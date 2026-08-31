import { createDb, personalFileMembers, personalFiles, users, PERSONAL_FILE_MEMBER_ROLES } from '@seedoffice/db'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { INLINE_SAFE_MIME } from '../lib/file-safety'
import { canEditPersonalFile, canViewPersonalFile, getPersonalFileAccess } from '../lib/personal-files'
import type { AppEnv } from '../types'

/**
 * Pronista §My Files (2026-08-28) — ไดรฟ์ส่วนตัว "ไฟล์ของฉัน" / "แชร์กับฉัน" ใต้เมนู "งานของฉัน"
 * รับทุกนามสกุลไฟล์ (พี่ยืนยันแล้ว) — แต่เพื่อความปลอดภัย ดาวน์โหลดบังคับ attachment เสมอยกเว้นชนิดที่ปลอดภัยจริง (PDF/รูปภาพทั่วไป) กัน browser เปิด/รัน HTML-SVG แฝงสคริปต์แบบ inline
 * ขนาดไฟล์ไม่ตั้งเพดานเอง (สตรีมตรงเข้า R2 ไม่ผ่านหน่วยความจำ) — เพดานจริงคือสิ่งที่แพลตฟอร์ม Cloudflare Workers อนุญาตต่อ request body
 * เมนูนี้เปิดให้ owner/member/vendor (ไม่รวม guest — ตกลงกับพี่แล้ว)
 */
export const myFileRoutes = new Hono<AppEnv>()

const createPayload = z.object({
  kind: z.enum(['folder', 'page']),
  name: z.string().min(1).max(255),
  parentId: z.string().nullable().optional(),
  contentMarkdown: z.string().optional(), // kind='page' เท่านั้น
})

