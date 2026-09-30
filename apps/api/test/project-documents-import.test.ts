import { createDb, docLinks, docs, docTemplateValues } from '@seedoffice/db'
import { env } from 'cloudflare:test'
import { and, eq } from 'drizzle-orm'
import { strToU8, zipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { matchMemberNames, normalizeThaiDate, parseMomDocx } from '../src/lib/mom-import'
import { loginAs, seedUsers } from './helpers'

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

// ── สร้างไฟล์ .docx ปลอม (zip + document.xml) — เนื้อหาสมมติทั้งหมด ไม่ใช้ข้อมูลลูกค้าจริง (repo เป็น public) ──
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
const table = (rows: string[][]) =>
  `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc>${para(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
const docx = (bodyXml: string) =>
  zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0"?><w:document><w:body>${bodyXml}</w:body></w:document>`) })

const SAMPLE_MOM = docx(
  [
    para('รายงานการประชุม (Minutes of Meeting)'),
    para('ข้อมูลการประชุม (Meeting Information)'),
    table([
      ['หัวข้อ', 'รายละเอียด'],
      ['รหัสเอกสาร (MOM No.)', 'ABC-MOM-20260930-001'],
      ['โครงการ (Project Code)', 'ตัวอย่าง (ABC)'],
      ['หัวข้อการประชุม', 'ประชุมวางแผนเปิดตัวระบบ'],
      ['วันที่ / เวลา', '30 กันยายน 2569 / 10:00 น.'],
      ['สถานที่ / ช่องทาง', 'Google Meet'],
      ['วาระสำคัญ', 'กำหนดวันเปิดตัว'],
    ]),
    para('ผู้เข้าร่วมประชุม (Attendees)'),
    table([
      ['ลำดับ', 'ชื่อ - นามสกุล', 'ตำแหน่ง / บริษัท', 'สถานะ'],
      ['1', 'คุณสมชาย', 'ตัวแทนลูกค้า', 'เข้าร่วม'],
      ['2', 'คุณปอนด์', 'ทีมพัฒนา', 'เข้าร่วม'],
    ]),
    para('วาระการประชุม (Agenda)'),
    para('1. แผนเปิดตัวระบบ'),
    para('2. ระบบชำระเงิน'),
    para('สรุปประเด็นและมติที่ประชุม (Discussion & Decisions)'),
    table([
      ['รหัสมติ (Decision ID)', 'ประเด็น / รายละเอียดการหารือ', 'มติ / ข้อสรุป'],
      ['ABC-D01', 'วันเปิดตัว', 'เปิดตัว 1 ต.ค.'],
    ]),
    para('รายการติดตาม (Action Items)'),
    table([
      ['รหัส', 'รายการที่ต้องดำเนินการ', 'ผู้รับผิดชอบ'],
      ['ABC-A01', 'เตรียมข้อมูลสินค้า', 'คุณปอนด์'],
      ['', '', ''],
    ]),
    para('กำหนดการประชุมครั้งถัดไป (Next Meeting)'),
    table([
      ['หัวข้อ', 'รายละเอียด'],
      ['วันที่ / เวลา', 'จะแจ้งภายหลัง'],
    ]),
  ].join(''),
)

