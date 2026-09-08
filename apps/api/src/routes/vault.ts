import { VAULT_ITEM_TYPES } from '@seedoffice/core'
import { auditLogs, createDb, projects, secretVaultFolders, secretVaultItems, users } from '@seedoffice/db'
import { and, desc, eq, isNull, like, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { decryptSecret, encryptSecret } from '../lib/crypto'
import { notifyUser, usersWithMenuAccess } from '../lib/notify'
import { hashPin, verifyPin } from '../lib/vault-pin'
import { createVaultUnlock, revokeVaultUnlock, vaultUnlockValid } from '../lib/vault-session'
import type { AppEnv } from '../types'

/**
 * Pronista §Secret Vault (2026-09-03, เปิดเพดานสิทธิ์ได้ 2026-09-08) — คลังเก็บรหัสผ่าน/ข้อมูลลับ (mount ที่ index.ts พร้อม requireAuth+ceilingMenu('vault'))
 * ต่อโปรเจกต์ (projectId มีค่า) หรือส่วนกลางบริษัท (projectId ว่าง) — password/notes เข้ารหัส AES-GCM (VAULT_ENC_KEY)
 * ต้องปลดล็อคด้วย Master PIN ก่อนเห็น/สร้าง/แก้ไขข้อมูล plaintext (ดู requireVaultUnlock ด้านล่าง) — list เห็นได้เลยไม่ต้องปลดล็อค (ไม่มี plaintext อยู่ใน list)
 * §Secret Vault Permission (2026-09-08) — ปลดล็อคไม่ persist ข้าม mount ของหน้าแล้ว (ต้องใส่ PIN ทุกครั้งที่เข้าเมนู): token ส่งกลับใน response body
 * ไม่ใช่ cookie ฝั่ง client เก็บไว้ใน memory (React state) เองแล้วแนบมาทาง header `X-Vault-Token` เอา — server ยัง verify กับ DB เหมือนเดิม (TTL 15 นาที เป็น safety-net)
 */

const VAULT_TOKEN_HEADER = 'x-vault-token'

const pinPayload = z.object({ currentPin: z.string().optional(), newPin: z.string().min(4).max(20) })
const pinResetPayload = z.object({ userId: z.string() })
const unlockPayload = z.object({ pin: z.string().min(1) })
const itemCreatePayload = z.object({
  name: z.string().min(1),
  type: z.enum(VAULT_ITEM_TYPES).optional(),
  projectId: z.string().nullable().optional(),
  folderId: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  // Pronista §Secret Vault Type (2026-09-08) — ฟิลด์เสริมอิสระ (API Secret/Merchant ID/เลขบัตร ฯลฯ) แล้วแต่ type ที่เลือก
  extraFields: z.array(z.object({ label: z.string().min(1).max(60), value: z.string().max(2000) })).max(20).optional(),
})
const itemPatchPayload = itemCreatePayload.partial()
const folderPayload = z.object({ name: z.string().min(1).max(60) })

/** ต้องปลดล็อค Vault ด้วย PIN ก่อน (token แนบมาทาง header ทุกครั้ง ไม่มี cookie แล้ว, อายุ 15 นาที) — ใช้กับ endpoint ที่แตะ plaintext เท่านั้น (reveal/create/update) */
const requireVaultUnlock = createMiddleware<AppEnv>(async (c, next) => {
  const me = c.get('user')
  const token = c.req.header(VAULT_TOKEN_HEADER)
  if (!token || !(await vaultUnlockValid(c.env, me.id, token))) return c.json({ error: 'vault_locked' }, 401)
  await next()
})

export const vaultRoutes = new Hono<AppEnv>()

  // §Secret Vault Permission (2026-09-08) — ไม่มี cookie ให้เช็คแล้ว คืนแค่ hasPin (unlocked เป็น state ฝั่ง client ล้วนๆ ต่อการ mount)
  .get('/status', async (c) => {
    const me = c.get('user')
    const row = (await createDb(c.env.DB).select({ vaultPinHash: users.vaultPinHash }).from(users).where(eq(users.id, me.id)).limit(1))[0]
    return c.json({ hasPin: !!row?.vaultPinHash })
  })

  // ตั้ง/เปลี่ยน PIN — ตั้งครั้งแรกไม่ต้องมี currentPin, เปลี่ยนต้องยืนยัน currentPin ก่อนเสมอ
  .post('/pin', async (c) => {
    const body = pinPayload.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const row = (await db.select({ vaultPinHash: users.vaultPinHash }).from(users).where(eq(users.id, me.id)).limit(1))[0]
    if (row?.vaultPinHash) {
      if (!body.data.currentPin || !(await verifyPin(body.data.currentPin, row.vaultPinHash)))
        return c.json({ error: 'invalid_pin', message: 'PIN เดิมไม่ถูกต้อง' }, 403)
    }
    const vaultPinHash = await hashPin(body.data.newPin)
    await db.update(users).set({ vaultPinHash }).where(eq(users.id, me.id))
    await writeAudit(c.env, { actorId: me.id, action: 'vault_pin.set', entity: 'user', entityId: me.id })
    return c.json({ ok: true })
  })

  // owner คนไหนก็ reset PIN ให้ owner คนอื่นได้โดยไม่ต้องรู้ PIN เดิม (key ถอดรหัสจริงไม่ได้ผูกกับ PIN) — แก้ปัญหา "ลืม PIN"
  // §Secret Vault Permission (2026-09-08) — เปิดเมนูให้ non-owner เข้าได้แล้ว จุดนี้ต้องเช็ค role เองตรงๆ (เดิมพึ่ง ownerOnly ของ middleware ทั้งหมด) กัน member reset PIN คนอื่นได้ (privilege escalation)
  .post('/pin/reset', async (c) => {
    if (c.get('user').role !== 'owner') return c.json({ error: 'forbidden' }, 403)
    const body = pinResetPayload.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const target = (await db.select({ id: users.id }).from(users).where(eq(users.id, body.data.userId)).limit(1))[0]
    if (!target) return c.json({ error: 'not_found' }, 404)
    await db.update(users).set({ vaultPinHash: null }).where(eq(users.id, target.id))
    await writeAudit(c.env, { actorId: me.id, action: 'vault_pin.reset', entity: 'user', entityId: target.id })
    return c.json({ ok: true })
  })

  // §Secret Vault Permission (2026-09-08) — รายชื่อ user (id/name/email เท่านั้น) ให้ owner เลือกตอน reset PIN คนอื่น
  // แยกจาก /api/admin/users ตั้งใจ (endpoint นั้นเปิดกว้างกว่า non-owner บางหมวดด้วย — ไม่เอามาผูกกับ endpoint owner-only นี้)
  .get('/users', async (c) => {
    if (c.get('user').role !== 'owner') return c.json({ error: 'forbidden' }, 403)
    const db = createDb(c.env.DB)
    const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(isNull(users.deletedAt)).orderBy(users.name)
    return c.json(rows)
  })

  // §Secret Vault Permission (2026-09-08) — token คืนใน body แทน cookie (client เก็บใน memory เอง ไม่ persist ข้าม mount)
  // + แจ้งเตือนทุกคนที่มีสิทธิ์เข้าเมนูนี้ทันทีที่ปลดล็อคสำเร็จ (ยกเว้นตัวเอง) ตามที่ตกลงกันไว้
  .post('/unlock', async (c) => {
    const body = unlockPayload.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const row = (await db.select({ vaultPinHash: users.vaultPinHash }).from(users).where(eq(users.id, me.id)).limit(1))[0]
    if (!row?.vaultPinHash) return c.json({ error: 'pin_not_set' }, 400)
    if (!(await verifyPin(body.data.pin, row.vaultPinHash))) return c.json({ error: 'invalid_pin' }, 401)
    const { token } = await createVaultUnlock(c.env, me.id)
    await writeAudit(c.env, { actorId: me.id, action: 'vault.unlock', entity: 'user', entityId: me.id })
    const recipients = (await usersWithMenuAccess(db, 'vault')).filter((id) => id !== me.id)
    for (const userId of recipients) {
      await notifyUser(db, { userId, type: 'vault_accessed', message: `${me.name} เข้าใช้งาน Secret Vault` })
    }
    return c.json({ ok: true, token })
  })

  .post('/lock', async (c) => {
    const me = c.get('user')
    const token = c.req.header(VAULT_TOKEN_HEADER)
    if (token) await revokeVaultUnlock(c.env, token)
    await writeAudit(c.env, { actorId: me.id, action: 'vault.lock', entity: 'user', entityId: me.id })
    return c.json({ ok: true })
  })

  // metadata เท่านั้น — ห้ามมี passwordEnc/notesEnc หลุดออกมาเด็ดขาด ไม่ต้องปลดล็อคก็ดูได้
  .get('/items', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db
      .select({
        id: secretVaultItems.id,
        name: secretVaultItems.name,
        type: secretVaultItems.type,
        username: secretVaultItems.username,
        url: secretVaultItems.url,
        projectId: secretVaultItems.projectId,
        projectName: projects.name,
        folderId: secretVaultItems.folderId,
        folderName: secretVaultFolders.name,
        updatedAt: secretVaultItems.updatedAt,
      })
      .from(secretVaultItems)
      .leftJoin(projects, eq(secretVaultItems.projectId, projects.id))
      .leftJoin(secretVaultFolders, eq(secretVaultItems.folderId, secretVaultFolders.id))
      .where(isNull(secretVaultItems.deletedAt))
      .orderBy(desc(secretVaultItems.updatedAt))
    return c.json(rows)
  })

  // §Secret Vault Folder (2026-09-08) — Folder แยกอิสระจากโปรเจกต์ ใครก็ตามที่เข้าเมนู vault ได้ สร้าง/แก้/ลบได้ร่วมกัน (shared organization)
  .get('/folders', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db.select().from(secretVaultFolders).orderBy(secretVaultFolders.name)
    return c.json(rows)
  })

  .post('/folders', async (c) => {
    const body = folderPayload.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const created = (await db.insert(secretVaultFolders).values({ name: body.data.name, createdBy: me.id }).returning())[0]!
    await writeAudit(c.env, { actorId: me.id, action: 'secret_vault_folder.create', entity: 'secret_vault_folder', entityId: created.id, meta: { name: created.name } })
    return c.json(created, 201)
  })

  .patch('/folders/:id', async (c) => {
    const body = folderPayload.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select({ id: secretVaultFolders.id }).from(secretVaultFolders).where(eq(secretVaultFolders.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    await db.update(secretVaultFolders).set({ name: body.data.name }).where(eq(secretVaultFolders.id, before.id))
    await writeAudit(c.env, { actorId: me.id, action: 'secret_vault_folder.rename', entity: 'secret_vault_folder', entityId: before.id, meta: { name: body.data.name } })
    return c.json({ ok: true })
  })

  // ลบ Folder = แค่เอาป้ายออก ไม่ลบรายการข้างในตาม (soft ตามธรรมเนียม — เคลียร์ folderId ของ item ที่อยู่ในนั้นกลับเป็น null)
  .delete('/folders/:id', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select({ id: secretVaultFolders.id, name: secretVaultFolders.name }).from(secretVaultFolders).where(eq(secretVaultFolders.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    await db.update(secretVaultItems).set({ folderId: null }).where(eq(secretVaultItems.folderId, before.id))
    await db.delete(secretVaultFolders).where(eq(secretVaultFolders.id, before.id))
    await writeAudit(c.env, { actorId: me.id, action: 'secret_vault_folder.delete', entity: 'secret_vault_folder', entityId: before.id, meta: { name: before.name } })
    return c.json({ ok: true })
  })

  .get('/items/:id/reveal', requireVaultUnlock, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const row = (
      await db
        .select()
        .from(secretVaultItems)
        .where(and(eq(secretVaultItems.id, c.req.param('id')), isNull(secretVaultItems.deletedAt)))
        .limit(1)
    )[0]
    if (!row) return c.json({ error: 'not_found' }, 404)
    await writeAudit(c.env, { actorId: me.id, action: 'secret_vault_item.reveal', entity: 'secret_vault_item', entityId: row.id })
    return c.json({
      username: row.username,
      password: row.passwordEnc ? await decryptSecret(row.passwordEnc, c.env.VAULT_ENC_KEY) : null,
      url: row.url,
      notes: row.notesEnc ? await decryptSecret(row.notesEnc, c.env.VAULT_ENC_KEY) : null,
      extraFields: row.extraFieldsEnc ? (JSON.parse(await decryptSecret(row.extraFieldsEnc, c.env.VAULT_ENC_KEY)) as { label: string; value: string }[]) : [],
    })
  })

  .post('/items', requireVaultUnlock, async (c) => {
    const body = itemCreatePayload.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const { password, notes, extraFields, ...rest } = body.data
    const inserted = await db
      .insert(secretVaultItems)
      .values({
        ...rest,
        passwordEnc: password ? await encryptSecret(password, c.env.VAULT_ENC_KEY) : null,
        notesEnc: notes ? await encryptSecret(notes, c.env.VAULT_ENC_KEY) : null,
        extraFieldsEnc: extraFields && extraFields.length > 0 ? await encryptSecret(JSON.stringify(extraFields), c.env.VAULT_ENC_KEY) : null,
        createdBy: me.id,
      })
      .returning()
    const created = inserted[0]!
    await writeAudit(c.env, { actorId: me.id, action: 'secret_vault_item.create', entity: 'secret_vault_item', entityId: created.id, meta: { name: created.name } })
    return c.json({ id: created.id }, 201)
  })

  .patch('/items/:id', requireVaultUnlock, async (c) => {
    const body = itemPatchPayload.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (
      await db
        .select({ id: secretVaultItems.id, name: secretVaultItems.name })
        .from(secretVaultItems)
        .where(and(eq(secretVaultItems.id, c.req.param('id')), isNull(secretVaultItems.deletedAt)))
        .limit(1)
    )[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const { password, notes, extraFields, ...rest } = body.data
    const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() }
    if ('password' in body.data) patch.passwordEnc = password ? await encryptSecret(password, c.env.VAULT_ENC_KEY) : null
    if ('notes' in body.data) patch.notesEnc = notes ? await encryptSecret(notes, c.env.VAULT_ENC_KEY) : null
    if ('extraFields' in body.data) patch.extraFieldsEnc = extraFields && extraFields.length > 0 ? await encryptSecret(JSON.stringify(extraFields), c.env.VAULT_ENC_KEY) : null
    await db.update(secretVaultItems).set(patch).where(eq(secretVaultItems.id, before.id))
    await writeAudit(c.env, { actorId: me.id, action: 'secret_vault_item.update', entity: 'secret_vault_item', entityId: before.id, meta: { name: before.name } })
    return c.json({ ok: true })
  })

  .delete('/items/:id', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (
      await db
        .select({ id: secretVaultItems.id, name: secretVaultItems.name })
        .from(secretVaultItems)
        .where(and(eq(secretVaultItems.id, c.req.param('id')), isNull(secretVaultItems.deletedAt)))
        .limit(1)
    )[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    await db.update(secretVaultItems).set({ deletedAt: new Date() }).where(eq(secretVaultItems.id, before.id))
    await writeAudit(c.env, { actorId: me.id, action: 'secret_vault_item.delete', entity: 'secret_vault_item', entityId: before.id, meta: { name: before.name } })
    return c.json({ ok: true })
  })

  // §Secret Vault Permission (2026-09-08) — ประวัติการเข้าใช้งาน/action ทุกจุดของ Vault (unlock/lock/reveal/create/update/delete/pin) ไม่มี plaintext เลย ไม่ต้องปลดล็อคก็ดูได้
  .get('/audit', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db
      .select({ id: auditLogs.id, actorId: auditLogs.actorId, actorName: users.name, action: auditLogs.action, meta: auditLogs.meta, at: auditLogs.at })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorId, users.id))
      .where(or(like(auditLogs.action, 'vault%'), like(auditLogs.action, 'secret_vault_item%'), like(auditLogs.action, 'secret_vault_folder%')))
      .orderBy(desc(auditLogs.at))
      .limit(100)
    return c.json(rows)
  })
