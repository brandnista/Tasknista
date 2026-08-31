import { unzipSync } from 'fflate'
import { createDb, DOC_TYPES, docLinks, docs, tasks, users, type Project } from '@seedoffice/db'
import { and, eq, isNotNull } from 'drizzle-orm'
import { cellToIsoDateOrNull, cellToNumberOrNull, cellToText, parseXlsxSheet } from './xlsx-parse'
import { nextTypedTaskCode, sanitizeCodePrefix } from './task-code'
import { writeAudit } from './audit'
import { notifyUser } from './notify'
import { findOrCreateTemplateFolder } from '../routes/docs'

/**
 * Pronista §Import Data — แกนหลักของฟีเจอร์ "อัปงานเข้าระบบทีเดียวจาก Excel + เอกสารแนบ"
 * 3 ขั้น: parseImportPackage (แกะ ZIP/xlsx) → previewImportRows (validate+resolve, ยังไม่แตะ DB เขียน) → createImportedItems (สร้างจริง)
 * ตาม pattern เดียวกับ docs-upload-breakout.ts (อัปโหลด→พรีวิว→ยืนยัน) — ยังไม่เข้าระบบจนกว่าจะกด "ยืนยัน" รอบสอง
 */

const TASKS_SHEET_NAME = 'งาน'
const MAX_ROWS = 500
const MAX_DOC_ENTRIES = 50
const MAX_PACKAGE_BYTES = 30 * 1024 * 1024
const MAX_DOC_FILE_BYTES = 15 * 1024 * 1024

const KIND_LABEL_MAP: Record<string, 'task' | 'defect' | 'cr' | 'backlog'> = {
  Task: 'task',
  Defect: 'defect',
  CR: 'cr',
  งานทั่วไป: 'backlog',
}
const PRIORITY_LABEL_MAP: Record<string, 'low' | 'normal' | 'high'> = { ต่ำ: 'low', ปกติ: 'normal', สูง: 'high' }
const TASK_STATUS_LABEL_MAP: Record<string, string> = { 'Non Start': 'non_start', 'On Processing': 'on_processing', 'Waiting for Review': 'waiting_for_test', Done: 'done' }
const DEFECT_STATUS_LABEL_MAP: Record<string, string> = { รอเริ่ม: 'reported', กำลังแก้: 'fixing', 'รอ Verify': 'waiting_verify', ปิด: 'closed' }
const REPORTER_LABEL_MAP: Record<string, 'customer' | 'self'> = { ลูกค้า: 'customer', ทีมเอง: 'self' }

const DOC_MIME_BY_EXT: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pdf': 'application/pdf',
}

export interface ImportDocumentEntry {
  path: string
  filename: string
  bytes: Uint8Array
  mime: string | null
  suggestedDocType: (typeof DOC_TYPES)[number] | null
}

export interface ParsedImportPackage {
  items: ImportItemPreview[]
  documents: ImportDocumentEntry[]
  fileError: string | null
}

export interface ImportItemPreview {
  rowNumber: number
  status: 'ok' | 'duplicate' | 'error'
  errors: string[]
  kind: 'task' | 'defect' | 'cr' | 'backlog' | null
  originCode: string | null
  parentCode: string | null
  parentRowNumber: number | null
  parentExistingTaskId: string | null
  title: string
  description: string | null
  assigneeEmail: string | null
  assigneeId: string | null
  taskStatus: string
  defectStatus: string | null
  priority: 'low' | 'normal' | 'high'
  estimateMinutes: number | null
  startDate: string | null
  dueDate: string | null
  reporterType: 'customer' | 'self' | null
  duplicateOfTaskId: string | null
  duplicateOfTitle: string | null
  resolution: 'create' | 'skip' | 'overwrite'
}

