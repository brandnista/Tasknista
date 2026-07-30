import { emptyTemplateData, getDocTemplate } from '@seedoffice/core'
import { createDb, projects } from '@seedoffice/db'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { strToU8, zipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { createTasksFromBreakoutItems, type BreakoutDocType, type BreakoutItemInput } from '../src/lib/doc-breakout-tasks'
import { loginAs, seedUsers } from './helpers'

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const patchJson = (cookie: string, body: unknown) => ({
  method: 'PATCH',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

beforeEach(async () => {
  await seedUsers()
  // ลำดับ FK: task_references/doc_links ชี้ไป tasks+docs → tasks (ชี้ไป docs ผ่าน originDocId/srsDocId ด้วย) → docs → project_members → projects
  await env.DB.prepare('DELETE FROM notifications').run()
  await env.DB.prepare('DELETE FROM task_references').run()
  await env.DB.prepare('DELETE FROM doc_links').run()
  await env.DB.prepare('DELETE FROM doc_template_values').run()
  await env.DB.prepare('DELETE FROM tasks').run()
  await env.DB.prepare('DELETE FROM epics').run()
  await env.DB.prepare('DELETE FROM docs').run()
  await env.DB.prepare('DELETE FROM sprint_task_snapshots').run()
  await env.DB.prepare('DELETE FROM sprints').run()
  await env.DB.prepare('DELETE FROM project_members').run()
  await env.DB.prepare('DELETE FROM projects').run()
})

// สร้างโปรเจกต์ด้วย owner (POST /api/projects เป็น ownerOnly) + ตั้ง pond เป็น editor เสมอ ให้ทดสอบ breakout ในฐานะ member ได้
async function makeProject(owner: string, code: string) {
  const p = (await (
    await app.request('/api/projects', json(owner, { name: `โปรเจกต์ ${code}`, type: 'project', code }), env)
  ).json()) as { id: string; code: string | null }
  await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_pond', role: 'editor' }), env)
  return p
}

async function makeTemplateDoc(cookie: string, templateType: string, projectId: string, title: string) {
  return (await (
    await app.request('/api/docs/template', json(cookie, { templateType, title, projectId }), env)
  ).json()) as { id: string }
}

async function setTemplateValues(cookie: string, docId: string, templateType: string, patch: (data: ReturnType<typeof emptyTemplateData>) => void) {
  const def = getDocTemplate(templateType)!
  const data = emptyTemplateData(def)
  patch(data)
  const res = await app.request(`/api/docs/${docId}/template-values`, patchJson(cookie, { dataJson: JSON.stringify(data) }), env)
  expect(res.status).toBe(200)
}

/**
 * Tasknista §SOW Task/Subtask — MOM/BRD/SRS/PEP/UIR ปิดใช้งานที่ POST /docs/:id/breakout แล้ว (เฉพาะ SOW เท่านั้นที่ผ่าน route ได้)
 * เทสต์ traceability chain เดิม (5 ประเภทนี้) ยังต้อง seed fixture ผ่านเรียก createTasksFromBreakoutItems() ตรงๆ แทนการยิง HTTP
 * เพื่อยืนยันว่า logic การ resolve task_references ยังทำงานถูกต้อง แม้ route หน้าบ้านจะถูกบล็อกไปแล้ว
 */
async function seedBreakoutTask(projectId: string, docId: string, docType: BreakoutDocType, items: BreakoutItemInput[], createdBy = 'u_pond') {
  const db = createDb(env.DB)
  const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]!
  return createTasksFromBreakoutItems(db, env, { project, docId, docType, docVersion: '1.0', items, createdBy })
}

describe('U1 — generic breakout: ปุ่ม "แตกเป็น Task" ในฟอร์ม Template', () => {
  it('MOM decisions → Task พร้อม originDocType/originCode/originRefCode · BRD อ้างอิงกลับ MOM ได้ผ่าน task_references', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const project = await makeProject(owner, 'MAK001')

    const momDoc = await makeTemplateDoc(m, 'mom', project.id, 'MOM ทดสอบ')
    const momResult = await seedBreakoutTask(project.id, momDoc.id, 'MOM', [
      { sourceCode: 'MOM-20260101-D01', title: 'ปัญหาทดสอบ', description: 'มติทดสอบ', priority: null, referenceCodes: [] },
    ])
    expect(momResult.tasks).toHaveLength(1)
    expect(momResult.tasks[0]!.originDocType).toBe('MOM')
    expect(momResult.tasks[0]!.originCode).toBe('MOM-20260101-D01')
    expect(momResult.tasks[0]!.originRefCode).toBe('MAK001-MOM-v1.0-001')
    const momTaskId = momResult.tasks[0]!.id

    const brdDoc = await makeTemplateDoc(m, 'brd', project.id, 'BRD ทดสอบ')
    // เอกสารจริงไม่มีคอลัมน์อ้างอิงกลับ MOM ในตาราง BRD แล้ว — referenceCodes ส่งเองผ่าน payload ตอนแตก Task (ไม่ใช่ resolve จากตารางอัตโนมัติ)
    const brdResult = await seedBreakoutTask(project.id, brdDoc.id, 'BRD', [
      { sourceCode: 'BR-F01', title: 'ความต้องการทดสอบ', description: '', priority: 'high', referenceCodes: ['MOM-20260101-D01'] },
    ])
    expect(brdResult.unresolvedReferences).toEqual([])
    const brdTaskId = brdResult.tasks[0]!.id

    // ไล่ chain ผ่าน /tasks/:id/trace — BR ต้องเห็น MOM เป็น upstream, MOM ต้องเห็น BR เป็น downstream
    const brdTrace = (await (await app.request(`/api/tasks/${brdTaskId}/trace`, { headers: { cookie: m } }, env)).json()) as {
      upstream: { id: string; originDocType: string }[]
    }
    expect(brdTrace.upstream).toHaveLength(1)
    expect(brdTrace.upstream[0]!.id).toBe(momTaskId)
    expect(brdTrace.upstream[0]!.originDocType).toBe('MOM')

    const momTrace = (await (await app.request(`/api/tasks/${momTaskId}/trace`, { headers: { cookie: m } }, env)).json()) as {
      downstream: { id: string }[]
    }
    expect(momTrace.downstream).toHaveLength(1)
    expect(momTrace.downstream[0]!.id).toBe(brdTaskId)
  })

  it('อ้างอิงรหัสที่ไม่มีจริง → สร้าง Task สำเร็จแต่คืน unresolvedReferences (ไม่ block)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const project = await makeProject(owner, 'MAK002')
    const brdDoc = await makeTemplateDoc(m, 'brd', project.id, 'BRD ทดสอบ 2')
    const result = await seedBreakoutTask(project.id, brdDoc.id, 'BRD', [
      { sourceCode: 'BR-F99', title: 'x', description: '', priority: null, referenceCodes: ['MOM-ไม่มีจริง-D99'] },
    ])
    expect(result.tasks).toHaveLength(1)
    expect(result.unresolvedReferences).toEqual(['MOM-ไม่มีจริง-D99'])
  })

  it('vendor แตกเป็น Task ไม่ได้ (403) — เอกสารทั้งหมด teamOnly (ใช้ SOW เพราะเป็นประเภทเดียวที่ route ยังเปิดอยู่)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const v = await loginAs(app, 'somchai@example.com')
    const project = await makeProject(owner, 'MAK003')
    const sowDoc = await makeTemplateDoc(m, 'sow', project.id, 'SOW vendor test')
    await setTemplateValues(m, sowDoc.id, 'sow', (data) => {
      data.tables.scope_items = [{ sow_id: 'MAK003-SOW-001', item_name: 'x', category: '', ref_brd: '', ticket_ref: '', effort: '' }]
    })
    const res = await app.request(`/api/docs/${sowDoc.id}/breakout`, json(v, { docVersion: '1.0', items: [{ sourceCode: 'MAK003-SOW-001', title: 'x', description: 'y', priority: null, referenceCodes: [] }] }), env)
    expect(res.status).toBe(403)
  })

  it('MOM/BRD/SRS/PEP/UIR แตกเป็น Task ผ่าน POST /docs/:id/breakout ไม่ได้แล้ว → 400 breakout_disabled', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const project = await makeProject(owner, 'MAK003B')
    const momDoc = await makeTemplateDoc(m, 'mom', project.id, 'MOM ปิดใช้งาน')
    await setTemplateValues(m, momDoc.id, 'mom', (data) => {
      data.tables.decisions = [{ decision_id: 'MOM-X-01', issue: 'x', decision: 'y' }]
    })
    const res = await app.request(`/api/docs/${momDoc.id}/breakout`, json(m, { docVersion: '1.0', items: [{ sourceCode: 'MOM-X-01', title: 'x', description: 'y', priority: null, referenceCodes: [] }] }), env)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('breakout_disabled')
  })
})

