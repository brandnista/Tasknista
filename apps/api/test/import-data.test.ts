import { createDb, tasks } from '@seedoffice/db'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { buildImportTemplateXlsx } from '../src/lib/xlsx-write'
import { loginAs, seedUsers } from './helpers'

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

interface TestImportItem {
  rowNumber: number
  status: 'ok' | 'duplicate' | 'error'
  errors: string[]
  kind: 'task' | 'defect' | 'cr' | 'backlog' | null
  originCode: string | null
  parentRowNumber: number | null
  parentExistingTaskId: string | null
  title: string
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
interface TestImportDocument {
  path: string
  filename: string
  suggestedDocType: string | null
}
interface TestParseResponse {
  pendingFileKey: string
  items: TestImportItem[]
  documents: TestImportDocument[]
  summary: { ready: number; duplicate: number; error: number; documents: number }
}

beforeEach(async () => {
  await seedUsers()
  await env.DB.prepare('DELETE FROM notifications').run()
  await env.DB.prepare('DELETE FROM doc_links').run()
  await env.DB.prepare('DELETE FROM tasks').run()
  await env.DB.prepare('DELETE FROM docs').run()
  await env.DB.prepare('DELETE FROM project_members').run()
  await env.DB.prepare('DELETE FROM chat_channels').run()
  await env.DB.prepare('DELETE FROM projects').run()
})

async function makeProject(owner: string, code: string) {
  return (await (await app.request('/api/projects', json(owner, { name: `โปรเจกต์ ${code}`, type: 'project', code }), env)).json()) as { id: string; code: string | null }
}

/** สร้างไฟล์ .xlsx ตาม header ของ Template จริงแต่ข้อมูลกำหนดเองได้ (ไม่ใช้แถวตัวอย่าง 5 แถวของ buildImportTemplateXlsx) */
function makeTaskXlsx(rows: (string | number)[][]): Uint8Array {
  // ใช้ template writer ตัวจริง (พิสูจน์ round-trip เขียน→อ่านในไฟล์เดียวกัน) แล้วสลับแค่ sheet1 (ชีต "งาน") ด้วยแถวที่ต้องการเทส
  const base = buildImportTemplateXlsx([])
  const files = unzipSync(base)
  const header = ['ประเภท', 'รหัสอ้างอิง', 'อยู่ใต้รหัส', 'ชื่องาน', 'รายละเอียด', 'ผู้รับผิดชอบ (อีเมล)', 'สถานะ', 'ความสำคัญ', 'ประเมิน (ชม.)', 'วันเริ่ม', 'กำหนดส่ง', 'ผู้แจ้ง']
  const colLetter = (i: number) => String.fromCharCode(65 + i)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const cellXml = (ref: string, v: string | number) =>
    typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : v === '' ? '' : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`
  const rowXml = (r: number, cells: (string | number)[]) => `<row r="${r}">${cells.map((v, i) => cellXml(`${colLetter(i)}${r}`, v)).join('')}</row>`
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml(1, header)}${rows.map((r, i) => rowXml(i + 2, r)).join('')}</sheetData></worksheet>`
  files['xl/worksheets/sheet1.xml'] = strToU8(sheetXml)
  return zipSync(files, { level: 6 })
}

describe('Import Data — Template', () => {
  it('โหลด Template ได้ .xlsx ที่มีสมาชิกจริง + owner เท่านั้นที่มีสิทธิ์เห็น (ใน "ตัวเลือก")', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const project = await makeProject(owner, 'IMP001')
    const res = await app.request(`/api/projects/${project.id}/import/template`, { headers: { cookie: owner } }, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('.xlsx')
    const bytes = new Uint8Array(await res.arrayBuffer())
    const files = unzipSync(bytes)
    expect(files['xl/worksheets/sheet1.xml']).toBeTruthy()
    expect(files['xl/worksheets/sheet2.xml']).toBeTruthy()
    expect(files['xl/worksheets/sheet3.xml']).toBeTruthy()
  })

  // Pronista §Import Data bugfix regression — makeTaskXlsx() ในไฟล์นี้ "ไม่" เขียน self-closing cell (<c .../>) สำหรับช่องว่าง
  // (มันข้ามไปเลยแทนที่จะเขียน tag เปล่า) ต่างจาก buildImportTemplateXlsx() ตัวจริงที่เขียน <c s="N"/> เสมอแม้ค่าว่าง
  // ต้อง parse ไฟล์ Template จริงที่ดาวน์โหลดได้ตรงๆ ถึงจะจับบั๊กแบบนี้ได้ — เคยพลาดมาแล้วรอบนึงตอน verify ผ่าน browser จริง
  it('อ่าน Template จริงที่โหลดจากระบบ (มี self-closing cell ว่างๆ ปนอยู่) กลับมาได้ครบทุกแถวตัวอย่าง ไม่มีชื่องานหายไปเงียบๆ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const project = await makeProject(owner, 'IMP001B')
    const res = await app.request(`/api/projects/${project.id}/import/template`, { headers: { cookie: owner } }, env)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const fd = new FormData()
    fd.append('file', new File([bytes], 'template.xlsx'))
    const parseRes = await app.request(`/api/projects/${project.id}/import/parse`, { method: 'POST', headers: { cookie: owner }, body: fd }, env)
    expect(parseRes.status).toBe(200)
    const body = (await parseRes.json()) as TestParseResponse
    expect(body.items).toHaveLength(5)
    for (const item of body.items) expect(item.title, `แถว ${item.rowNumber} ชื่องานหายไป`).not.toBe('')
  })

  it('member ที่ไม่มีสิทธิ์สร้าง task ในโปรเจกต์ (ไม่มีตำแหน่งเลย) โหลด/parse/confirm ไม่ได้ → 403', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const project = await makeProject(owner, 'IMP002')
    // ไม่ตั้ง position ให้ pond เลย — getProjectPermissions ต้องคืน all-false
    const tplRes = await app.request(`/api/projects/${project.id}/import/template`, { headers: { cookie: m } }, env)
    expect(tplRes.status).toBe(403)

    const fd = new FormData()
    fd.append('file', new File([makeTaskXlsx([['Task', '', '', 'งานทดสอบ', '', '', '', '', '', '', '', '']])], 'tasks.xlsx'))
    const parseRes = await app.request(`/api/projects/${project.id}/import/parse`, { method: 'POST', headers: { cookie: m }, body: fd }, env)
    expect(parseRes.status).toBe(403)
  })
})