/** แกะไฟล์ที่อัปมา — รับได้ทั้ง .xlsx ตรงๆ (ไม่มีเอกสารแนบ) และ .zip (tasks.xlsx + documents/) */
export function parseImportPackage(bytes: Uint8Array, filename: string): { xlsxBytes: Uint8Array; documents: ImportDocumentEntry[] } | { error: string } {
  if (bytes.byteLength > MAX_PACKAGE_BYTES) return { error: 'ไฟล์ใหญ่เกินไป (จำกัด 30MB ต่อครั้ง)' }
  const lower = filename.toLowerCase()
  const isXlsxDirect = lower.endsWith('.xlsx') && !lower.endsWith('.zip')
  if (isXlsxDirect) {
    try {
      const probe = unzipSync(bytes, { filter: (f) => f.name === 'xl/workbook.xml' })
      if (!probe['xl/workbook.xml']) return { error: 'ไฟล์ .xlsx เสียหายหรือไม่ใช่ไฟล์ Excel จริง' }
    } catch {
      return { error: 'อ่านไฟล์ .xlsx ไม่สำเร็จ — ไฟล์อาจเสียหาย' }
    }
    return { xlsxBytes: bytes, documents: [] }
  }
  let zipFiles: Record<string, Uint8Array>
  try {
    zipFiles = unzipSync(bytes)
  } catch {
    return { error: 'อ่านไฟล์ ZIP ไม่สำเร็จ — ไฟล์อาจเสียหาย' }
  }
  const xlsxEntry = Object.keys(zipFiles).find((n) => n.toLowerCase() === 'tasks.xlsx' || (n.toLowerCase().endsWith('.xlsx') && !n.includes('/')))
  if (!xlsxEntry) return { error: 'ไม่พบไฟล์ tasks.xlsx ที่ระดับบนสุดของ ZIP' }
  const xlsxBytes = zipFiles[xlsxEntry]!

  const docEntries = Object.keys(zipFiles).filter((n) => n.startsWith('documents/') && !n.endsWith('/') && zipFiles[n]!.byteLength > 0)
  if (docEntries.length > MAX_DOC_ENTRIES) return { error: `เอกสารในไฟล์เยอะเกินไป (พบ ${docEntries.length} ไฟล์ จำกัด ${MAX_DOC_ENTRIES} ไฟล์ต่อครั้ง)` }
  const documents: ImportDocumentEntry[] = []
  for (const path of docEntries) {
    const fileBytes = zipFiles[path]!
    if (fileBytes.byteLength > MAX_DOC_FILE_BYTES) return { error: `ไฟล์ "${path}" ใหญ่เกิน 15MB` }
    const parts = path.split('/') // documents/<TYPE>/name.ext หรือ documents/name.ext
    const filename = parts[parts.length - 1]!
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
    if (!(ext in DOC_MIME_BY_EXT)) continue // ข้ามไฟล์ประเภทที่ไม่รองรับเงียบๆ (เช่น .DS_Store)
    const maybeTypeFolder = parts.length === 3 ? parts[1]!.toUpperCase() : null
    const suggestedDocType = (maybeTypeFolder && (DOC_TYPES as readonly string[]).includes(maybeTypeFolder) ? maybeTypeFolder : null) as (typeof DOC_TYPES)[number] | null
    documents.push({ path, filename, bytes: fileBytes, mime: DOC_MIME_BY_EXT[ext] ?? null, suggestedDocType })
  }
  return { xlsxBytes, documents }
}

