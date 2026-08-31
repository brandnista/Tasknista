import { bkkDateOf, emptyTemplateData, getDocTemplate } from '@seedoffice/core'
import { createDb, docImages, docLinks, docMembers, docs, DOC_MEMBER_ROLES, DOC_TYPES, docTemplateValues, projects, tasks, users } from '@seedoffice/db'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { canEditDoc, canViewDoc, getDocAccess } from '../lib/doc-acl'
import { createTasksFromBreakoutItems } from '../lib/doc-breakout-tasks'
import { extractDocumentXml, extractParagraphs, extractTables } from '../lib/docx-parse'
import { renderDocxToHtml, renderDocxToMarkdown } from '../lib/docx-render'
import { canEditProject, getProjectRole } from '../lib/project-role'
import { nextTemplateDocNumber } from '../lib/template-doc-code'
import { sanitizeCodePrefix } from '../lib/task-code'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15MB ต่อไฟล์ — เท่ากับ task attachments
const ACCEPTED_FILE_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

/**
 * เอกสาร (SPEC §4.16 + Pronista §merge 2026-07-03) — mount ด้วย requireAuth + teamOnly (vendor 403 ทั้งเมนู+API)
 * ดูดรวม "คลังเอกสาร" (item 3) เข้ามา: 1 โหนดในทรีเป็นได้ทั้งหน้าวิกิ (kind='page'), ลิงก์ Google Docs (kind='link'), หรือไฟล์อัปโหลด (kind='file')
 * สิทธิ์ private/team ต่อโหนด (doc-acl.ts) · ผูกกับ project/task ได้ทุก kind (doc_links) · เทมเพลต+ทำสำเนาได้ทุก kind
 */
// หาโฟลเดอร์ root ที่ตั้งชื่อตาม docCodePrefix (เช่น "MOM") — ไม่เจอก็สร้างใหม่ · ใช้เฉพาะตอนสร้าง template doc แบบไม่ระบุ parentId มาเอง
// (ถ้าผู้ใช้กด "+" จากโฟลเดอร์ที่เจาะจงเอง ให้เคารพตำแหน่งนั้นแทน ไม่บังคับย้ายเข้าโฟลเดอร์นี้) generic ด้วย docCodePrefix ใช้ได้กับทุก template ในอนาคต
export async function findOrCreateTemplateFolder(
  db: ReturnType<typeof createDb>,
  def: { docCodePrefix: string },
  me: { id: string },
): Promise<string> {
  const existing = (
    await db
      .select({ id: docs.id })
      .from(docs)
      .where(and(isNull(docs.parentId), eq(docs.kind, 'folder'), eq(docs.title, def.docCodePrefix), isNull(docs.deletedAt)))
      .limit(1)
  )[0]
  if (existing) return existing.id
  const siblings = await db.select({ id: docs.id }).from(docs).where(and(isNull(docs.parentId), isNull(docs.deletedAt)))
  const inserted = await db
    .insert(docs)
    .values({
      title: def.docCodePrefix,
      parentId: null,
      sortOrder: siblings.length,
      kind: 'folder',
      ownerId: me.id,
      createdBy: me.id,
      updatedBy: me.id,
    })
    .returning()
  return inserted[0]!.id
}