describe('§MOM import (2026-09-30) — parseMomDocx', () => {
  it('อ่านหัวข้อ/ตาราง/วาระของไฟล์ MOM มาตรฐานได้ครบ และข้ามแถวว่าง', () => {
    const r = parseMomDocx(SAMPLE_MOM)
    expect(r.docNumber).toBe('ABC-MOM-20260930-001')
    expect(r.subject).toBe('ประชุมวางแผนเปิดตัวระบบ')
    expect(r.data.fields.meeting_info).toMatchObject({ project_code: 'ตัวอย่าง (ABC)', venue: 'Google Meet', key_agenda: 'กำหนดวันเปิดตัว' })
    expect(r.data.tables.attendees).toHaveLength(2)
    expect(r.data.tables.attendees![0]).toMatchObject({ no: '1', name: 'คุณสมชาย', status: 'เข้าร่วม' })
    expect(r.data.lists.agenda).toEqual(['แผนเปิดตัวระบบ', 'ระบบชำระเงิน']) // ตัดเลขนำหน้า
    expect(r.data.tables.decisions![0]).toMatchObject({ decision_id: 'ABC-D01', decision: 'เปิดตัว 1 ต.ค.' })
    expect(r.data.tables.action_items).toHaveLength(1) // แถวว่างถูกข้าม
    expect(r.data.fields.next_meeting!.datetime).toBe('จะแจ้งภายหลัง')
    expect(r.counts).toMatchObject({ attendees: 2, agenda: 2, decisions: 1, actionItems: 1 })
    expect(r.warnings).toEqual([])
  })

  it('ไฟล์ที่ไม่ใช่รูปแบบ MOM — ไม่ throw, คืน warning ว่าส่วนไหนไม่พบ', () => {
    const r = parseMomDocx(docx(para('เอกสารทั่วไป') + para('ไม่มีหัวข้อ MOM')))
    expect(r.warnings.some((w) => w.includes('ผู้เข้าร่วมประชุม'))).toBe(true)
    expect(r.counts.attendees).toBe(0)
  })

  it('ไม่ใช่ไฟล์ zip/docx — throw (route จับแล้วตอบ 400)', () => {
    expect(() => parseMomDocx(new Uint8Array([1, 2, 3, 4]))).toThrow()
  })

  it('normalizeThaiDate: แปลง พ.ศ./ชื่อเดือนไทย/d-m-y เป็น ISO และไม่เดาถ้าอ่านไม่ออก', () => {
    expect(normalizeThaiDate('18 กันยายน 2569')).toBe('2026-09-18')
    expect(normalizeThaiDate('5/10/2569')).toBe('2026-10-05')
    expect(normalizeThaiDate('2026-09-18')).toBe('2026-09-18')
    expect(normalizeThaiDate('เร็วๆ นี้')).toBe('')
  })

  it('matchMemberNames: "คุณปอนด์" จับคู่กับผู้ใช้ "ปอนด์" ได้ แต่ชื่อที่ไม่รู้จักคงข้อความเดิม', () => {
    const r = parseMomDocx(SAMPLE_MOM)
    r.data.tables.action_items!.push({ item_id: 'x', item: 'y', owner: 'คุณไม่รู้จัก', due_date: '', status: '' })
    const m = matchMemberNames(r.data, ['ปอนด์', 'สมชาย'])
    expect(m.tables.action_items![0]!.owner).toBe('ปอนด์')
    expect(m.tables.action_items![1]!.owner).toBe('คุณไม่รู้จัก')
  })
})

beforeEach(async () => {
  await seedUsers()
  await env.DB.prepare('DELETE FROM doc_links').run()
  await env.DB.prepare('DELETE FROM doc_template_values').run()
  await env.DB.prepare('DELETE FROM docs').run()
})

async function makeProject(ownerCookie: string, name = 'โปรเจกต์นำเข้า MOM', code?: string) {
  return (await (await app.request('/api/projects', json(ownerCookie, { name, type: 'project', ...(code ? { code } : {}) }), env)).json()) as { id: string }
}

const previewReq = (cookie: string, file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return { method: 'POST', headers: { cookie }, body: fd }
}
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

describe('§MOM import — API', () => {
  it('preview: อ่านไฟล์ .docx แล้วคืนข้อมูลให้ตรวจ (ไม่สร้างเอกสาร)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const res = await app.request(`/api/projects/${p.id}/documents/import-mom/preview`, previewReq(owner, new File([SAMPLE_MOM], 'mom.docx', { type: DOCX_MIME })), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { suggestedTitle: string; docNumber: string; counts: { attendees: number } }
    expect(body).toMatchObject({ suggestedTitle: 'ประชุมวางแผนเปิดตัวระบบ', docNumber: 'ABC-MOM-20260930-001' })
    expect(body.counts.attendees).toBe(2)
    expect(await createDb(env.DB).select().from(docs)).toHaveLength(0)
  })

  it('preview: ไฟล์ที่ไม่ใช่ .docx → 415, ไฟล์เสีย → 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const pdf = await app.request(`/api/projects/${p.id}/documents/import-mom/preview`, previewReq(owner, new File(['x'], 'a.pdf', { type: 'application/pdf' })), env)
    expect(pdf.status).toBe(415)
    const broken = await app.request(`/api/projects/${p.id}/documents/import-mom/preview`, previewReq(owner, new File(['not a zip'], 'a.docx', { type: DOCX_MIME })), env)
    expect(broken.status).toBe(400)
  })

  it('vendor (ดูอย่างเดียว) ใช้ import ไม่ได้ (403) ทั้ง preview และ create', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const vendor = await loginAs(app, 'somchai@example.com')
    const pv = await app.request(`/api/projects/${p.id}/documents/import-mom/preview`, previewReq(vendor, new File([SAMPLE_MOM], 'mom.docx', { type: DOCX_MIME })), env)
    expect(pv.status).toBe(403)
    const cr = await app.request(`/api/projects/${p.id}/documents/import-mom`, json(vendor, { title: 'x', data: { fields: {}, tables: {}, lists: {} } }), env)
    expect(cr.status).toBe(403)
  })

  it('create: สร้าง Template MOM ผูกโปรเจกต์ + แท็กประเภท MOM + ใช้เลขที่เอกสารจากไฟล์ · นำเข้าเลขเดิมซ้ำ → ออกเลขใหม่ ไม่ชน', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner, 'โปรเจกต์นำเข้า MOM', 'ABC')
    const pv = (await (
      await app.request(`/api/projects/${p.id}/documents/import-mom/preview`, previewReq(owner, new File([SAMPLE_MOM], 'mom.docx', { type: DOCX_MIME })), env)
    ).json()) as { suggestedTitle: string; data: unknown }

    const created = await app.request(`/api/projects/${p.id}/documents/import-mom`, json(owner, { title: pv.suggestedTitle, data: pv.data }), env)
    expect(created.status).toBe(201)
    const doc = (await created.json()) as { id: string; kind: string; docType: string; templateDocNumber: string; templateType: string }
    expect(doc).toMatchObject({ kind: 'template', docType: 'MOM', templateType: 'mom', templateDocNumber: 'ABC-MOM-20260930-001' })

    const list = (await (await app.request(`/api/projects/${p.id}/documents`, { headers: { cookie: owner } }, env)).json()) as { series: { versions: { id: string; kind: string; templateType: string | null }[] }[] }
    const found = list.series.flatMap((s) => s.versions).find((v) => v.id === doc.id)
    expect(found).toMatchObject({ kind: 'template', templateType: 'mom' })

    const again = (await (await app.request(`/api/projects/${p.id}/documents/import-mom`, json(owner, { title: 'สำเนา', data: pv.data }), env)).json()) as { templateDocNumber: string }
    expect(again.templateDocNumber).not.toBe('ABC-MOM-20260930-001')
  })
})

