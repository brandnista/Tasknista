import { createDb, DOC_TYPES, projects, users } from '@seedoffice/db'
import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { createImportedItems, parseImportPackage, previewImportRows, type ImportItemPreview } from '../lib/import-data'
import { buildImportTemplateXlsx } from '../lib/xlsx-write'
import { getProjectPermissions } from '../lib/project-role'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

const MAX_PACKAGE_BYTES = 30 * 1024 * 1024
// Pronista §permission — ป้ายชื่อ role ที่ผู้ใช้เห็น (ตรงกับ apps/web/src/lib/role-label.ts) ใช้แค่โชว์ในชีต "ตัวเลือก" ของ Template
const ROLE_LABEL_TH: Record<'owner' | 'member' | 'vendor' | 'guest', string> = { owner: 'Admin', member: 'พนักงาน', vendor: 'ผู้รับจ้าง', guest: 'ลูกค้า' }

/** Pronista §Import Data — อัปงานเข้าระบบทีเดียวจาก Excel (+ เอกสารแนบใน ZIP) แทนคีย์ทีละ Task
 * flow เดียวกับ docs-upload-breakout.ts: parse (อ่าน+validate อย่างเดียว) → confirm (ค่อยเขียน DB จริง) — mount ใต้ /api/projects/:id/import/*
 */
export const importDataRoutes = new Hono<AppEnv>()

  // โหลด Template .xlsx — รายชื่อสมาชิกจริงของบริษัท ณ ตอนกด เติมให้อัตโนมัติในชีต "ตัวเลือก"
  .get('/projects/:id/import/template', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const projectId = c.req.param('id')
    const permissions = await getProjectPermissions(db, projectId, me.id, me.role)
    if (!permissions.actions.task.create) return c.json({ error: 'forbidden' }, 403)
    const rows = await db.select({ name: users.name, email: users.email, role: users.role }).from(users).where(eq(users.status, 'active')).orderBy(asc(users.role), asc(users.name))
    const members = rows.filter((u) => u.role !== 'vendor').map((u) => ({ name: u.name, email: u.email, roleLabel: ROLE_LABEL_TH[u.role] ?? u.role }))
    const bytes = buildImportTemplateXlsx(members)
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="Pronista-Import-Template.xlsx"',
      },
    })
  })

  // อัปโหลด + อ่าน + validate — ยัง "ไม่" เขียนอะไรลง DB แค่ stash ไฟล์ต้นฉบับไว้ที่ R2 ชั่วคราว (ใช้ตอน confirm)
  .post('/projects/:id/import/parse', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const projectId = c.req.param('id')
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)
    const permissions = await getProjectPermissions(db, projectId, me.id, me.role)
    if (!permissions.actions.task.create) return c.json({ error: 'forbidden' }, 403)

    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400)
    if (file.size === 0 || file.size > MAX_PACKAGE_BYTES) return c.json({ error: 'file_too_large', message: 'ไฟล์ใหญ่เกิน 30MB' }, 413)

    const bytes = new Uint8Array(await file.arrayBuffer())
    const parsed = parseImportPackage(bytes, file.name)
    if ('error' in parsed) return c.json({ error: 'invalid_file', message: parsed.error }, 400)

    const { items, sheetError } = await previewImportRows(db, projectId, parsed.xlsxBytes)
    if (sheetError) return c.json({ error: 'invalid_file', message: sheetError }, 400)

    const safeName = file.name.replaceAll('/', '_').slice(0, 120)
    const pendingFileKey = `imports/pending/${crypto.randomUUID()}-${safeName}`
    await c.env.FILES.put(pendingFileKey, bytes)

    return c.json({
      pendingFileKey,
      items,
      documents: parsed.documents.map((d) => ({ path: d.path, filename: d.filename, suggestedDocType: d.suggestedDocType })),
      summary: {
        ready: items.filter((i) => i.status === 'ok').length,
        duplicate: items.filter((i) => i.status === 'duplicate').length,
        error: items.filter((i) => i.status === 'error').length,
        documents: parsed.documents.length,
      },
    })
  })

  // ยืนยันสร้างจริง — client ส่ง items ที่รีวิว/แก้แล้วกลับมา (resolution ต่อแถว) + docType ที่เลือกต่อเอกสาร
  .post('/projects/:id/import/confirm', teamOnly, async (c) => {
    const itemSchema = z.object({
      rowNumber: z.number().int(),
      status: z.enum(['ok', 'duplicate', 'error']),
      errors: z.array(z.string()),
      kind: z.enum(['task', 'defect', 'cr', 'backlog']).nullable(),
      originCode: z.string().nullable(),
      parentCode: z.string().nullable(),
      parentRowNumber: z.number().int().nullable(),
      parentExistingTaskId: z.string().nullable(),
      title: z.string(),
      description: z.string().nullable(),
      assigneeEmail: z.string().nullable(),
      assigneeId: z.string().nullable(),
      taskStatus: z.string(),
      defectStatus: z.string().nullable(),
      priority: z.enum(['low', 'normal', 'high']),
      estimateMinutes: z.number().int().nullable(),
      startDate: z.string().nullable(),
      dueDate: z.string().nullable(),
      reporterType: z.enum(['customer', 'self']).nullable(),
      duplicateOfTaskId: z.string().nullable(),
      duplicateOfTitle: z.string().nullable(),
      resolution: z.enum(['create', 'skip', 'overwrite']),
    })
    const body = z
      .object({
        pendingFileKey: z.string(),
        items: z.array(itemSchema).min(1),
        documentTypeOverrides: z.record(z.string(), z.enum(DOC_TYPES).nullable()).default({}),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const d = body.data
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const projectId = c.req.param('id')
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)
    const permissions = await getProjectPermissions(db, projectId, me.id, me.role)
    if (!permissions.actions.task.create) return c.json({ error: 'forbidden' }, 403)

    const pendingObj = await c.env.FILES.get(d.pendingFileKey)
    if (!pendingObj) return c.json({ error: 'pending_file_missing', message: 'ไฟล์ที่อัปโหลดหายไป — กรุณาอัปโหลดใหม่' }, 404)
    const pendingBytes = new Uint8Array(await pendingObj.arrayBuffer())
    const parsed = parseImportPackage(pendingBytes, d.pendingFileKey.endsWith('.xlsx') ? 'x.xlsx' : 'x.zip')
    if ('error' in parsed) return c.json({ error: 'invalid_file', message: parsed.error }, 400)

    const documents = parsed.documents
      .map((doc) => ({ ...doc, docType: (d.documentTypeOverrides[doc.path] ?? doc.suggestedDocType) as (typeof DOC_TYPES)[number] | null }))
      .filter((doc) => doc.mime !== null)
      .map((doc) => ({ path: doc.path, filename: doc.filename, bytes: doc.bytes, mime: doc.mime!, docType: doc.docType }))

    const result = await createImportedItems(db, c.env, {
      project,
      items: d.items as ImportItemPreview[],
      documents,
      createdBy: me.id,
    })
    await c.env.FILES.delete(d.pendingFileKey)
    return c.json(result, 201)
  })
