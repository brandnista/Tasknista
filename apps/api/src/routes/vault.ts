import { createDb, projects, secretVaultItems, users } from '@seedoffice/db'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { decryptSecret, encryptSecret } from '../lib/crypto'
import { hashPin, verifyPin } from '../lib/vault-pin'
import { createVaultUnlock, revokeVaultUnlock, VAULT_UNLOCK_COOKIE, vaultUnlockValid } from '../lib/vault-session'
import type { AppEnv } from '../types'

/**
 * Pronista §Secret Vault (2026-09-03) — คลังเก็บรหัสผ่าน/ข้อมูลลับ owner-only (mount ที่ index.ts พร้อม requireAuth+ownerOnly)
 * ต่อโปรเจกต์ (projectId มีค่า) หรือส่วนกลางบริษัท (projectId ว่าง) — password/notes เข้ารหัส AES-GCM (VAULT_ENC_KEY)
 * ต้องปลดล็อคด้วย Master PIN ก่อนเห็น/สร้าง/แก้ไขข้อมูล plaintext (ดู requireVaultUnlock ด้านล่าง) — list เห็นได้เลยไม่ต้องปลดล็อค (ไม่มี plaintext อยู่ใน list)
 */

const pinPayload = z.object({ currentPin: z.string().optional(), newPin: z.string().min(4).max(20) })
const pinResetPayload = z.object({ userId: z.string() })
const unlockPayload = z.object({ pin: z.string().min(1) })
const itemCreatePayload = z.object({
  name: z.string().min(1),
  projectId: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  password: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})
const itemPatchPayload = itemCreatePayload.partial()

const isHttps = (appUrl: string) => appUrl.startsWith('https://')

/** ต้องปลดล็อค Vault ด้วย PIN ก่อน (session แยกจาก login หลัก, อายุ 15 นาที) — ใช้กับ endpoint ที่แตะ plaintext เท่านั้น (reveal/create/update) */
const requireVaultUnlock = createMiddleware<AppEnv>(async (c, next) => {
  const me = c.get('user')
  const token = getCookie(c, VAULT_UNLOCK_COOKIE)
  if (!token || !(await vaultUnlockValid(c.env, me.id, token))) return c.json({ error: 'vault_locked' }, 401)
  await next()
})

export const vaultRoutes = new Hono<AppEnv>()

  .get('/status', async (c) => {
    const me = c.get('user')
    const row = (await createDb(c.env.DB).select({ vaultPinHash: users.vaultPinHash }).from(users).where(eq(users.id, me.id)).limit(1))[0]
    const token = getCookie(c, VAULT_UNLOCK_COOKIE)
    const unlocked = !!token && (await vaultUnlockValid(c.env, me.id, token))
    return c.json({ hasPin: !!row?.vaultPinHash, unlocked })
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
  .post('/pin/reset', async (c) => {
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

  .post('/unlock', async (c) => {
    const body = unlockPayload.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const row = (await db.select({ vaultPinHash: users.vaultPinHash }).from(users).where(eq(users.id, me.id)).limit(1))[0]
    if (!row?.vaultPinHash) return c.json({ error: 'pin_not_set' }, 400)
    if (!(await verifyPin(body.data.pin, row.vaultPinHash))) return c.json({ error: 'invalid_pin' }, 401)
    const { token, expiresAt } = await createVaultUnlock(c.env, me.id)
    setCookie(c, VAULT_UNLOCK_COOKIE, token, {
      httpOnly: true,
      secure: isHttps(c.env.APP_URL),
      sameSite: 'Lax',
      path: '/',
      expires: expiresAt,
    })
    await writeAudit(c.env, { actorId: me.id, action: 'vault.unlock', entity: 'user', entityId: me.id })
    return c.json({ ok: true })
  })

  .post('/lock', async (c) => {
    const me = c.get('user')
    const token = getCookie(c, VAULT_UNLOCK_COOKIE)
    if (token) await revokeVaultUnlock(c.env, token)
    deleteCookie(c, VAULT_UNLOCK_COOKIE, { path: '/' })
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
        username: secretVaultItems.username,
        url: secretVaultItems.url,
        projectId: secretVaultItems.projectId,
        projectName: projects.name,
        updatedAt: secretVaultItems.updatedAt,
      })
      .from(secretVaultItems)
      .leftJoin(projects, eq(secretVaultItems.projectId, projects.id))
      .where(isNull(secretVaultItems.deletedAt))
      .orderBy(desc(secretVaultItems.updatedAt))
    return c.json(rows)
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
    })
  })

  .post('/items', requireVaultUnlock, async (c) => {
    const body = itemCreatePayload.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const { password, notes, ...rest } = body.data
    const inserted = await db
      .insert(secretVaultItems)
      .values({
        ...rest,
        passwordEnc: password ? await encryptSecret(password, c.env.VAULT_ENC_KEY) : null,
        notesEnc: notes ? await encryptSecret(notes, c.env.VAULT_ENC_KEY) : null,
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
    const { password, notes, ...rest } = body.data
    const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() }
    if ('password' in body.data) patch.passwordEnc = password ? await encryptSecret(password, c.env.VAULT_ENC_KEY) : null
    if ('notes' in body.data) patch.notesEnc = notes ? await encryptSecret(notes, c.env.VAULT_ENC_KEY) : null
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