describe('§ผูกเอกสารที่มีอยู่แล้วเข้าโปรเจกต์ + เอาออกจากโปรเจกต์', () => {
  async function insertDoc(ownerUserId: string, over: Partial<typeof docs.$inferInsert> = {}) {
    const db = createDb(env.DB)
    const row = await db.insert(docs).values({ title: 'ไฟล์จากเมนูเอกสาร', kind: 'file', ownerId: ownerUserId, createdBy: ownerUserId, updatedBy: ownerUserId, ...over }).returning()
    return row[0]!
  }

  it('linkable แสดงเอกสารที่ยังไม่ผูก → link-existing ผูกได้ → หายจาก linkable และโผล่ใน list ของโปรเจกต์', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const d = await insertDoc('u_owner')
    const before = (await (await app.request(`/api/projects/${p.id}/documents/linkable`, { headers: { cookie: owner } }, env)).json()) as { items: { id: string }[] }
    expect(before.items.map((i) => i.id)).toContain(d.id)

    const link = await app.request(`/api/projects/${p.id}/documents/link-existing`, json(owner, { docId: d.id }), env)
    expect(link.status).toBe(200)
    const twice = (await (await app.request(`/api/projects/${p.id}/documents/link-existing`, json(owner, { docId: d.id }), env)).json()) as { alreadyLinked: boolean }
    expect(twice.alreadyLinked).toBe(true) // กดซ้ำไม่สร้างแถวซ้ำ

    const after = (await (await app.request(`/api/projects/${p.id}/documents/linkable`, { headers: { cookie: owner } }, env)).json()) as { items: { id: string }[] }
    expect(after.items.map((i) => i.id)).not.toContain(d.id)
    const list = (await (await app.request(`/api/projects/${p.id}/documents`, { headers: { cookie: owner } }, env)).json()) as { series: { versions: { id: string }[] }[] }
    expect(list.series.flatMap((s) => s.versions).map((v) => v.id)).toContain(d.id)
    const links = await createDb(env.DB).select().from(docLinks).where(and(eq(docLinks.docId, d.id), eq(docLinks.projectId, p.id)))
    expect(links).toHaveLength(1)
  })

  it('vendor ผูกเอกสารไม่ได้ (403) · member ที่ไม่ใช่เจ้าของ/editor ของเอกสาร ผูกไม่ได้ (403)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const d = await insertDoc('u_owner')
    const vendor = await loginAs(app, 'somchai@example.com')
    expect((await app.request(`/api/projects/${p.id}/documents/link-existing`, json(vendor, { docId: d.id }), env)).status).toBe(403)

    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_pond', positionId: 'pos_full_access' }), env)
    const pond = await loginAs(app, 'pond@example-co.test')
    expect((await app.request(`/api/projects/${p.id}/documents/link-existing`, json(pond, { docId: d.id }), env)).status).toBe(403)
    const lk = (await (await app.request(`/api/projects/${p.id}/documents/linkable`, { headers: { cookie: pond } }, env)).json()) as { items: { id: string }[] }
    expect(lk.items.map((i) => i.id)).not.toContain(d.id) // ไม่ใช่ของ pond และไม่ได้เป็น editor → ไม่อยู่ในตัวเลือก
  })

  it('DELETE เอกสารที่มาจากเมนูเอกสาร (source ว่าง) = แค่เอาออกจากโปรเจกต์ ตัวเอกสารยังอยู่ · เอกสารที่อัปโหลดในโปรเจกต์ (source=upload) = soft-delete เหมือนเดิม', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const central = await insertDoc('u_owner')
    await app.request(`/api/projects/${p.id}/documents/link-existing`, json(owner, { docId: central.id }), env)
    const un = await app.request(`/api/projects/${p.id}/documents/${central.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)
    expect(await un.json()).toMatchObject({ ok: true, unlinked: true })
    const db = createDb(env.DB)
    expect((await db.select().from(docs).where(eq(docs.id, central.id)))[0]!.deletedAt).toBeNull()
    expect(await db.select().from(docLinks).where(eq(docLinks.docId, central.id))).toHaveLength(0)

    const projectDoc = await insertDoc('u_owner', { source: 'upload', docType: 'MOM', docVersion: '1.0' })
    await db.insert(docLinks).values({ docId: projectDoc.id, projectId: p.id, createdBy: 'u_owner' })
    await app.request(`/api/projects/${p.id}/documents/${projectDoc.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)
    expect((await db.select().from(docs).where(eq(docs.id, projectDoc.id)))[0]!.deletedAt).not.toBeNull()
  })
})