myFileRoutes
  // parentId ไม่ระบุ = root ของตัวเอง (เฉพาะที่ตัวเองเป็นเจ้าของ) · ระบุ = ต้องมีสิทธิ์เข้าโฟลเดอร์นั้นก่อน (เจ้าของ หรือ ถูกแชร์มา) แล้วเห็นลูกทุกชิ้นข้างในไม่ว่าใครสร้าง
  .get('/my-files', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const parentId = c.req.query('parentId') || null
    let folder: { id: string; name: string; parentId: string | null; access: string } | null = null
    if (parentId) {
      const row = (await db.select().from(personalFiles).where(and(eq(personalFiles.id, parentId), isNull(personalFiles.deletedAt))).limit(1))[0]
      if (!row || row.kind !== 'folder') return c.json({ error: 'not_found' }, 404)
      const access = await getPersonalFileAccess(db, parentId, me.id)
      if (!canViewPersonalFile(access)) return c.json({ error: 'forbidden' }, 403)
      folder = { id: row.id, name: row.name, parentId: row.parentId, access }
    }
    const items = await db
      .select({ file: personalFiles, ownerName: users.name })
      .from(personalFiles)
      .leftJoin(users, eq(personalFiles.ownerId, users.id))
      .where(and(parentId ? eq(personalFiles.parentId, parentId) : and(isNull(personalFiles.parentId), eq(personalFiles.ownerId, me.id)), isNull(personalFiles.deletedAt)))
    // Pronista §My Files bug fix (2026-08-28) — บอกฝั่งหน้าบ้านตรงๆ ว่าใครเป็นเจ้าของจริงต่อแถว (กันปุ่ม "แชร์" โผล่ผิดคนตอนไล่เข้าโฟลเดอร์ที่มีลูกเจ้าของปนกัน — ดู my-files.ts ฝั่ง frontend)
    return c.json({ folder, items: items.map((r) => ({ ...r.file, ownerName: r.ownerName, isOwner: r.file.ownerId === me.id })) })
  })

  // แชร์กับฉัน — เฉพาะรายการที่ถูกแชร์ตรงถึงตัวเอง (ไม่ใช่เจ้าของ) แบบแบน ไม่ไล่ลูกหลาน — กดเข้าโฟลเดอร์ที่แชร์มาแล้วค่อยเห็นลูกผ่าน GET /my-files?parentId=
  .get('/my-files/shared', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const rows = await db
      .select({ file: personalFiles, ownerName: users.name, role: personalFileMembers.role })
      .from(personalFileMembers)
      .innerJoin(personalFiles, eq(personalFileMembers.fileId, personalFiles.id))
      .leftJoin(users, eq(personalFiles.ownerId, users.id))
      .where(and(eq(personalFileMembers.userId, me.id), isNull(personalFiles.deletedAt), ne(personalFiles.ownerId, me.id)))
    return c.json(rows.map((r) => ({ ...r.file, ownerName: r.ownerName, myRole: r.role, isOwner: false })))
  })

  .post('/my-files', async (c) => {
    const body = createPayload.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const parentId = body.data.parentId ?? null
    if (parentId) {
      const access = await getPersonalFileAccess(db, parentId, me.id)
      if (!canEditPersonalFile(access)) return c.json({ error: 'forbidden' }, 403)
    }
    const created = (
      await db
        .insert(personalFiles)
        .values({
          ownerId: me.id,
          parentId,
          kind: body.data.kind,
          name: body.data.name,
          contentMarkdown: body.data.kind === 'page' ? (body.data.contentMarkdown ?? '') : null,
          createdBy: me.id,
          updatedBy: me.id,
        })
        .returning()
    )[0]!
    await writeAudit(c.env, { actorId: me.id, action: 'personal_file.create', entity: 'personal_file', entityId: created.id, meta: { kind: created.kind, name: created.name } })
    return c.json(created, 201)
  })

  // อัปโหลดไฟล์ทั่วไป (multipart) → สตรีมตรงเข้า R2 ไม่บัฟเฟอร์ทั้งไฟล์ในหน่วยความจำ — รับทุกนามสกุล
  .post('/my-files/upload', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const form = await c.req.formData()
    const file = form.get('file')
    const parentIdRaw = form.get('parentId')
    const parentId = typeof parentIdRaw === 'string' && parentIdRaw ? parentIdRaw : null
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400)
    if (file.size === 0) return c.json({ error: 'file_empty' }, 400)
    if (parentId) {
      const access = await getPersonalFileAccess(db, parentId, me.id)
      if (!canEditPersonalFile(access)) return c.json({ error: 'forbidden' }, 403)
    }
    const safeName = file.name.replaceAll('/', '_').slice(0, 120)
    const r2Key = `personal-files/${me.id}/${crypto.randomUUID()}-${safeName}`
    await c.env.FILES.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } })
    const created = (
      await db
        .insert(personalFiles)
        .values({
          ownerId: me.id,
          parentId,
          kind: 'file',
          name: safeName,
          r2Key,
          mime: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          createdBy: me.id,
          updatedBy: me.id,
        })
        .returning()
    )[0]!
    await writeAudit(c.env, { actorId: me.id, action: 'personal_file.upload', entity: 'personal_file', entityId: created.id, meta: { name: safeName, sizeBytes: file.size } })
    return c.json(created, 201)
  })

  .get('/my-files/:id', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const file = (await db.select().from(personalFiles).where(and(eq(personalFiles.id, c.req.param('id')), isNull(personalFiles.deletedAt))).limit(1))[0]
    if (!file) return c.json({ error: 'not_found' }, 404)
    const access = await getPersonalFileAccess(db, file.id, me.id)
    if (!canViewPersonalFile(access)) return c.json({ error: 'forbidden' }, 403)
    return c.json({ ...file, myAccess: access })
  })

  .get('/my-files/:id/download', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const file = (await db.select().from(personalFiles).where(and(eq(personalFiles.id, c.req.param('id')), isNull(personalFiles.deletedAt))).limit(1))[0]
    if (!file || file.kind !== 'file' || !file.r2Key) return c.json({ error: 'not_found' }, 404)
    const access = await getPersonalFileAccess(db, file.id, me.id)
    if (!canViewPersonalFile(access)) return c.json({ error: 'forbidden' }, 403)
    const obj = await c.env.FILES.get(file.r2Key)
    if (!obj) return c.json({ error: 'object_missing' }, 404)
    const inlineSafe = file.mime ? INLINE_SAFE_MIME.has(file.mime) : false
    return new Response(obj.body, {
      headers: {
        'content-type': file.mime ?? 'application/octet-stream',
        'content-disposition': `${inlineSafe ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.name)}"`,
        'cache-control': 'private, max-age=3600',
      },
    })
  })

  .patch('/my-files/:id', async (c) => {
    const body = z
      .object({ name: z.string().min(1).max(255).optional(), contentMarkdown: z.string().optional() })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(personalFiles).where(and(eq(personalFiles.id, c.req.param('id')), isNull(personalFiles.deletedAt))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const access = await getPersonalFileAccess(db, before.id, me.id)
    if (!canEditPersonalFile(access)) return c.json({ error: 'forbidden' }, 403)
    const patch: Record<string, unknown> = { updatedBy: me.id, updatedAt: new Date() }
    if (body.data.name !== undefined) patch.name = body.data.name
    if (body.data.contentMarkdown !== undefined && before.kind === 'page') patch.contentMarkdown = body.data.contentMarkdown
    const updated = (await db.update(personalFiles).set(patch).where(eq(personalFiles.id, before.id)).returning())[0]
    return c.json(updated)
  })

  // ย้าย — กันย้ายลงใต้ลูกหลานตัวเอง (cycle) เหมือน docs.ts:/:id/move
  .post('/my-files/:id/move', async (c) => {
    const body = z.object({ parentId: z.string().nullable() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const id = c.req.param('id')
    const access = await getPersonalFileAccess(db, id, me.id)
    if (!canEditPersonalFile(access)) return c.json({ error: 'forbidden' }, 403)
    if (body.data.parentId) {
      const targetAccess = await getPersonalFileAccess(db, body.data.parentId, me.id)
      if (!canEditPersonalFile(targetAccess)) return c.json({ error: 'forbidden' }, 403)
      const all = await db.select({ id: personalFiles.id, parentId: personalFiles.parentId }).from(personalFiles).where(isNull(personalFiles.deletedAt))
      let cur: string | null = body.data.parentId
      while (cur) {
        if (cur === id) return c.json({ error: 'cycle', message: 'ย้ายลงใต้โฟลเดอร์ลูกของตัวเองไม่ได้' }, 409)
        cur = all.find((d) => d.id === cur)?.parentId ?? null
      }
    }
    const updated = (await db.update(personalFiles).set({ parentId: body.data.parentId, updatedBy: me.id, updatedAt: new Date() }).where(eq(personalFiles.id, id)).returning())[0]
    if (!updated) return c.json({ error: 'not_found' }, 404)
    return c.json(updated)
  })

  // ลบ = soft-delete ทั้ง subtree (owner หรือ editor ของไฟล์นั้น — เหมือนกติกา docs.ts)
  .delete('/my-files/:id', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const id = c.req.param('id')
    const access = await getPersonalFileAccess(db, id, me.id)
    if (!canEditPersonalFile(access)) return c.json({ error: 'forbidden' }, 403)
    const all = await db.select({ id: personalFiles.id, parentId: personalFiles.parentId, name: personalFiles.name }).from(personalFiles).where(isNull(personalFiles.deletedAt))
    const target = all.find((d) => d.id === id)
    if (!target) return c.json({ error: 'not_found' }, 404)
    const toDelete = new Set([id])
    let grew = true
    while (grew) {
      grew = false
      for (const d of all)
        if (d.parentId && toDelete.has(d.parentId) && !toDelete.has(d.id)) {
          toDelete.add(d.id)
          grew = true
        }
    }
    const now = new Date()
    for (const did of toDelete) await db.update(personalFiles).set({ deletedAt: now }).where(eq(personalFiles.id, did))
    await writeAudit(c.env, { actorId: me.id, action: 'personal_file.delete', entity: 'personal_file', entityId: id, meta: { name: target.name, count: toDelete.size } })
    return c.json({ deleted: toDelete.size })
  })

  // สิทธิ์แชร์ — จัดการได้เฉพาะเจ้าของไฟล์/โฟลเดอร์นั้นเท่านั้น (ไม่ใช่แค่ editor — การให้สิทธิ์คนอื่นเป็นเรื่องละเอียดอ่อนกว่าการแก้เนื้อหา)
  .get('/my-files/:id/members', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const access = await getPersonalFileAccess(db, c.req.param('id'), me.id)
    if (!canViewPersonalFile(access)) return c.json({ error: 'forbidden' }, 403)
    const rows = await db
      .select({ id: users.id, name: users.name, role: personalFileMembers.role })
      .from(personalFileMembers)
      .innerJoin(users, eq(personalFileMembers.userId, users.id))
      .where(eq(personalFileMembers.fileId, c.req.param('id')))
    return c.json(rows)
  })

  .post('/my-files/:id/members', async (c) => {
    const body = z.object({ userId: z.string(), role: z.enum(PERSONAL_FILE_MEMBER_ROLES) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const fileId = c.req.param('id')
    const access = await getPersonalFileAccess(db, fileId, me.id)
    if (access !== 'owner') return c.json({ error: 'forbidden' }, 403)
    const upserted = (
      await db
        .insert(personalFileMembers)
        .values({ fileId, userId: body.data.userId, role: body.data.role })
        .onConflictDoUpdate({ target: [personalFileMembers.fileId, personalFileMembers.userId], set: { role: body.data.role } })
        .returning()
    )[0]
    await writeAudit(c.env, { actorId: me.id, action: 'personal_file.share', entity: 'personal_file', entityId: fileId, meta: { userId: body.data.userId, role: body.data.role } })
    return c.json(upserted, 201)
  })

  .delete('/my-files/:id/members/:userId', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const fileId = c.req.param('id')
    const access = await getPersonalFileAccess(db, fileId, me.id)
    if (access !== 'owner') return c.json({ error: 'forbidden' }, 403)
    await db.delete(personalFileMembers).where(and(eq(personalFileMembers.fileId, fileId), eq(personalFileMembers.userId, c.req.param('userId'))))
    await writeAudit(c.env, { actorId: me.id, action: 'personal_file.unshare', entity: 'personal_file', entityId: fileId, meta: { userId: c.req.param('userId') } })
    return c.json({ ok: true })
  })
