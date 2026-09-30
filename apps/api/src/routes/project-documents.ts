import { bkkDateOf, emptyTemplateData, extractGoogleDriveFileId, getDocTemplate, groupDocSeries, isGoogleDriveUrl, type TemplateData } from '@seedoffice/core'
import { createDb, docLinks, docMembers, docs, DOC_TYPES, docTemplateValues, projects, users } from '@seedoffice/db'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { canEditDoc, getDocAccess } from '../lib/doc-acl'
import { streamDocFile } from '../lib/doc-file'
import { matchMemberNames, parseMomDocx } from '../lib/mom-import'
import { getProjectPermissions, isProjectVisibleToUser } from '../lib/project-role'
import { sanitizeCodePrefix } from '../lib/task-code'
import { nextTemplateDocNumber } from '../lib/template-doc-code'
import type { AppEnv } from '../types'
import { findOrCreateTemplateFolder } from './docs'

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
        templateType: docs.templateType,
        templateDocNumber: docs.templateDocNumber,
        sourceTaskAttachmentId: docs.sourceTaskAttachmentId,
        updatedBy: docs.updatedBy,
        updatedAt: docs.updatedAt,
        createdAt: docs.createdAt,
      })
      .from(docLinks)
      .innerJoin(docs, eq(docLinks.docId, docs.id))
      .where(and(eq(docLinks.projectId, projectId), isNull(docs.deletedAt), ne(docs.kind, 'folder')))

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

  // ─── ผูกเอกสารที่มีอยู่แล้วในเมนู "เอกสาร" เข้าโปรเจกต์ (2026-09-30) ───
  // เอกสารส่วนกลางมีสิทธิ์แยก (doc-acl.ts) — vendor/guest ไม่เข้าเมนูเอกสารเลย จึงผูกไม่ได้ · ต้องเป็นเจ้าของ/editor ของเอกสารนั้นถึงผูกได้ (เพราะสมาชิกโปรเจกต์จะเห็นไฟล์นี้ด้วย)
  .get('/:id/documents/linkable', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const ctx = await requireProjectView(c, db, projectId)
    if (!ctx) return c.json({ error: 'forbidden' }, 403)
    if (!ctx.permissions.actions.doc.create) return c.json({ error: 'forbidden' }, 403)
    if (ctx.me.role !== 'owner' && ctx.me.role !== 'member') return c.json({ error: 'forbidden' }, 403)

    const already = await db.select({ docId: docLinks.docId }).from(docLinks).where(eq(docLinks.projectId, projectId))
    const alreadySet = new Set(already.map((r) => r.docId))
    const rows = await db
      .select({
        id: docs.id,
        title: docs.title,
        kind: docs.kind,
        docType: docs.docType,
        docVersion: docs.docVersion,
        templateDocNumber: docs.templateDocNumber,
        filename: docs.filename,
        ownerId: docs.ownerId,
        updatedAt: docs.updatedAt,
      })
      .from(docs)
      .where(and(isNull(docs.deletedAt), ne(docs.kind, 'folder')))
    const myEditorRows = await db.select({ docId: docMembers.docId }).from(docMembers).where(and(eq(docMembers.userId, ctx.me.id), eq(docMembers.role, 'editor')))
    const editorSet = new Set(myEditorRows.map((r) => r.docId))
    const items = rows
      .filter((r) => !alreadySet.has(r.id) && (ctx.me.role === 'owner' || r.ownerId === ctx.me.id || editorSet.has(r.id)))
      .sort((a, b) => (b.updatedAt ? +b.updatedAt : 0) - (a.updatedAt ? +a.updatedAt : 0))
      .slice(0, 300)
      .map((r) => ({ id: r.id, title: r.title, kind: r.kind, docType: r.docType, docVersion: r.docVersion, templateDocNumber: r.templateDocNumber, filename: r.filename }))
    return c.json({ items })
  })

  .post('/:id/documents/link-existing', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const ctx = await requireProjectView(c, db, projectId)
    if (!ctx) return c.json({ error: 'forbidden' }, 403)
    if (!ctx.permissions.actions.doc.create) return c.json({ error: 'forbidden' }, 403)
    if (ctx.me.role !== 'owner' && ctx.me.role !== 'member') return c.json({ error: 'forbidden' }, 403)
    const body = z.object({ docId: z.string().min(1) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const doc = (await db.select().from(docs).where(and(eq(docs.id, body.data.docId), isNull(docs.deletedAt))).limit(1))[0]
    if (!doc || doc.kind === 'folder') return c.json({ error: 'not_found' }, 404)
    const access = await getDocAccess(db, doc.id, ctx.me.id, ctx.me.role)
    if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    const existing = (await db.select({ id: docLinks.id }).from(docLinks).where(and(eq(docLinks.docId, doc.id), eq(docLinks.projectId, projectId))).limit(1))[0]
    if (!existing) {
      await db.insert(docLinks).values({ docId: doc.id, projectId, createdBy: ctx.me.id })
      await writeAudit(c.env, { actorId: ctx.me.id, action: 'doc.link_project', entity: 'doc', entityId: doc.id, meta: { title: doc.title, projectId } })
    }
    return c.json({ ok: true, alreadyLinked: !!existing })
  })

  // ─── อัปโหลด MOM (.docx) → กรอก Template "MOM" ให้อัตโนมัติ (2026-09-30) ───
  // ขั้น 1: preview — อ่านไฟล์แล้วคืนข้อมูลที่แกะได้ให้ตรวจก่อน (ไม่บันทึกอะไร ไม่เก็บไฟล์)
  .post('/:id/documents/import-mom/preview', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const ctx = await requireProjectView(c, db, projectId)
    if (!ctx) return c.json({ error: 'forbidden' }, 403)
    if (!ctx.permissions.actions.doc.create) return c.json({ error: 'forbidden' }, 403)
    if (ctx.me.role !== 'owner' && ctx.me.role !== 'member') return c.json({ error: 'forbidden' }, 403)
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400)
    if (file.size === 0 || file.size > MAX_FILE_BYTES) return c.json({ error: 'file_too_large' }, 413)
    if (!file.name.toLowerCase().endsWith('.docx')) return c.json({ error: 'invalid_type', message: 'รองรับเฉพาะไฟล์ Word (.docx)' }, 415)
    let parsed: ReturnType<typeof parseMomDocx>
    try {
      parsed = parseMomDocx(new Uint8Array(await file.arrayBuffer()))
    } catch {
      return c.json({ error: 'invalid_docx', message: 'อ่านไฟล์ Word นี้ไม่ได้ — ตรวจว่าเป็นไฟล์ .docx ที่ไม่เสียหาย' }, 400)
    }
    const userRows = await db.select({ name: users.name }).from(users).where(isNull(users.deletedAt))
    const data = matchMemberNames(parsed.data, userRows.map((u) => u.name))
    return c.json({
      filename: file.name,
      suggestedTitle: parsed.subject ?? file.name.replace(/\.docx$/i, ''),
      docNumber: parsed.docNumber,
      data,
      counts: parsed.counts,
      warnings: parsed.warnings,
    })
  })

  // ขั้น 2: สร้างเอกสาร Template MOM จากข้อมูลที่ผู้ใช้ตรวจแล้ว — ผูกโปรเจกต์นี้อัตโนมัติ · แท็กประเภท MOM (ขึ้นในตัวกรองประเภทเอกสาร)
  .post('/:id/documents/import-mom', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const ctx = await requireProjectView(c, db, projectId)
    if (!ctx) return c.json({ error: 'forbidden' }, 403)
    if (!ctx.permissions.actions.doc.create) return c.json({ error: 'forbidden' }, 403)
    if (ctx.me.role !== 'owner' && ctx.me.role !== 'member') return c.json({ error: 'forbidden' }, 403)
    const project = await loadProject(db, projectId)
    if (!project) return c.json({ error: 'project_not_found' }, 404)
    const body = z
      .object({
        title: z.string().min(1).max(200),
        data: z.object({
          fields: z.record(z.string(), z.record(z.string(), z.string().max(20000))),
          tables: z.record(z.string(), z.array(z.record(z.string(), z.string().max(20000))).max(200)),
          lists: z.record(z.string(), z.array(z.string().max(5000)).max(200)),
        }),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const def = getDocTemplate('mom')
    if (!def) return c.json({ error: 'invalid_template_type' }, 400)

    // เก็บเฉพาะ section/คอลัมน์ที่ template รู้จัก (ทิ้งคีย์แปลกปลอม) — ที่ขาดเติมค่าว่างตามโครงเดิม
    const base = emptyTemplateData(def)
    const input = body.data.data as TemplateData
    const clean: TemplateData = { fields: {}, tables: {}, lists: {} }
    for (const s of def.sections) {
      if (s.kind === 'fields') {
        clean.fields[s.id] = Object.fromEntries(s.fields.map((f) => [f.key, input.fields[s.id]?.[f.key] ?? '']))
      } else if (s.kind === 'table') {
        const rows = input.tables[s.id]
        clean.tables[s.id] = rows && rows.length > 0 ? rows.map((r) => Object.fromEntries(s.columns.map((col) => [col.key, r[col.key] ?? '']))) : base.tables[s.id]!
      } else {
        const items = input.lists[s.id]
        clean.lists[s.id] = items && items.length > 0 ? items : base.lists[s.id]!
      }
    }

    // เลขที่เอกสาร: ใช้เลขที่อ่านจากไฟล์ถ้ายังไม่มีเอกสารอื่นใช้ ไม่งั้นออกเลขใหม่ตามระบบ
    const importedNo = (clean.fields.meeting_info?.document_no ?? '').trim()
    const taken = importedNo ? (await db.select({ id: docs.id }).from(docs).where(and(eq(docs.templateDocNumber, importedNo), isNull(docs.deletedAt))).limit(1))[0] : undefined
    let templateDocNumber: string
    if (importedNo && !taken) {
      templateDocNumber = importedNo
    } else {
      const [y = '', m = '', d = ''] = bkkDateOf(Date.now()).split('-')
      templateDocNumber = await nextTemplateDocNumber(db, sanitizeCodePrefix(project.code, 'DOC'), def.docCodePrefix, d + m + y)
    }

    const parentId = await findOrCreateTemplateFolder(db, def, ctx.me)
    const siblings = await db.select({ id: docs.id }).from(docs).where(and(eq(docs.parentId, parentId), isNull(docs.deletedAt)))
    const inserted = await db
      .insert(docs)
      .values({
        title: body.data.title,
        parentId,
        sortOrder: siblings.length,
        kind: 'template',
        templateType: 'mom',
        templateDocNumber,
        docType: 'MOM',
        ownerId: ctx.me.id,
        createdBy: ctx.me.id,
        updatedBy: ctx.me.id,
      })
      .returning()
    const doc = inserted[0]!
    await db.insert(docTemplateValues).values({ docId: doc.id, templateType: 'mom', dataJson: JSON.stringify(clean) })
    await db.insert(docLinks).values({ docId: doc.id, projectId, createdBy: ctx.me.id })
    await writeAudit(c.env, { actorId: ctx.me.id, action: 'doc.create', entity: 'doc', entityId: doc.id, meta: { title: doc.title, kind: 'template', templateType: 'mom', templateDocNumber, projectId, via: 'import_docx' } })
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
    // (2026-09-30) เอกสารที่มาจากเมนู "เอกสาร" (source ว่าง — อัปโหลด/สร้างจาก Template ที่นั่นแล้วผูกเข้าโปรเจกต์) เป็นของส่วนกลาง
    // ลบจากแท็บโปรเจกต์ = แค่ "เอาออกจากโปรเจกต์นี้" (ลบแถวผูก) ไม่ soft-delete ตัวเอกสาร กันเอกสารกลางหายเพราะกดผิดที่หน้าโปรเจกต์
    if (before.source === null) {
      await db.delete(docLinks).where(and(eq(docLinks.docId, before.id), eq(docLinks.projectId, projectId)))
      await writeAudit(c.env, { actorId: ctx.me.id, action: 'doc.unlink_project', entity: 'doc', entityId: before.id, meta: { title: before.title, projectId } })
      return c.json({ ok: true, unlinked: true })
    }
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