describe('§Template — รหัสเอกสาร (document_no) กรอกให้อัตโนมัติ', () => {
  const docNoOf = async (docId: string, sectionId: string) => {
    const row = (await createDb(env.DB).select().from(docTemplateValues).where(eq(docTemplateValues.docId, docId)))[0]!
    return (JSON.parse(row.dataJson) as { fields: Record<string, Record<string, string>> }).fields[sectionId]!.document_no
  }

  it('สร้าง MOM จาก Template → ช่อง MOM No. = เลขที่เอกสารที่ระบบออกให้ (ไม่ต้องกรอกเอง)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner, 'โปรเจกต์เลขที่เอกสาร', 'AAA')
    const res = await app.request('/api/docs/template', json(owner, { templateType: 'mom', title: 'ประชุมใหม่', projectId: p.id }), env)
    expect(res.status).toBe(201)
    const doc = (await res.json()) as { id: string; templateDocNumber: string }
    expect(doc.templateDocNumber).toMatch(/^AAA-MOM-[0-9]{8}-001$/)
    expect(await docNoOf(doc.id, 'meeting_info')).toBe(doc.templateDocNumber)
  })

  it('template อื่นที่มีช่อง document_no (เช่น BRD) ก็กรอกให้เหมือนกัน', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner, 'โปรเจกต์ BRD', 'AAB')
    const doc = (await (await app.request('/api/docs/template', json(owner, { templateType: 'brd', title: 'BRD ใหม่', projectId: p.id }), env)).json()) as { id: string; templateDocNumber: string }
    const values = JSON.parse((await createDb(env.DB).select().from(docTemplateValues).where(eq(docTemplateValues.docId, doc.id)))[0]!.dataJson) as { fields: Record<string, Record<string, string>> }
    const filled = Object.values(values.fields).filter((f) => f.document_no === doc.templateDocNumber)
    expect(filled).toHaveLength(1)
  })

  it('นำเข้า MOM จากไฟล์ที่ไม่มีเลขที่เอกสาร → ใช้เลขที่ที่ระบบออกให้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner, 'โปรเจกต์นำเข้าไม่มีเลข', 'AAC')
    const noNumber = docx(
      para('ข้อมูลการประชุม') + table([['หัวข้อ', 'รายละเอียด'], ['หัวข้อการประชุม', 'ประชุมไม่มีเลขที่']]) + para('ผู้เข้าร่วมประชุม') + table([['ลำดับ', 'ชื่อ - นามสกุล', 'ตำแหน่ง / บริษัท', 'สถานะ'], ['1', 'คุณสมชาย', 'ลูกค้า', 'เข้าร่วม']]),
    )
    const pv = (await (await app.request(`/api/projects/${p.id}/documents/import-mom/preview`, previewReq(owner, new File([noNumber], 'm.docx', { type: DOCX_MIME })), env)).json()) as { suggestedTitle: string; data: unknown; docNumber: string | null }
    expect(pv.docNumber).toBeNull()
    const doc = (await (await app.request(`/api/projects/${p.id}/documents/import-mom`, json(owner, { title: pv.suggestedTitle, data: pv.data }), env)).json()) as { id: string; templateDocNumber: string }
    expect(await docNoOf(doc.id, 'meeting_info')).toBe(doc.templateDocNumber)
  })
})