// สร้าง .docx ขั้นต่ำ (zip ที่มีแค่ word/document.xml — extractDocumentXml อ่านแค่ entry นี้ ไม่ต้องมีไฟล์อื่นของ docx จริงครบ)
function buildMinimalDocx(tableRows: string[][]): Uint8Array {
  const cellsXml = (cells: string[]) => cells.map((t) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`).join('')
  const rowsXml = tableRows.map((r) => `<w:tr>${cellsXml(r)}</w:tr>`).join('')
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>${rowsXml}</w:tbl></w:body></w:document>`
  return zipSync({ 'word/document.xml': strToU8(xml) })
}

// เหมือน buildMinimalDocx แต่เติม heading (pStyle HeadingN) + ย่อหน้าบรรยาย ไว้ก่อนตาราง — จำลองโครงสร้างเอกสาร SOW จริง (ข้อ 4.1-4.3 heading+ย่อหน้า แล้วตามด้วยตาราง 4.4)
function buildSowModuleDocx(headingText: string, bodyText: string, tableRows: string[][]): Uint8Array {
  const cellsXml = (cells: string[]) => cells.map((t) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`).join('')
  const rowsXml = tableRows.map((r) => `<w:tr>${cellsXml(r)}</w:tr>`).join('')
  const headingP = `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${headingText}</w:t></w:r></w:p>`
  const bodyP = `<w:p><w:r><w:t>${bodyText}</w:t></w:r></w:p>`
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${headingP}${bodyP}<w:tbl>${rowsXml}</w:tbl></w:body></w:document>`
  return zipSync({ 'word/document.xml': strToU8(xml) })
}

describe('U1b — PEP: อ้างอิงกลับ SOW เท่านั้น (ข้อยกเว้นของกฎ N อ้างอิง N-1)', () => {
  it('รหัสชนกันข้าม docType (BRD กับ SOW ใช้รหัสเดียวกัน) → PEP resolve ไปหา SOW เท่านั้น ไม่ผูกกับ BRD', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const project = await makeProject(owner, 'MAK006')

    // SOW กับ BRD ใช้รหัสเดียวกันโดยตั้งใจ (COLLIDE-01) — ทดสอบว่า PEP ต้อง resolve ไปที่ SOW เท่านั้นตาม EXPECTED_UPSTREAM
    // SOW ยังผ่าน route ปกติได้ (เฉพาะ SOW เท่านั้นที่ไม่ถูกบล็อก)
    const sowDoc = await makeTemplateDoc(m, 'sow', project.id, 'SOW ทดสอบชนรหัส')
    await setTemplateValues(m, sowDoc.id, 'sow', (data) => {
      data.tables.scope_items = [{ sow_id: 'COLLIDE-01', item_name: 'Scope ทดสอบ', category: '', ref_brd: '', ticket_ref: '', effort: 'S' }]
    })
    const sowBreakout = await app.request(`/api/docs/${sowDoc.id}/breakout`, json(m, { docVersion: '1.0', items: [{ sourceCode: 'COLLIDE-01', title: 'Scope ทดสอบ', description: '', priority: null, referenceCodes: [] }] }), env)
    expect(sowBreakout.status).toBe(201)
    const sowTaskId = ((await sowBreakout.json()) as { tasks: { id: string }[] }).tasks[0]!.id

    const brdDoc = await makeTemplateDoc(m, 'brd', project.id, 'BRD ทดสอบชนรหัส')
    const brdResult = await seedBreakoutTask(project.id, brdDoc.id, 'BRD', [
      { sourceCode: 'COLLIDE-01', title: 'BR ทดสอบ', description: '', priority: null, referenceCodes: [] },
    ])
    const brdTaskId = brdResult.tasks[0]!.id

    const pepDoc = await makeTemplateDoc(m, 'pep', project.id, 'PEP ทดสอบ')
    const pepResult = await seedBreakoutTask(project.id, pepDoc.id, 'PEP', [
      { sourceCode: 'PEP-MILESTONE-01', title: 'ลงนามอนุมัติ SOW', description: '', priority: null, referenceCodes: ['COLLIDE-01'] },
    ])
    expect(pepResult.tasks[0]!.originDocType).toBe('PEP')
    expect(pepResult.unresolvedReferences).toEqual([])
    const pepTaskId = pepResult.tasks[0]!.id

    const trace = (await (await app.request(`/api/tasks/${pepTaskId}/trace`, { headers: { cookie: m } }, env)).json()) as {
      upstream: { id: string; originDocType: string }[]
    }
    expect(trace.upstream).toHaveLength(1)
    expect(trace.upstream[0]!.id).toBe(sowTaskId)
    expect(trace.upstream[0]!.originDocType).toBe('SOW')
    expect(trace.upstream[0]!.id).not.toBe(brdTaskId)
  })

  it('UIR (ชั้นที่ 6) resolve ไปหา SRS เท่านั้น', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const project = await makeProject(owner, 'MAK007')

    const srsDoc = await makeTemplateDoc(m, 'srs', project.id, 'SRS ทดสอบ')
    const srsResult = await seedBreakoutTask(project.id, srsDoc.id, 'SRS', [
      { sourceCode: 'MKU-L-01', title: 'Login Redesign FR', description: '', priority: 'high', referenceCodes: [] },
    ])
    const srsTaskId = srsResult.tasks[0]!.id

    const uirDoc = await makeTemplateDoc(m, 'uir', project.id, 'UIR ทดสอบ')
    const uirResult = await seedBreakoutTask(project.id, uirDoc.id, 'UIR', [
      { sourceCode: 'UIR-001', title: 'Redesign หน้า Login', description: 'โมดูล: Login', priority: null, referenceCodes: ['MKU-L-01'] },
    ])
    expect(uirResult.tasks[0]!.originDocType).toBe('UIR')
    expect(uirResult.unresolvedReferences).toEqual([])

    const trace = (await (await app.request(`/api/tasks/${uirResult.tasks[0]!.id}/trace`, { headers: { cookie: m } }, env)).json()) as {
      upstream: { id: string; originDocType: string }[]
    }
    expect(trace.upstream).toHaveLength(1)
    expect(trace.upstream[0]!.id).toBe(srsTaskId)
    expect(trace.upstream[0]!.originDocType).toBe('SRS')
  })
})

