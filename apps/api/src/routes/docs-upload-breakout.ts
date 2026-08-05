import { getDocTemplate } from '@seedoffice/core'
import { createDb, docLinks, docs, epics, projects } from '@seedoffice/db'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { extractDocumentXml, extractStylesXml, parseSowModuleSubtasks, parseTemplateTableDocx } from '../lib/docx-parse'
import { canEditProject, getProjectRole } from '../lib/project-role'
import { createSowTasksFromBreakoutItems, type SowSubtaskInput } from '../lib/sow-breakout-tasks'
import { findOrCreateTemplateFolder } from './docs'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

const MAX_FILE_BYTES = 15 * 1024 * 1024
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
// Pronista §SOW Task/Subtask — เฉพาะ SOW เท่านั้นที่แตกเป็น Task ได้ในระบบ (MOM/BRD/SRS/PEP/UIR ยังเป็นเอกสารปกติ แต่ตัดความสามารถแตกเป็น Task ทิ้งแล้ว)
const UPLOADABLE_DOC_TYPES = ['sow'] as const
type UploadableTemplateKey = (typeof UPLOADABLE_DOC_TYPES)[number]

/**
 * Pronista §SOW Task/Subtask — อัปโหลดไฟล์ Word จริงของ SOW จากหน้าเมนูเอกสาร ให้ระบบอ่านตาราง 4.4 (Task พ่อ) + ย่อหน้าโมดูล 4.1-4.3 (Subtask ลูก) แล้วแตกเป็น Task/Subtask พร้อมกัน
 * ใช้ parseTemplateTableDocx + parseSowModuleSubtasks (docx-parse.ts) + createSowTasksFromBreakoutItems (sow-breakout-tasks.ts)
 */