/** อ่านชีต "งาน" + validate/resolve ทีละแถว (อีเมล→userId, รหัสซ้ำ, พ่อ-ลูก) — ยังไม่เขียนอะไรลง DB */
export async function previewImportRows(db: ReturnType<typeof createDb>, projectId: string, xlsxBytes: Uint8Array): Promise<{ items: ImportItemPreview[]; sheetError: string | null }> {
  const sheet = parseXlsxSheet(xlsxBytes, TASKS_SHEET_NAME)
  if (!sheet) return { items: [], sheetError: `ไม่พบชีต "${TASKS_SHEET_NAME}" ในไฟล์ — ต้องใช้ Template ที่โหลดจากระบบ` }
  if (sheet.maxRow - 1 > MAX_ROWS) return { items: [], sheetError: `แถวงานเยอะเกินไป (พบ ${sheet.maxRow - 1} แถว จำกัด ${MAX_ROWS} แถวต่อครั้ง)` }

  const allUsers = await db.select({ id: users.id, email: users.email }).from(users)
  const userIdByEmail = new Map(allUsers.map((u) => [u.email.toLowerCase(), u.id]))
  const existingTasks = await db
    .select({ id: tasks.id, originCode: tasks.originCode, title: tasks.title, kind: tasks.kind })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNotNull(tasks.originCode)))
  const existingByCode = new Map(existingTasks.map((t) => [t.originCode!.trim().toUpperCase(), t]))

  const rawRows: { rowNumber: number; cells: Record<string, string | number> }[] = []
  for (let r = 2; r <= sheet.maxRow; r++) {
    const cells = sheet.rows.get(r)
    if (!cells) continue
    const title = cellToText(cells.D)
    const kindLabel = cellToText(cells.A)
    if (!title && !kindLabel) continue // แถวว่างเปล่า ข้ามเงียบๆ
    rawRows.push({ rowNumber: r, cells })
  }

  // pass 1: batch ภายในตัวเอง — เอาไว้ resolve "อยู่ใต้รหัส" ที่ชี้ไปแถวอื่นในไฟล์เดียวกัน
  const codeToRowInBatch = new Map<string, number>()
  for (const { rowNumber, cells } of rawRows) {
    const code = cellToText(cells.B).trim().toUpperCase()
    if (code) codeToRowInBatch.set(code, rowNumber)
  }

  const items: ImportItemPreview[] = []
  for (const { rowNumber, cells } of rawRows) {
    const errors: string[] = []
    const kindLabel = cellToText(cells.A)
    const kind = KIND_LABEL_MAP[kindLabel] ?? null
    if (!kind) errors.push(`ประเภทไม่ถูกต้อง: "${kindLabel}" (ใส่ได้แค่ Task, Defect, CR, งานทั่วไป)`)
    const title = cellToText(cells.D)
    if (!title) errors.push('ต้องมีชื่องาน')

    const originCodeRaw = cellToText(cells.B)
    const originCode = originCodeRaw || null

    const parentCodeRaw = cellToText(cells.C)
    let parentRowNumber: number | null = null
    let parentExistingTaskId: string | null = null
    if (parentCodeRaw) {
      if (kind !== 'task') {
        errors.push('"อยู่ใต้รหัส" ใช้ได้เฉพาะแถวที่ประเภท = Task')
      } else {
        const key = parentCodeRaw.trim().toUpperCase()
        const inBatch = codeToRowInBatch.get(key)
        if (inBatch && inBatch !== rowNumber) {
          parentRowNumber = inBatch
        } else {
          const existing = existingByCode.get(key)
          if (existing) parentExistingTaskId = existing.id
          else errors.push(`ไม่พบรหัสอ้างอิง "${parentCodeRaw}" ที่ระบุใน "อยู่ใต้รหัส" (ไม่มีทั้งในไฟล์นี้และในโปรเจกต์)`)
        }
      }
    }

    const assigneeEmail = cellToText(cells.F) || null
    let assigneeId: string | null = null
    if (assigneeEmail) {
      assigneeId = userIdByEmail.get(assigneeEmail.toLowerCase()) ?? null
      if (!assigneeId) errors.push(`ไม่พบผู้ใช้อีเมล "${assigneeEmail}" ในระบบ`)
    }

    const priorityLabel = cellToText(cells.H)
    const priority = priorityLabel ? PRIORITY_LABEL_MAP[priorityLabel] : 'normal'
    if (priorityLabel && !priority) errors.push(`ความสำคัญไม่ถูกต้อง: "${priorityLabel}" (ใส่ได้แค่ ต่ำ, ปกติ, สูง)`)

    const statusLabel = cellToText(cells.G)
    let taskStatus = 'non_start'
    let defectStatus: string | null = null
    if (statusLabel) {
      if (kind === 'defect') {
        const resolved = DEFECT_STATUS_LABEL_MAP[statusLabel]
        if (!resolved) errors.push(`สถานะไม่ถูกต้องสำหรับ Defect: "${statusLabel}" (ใส่ได้แค่ รอเริ่ม, กำลังแก้, รอ Verify, ปิด)`)
        else defectStatus = resolved
      } else if (kind) {
        const resolved = TASK_STATUS_LABEL_MAP[statusLabel]
        if (!resolved) errors.push(`สถานะไม่ถูกต้อง: "${statusLabel}" (ใส่ได้แค่ Non Start, On Processing, Waiting for Review, Done)`)
        else taskStatus = resolved
      }
    } else if (kind === 'defect') {
      defectStatus = 'reported'
    }

    const reporterLabel = cellToText(cells.L)
    let reporterType: 'customer' | 'self' | null = null
    if (reporterLabel) {
      if (kind !== 'defect') errors.push('"ผู้แจ้ง" ใช้ได้เฉพาะแถวที่ประเภท = Defect')
      else {
        reporterType = REPORTER_LABEL_MAP[reporterLabel] ?? null
        if (!reporterType) errors.push(`ผู้แจ้งไม่ถูกต้อง: "${reporterLabel}" (ใส่ได้แค่ ลูกค้า, ทีมเอง)`)
      }
    }

    const startDate = cellToIsoDateOrNull(cells.J)
    if (cells.J != null && cells.J !== '' && !startDate) errors.push(`วันเริ่มอ่านไม่ได้: "${cells.J}"`)
    const dueDate = cellToIsoDateOrNull(cells.K)
    if (cells.K != null && cells.K !== '' && !dueDate) errors.push(`กำหนดส่งอ่านไม่ได้: "${cells.K}"`)
    const estimateHours = cellToNumberOrNull(cells.I)
    const estimateMinutes = estimateHours != null ? Math.round(estimateHours * 60) : null

    const dup = originCode ? existingByCode.get(originCode.trim().toUpperCase()) : undefined
    // รหัสซ้ำกันเองภายในไฟล์เดียว (คนละแถวใช้รหัสเดียวกัน) = ความกำกวม ต้องแก้ในไฟล์ก่อน ไม่ใช่ duplicate-resolution เคส
    if (originCode) {
      const batchRow = codeToRowInBatch.get(originCode.trim().toUpperCase())
      if (batchRow && batchRow !== rowNumber) errors.push(`รหัสอ้างอิง "${originCode}" ซ้ำกับแถวอื่นในไฟล์นี้ (แถว ${batchRow}) — แก้ให้ไม่ซ้ำก่อน`)
    }

    items.push({
      rowNumber,
      status: errors.length > 0 ? 'error' : dup ? 'duplicate' : 'ok',
      errors,
      kind,
      originCode,
      parentCode: parentCodeRaw || null,
      parentRowNumber,
      parentExistingTaskId,
      title,
      description: cellToText(cells.E) || null,
      assigneeEmail,
      assigneeId,
      taskStatus,
      defectStatus,
      priority: priority ?? 'normal',
      estimateMinutes,
      startDate,
      dueDate,
      reporterType,
      duplicateOfTaskId: dup?.id ?? null,
      duplicateOfTitle: dup?.title ?? null,
      resolution: dup ? 'skip' : 'create',
    })
  }
  return { items, sheetError: null }
}

