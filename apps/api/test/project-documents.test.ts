import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

beforeEach(async () => {
  await seedUsers()
  await env.DB.prepare('DELETE FROM doc_links').run()
  await env.DB.prepare('DELETE FROM docs').run()
})

async function makeProject(ownerCookie: string, name = 'โปรเจกต์เอกสาร') {
  return (await (await app.request('/api/projects', json(ownerCookie, { name, type: 'project' }), env)).json()) as { id: string }
}

async function uploadDoc(cookie: string, projectId: string, opts: { docType?: string; docVersion?: string; filename?: string } = {}) {
  const fd = new FormData()
  fd.append('file', new File(['hello world'], opts.filename ?? 'spec.pdf', { type: 'application/pdf' }))
  fd.append('title', 'เอกสารทดสอบ')
  if (opts.docType !== undefined) fd.append('docType', opts.docType)
  if (opts.docVersion !== undefined) fd.append('docVersion', opts.docVersion)
  return app.request(`/api/projects/${projectId}/documents/upload`, { method: 'POST', headers: { cookie }, body: fd }, env)
}

describe('§Project Documents (2026-09-17) — สร้างเอกสารต้องบังคับ docType+docVersion', () => {
  it('owner อัปโหลดไฟล์ครบ type+version — สำเร็จ 201', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const res = await uploadDoc(owner, p.id, { docType: 'MOM', docVersion: '1.0' })
    expect(res.status).toBe(201)
    const doc = (await res.json()) as { docType: string; docVersion: string; source: string }
    expect(doc.docType).toBe('MOM')
    expect(doc.docVersion).toBe('1.0')
    expect(doc.source).toBe('upload')
  })

  it('ไม่ระบุ docType — 400 doc_type_required', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const res = await uploadDoc(owner, p.id, { docVersion: '1.0' })
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'doc_type_required' })
  })

  it('ไม่ระบุ docVersion — 400 doc_version_required', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const res = await uploadDoc(owner, p.id, { docType: 'MOM' })
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'doc_version_required' })
  })
})

describe('§Project Documents — สิทธิ์: เพดานโปรเจกต์ (actions.doc.*) ไม่ใช่ doc-acl.ts', () => {
  it('vendor (เพดาน outsource default = ดูอย่างเดียว) เห็น list ได้แต่สร้างไม่ได้ (403)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const vendor = await loginAs(app, 'somchai@example.com')
    const list = await app.request(`/api/projects/${p.id}/documents`, { headers: { cookie: vendor } }, env)
    expect(list.status).toBe(200)
    const create = await uploadDoc(vendor, p.id, { docType: 'MOM', docVersion: '1.0' })
    expect(create.status).toBe(403)
  })

  it('member ที่ยังไม่ได้ตั้งตำแหน่งในโปรเจกต์นี้ (fallback VIEW_ONLY) — สร้างไม่ได้ (403)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const pond = await loginAs(app, 'pond@example-co.test')
    const create = await uploadDoc(pond, p.id, { docType: 'MOM', docVersion: '1.0' })
    expect(create.status).toBe(403)
  })

  it('member ที่ตั้งตำแหน่ง "เข้าถึงเต็มรูปแบบ" ในโปรเจกต์นี้แล้ว — สร้างได้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_pond', positionId: 'pos_full_access' }), env)
    const pond = await loginAs(app, 'pond@example-co.test')
    const create = await uploadDoc(pond, p.id, { docType: 'MOM', docVersion: '1.0' })
    expect(create.status).toBe(201)
  })

  it('guest ที่ไม่ได้ผูกกับโปรเจกต์นี้เลย — เข้า list ไม่ได้เลย (403)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const other = await makeProject(owner, 'โปรเจกต์อื่นของ guest')
    const p = await makeProject(owner)
    await app.request('/api/admin/users', json(owner, { email: 'guest-doc@example.com', name: 'ลูกค้า', role: 'guest', projectIds: [other.id] }), env)
    const guest = await loginAs(app, 'guest-doc@example.com')
    const list = await app.request(`/api/projects/${p.id}/documents`, { headers: { cookie: guest } }, env)
    expect(list.status).toBe(403)
  })
})