export const docsUploadBreakoutRoutes = new Hono<AppEnv>()

  // อัปโหลด + พาร์สหาโครงสร้าง — ยังไม่สร้างอะไรลง DB (แค่ stash ไฟล์ไว้ที่ R2 ชั่วคราว)
  .post('/docs/upload-breakout/parse', teamOnly, async (c) => {
    const form = await c.req.formData()
    const file = form.get('file')
    const docTypeKey = form.get('docType')
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400)
    if (typeof docTypeKey !== 'string' || !UPLOADABLE_DOC_TYPES.includes(docTypeKey as UploadableTemplateKey))
      return c.json({ error: 'invalid_doc_type' }, 400)
    if (file.size === 0 || file.size > MAX_FILE_BYTES) return c.json({ error: 'file_too_large' }, 413)
    if (file.type !== DOCX_MIME)
      return c.json({ error: 'invalid_type', message: 'รับเฉพาะไฟล์ .docx เท่านั้น (ถ้าเป็น .doc เก่า กรุณา Save As เป็น .docx ก่อน)' }, 415)

    const def = getDocTemplate(docTypeKey)
    if (!def) return c.json({ error: 'invalid_doc_type' }, 400)

    const bytes = new Uint8Array(await file.arrayBuffer())
    let result
    try {
      const xml = extractDocumentXml(bytes)
      result = parseTemplateTableDocx(xml, def)
    } catch {
      return c.json({ error: 'invalid_docx', message: 'อ่านไฟล์ไม่สำเร็จ — ไฟล์อาจเสียหายหรือไม่ใช่ .docx จริง' }, 400)
    }

    const safeName = file.name.replaceAll('/', '_').slice(0, 120)
    const pendingFileKey = `docs/breakout-pending/${crypto.randomUUID()}-${safeName}`
    await c.env.FILES.put(pendingFileKey, bytes, { httpMetadata: { contentType: DOCX_MIME } })

    // Pronista §SOW Task/Subtask — จับคู่ Task พ่อ (แถวตาราง 4.4) กับ Subtask ลูก (ย่อหน้าโมดูล 4.1-4.3) ผ่านรหัสในวงเล็บท้าย heading
    // แถวไหนจับคู่ไม่ได้ (parse ไม่เจอ heading ที่ตรงกัน) ได้ subtasks: [] — ให้ผู้ใช้เพิ่มเองในหน้ารีวิว (graceful degrade)
    const moduleGroups = parseSowModuleSubtasks(extractDocumentXml(bytes), extractStylesXml(bytes))
    const normalizeCode = (s: string) => s.replace(/\s+/g, '').toUpperCase()
    const items = result.items.map((it) => {
      const group = it.sourceCode ? moduleGroups.find((g) => normalizeCode(g.refIdBase) === normalizeCode(it.sourceCode!)) : undefined
      const subtasks: (SowSubtaskInput & { tempId: string })[] = (group?.subtasks ?? []).map((s, idx) => ({
        tempId: s.tempId,
        text: s.text,
        referenceCode: it.sourceCode ? `${it.sourceCode}-${String(idx + 1).padStart(3, '0')}` : null,
        assigneeId: null,
        estimateMinutes: null,
      }))
      // Pronista §SOW Task/Subtask — แยก "ประเภท" ออกเป็นฟิลด์เดี่ยวให้แก้ไขในหน้ารีวิวได้ตรงๆ (เดิมถูกยำรวมอยู่ใน description) — description ที่เหลือให้มีแค่ Ticket (Proposal)
      const category = it.descriptionFields.category ?? ''
      const description = it.descriptionFields.ticket_ref ? `Ticket (Proposal):\n${it.descriptionFields.ticket_ref}` : ''
      return { ...it, category, description, subtasks }
    })

    return c.json({
      pendingFileKey,
      filename: safeName,
      items,
      detectionFailed: result.detectionFailed,
      suggestedDocNumber: result.suggestedDocNumber,
      suggestedVersion: result.suggestedVersion,
    })
  })

  // ยืนยันสร้างจริง — เอกสาร (ลงโฟลเดอร์ตาม docCodePrefix เช่น "MOM"/"BRD"/"SOW") + N tasks ลง Backlog ของโปรเจกต์ พร้อมรหัสอ้างอิง + resolve reference codes
  .post('/docs/upload-breakout/confirm', teamOnly, async (c) => {
    const body = z
      .object({
        projectId: z.string(),
        docType: z.enum(UPLOADABLE_DOC_TYPES),
        pendingFileKey: z.string(),
        filename: z.string(),
        docTitle: z.string().min(1),
        docNumber: z.string().nullable().optional(),
        docVersion: z.string().min(1),
        // Pronista §Epic Layer — ชื่อ Epic ที่จะครอบ Task ทั้งหมดที่แตกจากเอกสารนี้ (1 เอกสาร = 1 Epic อัตโนมัติ) — บังคับเฉพาะ mode V2 เท่านั้น (เช็คเพิ่มด้านล่าง, V1 ไม่สร้าง Epic เลย)
        epicTitle: z.string().min(1).optional(),
        // Pronista §Project Refactor — SOW Parser Mode: เก็บ AdvancedSOWParser (V2, โครงสร้างเดิม Epic>Task>Subtask) ไว้พร้อมใช้ต่อ แต่ตั้งค่าเริ่มต้นเป็น V1 (flat) เพราะฟอร์แมต SOW จริงยังไม่นิ่ง
        mode: z.enum(['V1_SIMPLE_TASK', 'V2_ADVANCED_HIERARCHY']).default('V1_SIMPLE_TASK'),
        items: z
          .array(
            z.object({
              sourceCode: z.string().nullable(),
              title: z.string().min(1),
              description: z.string(),
              // Pronista §SOW Task/Subtask — "ประเภท" แยกจาก description (auto จากคอลัมน์ 4.4 แก้ไขได้ในหน้ารีวิว)
              category: z.string().optional(),
              priority: z.enum(['low', 'normal', 'high']).nullable(),
              referenceCodes: z.array(z.string()).default([]),
              subtasks: z
                .array(
                  z.object({
                    text: z.string().min(1),
                    referenceCode: z.string().nullable(),
                    assigneeId: z.string().nullable(),
                    estimateMinutes: z.number().int().nonnegative().nullable(),
                  }),
                )
                .default([]),
            }),
          )
          .min(1),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const d = body.data
    const def = getDocTemplate(d.docType)
    if (!def) return c.json({ error: 'invalid_doc_type' }, 400)
    if (d.mode === 'V2_ADVANCED_HIERARCHY' && !d.epicTitle?.trim()) return c.json({ error: 'epic_title_required' }, 400)

    const db = createDb(c.env.DB)
    const me = c.get('user')
    const project = (await db.select().from(projects).where(eq(projects.id, d.projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)
    const role = await getProjectRole(db, project.id, me.id, me.role)
    if (!canEditProject(role)) return c.json({ error: 'forbidden' }, 403)

    const pendingObj = await c.env.FILES.get(d.pendingFileKey)
    if (!pendingObj) return c.json({ error: 'pending_file_missing', message: 'ไฟล์ที่อัปโหลดหายไป — กรุณาอัปโหลดใหม่' }, 404)
    const fileBytes = new Uint8Array(await pendingObj.arrayBuffer())
    const safeName = d.filename.replaceAll('/', '_').slice(0, 120)
    const r2Key = `docs/${crypto.randomUUID()}-${safeName}`
    await c.env.FILES.put(r2Key, fileBytes, { httpMetadata: { contentType: DOCX_MIME } })
    await c.env.FILES.delete(d.pendingFileKey)

    const folderId = await findOrCreateTemplateFolder(db, def, me)
    const folderSiblings = await db.select({ id: docs.id }).from(docs).where(eq(docs.parentId, folderId))
    const docType = 'SOW' as const
    // เก็บเฉพาะไฟล์ .docx ต้นฉบับ + แตก Task/Subtask ตรงจากตาราง 4.4 + ย่อหน้าโมดูล 4.1-4.3 ที่ parse ได้ (ไม่สร้างเอกสาร template คู่กันแล้ว)
    const createdDoc = (
      await db
        .insert(docs)
        .values({
          parentId: folderId,
          sortOrder: folderSiblings.length,
          title: d.docTitle,
          kind: 'file',
          r2Key,
          filename: safeName,
          mime: DOCX_MIME,
          docType,
          // Pronista §Document Version History — เก็บเลขที่เอกสาร (เล่ม) + เวอร์ชัน ลง doc row เพื่อจัดกลุ่มในหน้าประวัติเอกสาร
          docNumber: d.docNumber ?? null,
          docVersion: d.docVersion,
          visibility: 'team',
          ownerId: me.id,
          createdBy: me.id,
          updatedBy: me.id,
        })
        .returning()
    )[0]!
    await db.insert(docLinks).values({ docId: createdDoc.id, projectId: project.id, createdBy: me.id })

    // Pronista §Project Refactor — SOW Parser Mode: V2 (Advanced) เท่านั้นที่สร้าง Epic ครอบ Task ทั้งหมด — 1 เอกสาร = 1 Epic เหมือนเดิม
    // V1 (Simple, ค่าเริ่มต้น) ไม่สร้าง Epic เลย แตกเป็น Task แบนราบล้วนตามสเปกใหม่ (ฟอร์แมต SOW จริงยังไม่นิ่งพอจะพึ่ง hierarchy)
    const createdEpic =
      d.mode === 'V2_ADVANCED_HIERARCHY'
        ? (
            await db
              .insert(epics)
              .values({
                projectId: project.id,
                title: d.epicTitle!.trim(),
                code: d.docNumber?.trim() || null,
                sourceDocId: createdDoc.id,
                sortOrder: (await db.select({ id: epics.id }).from(epics).where(eq(epics.projectId, project.id))).length,
              })
              .returning()
          )[0]!
        : null

    const {
      tasks: createdTasks,
      subtasks: createdSubtasks,
      duplicateWarnings,
      unresolvedReferences,
    } = await createSowTasksFromBreakoutItems(db, c.env, {
      project,
      docId: createdDoc.id,
      docVersion: d.docVersion,
      epicId: createdEpic?.id ?? null,
      flat: d.mode === 'V1_SIMPLE_TASK',
      items: d.items,
      createdBy: me.id,
    })
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'doc.create',
      entity: 'doc',
      entityId: createdDoc.id,
      meta: { docBreakoutImport: true, docType, itemCount: createdTasks.length, subtaskCount: createdSubtasks.length, projectId: project.id },
    })

    return c.json({ doc: createdDoc, epic: createdEpic, tasks: createdTasks, subtasks: createdSubtasks, duplicateWarnings, unresolvedReferences }, 201)
  })