export interface ImportConfirmResult {
  createdTaskIds: string[]
  updatedTaskIds: string[]
  skippedRowNumbers: number[]
  createdDocIds: string[]
  warnings: string[]
}

/** สร้าง/อัปเดตจริงตามที่พรีวิวแล้ว — 2 รอบ: รอบแรกแถวที่ไม่มีพ่อ (หรือพ่อเป็น task ที่มีอยู่แล้ว) รอบสองแถวลูกที่ต้องรู้ id ของพ่อที่เพิ่งสร้าง (รองรับลึก 1 ชั้นตามสเปก) */
export async function createImportedItems(
  db: ReturnType<typeof createDb>,
  env: Env,
  params: {
    project: Project
    items: ImportItemPreview[]
    documents: { path: string; filename: string; bytes: Uint8Array; mime: string; docType: (typeof DOC_TYPES)[number] | null }[]
    createdBy: string
  },
): Promise<ImportConfirmResult> {
  const { project, items, documents, createdBy } = params
  const codePrefix = sanitizeCodePrefix(project.code, 'TASK')
  const result: ImportConfirmResult = { createdTaskIds: [], updatedTaskIds: [], skippedRowNumbers: [], createdDocIds: [], warnings: [] }
  const rowToTaskId = new Map<number, string>()

  const toCreate = items.filter((it) => it.status !== 'error' && it.resolution !== 'skip')
  const topLevel = toCreate.filter((it) => it.parentRowNumber == null)
  const children = toCreate.filter((it) => it.parentRowNumber != null)

  const kindKeyLabel = { task: 'Task', defect: 'Defect', cr: 'CR', backlog: 'Backlog' } as const

  const upsertOne = async (item: ImportItemPreview, parentId: string | null): Promise<string> => {
    const kind = item.kind!
    const values = {
      title: item.title,
      description: item.description,
      originCode: item.originCode,
      assigneeId: item.assigneeId,
      assignedBy: item.assigneeId ? createdBy : null,
      status: item.taskStatus as (typeof tasks.$inferInsert)['status'],
      defectStatus: item.defectStatus as (typeof tasks.$inferInsert)['defectStatus'],
      priority: item.priority,
      estimateMinutes: item.estimateMinutes,
      startDate: item.startDate,
      dueDate: item.dueDate,
      reporterType: item.reporterType,
      kind,
      parentId,
      isStandaloneTask: kind === 'task' && parentId === null,
    }
    if (item.resolution === 'overwrite' && item.duplicateOfTaskId) {
      const before = (await db.select().from(tasks).where(eq(tasks.id, item.duplicateOfTaskId)).limit(1))[0]
      const updated = (await db.update(tasks).set(values).where(eq(tasks.id, item.duplicateOfTaskId)).returning())[0]!
      result.updatedTaskIds.push(updated.id)
      await writeAudit(env, { actorId: createdBy, action: 'task.update', entity: 'task', entityId: updated.id, meta: { title: updated.title, import: true, overwrite: true } })
      if (item.assigneeId && item.assigneeId !== before?.assigneeId) {
        await notifyUser(db, { userId: item.assigneeId, type: 'subtask_assigned', taskId: updated.id, projectId: project.id, message: `คุณได้รับมอบหมายงาน "${updated.title}"` })
      }
      return updated.id
    }
    const code = await nextTypedTaskCode(db, codePrefix, kindKeyLabel[kind])
    const created = (await db.insert(tasks).values({ ...values, projectId: project.id, groupId: null, sortOrder: 0, code, createdBy }).returning())[0]!
    result.createdTaskIds.push(created.id)
    await writeAudit(env, { actorId: createdBy, action: 'task.create', entity: 'task', entityId: created.id, meta: { title: created.title, import: true } })
    if (item.assigneeId) {
      await notifyUser(db, { userId: item.assigneeId, type: 'subtask_assigned', taskId: created.id, projectId: project.id, message: `คุณได้รับมอบหมายงาน "${created.title}"` })
    }
    return created.id
  }

  for (const item of topLevel) {
    const parentId = item.parentExistingTaskId ?? null
    const id = await upsertOne(item, parentId)
    rowToTaskId.set(item.rowNumber, id)
  }
  for (const item of children) {
    const parentId = item.parentRowNumber != null ? (rowToTaskId.get(item.parentRowNumber) ?? null) : null
    if (!parentId) {
      result.warnings.push(`แถว ${item.rowNumber} "${item.title}" ข้ามไป — งานแม่ (แถว ${item.parentRowNumber}) ไม่ได้ถูกสร้าง (อาจถูกเลือก "ข้าม" ไว้)`)
      result.skippedRowNumbers.push(item.rowNumber)
      continue
    }
    const id = await upsertOne(item, parentId)
    rowToTaskId.set(item.rowNumber, id)
  }
  for (const item of items) {
    if (item.status === 'error' || item.resolution === 'skip') result.skippedRowNumbers.push(item.rowNumber)
  }

  for (const doc of documents) {
    if (!doc.docType) continue // ยังไม่เลือกประเภท — ข้าม ไม่อัปโหลด (พรีวิวควรบังคับให้เลือกก่อนอยู่แล้ว)
    const safeName = doc.filename.replaceAll('/', '_').slice(0, 120)
    const r2Key = `docs/${crypto.randomUUID()}-${safeName}`
    await env.FILES.put(r2Key, doc.bytes, { httpMetadata: { contentType: doc.mime } })
    const folderId = await findOrCreateTemplateFolder(db, { docCodePrefix: doc.docType }, { id: createdBy })
    const siblings = await db.select({ id: docs.id }).from(docs).where(and(eq(docs.parentId, folderId), eq(docs.kind, 'file')))
    const createdDoc = (
      await db
        .insert(docs)
        .values({
          parentId: folderId,
          sortOrder: siblings.length,
          title: safeName,
          kind: 'file',
          r2Key,
          filename: safeName,
          mime: doc.mime,
          sizeBytes: doc.bytes.byteLength,
          docType: doc.docType,
          ownerId: createdBy,
          createdBy,
          updatedBy: createdBy,
        })
        .returning()
    )[0]!
    result.createdDocIds.push(createdDoc.id)
    await db.insert(docLinks).values({ docId: createdDoc.id, projectId: project.id, createdBy })
    await writeAudit(env, { actorId: createdBy, action: 'doc.create', entity: 'doc', entityId: createdDoc.id, meta: { filename: safeName, import: true, projectId: project.id } })
  }

  return result
}
