import { extractGoogleDriveFileId, groupDocSeries, isGoogleDriveUrl } from '@seedoffice/core'
import { createDb, docLinks, docs, DOC_TYPES, projects, users } from '@seedoffice/db'
import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { streamDocFile } from '../lib/doc-file'
import { getProjectPermissions, isProjectVisibleToUser } from '../lib/project-role'
import type { AppEnv } from '../types'

/**
 * Pronista §Project Documents (2026-09-17) — เอกสารในระดับโปรเจกต์: อัปโหลดไฟล์/ลิงก์ Google Drive บังคับเลือกประเภท+เวอร์ชัน
 * ต่างจาก /api/docs/* (wiki บริษัทเดิม) ตรงที่ใช้สิทธิ์ "เพดานโปรเจกต์" (project-role.ts + actions.doc.*) ไม่ใช่ doc-acl.ts
 * (doc-acl.ts กัน vendor/guest ออกทั้งหมดแบบไม่มีเงื่อนไข ไม่ตรงกับโจทย์ที่ต้องการ "ตรวจสอบ permission ของโปรเจกต์")
 * ยังใช้ตาราง docs เดิมเป็น entity กลาง (ไม่สร้างตารางคู่ขนาน) — "เวอร์ชันใหม่" = docs แถวใหม่ที่มี docType+docNumber เดียวกัน (pattern เดิมของระบบ)
 */

const MAX_FILE_BYTES = 15 * 1024 * 1024 // เท่ากับ docs.ts/task attachments
const ACCEPTED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
])