export const docRoutes = new Hono<AppEnv>()

  // tree ทั้งหมดที่ฉันมองเห็น (ไม่เอา contentMarkdown — โหลดทีละหน้า)
  .get('/', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const rows = await db
      .select({
        id: docs.id,
        parentId: docs.parentId,
        sortOrder: docs.sortOrder,
        icon: docs.icon,
        title: docs.title,
        kind: docs.kind,
        externalUrl: docs.externalUrl,
        filename: docs.filename,
        mime: docs.mime,
        isTemplate: docs.isTemplate,
        templateDocNumber: docs.templateDocNumber,
        // Pronista §Document Version History — เลขที่เอกสาร (เล่ม) + เวอร์ชัน
        docNumber: docs.docNumber,
        docVersion: docs.docVersion,
        // Pronista §Document Traceability — สำหรับฟิลเตอร์หน้าเอกสาร (ประเภทเอกสาร + โปรเจกต์ที่ผูก)
        docType: docs.docType,
        ownerId: docs.ownerId,
        visibility: docs.visibility,
        // Pronista §Document Management MVP — Grid view โชว์ "แก้ไขล่าสุดโดยใคร/เมื่อไร" แบบ Google Docs
        updatedBy: docs.updatedBy,
        updatedAt: docs.updatedAt,
      })
      .from(docs)
      .where(isNull(docs.deletedAt))
      .orderBy(asc(docs.sortOrder), asc(docs.createdAt))
    const myMemberships = await db
      .select({ docId: docMembers.docId, role: docMembers.role })
      .from(docMembers)
      .where(eq(docMembers.userId, me.id))
    const updaterNames = await db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl }).from(users)
    const nameOfUser = new Map(updaterNames.map((u) => [u.id, u.name]))
    const avatarOfUser = new Map(updaterNames.map((u) => [u.id, u.avatarUrl]))
    // Pronista §Document Traceability — โปรเจกต์แรกที่เอกสารนี้ผูกไว้ (ถ้ามีหลายอัน เอาแค่อันแรกพอสำหรับฟิลเตอร์)
    const projectLinks = await db.select({ docId: docLinks.docId, projectId: docLinks.projectId }).from(docLinks).where(isNotNull(docLinks.projectId))
    const projectIdOf = new Map<string, string>()
    for (const l of projectLinks) if (l.projectId && !projectIdOf.has(l.docId)) projectIdOf.set(l.docId, l.projectId)
    const roleOf = (r: (typeof rows)[number]): 'owner' | 'editor' | 'viewer' | 'none' => {
      if (me.role === 'owner' || r.ownerId === me.id) return 'owner'
      const mine = myMemberships.filter((m) => m.docId === r.id)
      const memberRole = mine.some((m) => m.role === 'editor') ? 'editor' : mine.length > 0 ? 'viewer' : null
      if (r.visibility === 'team') return memberRole ?? 'viewer'
      return memberRole ?? 'none'
    }
    const visible = rows
      .map((r) => ({
        ...r,
        myAccess: roleOf(r),
        linkedProjectId: projectIdOf.get(r.id) ?? null,
        updatedByName: r.updatedBy ? (nameOfUser.get(r.updatedBy) ?? null) : null,
        updatedByAvatarUrl: r.updatedBy ? (avatarOfUser.get(r.updatedBy) ?? null) : null,
      }))
      .filter((r) => r.myAccess !== 'none')
    return c.json(visible)
  })

  // สร้างหน้าวิกิใหม่ (kind='page' โดยปริยาย) — ผูกสิทธิ์กับ parent ถ้ามี
  .post('/', teamOnly, async (c) => {
    const body = z
      .object({
        title: z.string().min(1).max(200),
        parentId: z.string().nullable().optional(),
        icon: z.string().max(8).optional(),
        visibility: z.enum(['private', 'team']).optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const parentId = body.data.parentId ?? null
    if (parentId) {
      const access = await getDocAccess(db, parentId, me.id, me.role)
      if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    }
    const siblings = await db
      .select({ id: docs.id })
      .from(docs)
      .where(and(parentId ? eq(docs.parentId, parentId) : isNull(docs.parentId), isNull(docs.deletedAt)))
    const inserted = await db
      .insert(docs)
      .values({
        title: body.data.title,
        icon: body.data.icon,
        parentId,
        sortOrder: siblings.length,
        kind: 'page',
        ownerId: me.id,
        visibility: body.data.visibility ?? 'team',
        createdBy: me.id,
        updatedBy: me.id,
      })
      .returning()
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'doc.create',
      entity: 'doc',
      entityId: inserted[0]?.id ?? '',
      meta: { title: body.data.title, parentId },
    })
    return c.json(inserted[0], 201)
  })

  // สร้างโฟลเดอร์เปล่า (จัดกลุ่มเอกสาร) — kind='folder' ไม่มีเนื้อหา คลิกฝั่ง web แค่ expand/collapse
  .post('/folder', teamOnly, async (c) => {
    const body = z
      .object({ title: z.string().min(1).max(200), parentId: z.string().nullable().optional() })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const parentId = body.data.parentId ?? null
    if (parentId) {
      const access = await getDocAccess(db, parentId, me.id, me.role)
      if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    }
    const siblings = await db
      .select({ id: docs.id })
      .from(docs)
      .where(and(parentId ? eq(docs.parentId, parentId) : isNull(docs.parentId), isNull(docs.deletedAt)))
    const inserted = await db
      .insert(docs)
      .values({
        title: body.data.title,
        parentId,
        sortOrder: siblings.length,
        kind: 'folder',
        ownerId: me.id,
        createdBy: me.id,
        updatedBy: me.id,
      })
      .returning()
    await writeAudit(c.env, { actorId: me.id, action: 'doc.create', entity: 'doc', entityId: inserted[0]!.id, meta: { title: body.data.title, kind: 'folder' } })
    return c.json(inserted[0], 201)
  })

  // สร้างเอกสารแบบ "ลิงก์" (Google Docs/Drive หรือ URL อื่นๆ) — kind='link'
  .post('/link', teamOnly, async (c) => {
    const body = z
      .object({ parentId: z.string().nullable().optional(), title: z.string().min(1).max(200), externalUrl: z.string().url(), isTemplate: z.boolean().optional() })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const parentId = body.data.parentId ?? null
    if (parentId) {
      const access = await getDocAccess(db, parentId, me.id, me.role)
      if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    }
    const siblings = await db
      .select({ id: docs.id })
      .from(docs)
      .where(and(parentId ? eq(docs.parentId, parentId) : isNull(docs.parentId), isNull(docs.deletedAt)))
    const inserted = await db
      .insert(docs)
      .values({
        title: body.data.title,
        parentId,
        sortOrder: siblings.length,
        kind: 'link',
        externalUrl: body.data.externalUrl,
        isTemplate: body.data.isTemplate ?? false,
        ownerId: me.id,
        createdBy: me.id,
        updatedBy: me.id,
      })
      .returning()
    await writeAudit(c.env, { actorId: me.id, action: 'doc.create', entity: 'doc', entityId: inserted[0]!.id, meta: { title: body.data.title, kind: 'link' } })
    return c.json(inserted[0], 201)
  })

  // อัปโหลดไฟล์ Word/PDF (multipart) → R2 — kind='file' (จากคลังเอกสารเดิม)
  .post('/upload', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const form = await c.req.formData()
    const file = form.get('file')
    const title = form.get('title')
    const parentId = form.get('parentId')
    const isTemplate = form.get('isTemplate') === '1'
    // Pronista §Document Traceability — ผู้ใช้เลือกแท็กประเภทเอกสารตอนอัปโหลดไฟล์ทั่วไปได้ (ไม่บังคับ) เพื่อใช้ฟิลเตอร์หน้าเอกสาร
    const docTypeRaw = form.get('docType')
    const docType = typeof docTypeRaw === 'string' && DOC_TYPES.includes(docTypeRaw as (typeof DOC_TYPES)[number]) ? (docTypeRaw as (typeof DOC_TYPES)[number]) : null
    // Pronista §Document project link fix — อัปโหลดไฟล์ทั่วไปเดิมไม่มีทางผูกโปรเจกต์ได้เลย (ไม่มีช่องให้เลือก + endpoint ไม่รับ projectId)
    // ผลคือเอกสารที่อัปด้วยทางนี้ไม่โผล่ "ประวัติเอกสาร" เพราะหน้านั้นกรองเอาเฉพาะเอกสารที่ผูกโปรเจกต์ (ผ่าน docLinks) เท่านั้น — ไม่บังคับ (ไม่ใช่ทุกไฟล์ต้องผูกโปรเจกต์)
    const projectIdRaw = form.get('projectId')
    const projectId = typeof projectIdRaw === 'string' && projectIdRaw ? projectIdRaw : null
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400)
    if (file.size === 0 || file.size > MAX_FILE_BYTES) return c.json({ error: 'file_too_large' }, 413)
    if (!ACCEPTED_FILE_MIME.has(file.type)) return c.json({ error: 'invalid_type', message: 'รับเฉพาะ Word (.docx/.doc) และ PDF' }, 415)
    const targetParentId = typeof parentId === 'string' && parentId ? parentId : null
    if (targetParentId) {
      const access = await getDocAccess(db, targetParentId, me.id, me.role)
      if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    }
    let project: (typeof projects.$inferSelect) | undefined
    if (projectId) {
      project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
      if (!project) return c.json({ error: 'project_not_found' }, 404)
      const role = await getProjectRole(db, project.id, me.id, me.role)
      if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)
    }
    const safeName = file.name.replaceAll('/', '_').slice(0, 120)
    const r2Key = `docs/${crypto.randomUUID()}-${safeName}`
    await c.env.FILES.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type } })
    const siblings = await db
      .select({ id: docs.id })
      .from(docs)
      .where(and(targetParentId ? eq(docs.parentId, targetParentId) : isNull(docs.parentId), isNull(docs.deletedAt)))
    const inserted = await db
      .insert(docs)
      .values({
        parentId: targetParentId,
        sortOrder: siblings.length,
        title: typeof title === 'string' && title ? title : safeName,
        kind: 'file',
        r2Key,
        filename: safeName,
        mime: file.type,
        sizeBytes: file.size,
        isTemplate,
        docType,
        ownerId: me.id,
        createdBy: me.id,
        updatedBy: me.id,
      })
      .returning()
    if (project) await db.insert(docLinks).values({ docId: inserted[0]!.id, projectId: project.id, createdBy: me.id })
    await writeAudit(c.env, { actorId: me.id, action: 'doc.create', entity: 'doc', entityId: inserted[0]!.id, meta: { filename: safeName, kind: 'file', projectId: project?.id ?? null } })
    return c.json(inserted[0], 201)
  })

  // สร้างเอกสารจาก Template (Pronista §Document Template) — kind='template' · โครงสร้าง section มาจาก @seedoffice/core registry ไม่ใช่ DB
  // template ที่ def.requiresProject (default true) ต้องผูกโปรเจกต์เสมอ (รหัสอ้างอิง "<Codename>-<prefix>-<วันที่>-<เลขวิ่ง>" ยึด Codename โปรเจกต์) — ผูกผ่าน docLinks แบบเดียวกับเอกสาร SRS
  .post('/template', teamOnly, async (c) => {
    const body = z
      .object({
        templateType: z.string(),
        title: z.string().min(1).max(200),
        parentId: z.string().nullable().optional(),
        projectId: z.string().nullable().optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const def = getDocTemplate(body.data.templateType)
    if (!def) return c.json({ error: 'invalid_template_type' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    // เช็คสิทธิ์เฉพาะตอนผู้ใช้ระบุ parentId มาเอง (เจาะจงตำแหน่งเอง) — โฟลเดอร์ auto-gen ตามประเภทเอกสารเป็น bucket กลางของทีม ทุกคนใส่เอกสารเข้าได้เสมอไม่ต้องเช็คสิทธิ์ต่อโหนด
    if (body.data.parentId) {
      const access = await getDocAccess(db, body.data.parentId, me.id, me.role)
      if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    }
    // ไม่ระบุ parentId มาเอง (เช่น สร้างจากปุ่ม "+ เพิ่ม" บนสุด) → จัดเข้าโฟลเดอร์ตามประเภทเอกสารอัตโนมัติ (Folder "MOM" ฯลฯ)
    const parentId = body.data.parentId ?? (await findOrCreateTemplateFolder(db, def, me))

    // def.requiresProject (default true) → ต้องผูกโปรเจกต์+gen เลขที่ — generic ตาม registry ไม่ hardcode ชื่อ template
    const requiresProject = def.requiresProject ?? true
    let project: (typeof projects.$inferSelect) | undefined
    if (requiresProject) {
      if (!body.data.projectId) return c.json({ error: 'project_required', message: 'ต้องเลือกโปรเจกต์ก่อนสร้าง' }, 400)
      project = (await db.select().from(projects).where(eq(projects.id, body.data.projectId)).limit(1))[0]
      if (!project) return c.json({ error: 'project_not_found' }, 404)
    }

    let templateDocNumber: string | null = null
    if (project) {
      const [y, m, d] = bkkDateOf(Date.now()).split('-')
      const ddmmyyyy = `${d}${m}${y}`
      templateDocNumber = await nextTemplateDocNumber(db, sanitizeCodePrefix(project.code, 'DOC'), def.docCodePrefix, ddmmyyyy)
    }

    const siblings = await db
      .select({ id: docs.id })
      .from(docs)
      .where(and(parentId ? eq(docs.parentId, parentId) : isNull(docs.parentId), isNull(docs.deletedAt)))
    const inserted = await db
      .insert(docs)
      .values({
        title: body.data.title,
        parentId,
        sortOrder: siblings.length,
        kind: 'template',
        templateType: body.data.templateType,
        templateDocNumber,
        // Pronista §Document Traceability — auto-tag ประเภทเอกสารจาก templateType (mom→MOM ฯลฯ) ให้ตรงกับฟิลเตอร์หน้าเอกสารเสมอ
        docType: DOC_TYPES.includes(body.data.templateType.toUpperCase() as (typeof DOC_TYPES)[number])
          ? (body.data.templateType.toUpperCase() as (typeof DOC_TYPES)[number])
          : null,
        ownerId: me.id,
        createdBy: me.id,
        updatedBy: me.id,
      })
      .returning()
    const createdDoc = inserted[0]!
    await db.insert(docTemplateValues).values({
      docId: createdDoc.id,
      templateType: body.data.templateType,
      dataJson: JSON.stringify(emptyTemplateData(def)),
    })
    if (project) await db.insert(docLinks).values({ docId: createdDoc.id, projectId: project.id, createdBy: me.id })
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'doc.create',
      entity: 'doc',
      entityId: createdDoc.id,
      meta: { title: body.data.title, kind: 'template', templateType: body.data.templateType, templateDocNumber },
    })
    return c.json(createdDoc, 201)
  })

  .get('/:id', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const doc = (
      await db
        .select()
        .from(docs)
        .where(and(eq(docs.id, c.req.param('id')), isNull(docs.deletedAt)))
        .limit(1)
    )[0]
    if (!doc) return c.json({ error: 'not_found' }, 404)
    const access = await getDocAccess(db, doc.id, me.id, me.role)
    if (!canViewDoc(access)) return c.json({ error: 'forbidden' }, 403)
    if (doc.kind === 'template') {
      const values = (await db.select().from(docTemplateValues).where(eq(docTemplateValues.docId, doc.id)).limit(1))[0]
      return c.json({ ...doc, myAccess: access, templateData: values ? JSON.parse(values.dataJson) : null })
    }
    return c.json({ ...doc, myAccess: access })
  })

  // autosave ข้อมูลที่กรอกใน template (แยกจาก PATCH /:id หลัก เพราะเปลี่ยนถี่กว่า/รูปร่างต่างกันสิ้นเชิง)
  .patch('/:id/template-values', teamOnly, async (c) => {
    const body = z.object({ dataJson: z.string().max(500_000) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    try {
      JSON.parse(body.data.dataJson)
    } catch {
      return c.json({ error: 'invalid_json' }, 400)
    }
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const doc = (await db.select().from(docs).where(and(eq(docs.id, c.req.param('id')), isNull(docs.deletedAt))).limit(1))[0]
    if (!doc || doc.kind !== 'template') return c.json({ error: 'not_found' }, 404)
    const access = await getDocAccess(db, doc.id, me.id, me.role)
    if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    const existing = (await db.select().from(docTemplateValues).where(eq(docTemplateValues.docId, doc.id)).limit(1))[0]
    if (existing) {
      await db.update(docTemplateValues).set({ dataJson: body.data.dataJson, updatedAt: new Date() }).where(eq(docTemplateValues.docId, doc.id))
    } else {
      await db.insert(docTemplateValues).values({ docId: doc.id, templateType: doc.templateType ?? '', dataJson: body.data.dataJson })
    }
    return c.json({ ok: true })
  })

  // Pronista §Document Traceability — แตกแถวจากตาราง breakoutToTasks ของ Template เอกสาร (MOM/BRD/SOW/SRS ทั้งหมด) ให้เป็น Task จริง
  // generic แทนที่ endpoint เดิม /:id/srs-breakout — เอกสารต้องเป็น kind='template' ที่ registry มี section เปิด breakoutToTasks ไว้ + ผูกโปรเจกต์แล้ว
  // (flow อัปโหลดไฟล์ SRS จากหน้าโปรเจกต์เดิมอยู่คนละ endpoint ใน docs-srs.ts ไม่กระทบ)
  .post('/:id/breakout', teamOnly, async (c) => {
    const body = z
      .object({
        docVersion: z.string().min(1),
        items: z
          .array(
            z.object({
              sourceCode: z.string().nullable(),
              title: z.string().min(1),
              description: z.string(),
              priority: z.enum(['low', 'normal', 'high']).nullable(),
              referenceCodes: z.array(z.string()).default([]),
            }),
          )
          .min(1),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const doc = (await db.select().from(docs).where(and(eq(docs.id, c.req.param('id')), isNull(docs.deletedAt))).limit(1))[0]
    if (!doc || doc.kind !== 'template' || !doc.templateType) return c.json({ error: 'not_found' }, 404)
    const def = getDocTemplate(doc.templateType)
    const breakoutSection = def?.sections.find((s) => s.kind === 'table' && s.breakoutToTasks)
    if (!breakoutSection || breakoutSection.kind !== 'table' || !breakoutSection.breakoutToTasks) return c.json({ error: 'not_found' }, 404)
    // Pronista §SOW Task/Subtask — เฉพาะ SOW เท่านั้นที่แตกเป็น Task ได้แล้ว (MOM/BRD/SRS/PEP/UIR ปิดใช้งาน — เอกสารเก่าที่เคยแตกไปแล้วยังอยู่ตามเดิม ไม่ลบ)
    if (breakoutSection.breakoutToTasks.docType !== 'SOW')
      return c.json({ error: 'breakout_disabled', message: 'ยกเลิกการแตกเป็น Task สำหรับเอกสารประเภทนี้แล้ว — รองรับเฉพาะ SOW' }, 400)
    const access = await getDocAccess(db, doc.id, me.id, me.role)
    if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    const link = (await db.select().from(docLinks).where(and(eq(docLinks.docId, doc.id), isNotNull(docLinks.projectId))).limit(1))[0]
    if (!link?.projectId) return c.json({ error: 'project_not_linked', message: 'เอกสารนี้ยังไม่ผูกกับโปรเจกต์' }, 400)
    const project = (await db.select().from(projects).where(eq(projects.id, link.projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'project_not_found' }, 404)
    if (!canEditProject(await getProjectRole(db, project.id, me.id, me.role))) return c.json({ error: 'forbidden' }, 403)

    const { tasks: createdTasks, duplicateWarnings, unresolvedReferences } = await createTasksFromBreakoutItems(db, c.env, {
      project,
      docId: doc.id,
      docType: breakoutSection.breakoutToTasks.docType,
      docVersion: body.data.docVersion,
      items: body.data.items,
      createdBy: me.id,
    })
    return c.json({ tasks: createdTasks, duplicateWarnings, unresolvedReferences }, 201)
  })

  // ดาวน์โหลด/เปิดไฟล์ — PDF เปิด inline ได้ (ปลอดภัย ไม่ใช่ SVG), Word บังคับดาวน์โหลด
  .get('/:id/raw', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const doc = (await db.select().from(docs).where(and(eq(docs.id, c.req.param('id')), isNull(docs.deletedAt))).limit(1))[0]
    if (!doc || doc.kind !== 'file' || !doc.r2Key) return c.json({ error: 'not_found' }, 404)
    const access = await getDocAccess(db, doc.id, me.id, me.role)
    if (!canViewDoc(access)) return c.json({ error: 'forbidden' }, 403)
    const obj = await c.env.FILES.get(doc.r2Key)
    if (!obj) return c.json({ error: 'object_missing' }, 404)
    const inlineSafe = doc.mime === 'application/pdf'
    return new Response(obj.body, {
      headers: {
        'content-type': doc.mime ?? 'application/octet-stream',
        'content-disposition': `${inlineSafe ? 'inline' : 'attachment'}; filename="${encodeURIComponent(doc.filename ?? doc.title)}"`,
        'cache-control': 'private, max-age=3600',
      },
    })
  })

  // Pronista §Document Management MVP — แปลง .docx เป็น HTML ให้เปิดอ่านได้ในแอปทันที (Chrome/Edge ไม่มีตัวแสดงผล .docx ในตัวเหมือน PDF)
  .get('/:id/preview', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const doc = (await db.select().from(docs).where(and(eq(docs.id, c.req.param('id')), isNull(docs.deletedAt))).limit(1))[0]
    if (!doc || doc.kind !== 'file' || !doc.r2Key) return c.json({ error: 'not_found' }, 404)
    const access = await getDocAccess(db, doc.id, me.id, me.role)
    if (!canViewDoc(access)) return c.json({ error: 'forbidden' }, 403)
    if (doc.mime !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && doc.mime !== 'application/msword') {
      return c.json({ error: 'unsupported_mime' }, 400)
    }
    const obj = await c.env.FILES.get(doc.r2Key)
    if (!obj) return c.json({ error: 'object_missing' }, 404)
    try {
      const html = renderDocxToHtml(new Uint8Array(await obj.arrayBuffer()))
      return c.json({ html })
    } catch {
      return c.json({ error: 'render_failed' }, 500)
    }
  })

  // Pronista §Document Diff — ข้อความล้วนจาก .docx ที่อัปโหลด (paragraph + แถวตารางแบบ pseudo-paragraph) สำหรับหน้าเปรียบเทียบเอกสาร (ไฟล์ที่ไม่ใช่ kind='template' ไม่มี dataJson โครงสร้างให้ diff แบบ field-by-field ได้)
  .get('/:id/text-content', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const doc = (await db.select().from(docs).where(and(eq(docs.id, c.req.param('id')), isNull(docs.deletedAt))).limit(1))[0]
    if (!doc || doc.kind !== 'file' || !doc.r2Key) return c.json({ error: 'not_found' }, 404)
    const access = await getDocAccess(db, doc.id, me.id, me.role)
    if (!canViewDoc(access)) return c.json({ error: 'forbidden' }, 403)
    if (doc.mime !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return c.json({ error: 'unsupported_mime' }, 400)
    const obj = await c.env.FILES.get(doc.r2Key)
    if (!obj) return c.json({ error: 'object_missing' }, 404)
    try {
      const bytes = new Uint8Array(await obj.arrayBuffer())
      const xml = extractDocumentXml(bytes)
      const paragraphs = extractParagraphs(xml).map((p) => p.text.trim()).filter(Boolean)
      const tableLines = extractTables(xml).flatMap((table) => table.map((row) => row.map((cell) => cell.trim()).join(' | ')))
      return c.json({ paragraphs: [...paragraphs, ...tableLines] })
    } catch {
      return c.json({ error: 'render_failed' }, 500)
    }
  })

  // Pronista §Document Management MVP — แปลง .docx เป็น Markdown เก็บลง contentMarkdown ครั้งแรกที่กด "แก้ไขเอกสาร" (ไฟล์ต้นฉบับยังอยู่ ดาวน์โหลดได้เหมือนเดิม)
  // idempotent — ถ้าแปลง+เริ่มแก้ไปแล้ว (contentMarkdown ไม่ว่าง) จะไม่ทับของเดิมซ้ำ กันข้อมูลที่แก้ไปแล้วหาย
  .post('/:id/convert-to-editable', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const doc = (await db.select().from(docs).where(and(eq(docs.id, c.req.param('id')), isNull(docs.deletedAt))).limit(1))[0]
    if (!doc || doc.kind !== 'file' || !doc.r2Key) return c.json({ error: 'not_found' }, 404)
    const access = await getDocAccess(db, doc.id, me.id, me.role)
    if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    if (doc.mime !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && doc.mime !== 'application/msword') {
      return c.json({ error: 'unsupported_mime' }, 400)
    }
    if (doc.contentMarkdown) return c.json(doc)
    const obj = await c.env.FILES.get(doc.r2Key)
    if (!obj) return c.json({ error: 'object_missing' }, 404)
    let markdown: string
    try {
      markdown = renderDocxToMarkdown(new Uint8Array(await obj.arrayBuffer()))
    } catch {
      return c.json({ error: 'render_failed' }, 500)
    }
    const updated = await db
      .update(docs)
      .set({ contentMarkdown: markdown, updatedBy: me.id, updatedAt: new Date() })
      .where(eq(docs.id, doc.id))
      .returning()
    return c.json(updated[0])
  })

  // autosave (title/icon/content) + ย้าย visibility/template — content ไม่เขียน audit (จะ spam)
  .patch('/:id', teamOnly, async (c) => {
    const body = z
      .object({
        title: z.string().min(1).max(200).optional(),
        icon: z.string().max(8).nullable().optional(),
        contentMarkdown: z.string().max(500_000).optional(),
        visibility: z.enum(['private', 'team']).optional(),
        isTemplate: z.boolean().optional(),
        parentId: z.string().nullable().optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (
      await db
        .select()
        .from(docs)
        .where(and(eq(docs.id, c.req.param('id')), isNull(docs.deletedAt)))
        .limit(1)
    )[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const access = await getDocAccess(db, before.id, me.id, me.role)
    // เปลี่ยน visibility = สิทธิ์ owner เท่านั้น (เจ้าของโหนด/company owner) — editor แก้ content/title/icon ได้
    if (body.data.visibility !== undefined && access !== 'owner') return c.json({ error: 'forbidden' }, 403)
    if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    if (body.data.parentId) {
      const targetAccess = await getDocAccess(db, body.data.parentId, me.id, me.role)
      if (!canEditDoc(targetAccess)) return c.json({ error: 'forbidden' }, 403)
    }
    const updated = await db
      .update(docs)
      .set({ ...body.data, updatedBy: me.id, updatedAt: new Date() })
      .where(eq(docs.id, before.id))
      .returning()
    if (body.data.title && body.data.title !== before.title)
      await writeAudit(c.env, {
        actorId: me.id,
        action: 'doc.rename',
        entity: 'doc',
        entityId: before.id,
        meta: { before: before.title, after: body.data.title },
      })
    return c.json(updated[0])
  })

  // ย้าย/จัดเรียง — กันย้ายลงใต้ลูกหลานตัวเอง (cycle)
  .post('/:id/move', teamOnly, async (c) => {
    const body = z
      .object({ parentId: z.string().nullable(), sortOrder: z.number().int().min(0) })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const id = c.req.param('id')
    const access = await getDocAccess(db, id, me.id, me.role)
    if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    const all = await db
      .select({ id: docs.id, parentId: docs.parentId })
      .from(docs)
      .where(isNull(docs.deletedAt))
    if (body.data.parentId) {
      // เดินขึ้นจาก parent เป้าหมาย — ถ้าเจอตัวเอง = cycle
      let cur: string | null = body.data.parentId
      while (cur) {
        if (cur === id) return c.json({ error: 'cycle', message: 'ย้ายลงใต้หน้าลูกของตัวเองไม่ได้' }, 409)
        cur = all.find((d) => d.id === cur)?.parentId ?? null
      }
      if (!all.some((d) => d.id === body.data.parentId)) return c.json({ error: 'parent_not_found' }, 404)
    }
    const updated = await db
      .update(docs)
      .set({ parentId: body.data.parentId, sortOrder: body.data.sortOrder, updatedBy: me.id, updatedAt: new Date() })
      .where(and(eq(docs.id, id), isNull(docs.deletedAt)))
      .returning()
    if (!updated[0]) return c.json({ error: 'not_found' }, 404)
    await writeAudit(c.env, { actorId: me.id, action: 'doc.move', entity: 'doc', entityId: id, meta: body.data })
    return c.json(updated[0])
  })

  // ทำสำเนา (เทมเพลต) — ใช้ได้ทุก kind (page/link/file) ตามที่ยืนยัน — ไปโฟลเดอร์ที่ระบุ (หรือ root ถ้าไม่ระบุ)
  .post('/:id/duplicate', teamOnly, async (c) => {
    const body = z.object({ parentId: z.string().nullable().optional() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const doc = (await db.select().from(docs).where(and(eq(docs.id, c.req.param('id')), isNull(docs.deletedAt))).limit(1))[0]
    if (!doc) return c.json({ error: 'not_found' }, 404)
    const access = await getDocAccess(db, doc.id, me.id, me.role)
    if (!canViewDoc(access)) return c.json({ error: 'forbidden' }, 403)
    const targetParentId = body.data.parentId ?? null
    if (targetParentId) {
      const targetAccess = await getDocAccess(db, targetParentId, me.id, me.role)
      if (!canEditDoc(targetAccess)) return c.json({ error: 'forbidden' }, 403)
    }
    let newR2Key: string | null = null
    if (doc.kind === 'file' && doc.r2Key) {
      const obj = await c.env.FILES.get(doc.r2Key)
      if (!obj) return c.json({ error: 'object_missing' }, 404)
      newR2Key = `docs/${crypto.randomUUID()}-${doc.filename ?? 'copy'}`
      await c.env.FILES.put(newR2Key, obj.body, { httpMetadata: { contentType: doc.mime ?? undefined } })
    }
    const siblings = await db
      .select({ id: docs.id })
      .from(docs)
      .where(and(targetParentId ? eq(docs.parentId, targetParentId) : isNull(docs.parentId), isNull(docs.deletedAt)))
    const inserted = await db
      .insert(docs)
      .values({
        parentId: targetParentId,
        sortOrder: siblings.length,
        title: `${doc.title} (สำเนา)`,
        kind: doc.kind,
        contentMarkdown: doc.contentMarkdown,
        externalUrl: doc.externalUrl,
        r2Key: newR2Key,
        filename: doc.filename,
        mime: doc.mime,
        sizeBytes: doc.sizeBytes,
        isTemplate: false,
        ownerId: me.id,
        createdBy: me.id,
        updatedBy: me.id,
      })
      .returning()
    await writeAudit(c.env, { actorId: me.id, action: 'doc.duplicate', entity: 'doc', entityId: inserted[0]!.id, meta: { fromId: doc.id, title: doc.title } })
    return c.json(inserted[0], 201)
  })

  // สิทธิ์ต่อโหนด private — จัดการได้เฉพาะ owner (เจ้าของโหนด/company owner)
  .get('/:id/members', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const docId = c.req.param('id')
    const access = await getDocAccess(db, docId, me.id, me.role)
    if (!canViewDoc(access)) return c.json({ error: 'forbidden' }, 403)
    const rows = await db
      .select({ id: users.id, name: users.name, role: docMembers.role })
      .from(docMembers)
      .innerJoin(users, eq(docMembers.userId, users.id))
      .where(eq(docMembers.docId, docId))
    return c.json(rows)
  })

  .post('/:id/members', teamOnly, async (c) => {
    const body = z.object({ userId: z.string(), role: z.enum(DOC_MEMBER_ROLES) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const docId = c.req.param('id')
    const access = await getDocAccess(db, docId, me.id, me.role)
    if (access !== 'owner') return c.json({ error: 'forbidden' }, 403)
    const upserted = await db
      .insert(docMembers)
      .values({ docId, userId: body.data.userId, role: body.data.role })
      .onConflictDoUpdate({ target: [docMembers.docId, docMembers.userId], set: { role: body.data.role } })
      .returning()
    return c.json(upserted[0], 201)
  })

  .delete('/:id/members/:userId', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const docId = c.req.param('id')
    const access = await getDocAccess(db, docId, me.id, me.role)
    if (access !== 'owner') return c.json({ error: 'forbidden' }, 403)
    await db.delete(docMembers).where(and(eq(docMembers.docId, docId), eq(docMembers.userId, c.req.param('userId'))))
    return c.json({ ok: true })
  })

  // ผูก/เลิกผูกกับ project หรือ task/sub-task — ใช้ได้ทุก kind รวมหน้าวิกิด้วย (mirror ตัวเลือกย้าย Backlog)
  .get('/:id/links', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db
      .select({
        link: docLinks,
        projectName: projects.name,
        taskTitle: tasks.title,
        taskCode: tasks.code,
        taskSrsRefCode: tasks.srsRefCode,
        taskSrsSourceCode: tasks.srsSourceCode,
        taskProjectId: tasks.projectId,
      })
      .from(docLinks)
      .leftJoin(projects, eq(docLinks.projectId, projects.id))
      .leftJoin(tasks, eq(docLinks.taskId, tasks.id))
      .where(eq(docLinks.docId, c.req.param('id')))
    return c.json(
      rows.map((r) => ({
        ...r.link,
        projectName: r.projectName,
        taskTitle: r.taskTitle,
        taskCode: r.taskCode,
        taskSrsRefCode: r.taskSrsRefCode,
        taskSrsSourceCode: r.taskSrsSourceCode,
        taskProjectId: r.taskProjectId,
      })),
    )
  })

  .post('/:id/links', teamOnly, async (c) => {
    const body = z
      .object({ projectId: z.string().optional(), taskId: z.string().optional() })
      .refine((d) => (d.projectId ? 1 : 0) + (d.taskId ? 1 : 0) === 1, 'ต้องระบุ projectId หรือ taskId อย่างใดอย่างหนึ่ง')
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const doc = (await db.select().from(docs).where(and(eq(docs.id, c.req.param('id')), isNull(docs.deletedAt))).limit(1))[0]
    if (!doc) return c.json({ error: 'not_found' }, 404)
    const access = await getDocAccess(db, doc.id, me.id, me.role)
    if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    if (body.data.projectId) {
      const exists = (await db.select({ id: projects.id }).from(projects).where(eq(projects.id, body.data.projectId)).limit(1))[0]
      if (!exists) return c.json({ error: 'project_not_found' }, 404)
    }
    if (body.data.taskId) {
      const exists = (await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, body.data.taskId)).limit(1))[0]
      if (!exists) return c.json({ error: 'task_not_found' }, 404)
    }
    const inserted = await db
      .insert(docLinks)
      .values({ docId: doc.id, projectId: body.data.projectId ?? null, taskId: body.data.taskId ?? null, createdBy: me.id })
      .returning()
    return c.json(inserted[0], 201)
  })

  .delete('/links/:id', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const link = (await db.select().from(docLinks).where(eq(docLinks.id, c.req.param('id'))).limit(1))[0]
    if (!link) return c.json({ error: 'not_found' }, 404)
    const doc = (await db.select().from(docs).where(eq(docs.id, link.docId)).limit(1))[0]
    const access = doc ? await getDocAccess(db, doc.id, me.id, me.role) : 'none'
    if (!canEditDoc(access) && me.role !== 'owner') return c.json({ error: 'forbidden' }, 403)
    await db.delete(docLinks).where(eq(docLinks.id, link.id))
    return c.json({ ok: true })
  })

  // ลบ = soft-delete ทั้ง subtree
  .delete('/:id', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const id = c.req.param('id')
    const access = await getDocAccess(db, id, me.id, me.role)
    if (!canEditDoc(access)) return c.json({ error: 'forbidden' }, 403)
    const all = await db
      .select({ id: docs.id, parentId: docs.parentId, title: docs.title })
      .from(docs)
      .where(isNull(docs.deletedAt))
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
    for (const did of toDelete) await db.update(docs).set({ deletedAt: now }).where(eq(docs.id, did))
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'doc.delete',
      entity: 'doc',
      entityId: id,
      meta: { title: target.title, subtreeCount: toDelete.size },
    })
    return c.json({ ok: true, deleted: toDelete.size })
  })

  // D3: อัปรูป → R2 (ไม่รับ SVG กัน XSS · SPEC §4.16) — ใช้กับหน้าวิกิ (kind='page') เท่านั้น
  .post('/images', async (c) => {
    const form = await c.req.formData()
    const file = form.get('file')
    const docId = form.get('docId')
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400)
    if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type))
      return c.json({ error: 'invalid_type', message: 'รับเฉพาะรูป png/jpeg/gif/webp/avif (ไม่รับ SVG)' }, 415)
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) return c.json({ error: 'file_too_large' }, 413)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const safeName = file.name.replaceAll('/', '_').slice(0, 120)
    const r2Key = `docs/${crypto.randomUUID()}-${safeName}`
    await c.env.FILES.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type } })
    const inserted = await db
      .insert(docImages)
      .values({
        docId: typeof docId === 'string' && docId ? docId : null,
        r2Key,
        filename: safeName,
        mime: file.type,
        sizeBytes: file.size,
        uploadedBy: me.id,
      })
      .returning()
    return c.json({ id: inserted[0]?.id, url: `/api/docs/images/${inserted[0]?.id}` }, 201)
  })

  .get('/images/:id', async (c) => {
    const db = createDb(c.env.DB)
    const img = (
      await db.select().from(docImages).where(eq(docImages.id, c.req.param('id'))).limit(1)
    )[0]
    if (!img) return c.json({ error: 'not_found' }, 404)
    const obj = await c.env.FILES.get(img.r2Key)
    if (!obj) return c.json({ error: 'object_missing' }, 404)
    return new Response(obj.body, {
      headers: { 'content-type': img.mime, 'cache-control': 'private, max-age=86400' },
    })
  })