describe('§Project Documents — แก้ metadata แยกจากอัปโหลดเวอร์ชันใหม่ + group เป็นเล่ม', () => {
  it('PATCH แก้ title/docVersion — ไม่กระทบไฟล์เดิม', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const created = (await (await uploadDoc(owner, p.id, { docType: 'MOM', docVersion: '1.0' })).json()) as { id: string; r2Key: string }
    const patched = await app.request(
      `/api/projects/${p.id}/documents/${created.id}`,
      { method: 'PATCH', headers: { cookie: owner, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'ชื่อใหม่', docVersion: '1.1' }) },
      env,
    )
    expect(patched.status).toBe(200)
    const updated = (await patched.json()) as { title: string; docVersion: string; r2Key: string }
    expect(updated.title).toBe('ชื่อใหม่')
    expect(updated.docVersion).toBe('1.1')
    expect(updated.r2Key).toBe(created.r2Key) // metadata edit ไม่แตะไฟล์
  })

  it('เพิ่มเวอร์ชันใหม่ — copy docType/docNumber จากเอกสารต้นทาง, group เป็นเล่มเดียวกันใน list', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const base = (await (await uploadDoc(owner, p.id, { docType: 'MOM', docVersion: '1.0' })).json()) as { id: string; docNumber: string | null }

    const fd = new FormData()
    fd.append('file', new File(['v2 content'], 'spec-v2.pdf', { type: 'application/pdf' }))
    fd.append('docVersion', '2.0')
    const verRes = await app.request(`/api/projects/${p.id}/documents/${base.id}/versions/upload`, { method: 'POST', headers: { cookie: owner }, body: fd }, env)
    expect(verRes.status).toBe(201)
    const v2 = (await verRes.json()) as { docType: string; docNumber: string | null; docVersion: string }
    expect(v2.docType).toBe('MOM')
    expect(v2.docVersion).toBe('2.0')
    expect(v2.docNumber).toBeTruthy()

    const list = (await (await app.request(`/api/projects/${p.id}/documents`, { headers: { cookie: owner } }, env)).json()) as {
      series: { versions: { id: string; docVersion: string | null }[] }[]
    }
    expect(list.series).toHaveLength(1) // เล่มเดียว 2 เวอร์ชัน
    expect(list.series[0]!.versions.map((v) => v.docVersion)).toEqual(['2.0', '1.0']) // ใหม่สุดก่อน
  })
})