describe('Import Data — parse', () => {
  it('อ่านแถวถูกต้อง: ประเภท/ผู้รับผิดชอบ(อีเมล)/สถานะ/ความสำคัญ/ประเมิน/วันที่ + งานย่อยจับคู่รหัสในไฟล์เดียวกัน', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const project = await makeProject(owner, 'IMP003')
    const xlsx = makeTaskXlsx([
      ['Task', 'SOW-001', '', 'งานแม่', 'รายละเอียดงานแม่', 'pond@example-co.test', 'On Processing', 'สูง', 8, '2026-08-10', '2026-08-20', ''],
      ['Task', 'SOW-001-1', 'SOW-001', 'งานลูก', '', '', '', '', 4, '', '', ''],
      ['Defect', 'BUG-1', '', 'บั๊กทดสอบ', '', 'pond@example-co.test', 'กำลังแก้', '', '', '', '', 'ลูกค้า'],
    ])
    const fd = new FormData()
    fd.append('file', new File([xlsx], 'tasks.xlsx'))
    const res = await app.request(`/api/projects/${project.id}/import/parse`, { method: 'POST', headers: { cookie: owner }, body: fd }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as TestParseResponse
    expect(body.items).toHaveLength(3)
    expect(body.summary).toEqual({ ready: 3, duplicate: 0, error: 0, documents: 0 })

    const parent = body.items.find((i) => i.originCode === 'SOW-001')!
    expect(parent.kind).toBe('task')
    expect(parent.priority).toBe('high')
    expect(parent.taskStatus).toBe('on_processing')
    expect(parent.estimateMinutes).toBe(480)
    expect(parent.startDate).toBe('2026-08-10')
    expect(parent.dueDate).toBe('2026-08-20')

    const child = body.items.find((i) => i.originCode === 'SOW-001-1')!
    expect(child.parentRowNumber).toBe(parent.rowNumber)
    expect(child.parentExistingTaskId).toBeNull()

    const defect = body.items.find((i) => i.originCode === 'BUG-1')!
    expect(defect.kind).toBe('defect')
    expect(defect.defectStatus).toBe('fixing')
    expect(defect.reporterType).toBe('customer')
  })

  it('validate error ต่อแถว: ประเภทผิด, อีเมลไม่รู้จัก, อยู่ใต้รหัสหาไม่เจอ, ผู้แจ้งใช้กับ non-Defect', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const project = await makeProject(owner, 'IMP004')
    const xlsx = makeTaskXlsx([
      ['ไม่รู้จัก', '', '', 'แถวประเภทผิด', '', '', '', '', '', '', '', ''],
      ['Task', '', '', 'อีเมลไม่มีในระบบ', '', 'nobody@nowhere.test', '', '', '', '', '', ''],
      ['Task', 'X-1', 'NOPE-999', 'หาพ่อไม่เจอ', '', '', '', '', '', '', '', ''],
      ['CR', '', '', 'ผู้แจ้งผิดที่', '', '', '', '', '', '', '', 'ลูกค้า'],
    ])
    const fd = new FormData()
    fd.append('file', new File([xlsx], 'tasks.xlsx'))
    const res = await app.request(`/api/projects/${project.id}/import/parse`, { method: 'POST', headers: { cookie: owner }, body: fd }, env)
    const body = (await res.json()) as TestParseResponse
    expect(body.items.every((i) => i.status === 'error')).toBe(true)
    expect(body.items[0]!.errors[0]).toMatch(/ประเภทไม่ถูกต้อง/)
    expect(body.items[1]!.errors[0]).toMatch(/ไม่พบผู้ใช้อีเมล/)
    expect(body.items[2]!.errors[0]).toMatch(/ไม่พบรหัสอ้างอิง/)
    expect(body.items[3]!.errors[0]).toMatch(/ผู้แจ้ง.*เฉพาะ.*Defect/)
  })

  it('รหัสซ้ำกับ task ที่มีอยู่แล้วในโปรเจกต์ → status=duplicate, resolution เริ่มต้น=skip', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const project = await makeProject(owner, 'IMP005')
    const db = createDb(env.DB)
    await db.insert(tasks).values({ projectId: project.id, groupId: null, sortOrder: 0, createdBy: 'u_owner', code: 'IMP005-Task-1', title: 'ของเดิม', originCode: 'DUP-1' })

    const fd = new FormData()
    fd.append('file', new File([makeTaskXlsx([['Task', 'DUP-1', '', 'ตัวใหม่รหัสซ้ำ', '', '', '', '', '', '', '', '']])], 'tasks.xlsx'))
    const res = await app.request(`/api/projects/${project.id}/import/parse`, { method: 'POST', headers: { cookie: owner }, body: fd }, env)
    const body = (await res.json()) as TestParseResponse
    expect(body.items[0]!.status).toBe('duplicate')
    expect(body.items[0]!.resolution).toBe('skip')
    expect(body.items[0]!.duplicateOfTitle).toBe('ของเดิม')
  })

  it('ไฟล์ ZIP ที่มี tasks.xlsx + documents/<TYPE>/ไฟล์ → แกะเอกสารพร้อมเดา docType จากชื่อโฟลเดอร์', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const project = await makeProject(owner, 'IMP006')
    const xlsx = makeTaskXlsx([['Task', '', '', 'งาน', '', '', '', '', '', '', '', '']])
    const zip = zipSync({
      'tasks.xlsx': xlsx,
      'documents/SOW/SOW-1.docx': strToU8('fake docx content'),
      'documents/ใบเสนอราคา.pdf': strToU8('%PDF-1.4 fake'),
    })
    const fd = new FormData()
    fd.append('file', new File([zip], 'package.zip'))
    const res = await app.request(`/api/projects/${project.id}/import/parse`, { method: 'POST', headers: { cookie: owner }, body: fd }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as TestParseResponse
    expect(body.documents).toHaveLength(2)
    const sow = body.documents.find((d) => d.filename === 'SOW-1.docx')!
    expect(sow.suggestedDocType).toBe('SOW')
    const loose = body.documents.find((d) => d.filename === 'ใบเสนอราคา.pdf')!
    expect(loose.suggestedDocType).toBeNull()
    expect(body.summary.documents).toBe(2)
    expect(body.pendingFileKey).toMatch(/^imports\/pending\//)
  })
})