async function loadProject(db: ReturnType<typeof createDb>, projectId: string) {
  return (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
}

/** ยืนยันว่าเห็นโปรเจกต์นี้ได้ก่อนเสมอ (กัน guest ที่ไม่ใช่สมาชิกโปรเจกต์เข้าไม่ได้เลยตามที่โจทย์ต้องการ) — คืน permissions bundle ให้เรียกซ้ำต่อได้ */
async function requireProjectView(
  c: { env: AppEnv['Bindings']; get: (k: 'user') => { id: string; role: 'owner' | 'member' | 'vendor' | 'guest' } },
  db: ReturnType<typeof createDb>,
  projectId: string,
) {
  const me = c.get('user')
  const visible = await isProjectVisibleToUser(db, projectId, me.id, me.role)
  if (!visible) return null
  const permissions = await getProjectPermissions(db, projectId, me.id, me.role)
  return { me, permissions }
}

export const projectDocumentRoutes = new Hono<AppEnv>()

  // list — จัดกลุ่มเป็น "เล่ม" (docType+docNumber) เรียงเวอร์ชันล่าสุดก่อน
  .get('/:id/documents', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const ctx = await requireProjectView(c, db, projectId)
    if (!ctx) return c.json({ error: 'forbidden' }, 403)

    const rows = await db
      .select({
        id: docs.id,
        title: docs.title,
        kind: docs.kind,
        docType: docs.docType,
        docNumber: docs.docNumber,
        docVersion: docs.docVersion,
        externalUrl: docs.externalUrl,
        filename: docs.filename,
        mime: docs.mime,
        sizeBytes: docs.sizeBytes,
        source: docs.source,
        sourceTaskAttachmentId: docs.sourceTaskAttachmentId,
        updatedBy: docs.updatedBy,
        updatedAt: docs.updatedAt,
        createdAt: docs.createdAt,
      })
      .from(docLinks)
      .innerJoin(docs, eq(docLinks.docId, docs.id))
      .where(and(eq(docLinks.projectId, projectId), isNull(docs.deletedAt)))

    const userIds = [...new Set(rows.map((r) => r.updatedBy))]
    const nameRows = userIds.length > 0 ? await db.select({ id: users.id, name: users.name }).from(users) : []
    const nameOf = new Map(nameRows.map((u) => [u.id, u.name]))

    const series = groupDocSeries(rows.map((r) => ({ ...r, updatedAt: r.updatedAt ? +r.updatedAt : null })))
    return c.json({
      series: series.map((s) => ({
        ...s,
        versions: s.versions.map((v) => ({ ...v, updatedByName: nameOf.get(v.updatedBy) ?? null })),
      })),
      canCreate: ctx.permissions.actions.doc.create,
      canEdit: ctx.permissions.actions.doc.edit,
      canDelete: ctx.permissions.actions.doc.delete,
    })
  })

  // สร้างเอกสารใหม่ — อัปโหลดไฟล์ (multipart) บังคับ docType+docVersion
  .post('/:id/documents/upload', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const ctx = await requireProjectView(c, db, projectId)
    if (!ctx) return c.json({ error: 'forbidden' }, 403)
    if (!ctx.permissions.actions.doc.create) return c.json({ error: 'forbidden' }, 403)
    const project = await loadProject(db, projectId)
    if (!project) return c.json({ error: 'project_not_found' }, 404)

    const form = await c.req.formData()
    const file = form.get('file')
    const title = form.get('title')
    const docTypeRaw = form.get('docType')
    const docVersionRaw = form.get('docVersion')
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400)
    if (file.size === 0 || file.size > MAX_FILE_BYTES) return c.json({ error: 'file_too_large' }, 413)
    if (!ACCEPTED_MIME.has(file.type)) return c.json({ error: 'invalid_type', message: 'ชนิดไฟล์นี้ไม่รองรับ' }, 415)
    const docType = typeof docTypeRaw === 'string' && DOC_TYPES.includes(docTypeRaw as (typeof DOC_TYPES)[number]) ? (docTypeRaw as (typeof DOC_TYPES)[number]) : null
    if (!docType) return c.json({ error: 'doc_type_required', message: 'ต้องเลือกประเภทเอกสาร' }, 400)
    const docVersion = typeof docVersionRaw === 'string' ? docVersionRaw.trim().slice(0, 30) : ''
    if (!docVersion) return c.json({ error: 'doc_version_required', message: 'ต้องระบุเวอร์ชันเอกสาร' }, 400)

    const safeName = file.name.replaceAll('/', '_').slice(0, 120)
    const r2Key = `docs/${crypto.randomUUID()}-${safeName}`
    await c.env.FILES.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type } })
    const inserted = await db
      .insert(docs)
      .values({
        title: typeof title === 'string' && title ? title : safeName,
        kind: 'file',
        r2Key,
        filename: safeName,
        mime: file.type,
        sizeBytes: file.size,
        docType,
        docVersion,
        source: 'upload',
        ownerId: ctx.me.id,
        createdBy: ctx.me.id,
        updatedBy: ctx.me.id,
      })
      .returning()
    const doc = inserted[0]!
    await db.insert(docLinks).values({ docId: doc.id, projectId, createdBy: ctx.me.id })
    await writeAudit(c.env, { actorId: ctx.me.id, action: 'doc.create', entity: 'doc', entityId: doc.id, meta: { filename: safeName, projectId, docType, docVersion } })
    return c.json(doc, 201)
  })

  // สร้างเอกสารใหม่ — ลิงก์ Google Drive/Docs เท่านั้น (เข้มกว่า /api/docs/link ที่รับ URL อะไรก็ได้)
  .post('/:id/documents/link', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const ctx = await requireProjectView(c, db, projectId)
    if (!ctx) return c.json({ error: 'forbidden' }, 403)
    if (!ctx.permissions.actions.doc.create) return c.json({ error: 'forbidden' }, 403)
    const project = await loadProject(db, projectId)
    if (!project) return c.json({ error: 'project_not_found' }, 404)

    const body = z
      .object({ title: z.string().min(1).max(200), externalUrl: z.string().url(), docType: z.enum(DOC_TYPES), docVersion: z.string().min(1).max(30) })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    if (!isGoogleDriveUrl(body.data.externalUrl))
      return c.json({ error: 'invalid_host', message: 'ต้องเป็นลิงก์ Google Drive หรือ Google Docs เท่านั้น' }, 400)
    const driveFileId = extractGoogleDriveFileId(body.data.externalUrl)

    const inserted = await db
      .insert(docs)
      .values({
        title: body.data.title,
        kind: 'link',
        externalUrl: body.data.externalUrl,
        driveFileId,
        docType: body.data.docType,
        docVersion: body.data.docVersion.trim(),
        source: 'gdrive',
        ownerId: ctx.me.id,
        createdBy: ctx.me.id,
        updatedBy: ctx.me.id,
      })
      .returning()
    const doc = inserted[0]!
    await db.insert(docLinks).values({ docId: doc.id, projectId, createdBy: ctx.me.id })
    await writeAudit(c.env, { actorId: ctx.me.id, action: 'doc.create', entity: 'doc', entityId: doc.id, meta: { externalUrl: body.data.externalUrl, projectId, docType: body.data.docType } })
    return c.json(doc, 201)
  })

  // แก้ metadata เท่านั้น (title/docType/docVersion) — แยกจาก action อัปโหลดเวอร์ชันใหม่ด้านล่าง
  .patch('/:id/documents/:docId', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const ctx = await requireProjectView(c, db, projectId)
    if (!ctx) return c.json({ error: 'forbidden' }, 403)
    if (!ctx.permissions.actions.doc.edit) return c.json({ error: 'forbidden' }, 403)
    const body = z
      .object({ title: z.string().min(1).max(200).optional(), docType: z.enum(DOC_TYPES).nullable().optional(), docVersion: z.string().min(1).max(30).optional() })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const before = (await db.select().from(docs).where(and(eq(docs.id, c.req.param('docId')), isNull(docs.deletedAt))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const linked = (await db.select({ id: docLinks.id }).from(docLinks).where(and(eq(docLinks.docId, before.id), eq(docLinks.projectId, projectId))).limit(1))[0]
    if (!linked) return c.json({ error: 'not_found' }, 404)
    const updated = await db.update(docs).set({ ...body.data, updatedBy: ctx.me.id, updatedAt: new Date() }).where(eq(docs.id, before.id)).returning()
    await writeAudit(c.env, { actorId: ctx.me.id, action: 'doc.edit_metadata', entity: 'doc', entityId: before.id, meta: { before: { title: before.title, docType: before.docType, docVersion: before.docVersion }, after: body.data } })
    return c.json(updated[0])
  })

  // เพิ่มเวอร์ชันใหม่ให้เอกสารที่มีอยู่ — copy docNumber/docType/title จากเอกสารต้นทาง บังคับ docVersion ใหม่ + ไฟล์ใหม่
  .post('/:id/documents/:docId/versions/upload', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const ctx = await requireProjectView(c, db, projectId)
    if (!ctx) return c.json({ error: 'forbidden' }, 403)
    if (!ctx.permissions.actions.doc.create) return c.json({ error: 'forbidden' }, 403)
    const base = (await db.select().from(docs).where(and(eq(docs.id, c.req.param('docId')), isNull(docs.deletedAt))).limit(1))[0]
    if (!base) return c.json({ error: 'not_found' }, 404)
    const linked = (await db.select({ id: docLinks.id }).from(docLinks).where(and(eq(docLinks.docId, base.id), eq(docLinks.projectId, projectId))).limit(1))[0]
    if (!linked) return c.json({ error: 'not_found' }, 404)

    const form = await c.req.formData()
    const file = form.get('file')
    const docVersionRaw = form.get('docVersion')
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400)
    if (file.size === 0 || file.size > MAX_FILE_BYTES) return c.json({ error: 'file_too_large' }, 413)
    if (!ACCEPTED_MIME.has(file.type)) return c.json({ error: 'invalid_type', message: 'ชนิดไฟล์นี้ไม่รองรับ' }, 415)
    const docVersion = typeof docVersionRaw === 'string' ? docVersionRaw.trim().slice(0, 30) : ''
    if (!docVersion) return c.json({ error: 'doc_version_required', message: 'ต้องระบุเวอร์ชันเอกสาร' }, 400)

    const safeName = file.name.replaceAll('/', '_').slice(0, 120)
    const r2Key = `docs/${crypto.randomUUID()}-${safeName}`
    await c.env.FILES.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type } })
    const inserted = await db
      .insert(docs)
      .values({
        title: base.title,
        kind: 'file',
        r2Key,
        filename: safeName,
        mime: file.type,
        sizeBytes: file.size,
        docType: base.docType,
        docNumber: base.docNumber ?? base.id, // เอกสารต้นทางยังไม่มีเลขที่ (เล่มเดี่ยว) — ใช้ id ของแถวแรกเป็นเลขที่เล่มให้เวอร์ชันถัดไปกลุ่มตามได้
        docVersion,
        source: 'upload',
        ownerId: ctx.me.id,
        createdBy: ctx.me.id,
        updatedBy: ctx.me.id,
      })
      .returning()
    const doc = inserted[0]!
    // เอกสารต้นทางยังไม่มี docNumber มาก่อน (เล่มเดี่ยว) — เติมให้ตรงกับเวอร์ชันใหม่ที่เพิ่งสร้าง ไม่งั้นจะไม่ group เป็นเล่มเดียวกัน
    if (!base.docNumber) await db.update(docs).set({ docNumber: doc.docNumber }).where(eq(docs.id, base.id))
    await db.insert(docLinks).values({ docId: doc.id, projectId, createdBy: ctx.me.id })
    await writeAudit(c.env, { actorId: ctx.me.id, action: 'doc.version_add', entity: 'doc', entityId: doc.id, meta: { baseDocId: base.id, docVersion } })
    return c.json(doc, 201)
  })

  // ลบ = soft-delete (ใช้ deletedAt เดิม — GET/list ทุกจุดกรอง isNull(deletedAt) อยู่แล้ว)
  .delete('/:id/documents/:docId', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const ctx = await requireProjectView(c, db, projectId)
    if (!ctx) return c.json({ error: 'forbidden' }, 403)
    if (!ctx.permissions.actions.doc.delete) return c.json({ error: 'forbidden' }, 403)
    const before = (await db.select().from(docs).where(and(eq(docs.id, c.req.param('docId')), isNull(docs.deletedAt))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const linked = (await db.select({ id: docLinks.id }).from(docLinks).where(and(eq(docLinks.docId, before.id), eq(docLinks.projectId, projectId))).limit(1))[0]
    if (!linked) return c.json({ error: 'not_found' }, 404)
    await db.update(docs).set({ deletedAt: new Date() }).where(eq(docs.id, before.id))
    await writeAudit(c.env, { actorId: ctx.me.id, action: 'doc.delete', entity: 'doc', entityId: before.id, meta: { title: before.title, projectId } })
    return c.json({ ok: true })
  })

  // เปิด/ดาวน์โหลดไฟล์ — gate ด้วยสิทธิ์โปรเจกต์ (ไม่ใช่ doc-acl.ts)
  .get('/:id/documents/:docId/raw', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const ctx = await requireProjectView(c, db, projectId)
    if (!ctx) return c.json({ error: 'forbidden' }, 403)
    const doc = (await db.select().from(docs).where(and(eq(docs.id, c.req.param('docId')), isNull(docs.deletedAt))).limit(1))[0]
    if (!doc || doc.kind !== 'file') return c.json({ error: 'not_found' }, 404)
    const linked = (await db.select({ id: docLinks.id }).from(docLinks).where(and(eq(docLinks.docId, doc.id), eq(docLinks.projectId, projectId))).limit(1))[0]
    if (!linked) return c.json({ error: 'not_found' }, 404)
    return streamDocFile(c.env, doc)
  })