describe('U2 — อัปโหลดไฟล์ Word จริง → แตกเป็น Task จากหน้าเมนูเอกสาร (เฉพาะ SOW เท่านั้นแล้ว)', () => {
  it('อัปโหลดประเภทอื่นที่ไม่ใช่ SOW (เช่น MOM) → 400 invalid_doc_type', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    await makeProject(owner, 'MAK004')

    const bytes = buildMinimalDocx([
      ['รหัสมติ (Decision ID)', 'วาระ', 'ประเด็น / รายละเอียดการหารือ', 'มติ / ข้อสรุป'],
      ['MOM-20260101-D05', '1', 'ประเด็นทดสอบอัปโหลด', 'มติทดสอบอัปโหลด'],
    ])
    const fd = new FormData()
    fd.append('file', new File([bytes], 'mom-test.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    fd.append('docType', 'mom')
    const parseRes = await app.request('/api/docs/upload-breakout/parse', { method: 'POST', headers: { cookie: m }, body: fd }, env)
    expect(parseRes.status).toBe(400)
    expect(((await parseRes.json()) as { error: string }).error).toBe('invalid_doc_type')
  })

  it('ไฟล์ไม่ใช่ .docx จริง → 400 invalid_docx', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    await makeProject(owner, 'MAK005')
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array([1, 2, 3])], 'bad.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    fd.append('docType', 'sow')
    const res = await app.request('/api/docs/upload-breakout/parse', { method: 'POST', headers: { cookie: m }, body: fd }, env)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_docx')
  })

  it('อัปโหลด SOW .docx โครงสร้างจริง (heading 4.1 + ย่อหน้าโมดูล + ตาราง 4.4) → parse ได้ Task พ่อ + Subtask ลูก → confirm สร้างจริงเป็น tree', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const project = await makeProject(owner, 'MAK008')

    const bytes = buildSowModuleDocx(
      '4.1 Test Module (MAK002-SOW-006)',
      'Feature A, Feature B และ Feature C - อ้างอิง BR-D01 - รวม 1 Ticket (MKD-01) 5 MH',
      [
        ['SOW ID', 'ชื่อรายการ', 'ประเภท', 'อ้างอิง BRD', 'Ticket (Proposal)', 'Effort'],
        ['MAK002-SOW-006', 'Test Module', 'Feature', 'BR-D01', 'MKD-01', 'S'],
      ],
    )
    const fd = new FormData()
    fd.append('file', new File([bytes], 'sow-test.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    fd.append('docType', 'sow')
    const parseRes = await app.request('/api/docs/upload-breakout/parse', { method: 'POST', headers: { cookie: m }, body: fd }, env)
    expect(parseRes.status).toBe(200)
    const parsed = (await parseRes.json()) as {
      pendingFileKey: string
      filename: string
      detectionFailed: boolean
      items: { sourceCode: string; title: string; subtasks: { text: string; referenceCode: string | null }[] }[]
    }
    expect(parsed.detectionFailed).toBe(false)
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]!.sourceCode).toBe('MAK002-SOW-006')
    expect(parsed.items[0]!.subtasks).toHaveLength(3)
    expect(parsed.items[0]!.subtasks.map((s) => s.text)).toEqual(['Feature A', 'Feature B', 'Feature C'])
    expect(parsed.items[0]!.subtasks[0]!.referenceCode).toBe('MAK002-SOW-006-001')
    expect(parsed.items[0]!.subtasks[2]!.referenceCode).toBe('MAK002-SOW-006-003')

    const confirmRes = await app.request(
      '/api/docs/upload-breakout/confirm',
      json(m, {
        projectId: project.id,
        docType: 'sow',
        pendingFileKey: parsed.pendingFileKey,
        filename: parsed.filename,
        docTitle: 'SOW อัปโหลดทดสอบ',
        docVersion: '1.0',
        epicTitle: 'Epic ทดสอบ',
        mode: 'V2_ADVANCED_HIERARCHY',
        items: parsed.items.map((it) => ({
          sourceCode: it.sourceCode,
          title: it.title,
          description: '',
          priority: null,
          referenceCodes: [],
          subtasks: it.subtasks.map((s) => ({ text: s.text, referenceCode: s.referenceCode, assigneeId: null, estimateMinutes: 120 })),
        })),
      }),
      env,
    )
    expect(confirmRes.status).toBe(201)
    const result = (await confirmRes.json()) as {
      doc: { id: string; docType: string; kind: string }
      tasks: { id: string; originDocType: string; originCode: string; parentId: string | null }[]
      subtasks: { id: string; parentId: string; originDocType: string; originCode: string; estimateMinutes: number }[]
    }
    expect(result.doc.docType).toBe('SOW')
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0]!.parentId).toBeNull()
    expect(result.subtasks).toHaveLength(3)
    for (const sub of result.subtasks) {
      expect(sub.parentId).toBe(result.tasks[0]!.id)
      expect(sub.originDocType).toBe('SOW')
      expect(sub.estimateMinutes).toBe(120)
    }
    expect(result.subtasks.map((s) => s.originCode)).toEqual(['MAK002-SOW-006-001', 'MAK002-SOW-006-002', 'MAK002-SOW-006-003'])
  })

  it('Tasknista §Project Refactor — SOW Parser Mode V1 (ค่าเริ่มต้น, ไม่ระบุ mode): แตกเป็น Task แบนราบทั้งหมด ไม่มี Epic ไม่มี parent/child', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const project = await makeProject(owner, 'MAK010')

    const bytes = buildSowModuleDocx(
      '4.1 Test Module (MAK002-SOW-007)',
      'Feature A, Feature B - อ้างอิง BR-D02 - รวม 1 Ticket (MKD-02) 5 MH',
      [
        ['SOW ID', 'ชื่อรายการ', 'ประเภท', 'อ้างอิง BRD', 'Ticket (Proposal)', 'Effort'],
        ['MAK002-SOW-007', 'Test Module 2', 'Feature', 'BR-D02', 'MKD-02', 'S'],
      ],
    )
    const fd = new FormData()
    fd.append('file', new File([bytes], 'sow-test-v1.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    fd.append('docType', 'sow')
    const parseRes = await app.request('/api/docs/upload-breakout/parse', { method: 'POST', headers: { cookie: m }, body: fd }, env)
    const parsed = (await parseRes.json()) as {
      pendingFileKey: string
      filename: string
      items: { sourceCode: string; title: string; subtasks: { text: string; referenceCode: string | null }[] }[]
    }
    expect(parsed.items[0]!.subtasks).toHaveLength(2)

    const confirmRes = await app.request(
      '/api/docs/upload-breakout/confirm',
      json(m, {
        projectId: project.id,
        docType: 'sow',
        pendingFileKey: parsed.pendingFileKey,
        filename: parsed.filename,
        docTitle: 'SOW อัปโหลดทดสอบ V1',
        docVersion: '1.0',
        // ไม่ส่ง mode → default V1_SIMPLE_TASK · ไม่ส่ง epicTitle ด้วย (ไม่บังคับใน mode นี้)
        items: parsed.items.map((it) => ({
          sourceCode: it.sourceCode,
          title: it.title,
          description: '',
          priority: null,
          referenceCodes: [],
          subtasks: it.subtasks.map((s) => ({ text: s.text, referenceCode: s.referenceCode, assigneeId: null, estimateMinutes: null })),
        })),
      }),
      env,
    )
    expect(confirmRes.status).toBe(201)
    const result = (await confirmRes.json()) as {
      epic: unknown
      tasks: { id: string; parentId: string | null; epicId: string | null }[]
      subtasks: { id: string; parentId: string | null; epicId: string | null; originDocType: string }[]
    }
    expect(result.epic).toBeNull()
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0]!.parentId).toBeNull()
    expect(result.tasks[0]!.epicId).toBeNull()
    expect(result.subtasks).toHaveLength(2)
    for (const sub of result.subtasks) {
      expect(sub.parentId).toBeNull()
      expect(sub.epicId).toBeNull()
      expect(sub.originDocType).toBe('SOW')
    }
  })
})