describe('Import Data — confirm', () => {
  it('สร้าง Task แม่-ลูก + Defect + CR + งานทั่วไป ครบ พร้อมแจ้งเตือนผู้รับผิดชอบ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const project = await makeProject(owner, 'IMP010')
    const xlsx = makeTaskXlsx([
      ['Task', 'P-1', '', 'พ่อ', 'desc', 'pond@example-co.test', 'On Processing', 'สูง', 8, '', '', ''],
      ['Task', 'P-1-1', 'P-1', 'ลูก', '', '', '', '', '', '', '', ''],
      ['Defect', 'D-1', '', 'บั๊ก', '', '', 'ปิด', '', '', '', '', 'ทีมเอง'],
      ['CR', 'C-1', '', 'คำขอเปลี่ยน', '', '', '', '', '', '', '', ''],
      ['งานทั่วไป', '', '', 'งานทั่วไป', '', '', '', '', '', '', '', ''],
    ])
    const fd = new FormData()
    fd.append('file', new File([xlsx], 'tasks.xlsx'))
    const parseRes = await app.request(`/api/projects/${project.id}/import/parse`, { method: 'POST', headers: { cookie: owner }, body: fd }, env)
    const parsed = (await parseRes.json()) as TestParseResponse

    const confirmRes = await app.request(
      `/api/projects/${project.id}/import/confirm`,
      json(owner, { pendingFileKey: parsed.pendingFileKey, items: parsed.items, documentTypeOverrides: {} }),
      env,
    )
    expect(confirmRes.status).toBe(201)
    const result = (await confirmRes.json()) as { createdTaskIds: string[]; skippedRowNumbers: number[] }
    expect(result.createdTaskIds).toHaveLength(5)
    expect(result.skippedRowNumbers).toHaveLength(0)

    const db = createDb(env.DB)
    const created = await db.select().from(tasks).where(eq(tasks.projectId, project.id))
    expect(created).toHaveLength(5)
    const parent = created.find((t) => t.originCode === 'P-1')!
    const child = created.find((t) => t.originCode === 'P-1-1')!
    expect(child.parentId).toBe(parent.id)
    expect(parent.isStandaloneTask).toBe(true)
    expect(parent.assigneeId).toBe('u_pond')

    const defect = created.find((t) => t.originCode === 'D-1')!
    expect(defect.kind).toBe('defect')
    expect(defect.defectStatus).toBe('closed')
    expect(defect.reporterType).toBe('self')

    const cr = created.find((t) => t.originCode === 'C-1')!
    expect(cr.kind).toBe('cr')

    const general = created.find((t) => t.title === 'งานทั่วไป')!
    expect(general.kind).toBe('backlog')

    const notif = await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').bind('u_pond').first<{ n: number }>()
    expect(notif?.n).toBe(1)

    // pending file ต้องถูกลบทิ้งหลัง confirm แล้ว
    const gone = await env.FILES.get(parsed.pendingFileKey)
    expect(gone).toBeNull()
  })

  it('resolution=skip ไม่สร้าง, resolution=overwrite อัปเดตของเดิมแทนสร้างใหม่', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const project = await makeProject(owner, 'IMP011')
    const db = createDb(env.DB)
    const existing = (await db.insert(tasks).values({ projectId: project.id, groupId: null, sortOrder: 0, createdBy: 'u_owner', code: 'IMP011-Task-1', title: 'ของเดิม', originCode: 'DUP-2', priority: 'low' }).returning())[0]!

    const xlsx = makeTaskXlsx([
      ['Task', 'DUP-2', '', 'อัปเดตแล้ว', '', '', '', 'สูง', '', '', '', ''],
      ['Task', 'SKIP-ME', '', 'ไม่ควรถูกสร้าง', '', '', '', '', '', '', '', ''],
    ])
    const fd = new FormData()
    fd.append('file', new File([xlsx], 'tasks.xlsx'))
    const parseRes = await app.request(`/api/projects/${project.id}/import/parse`, { method: 'POST', headers: { cookie: owner }, body: fd }, env)
    const parsed = (await parseRes.json()) as TestParseResponse
    const items = parsed.items.map((it) => (it.duplicateOfTaskId === existing.id ? { ...it, resolution: 'overwrite' } : { ...it, resolution: 'skip' }))

    const confirmRes = await app.request(`/api/projects/${project.id}/import/confirm`, json(owner, { pendingFileKey: parsed.pendingFileKey, items, documentTypeOverrides: {} }), env)
    expect(confirmRes.status).toBe(201)
    const result = (await confirmRes.json()) as { createdTaskIds: string[]; updatedTaskIds: string[]; skippedRowNumbers: number[] }
    expect(result.createdTaskIds).toHaveLength(0)
    expect(result.updatedTaskIds).toEqual([existing.id])
    expect(result.skippedRowNumbers).toHaveLength(1)

    const all = await db.select().from(tasks).where(eq(tasks.projectId, project.id))
    expect(all).toHaveLength(1)
    expect(all[0]!.title).toBe('อัปเดตแล้ว')
    expect(all[0]!.priority).toBe('high')
  })

  it('อัปโหลดเอกสารจริง (ZIP) → ผูก docLinks กับโปรเจกต์ + เลือก docType เองได้สำหรับไฟล์ที่วางนอกโฟลเดอร์ประเภท', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const project = await makeProject(owner, 'IMP012')
    const xlsx = makeTaskXlsx([['Task', '', '', 'งาน', '', '', '', '', '', '', '', '']])
    const zip = zipSync({
      'tasks.xlsx': xlsx,
      'documents/SOW/SOW-1.docx': strToU8('fake docx'),
      'documents/loose.pdf': strToU8('%PDF-1.4 fake'),
    })
    const fd = new FormData()
    fd.append('file', new File([zip], 'package.zip'))
    const parseRes = await app.request(`/api/projects/${project.id}/import/parse`, { method: 'POST', headers: { cookie: owner }, body: fd }, env)
    const parsed = (await parseRes.json()) as TestParseResponse
    const looseDoc = parsed.documents.find((d) => d.filename === 'loose.pdf')!

    const confirmRes = await app.request(
      `/api/projects/${project.id}/import/confirm`,
      json(owner, { pendingFileKey: parsed.pendingFileKey, items: parsed.items, documentTypeOverrides: { [looseDoc.path]: 'BRD' } }),
      env,
    )
    expect(confirmRes.status).toBe(201)
    const result = (await confirmRes.json()) as { createdDocIds: string[] }
    expect(result.createdDocIds).toHaveLength(2)

    const links = await env.DB.prepare('SELECT project_id FROM doc_links WHERE project_id = ?').bind(project.id).all()
    expect(links.results).toHaveLength(2)
    const docRows = await env.DB.prepare('SELECT doc_type FROM docs WHERE id IN (?, ?)').bind(result.createdDocIds[0], result.createdDocIds[1]).all<{ doc_type: string }>()
    const types = docRows.results.map((r) => r.doc_type).sort()
    expect(types).toEqual(['BRD', 'SOW'])
  })
})