describe('§Project Documents — ลบ = soft-delete', () => {
  it('DELETE แล้วหายจาก list แต่แถวยังอยู่ใน DB (deletedAt ถูกเซ็ต)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const created = (await (await uploadDoc(owner, p.id, { docType: 'MOM', docVersion: '1.0' })).json()) as { id: string }
    const del = await app.request(`/api/projects/${p.id}/documents/${created.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)
    expect(del.status).toBe(200)
    const list = (await (await app.request(`/api/projects/${p.id}/documents`, { headers: { cookie: owner } }, env)).json()) as { series: unknown[] }
    expect(list.series).toHaveLength(0)
    const row = await env.DB.prepare('SELECT deleted_at FROM docs WHERE id = ?').bind(created.id).first<{ deleted_at: number | null }>()
    expect(row?.deleted_at).not.toBeNull()
  })
})

describe('§Project Documents — เพิ่มลิงก์ Google Drive เท่านั้น', () => {
  it('ลิงก์ Google Drive ถูกต้อง — สร้างได้ พร้อมดึง driveFileId', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const res = await app.request(
      `/api/projects/${p.id}/documents/link`,
      json(owner, { title: 'ไฟล์ Drive', externalUrl: 'https://drive.google.com/file/d/1AbcDefGhi/view', docType: 'BRD', docVersion: '1.0' }),
      env,
    )
    expect(res.status).toBe(201)
    const doc = (await res.json()) as { driveFileId: string | null; source: string }
    expect(doc.driveFileId).toBe('1AbcDefGhi')
    expect(doc.source).toBe('gdrive')
  })

  it('ลิงก์ที่ไม่ใช่ Google Drive (เช่น Dropbox) — 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const res = await app.request(
      `/api/projects/${p.id}/documents/link`,
      json(owner, { title: 'ไฟล์อื่น', externalUrl: 'https://www.dropbox.com/s/abc/file.pdf', docType: 'BRD', docVersion: '1.0' }),
      env,
    )
    expect(res.status).toBe(400)
  })
})

describe('§Project Documents — โปรโมทไฟล์แนบ Task เป็นเอกสารโปรเจกต์', () => {
  async function makeTaskWithAttachment(ownerCookie: string, projectId: string) {
    const g = (await (await app.request(`/api/projects/${projectId}/groups`, json(ownerCookie, { name: 'G' }), env)).json()) as { id: string }
    const t = (await (await app.request(`/api/groups/${g.id}/tasks`, json(ownerCookie, { title: 'งานมีไฟล์แนบ' }), env)).json()) as { id: string }
    const fd = new FormData()
    fd.append('file', new File(['attachment bytes'], 'report.pdf', { type: 'application/pdf' }))
    const att = (await (await app.request(`/api/tasks/${t.id}/attachments`, { method: 'POST', headers: { cookie: ownerCookie }, body: fd }, env)).json()) as { id: string; r2Key: string }
    return { taskId: t.id, attachmentId: att.id, r2Key: att.r2Key }
  }

  it('โปรโมทไฟล์ → เอกสารใหม่โผล่ในแท็บเอกสารโปรเจกต์ + ไฟล์แนบต้นฉบับยังอยู่ในหน้า Task', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const { taskId, attachmentId } = await makeTaskWithAttachment(owner, p.id)

    const promote = await app.request(
      `/api/tasks/${taskId}/attachments/${attachmentId}/promote`,
      json(owner, { docType: 'SOW', docVersion: '1.0' }),
      env,
    )
    expect(promote.status).toBe(201)
    const doc = (await promote.json()) as { id: string; source: string; sourceTaskAttachmentId: string }
    expect(doc.source).toBe('task_attachment')
    expect(doc.sourceTaskAttachmentId).toBe(attachmentId)

    const list = (await (await app.request(`/api/projects/${p.id}/documents`, { headers: { cookie: owner } }, env)).json()) as { series: { versions: { id: string }[] }[] }
    expect(list.series.some((s) => s.versions.some((v) => v.id === doc.id))).toBe(true)

    // ไฟล์แนบต้นฉบับใน Task ยังอยู่เหมือนเดิม
    const attList = (await (await app.request(`/api/tasks/${taskId}/detail`, { headers: { cookie: owner } }, env)).json()) as { attachments: { id: string }[] }
    expect(attList.attachments.some((a) => a.id === attachmentId)).toBe(true)
  })

  it('โปรโมทแล้วลบไฟล์แนบต้นฉบับใน Task ภายหลัง — เอกสารที่โปรโมทไปแล้วยังเปิดได้ปกติ (copy ไฟล์ไปคีย์ใหม่ ไม่ได้อ้างคีย์เดิมร่วมกัน)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const { taskId, attachmentId, r2Key: originalR2Key } = await makeTaskWithAttachment(owner, p.id)

    const promote = await app.request(
      `/api/tasks/${taskId}/attachments/${attachmentId}/promote`,
      json(owner, { docType: 'SOW', docVersion: '1.0' }),
      env,
    )
    const doc = (await promote.json()) as { id: string; r2Key: string }
    expect(doc.r2Key).not.toBe(originalR2Key) // คนละคีย์กัน — copy จริง ไม่ใช่ reference เดิม

    // ลบไฟล์แนบต้นฉบับ (ลบไฟล์จริงใน R2 ด้วยตาม behavior เดิมของ endpoint นี้)
    const delAtt = await app.request(`/api/attachments/${attachmentId}`, { method: 'DELETE', headers: { cookie: owner } }, env)
    expect(delAtt.status).toBe(200)

    // เอกสารที่โปรโมทไปแล้วยังเปิดไฟล์ได้ปกติ (r2Key คนละอันกับที่เพิ่งถูกลบ)
    const raw = await app.request(`/api/projects/${p.id}/documents/${doc.id}/raw`, { headers: { cookie: owner } }, env)
    expect(raw.status).toBe(200)
    expect(await raw.text()).toBe('attachment bytes')
  })
})