describe('U3 — Sprint guard: เฉพาะ Subtask ของ SOW เท่านั้นที่ลาก Sprint ได้', () => {
  async function makeSprint(cookie: string, projectId: string) {
    const res = await app.request(`/api/projects/${projectId}/sprints`, json(cookie, { startDate: '2026-08-01', endDate: '2026-08-14' }), env)
    expect(res.status).toBe(201)
    return (await res.json()) as { id: string }
  }
  async function addToSprint(cookie: string, sprintId: string, taskId: string) {
    return app.request(`/api/sprints/${sprintId}/tasks`, json(cookie, { taskId }), env)
  }

  it('Task ทั่วไป (ไม่มีต้นทาง) ลาก Sprint ได้ตามปกติ — ไม่กระทบ workflow เดิม', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const project = await makeProject(owner, 'MAK009')
    const sprint = await makeSprint(m, project.id)
    const task = (await (await app.request(`/api/projects/${project.id}/backlog`, json(m, { title: 'งานทั่วไป' }), env)).json()) as { id: string }
    const res = await addToSprint(m, sprint.id, task.id)
    expect(res.status).toBe(200)
  })

  it('Task พ่อของ SOW ที่ไม่มี Subtask เหลือใน Backlog ลาก Sprint ไม่ได้ (400 no_subtasks_available)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const project = await makeProject(owner, 'MAK010')
    const sprint = await makeSprint(m, project.id)
    const sowDoc = await makeTemplateDoc(m, 'sow', project.id, 'SOW guard test')
    const sowResult = await seedBreakoutTask(project.id, sowDoc.id, 'SOW', [
      { sourceCode: 'MAK010-SOW-001', title: 'Parent', description: '', priority: null, referenceCodes: [] },
    ])
    const res = await addToSprint(m, sprint.id, sowResult.tasks[0]!.id)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('no_subtasks_available')
  })

  it('ลาก Task พ่อของ SOW ที่มี Subtask เข้า Sprint = ดึง Subtask ทั้งหมดที่ยังอยู่ Backlog เข้าไปแทน (Task พ่อเองไม่เข้า sprint)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const project = await makeProject(owner, 'MAK013')
    const sprint = await makeSprint(m, project.id)
    const sowDoc = await makeTemplateDoc(m, 'sow', project.id, 'SOW guard test 3')
    const sowResult = await seedBreakoutTask(project.id, sowDoc.id, 'SOW', [
      { sourceCode: 'MAK013-SOW-001', title: 'Parent', description: '', priority: null, referenceCodes: [] },
    ])
    const parentId = sowResult.tasks[0]!.id
    const sub1 = (await (await app.request(`/api/tasks/${parentId}/subtasks`, json(m, { title: 'ย่อย 1' }), env)).json()) as { id: string }
    const sub2 = (await (await app.request(`/api/tasks/${parentId}/subtasks`, json(m, { title: 'ย่อย 2' }), env)).json()) as { id: string }

    const res = await addToSprint(m, sprint.id, parentId)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { added: { id: string; sprintId: string | null }[] }
    expect(body.added.map((t) => t.id).sort()).toEqual([sub1.id, sub2.id].sort())
    expect(body.added.every((t) => t.sprintId === sprint.id)).toBe(true)

    // Task พ่อเองไม่เข้า sprint — ยังลากตรงไม่ได้เหมือนเดิม (ไม่มี subtask เหลือใน backlog ให้ดึงแล้ว)
    const parentAgain = await addToSprint(m, sprint.id, parentId)
    expect(parentAgain.status).toBe(400)
    expect(((await parentAgain.json()) as { error: string }).error).toBe('no_subtasks_available')
  })

  it('Subtask ของ SOW ลาก Sprint ได้ (200) — รวมถึง Subtask ที่เพิ่มเองด้วยมือ (สืบ originDocType จาก parent)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const project = await makeProject(owner, 'MAK011')
    const sprint = await makeSprint(m, project.id)
    const sowDoc = await makeTemplateDoc(m, 'sow', project.id, 'SOW guard test 2')
    const sowResult = await seedBreakoutTask(project.id, sowDoc.id, 'SOW', [
      { sourceCode: 'MAK011-SOW-001', title: 'Parent', description: '', priority: null, referenceCodes: [] },
    ])
    const parentId = sowResult.tasks[0]!.id
    // เพิ่ม Subtask เองด้วยมือผ่าน task-detail.ts (ไม่ใช่จาก auto-parse) — ต้องสืบ originDocType จาก parent ถึงจะลาก sprint ได้
    const manualSub = (await (await app.request(`/api/tasks/${parentId}/subtasks`, json(m, { title: 'เพิ่มเอง' }), env)).json()) as { id: string; originDocType: string | null }
    expect(manualSub.originDocType).toBe('SOW')
    const res = await addToSprint(m, sprint.id, manualSub.id)
    expect(res.status).toBe(200)
  })

  it('Subtask ทั่วไป (ไม่ใช่ของ SOW) ยังลาก Sprint ไม่ได้เหมือนเดิม (พฤติกรรมเดิมไม่เปลี่ยน)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const m = await loginAs(app, 'pond@example-co.test')
    const project = await makeProject(owner, 'MAK012')
    const sprint = await makeSprint(m, project.id)
    const parent = (await (await app.request(`/api/projects/${project.id}/backlog`, json(m, { title: 'Parent ทั่วไป' }), env)).json()) as { id: string }
    const sub = (await (await app.request(`/api/tasks/${parent.id}/subtasks`, json(m, { title: 'Subtask ทั่วไป' }), env)).json()) as { id: string }
    const res = await addToSprint(m, sprint.id, sub.id)
    expect(res.status).toBe(400)
  })
})
