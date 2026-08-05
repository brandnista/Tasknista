import { createDb, docLinks, docs, projects } from '@seedoffice/db'
import { and, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { extractDocumentXml, extractStylesXml, parseSrsDocx } from '../lib/docx-parse'
import { canEditProject, getProjectRole } from '../lib/project-role'
import { createTasksFromSrsItems } from '../lib/srs-tasks'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15MB — เท่ากับ docs.ts อัปโหลดไฟล์ทั่วไป
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** หา/สร้างโฟลเดอร์ "SRS" กลางที่ root ของเมนูเอกสาร (kind='page' ทำหน้าที่เป็นโฟลเดอร์ — ตามที่ผู้ใช้ยืนยัน) */
async function findOrCreateSrsFolder(db: ReturnType<typeof createDb>, meId: string) {
  const existing = await db
    .select()
    .from(docs)
    .where(and(isNull(docs.parentId), eq(docs.title, 'SRS'), eq(docs.kind, 'page'), isNull(docs.deletedAt)))
    .limit(1)
  if (existing[0]) return existing[0]
  const siblings = await db.select({ id: docs.id }).from(docs).where(and(isNull(docs.parentId), isNull(docs.deletedAt)))
  const created = await db
    .insert(docs)
    .values({
      parentId: null,
      sortOrder: siblings.length,
      title: 'SRS',
      kind: 'page',
      contentMarkdown: '',
      visibility: 'team',
      ownerId: meId,
      createdBy: meId,
      updatedBy: meId,
    })
    .returning()
  return created[0]!
}

/** Pronista §SRS import — นำเข้าเอกสาร SRS มาแตกเป็น Task (ผูก vendor teamOnly เหมือน docRoutes) */
export const docsSrsRoutes = new Hono<AppEnv>()

  // อัปโหลด + พาร์สหาโครงสร้าง — ยังไม่สร้างอะไรลง DB (แค่ stash ไฟล์ไว้ที่ R2 ชั่วคราว)
  .post('/docs/srs/parse', teamOnly, async (c) => {
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400)
    if (file.size === 0 || file.size > MAX_FILE_BYTES) return c.json({ error: 'file_too_large' }, 413)
    if (file.type !== DOCX_MIME)
      return c.json({ error: 'invalid_type', message: 'รับเฉพาะไฟล์ .docx เท่านั้น (ถ้าเป็น .doc เก่า กรุณา Save As เป็น .docx ก่อน)' }, 415)

    const bytes = new Uint8Array(await file.arrayBuffer())
    let result
    try {
      const xml = extractDocumentXml(bytes)
      const stylesXml = extractStylesXml(bytes) // บางเอกสาร (export จาก Google Docs/LibreOffice) pStyle เป็นเลข ต้องเปิด styles.xml เช็คว่า id ไหนคือ heading
      result = parseSrsDocx(xml, stylesXml)
    } catch {
      return c.json({ error: 'invalid_docx', message: 'อ่านไฟล์ไม่สำเร็จ — ไฟล์อาจเสียหายหรือไม่ใช่ .docx จริง' }, 400)
    }

    const safeName = file.name.replaceAll('/', '_').slice(0, 120)
    const pendingFileKey = `docs/srs-pending/${crypto.randomUUID()}-${safeName}`
    await c.env.FILES.put(pendingFileKey, bytes, { httpMetadata: { contentType: DOCX_MIME } })

    return c.json({
      pendingFileKey,
      filename: safeName,
      detectedGroups: result.detectedGroups,
      detectionFailed: result.detectionFailed,
      suggestedDocNumber: result.suggestedDocNumber,
      suggestedVersion: result.suggestedVersion,
    })
  })

  // ยืนยันสร้างจริง — เอกสาร SRS (ลงโฟลเดอร์ "SRS") + N tasks ลง Backlog ของโปรเจกต์ (groupId ว่าง) พร้อมรหัสอ้างอิง
  .post('/docs/srs/confirm', teamOnly, async (c) => {
    const body = z
      .object({
        projectId: z.string(),
        pendingFileKey: z.string(),
        filename: z.string(),
        docTitle: z.string().min(1),
        srsDocNumber: z.string().nullable().optional(),
        srsVersion: z.string().min(1),
        items: z
          .array(
            z.object({
              sourceCode: z.string().nullable(),
              title: z.string().min(1),
              description: z.string(),
              priority: z.enum(['low', 'normal', 'high']).nullable(),
            }),
          )
          .min(1),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const d = body.data

    const db = createDb(c.env.DB)
    const me = c.get('user')
    const project = (await db.select().from(projects).where(eq(projects.id, d.projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)
    const role = await getProjectRole(db, project.id, me.id, me.role)
    if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)

    const pendingObj = await c.env.FILES.get(d.pendingFileKey)
    if (!pendingObj) return c.json({ error: 'pending_file_missing', message: 'ไฟล์ที่อัปโหลดหายไป — กรุณาอัปโหลดใหม่' }, 404)
    const safeName = d.filename.replaceAll('/', '_').slice(0, 120)
    const r2Key = `docs/${crypto.randomUUID()}-${safeName}`
    await c.env.FILES.put(r2Key, pendingObj.body, { httpMetadata: { contentType: DOCX_MIME } })
    await c.env.FILES.delete(d.pendingFileKey)

    const srsFolder = await findOrCreateSrsFolder(db, me.id)
    const folderSiblings = await db
      .select({ id: docs.id })
      .from(docs)
      .where(and(eq(docs.parentId, srsFolder.id), isNull(docs.deletedAt)))
    const createdDoc = (
      await db
        .insert(docs)
        .values({
          parentId: srsFolder.id,
          sortOrder: folderSiblings.length,
          title: d.docTitle,
          kind: 'file',
          r2Key,
          filename: safeName,
          mime: DOCX_MIME,
          sizeBytes: pendingObj.size,
          srsDocNumber: d.srsDocNumber ?? null,
          srsVersion: d.srsVersion,
          visibility: 'team',
          ownerId: me.id,
          createdBy: me.id,
          updatedBy: me.id,
        })
        .returning()
    )[0]!
    await db.insert(docLinks).values({ docId: createdDoc.id, projectId: project.id, createdBy: me.id })

    const { tasks: createdTasks, duplicateWarnings } = await createTasksFromSrsItems(db, c.env, {
      project,
      docId: createdDoc.id,
      srsVersion: d.srsVersion,
      items: d.items,
      createdBy: me.id,
    })
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'doc.create',
      entity: 'doc',
      entityId: createdDoc.id,
      meta: { srsImport: true, itemCount: createdTasks.length, projectId: project.id },
    })

    return c.json({ doc: createdDoc, tasks: createdTasks, duplicateWarnings }, 201)
  })
