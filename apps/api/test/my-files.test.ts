import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

// Pronista §My Files (2026-08-28) — ไดรฟ์ส่วนตัวแยกขาดจาก "เอกสาร" บริษัท — ไม่มี owner-bypass (Admin เห็นไฟล์คนอื่นไม่ได้ถ้าไม่ถูกแชร์)
// แชร์ทั้งโฟลเดอร์ = ลูกข้างในสืบสิทธิ์ต่อ · guest เข้าเมนูนี้ไม่ได้เลย (owner/member/vendor เท่านั้น)

beforeEach(async () => {
  await seedUsers()
})

const json = (cookie: string, body: unknown) => ({ method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const patch = (cookie: string, body: unknown) => ({ ...json(cookie, body), method: 'PATCH' })

describe('Pronista §My Files — สิทธิ์เมนู (owner/member/vendor เข้าได้ · guest ไม่ได้)', () => {
  it('owner/member/vendor เรียก GET /api/my-files ได้ (200)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    expect((await app.request('/api/my-files', { headers: { cookie: owner } }, env)).status).toBe(200)
    expect((await app.request('/api/my-files', { headers: { cookie: pond } }, env)).status).toBe(200)
    expect((await app.request('/api/my-files', { headers: { cookie: somchai } }, env)).status).toBe(200)
  })

  it('ไม่ login เรียกไม่ได้ (401)', async () => {
    expect((await app.request('/api/my-files', {}, env)).status).toBe(401)
  })
})

describe('Pronista §My Files — สร้างโฟลเดอร์/เอกสาร, list root ของตัวเอง, ไม่เห็นของคนอื่น', () => {
  it('สร้างโฟลเดอร์ + เอกสาร page ที่ root ได้ · list root เห็นเฉพาะของตัวเอง', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    await app.request('/api/my-files', json(pond, { kind: 'folder', name: 'โฟลเดอร์ปอนด์' }), env)
    await app.request('/api/my-files', json(pond, { kind: 'page', name: 'เอกสารปอนด์', contentMarkdown: '# หัวข้อ' }), env)
    await app.request('/api/my-files', json(somchai, { kind: 'folder', name: 'โฟลเดอร์สมชาย' }), env)

    const pondRoot = (await (await app.request('/api/my-files', { headers: { cookie: pond } }, env)).json()) as { items: { name: string }[] }
    expect(pondRoot.items.map((i) => i.name).sort()).toEqual(['เอกสารปอนด์', 'โฟลเดอร์ปอนด์'])

    const somchaiRoot = (await (await app.request('/api/my-files', { headers: { cookie: somchai } }, env)).json()) as { items: { name: string }[] }
    expect(somchaiRoot.items.map((i) => i.name)).toEqual(['โฟลเดอร์สมชาย'])
  })
})

describe('Pronista §My Files — ไม่มี owner-bypass (จุดต่างสำคัญจากเอกสารบริษัท)', () => {
  it('Admin (owner) เห็นไฟล์ส่วนตัวของ pond ไม่ได้เลยถ้าไม่ถูกแชร์', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/my-files', json(pond, { kind: 'page', name: 'ลับสุดยอด', contentMarkdown: 'x' }), env)).json()) as { id: string }

    expect((await app.request(`/api/my-files/${created.id}`, { headers: { cookie: owner } }, env)).status).toBe(403)
    const ownerRoot = (await (await app.request('/api/my-files', { headers: { cookie: owner } }, env)).json()) as { items: { name: string }[] }
    expect(ownerRoot.items.some((i) => i.name === 'ลับสุดยอด')).toBe(false)
  })
})

describe('Pronista §My Files — แชร์ (viewer/editor) + สืบสิทธิ์จากโฟลเดอร์แม่', () => {
  it('แชร์แบบ viewer → อ่านได้ แก้ไม่ได้ · แชร์แบบ editor → แก้ได้ด้วย', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const created = (await (await app.request('/api/my-files', json(pond, { kind: 'page', name: 'จะแชร์', contentMarkdown: 'เดิม' }), env)).json()) as { id: string }

    expect((await app.request(`/api/my-files/${created.id}`, { headers: { cookie: somchai } }, env)).status).toBe(403)

    await app.request(`/api/my-files/${created.id}/members`, json(pond, { userId: 'u_somchai', role: 'viewer' }), env)
    expect((await app.request(`/api/my-files/${created.id}`, { headers: { cookie: somchai } }, env)).status).toBe(200)
    expect((await app.request(`/api/my-files/${created.id}`, patch(somchai, { name: 'แอบแก้' }), env)).status).toBe(403)

    await app.request(`/api/my-files/${created.id}/members`, json(pond, { userId: 'u_somchai', role: 'editor' }), env)
    const editRes = await app.request(`/api/my-files/${created.id}`, patch(somchai, { contentMarkdown: 'แก้แล้ว' }), env)
    expect(editRes.status).toBe(200)
  })

  it('แชร์ทั้งโฟลเดอร์ → เห็น/เข้าไฟล์ลูกข้างในได้ทุกชิ้นโดยไม่ต้องแชร์ทีละไฟล์', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const folder = (await (await app.request('/api/my-files', json(pond, { kind: 'folder', name: 'โฟลเดอร์แชร์' }), env)).json()) as { id: string }
    const child = (await (await app.request('/api/my-files', json(pond, { kind: 'page', name: 'ลูกในโฟลเดอร์', contentMarkdown: 'x', parentId: folder.id }), env)).json()) as { id: string }

    expect((await app.request(`/api/my-files/${child.id}`, { headers: { cookie: somchai } }, env)).status).toBe(403)
    await app.request(`/api/my-files/${folder.id}/members`, json(pond, { userId: 'u_somchai', role: 'viewer' }), env)

    expect((await app.request(`/api/my-files/${child.id}`, { headers: { cookie: somchai } }, env)).status).toBe(200)
    const listing = (await (await app.request(`/api/my-files?parentId=${folder.id}`, { headers: { cookie: somchai } }, env)).json()) as { items: { name: string }[] }
    expect(listing.items.map((i) => i.name)).toEqual(['ลูกในโฟลเดอร์'])
  })

  it('เห็นในแท็บ "แชร์กับฉัน" เฉพาะที่แชร์ตรงถึงตัวเอง (ไม่ใช่เจ้าของ)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const created = (await (await app.request('/api/my-files', json(pond, { kind: 'page', name: 'แชร์ให้สมชาย', contentMarkdown: 'x' }), env)).json()) as { id: string }
    await app.request(`/api/my-files/${created.id}/members`, json(pond, { userId: 'u_somchai', role: 'viewer' }), env)

    const shared = (await (await app.request('/api/my-files/shared', { headers: { cookie: somchai } }, env)).json()) as { name: string; myRole: string }[]
    expect(shared.find((s) => s.name === 'แชร์ให้สมชาย')).toMatchObject({ myRole: 'viewer' })

    const pondShared = (await (await app.request('/api/my-files/shared', { headers: { cookie: pond } }, env)).json()) as { name: string }[]
    expect(pondShared.some((s) => s.name === 'แชร์ให้สมชาย')).toBe(false) // ตัวเองเป็นเจ้าของ ไม่ใช่ถูกแชร์มา
  })

  it('isOwner ต่อแถวถูกต้องแม้ไล่เข้าโฟลเดอร์ที่มีลูกเจ้าของปนกัน (บั๊กเดิม: ปุ่มแชร์โผล่ผิดคนเพราะเช็ค myRole===undefined ซึ่ง endpoint parentId= ไม่เคยส่ง myRole มาเลย)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const folder = (await (await app.request('/api/my-files', json(pond, { kind: 'folder', name: 'โฟลเดอร์ผสม' }), env)).json()) as { id: string }
    // ปอนด์ (เจ้าของโฟลเดอร์) สร้างไฟล์ลูกไว้เอง
    const pondChild = (await (await app.request('/api/my-files', json(pond, { kind: 'page', name: 'ของปอนด์', contentMarkdown: 'x', parentId: folder.id }), env)).json()) as { id: string }
    await app.request(`/api/my-files/${folder.id}/members`, json(pond, { userId: 'u_somchai', role: 'editor' }), env)
    // สมชาย (editor ของโฟลเดอร์ ไม่ใช่เจ้าของ) สร้างไฟล์ลูกของตัวเองเพิ่มเข้ามาในโฟลเดอร์เดียวกัน
    const somchaiChild = (await (await app.request('/api/my-files', json(somchai, { kind: 'page', name: 'ของสมชาย', contentMarkdown: 'y', parentId: folder.id }), env)).json()) as { id: string }

    const listing = (await (await app.request(`/api/my-files?parentId=${folder.id}`, { headers: { cookie: somchai } }, env)).json()) as { items: { id: string; isOwner: boolean }[] }
    expect(listing.items.find((i) => i.id === pondChild.id)?.isOwner).toBe(false) // ไฟล์ของปอนด์ — สมชายไม่ใช่เจ้าของ ปุ่มแชร์ต้องไม่โผล่
    expect(listing.items.find((i) => i.id === somchaiChild.id)?.isOwner).toBe(true) // ไฟล์ที่สมชายสร้างเอง — เป็นเจ้าของจริง ปุ่มแชร์โผล่ได้

    const pondListing = (await (await app.request(`/api/my-files?parentId=${folder.id}`, { headers: { cookie: pond } }, env)).json()) as { items: { id: string; isOwner: boolean }[] }
    expect(pondListing.items.find((i) => i.id === somchaiChild.id)?.isOwner).toBe(false) // มุมกลับ — ปอนด์ก็ไม่ใช่เจ้าของไฟล์ของสมชาย
  })

  it('เฉพาะเจ้าของเท่านั้นที่แชร์/ถอนแชร์ได้ (editor ทำไม่ได้)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const created = (await (await app.request('/api/my-files', json(pond, { kind: 'page', name: 'สิทธิ์แชร์', contentMarkdown: 'x' }), env)).json()) as { id: string }
    await app.request(`/api/my-files/${created.id}/members`, json(pond, { userId: 'u_somchai', role: 'editor' }), env)

    const res = await app.request(`/api/my-files/${created.id}/members`, json(somchai, { userId: 'u_pond', role: 'viewer' }), env)
    expect(res.status).toBe(403)
  })
})

describe('Pronista §My Files — อัปโหลดไฟล์ + ดาวน์โหลด (inline vs attachment)', () => {
  it('อัปโหลดไฟล์ .exe (นามสกุลอะไรก็ได้ตามที่ตกลง) → ดาวน์โหลดกลับมาเป็น attachment เสมอ (ไม่ inline)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const form = new FormData()
    form.set('file', new File(['fake binary'], 'tool.exe', { type: 'application/octet-stream' }))
    const uploadRes = await app.request('/api/my-files/upload', { method: 'POST', headers: { cookie: pond }, body: form }, env)
    expect(uploadRes.status).toBe(201)
    const created = (await uploadRes.json()) as { id: string; name: string }
    expect(created.name).toBe('tool.exe')

    const dl = await app.request(`/api/my-files/${created.id}/download`, { headers: { cookie: pond } }, env)
    expect(dl.status).toBe(200)
    expect(dl.headers.get('content-disposition')).toContain('attachment')
  })

  it('อัปโหลด PDF → ดาวน์โหลดได้แบบ inline (ปลอดภัย)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const form = new FormData()
    form.set('file', new File(['%PDF-1.4 fake'], 'report.pdf', { type: 'application/pdf' }))
    const created = (await (await app.request('/api/my-files/upload', { method: 'POST', headers: { cookie: pond }, body: form }, env)).json()) as { id: string }
    const dl = await app.request(`/api/my-files/${created.id}/download`, { headers: { cookie: pond } }, env)
    expect(dl.headers.get('content-disposition')).toContain('inline')
  })

  it('แชร์ไฟล์อัปโหลด (ไม่ใช่ page) ให้คนอื่นแบบ editor → เห็นใน "แชร์กับฉัน" + ดาวน์โหลดได้จริง', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const form = new FormData()
    form.set('file', new File(['เนื้อหาไฟล์'], 'สัญญา.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    const created = (await (await app.request('/api/my-files/upload', { method: 'POST', headers: { cookie: pond }, body: form }, env)).json()) as { id: string }
    await app.request(`/api/my-files/${created.id}/members`, json(pond, { userId: 'u_somchai', role: 'editor' }), env)

    const shared = (await (await app.request('/api/my-files/shared', { headers: { cookie: somchai } }, env)).json()) as { id: string; myRole: string; isOwner: boolean }[]
    expect(shared.find((s) => s.id === created.id)).toMatchObject({ myRole: 'editor', isOwner: false })

    const dl = await app.request(`/api/my-files/${created.id}/download`, { headers: { cookie: somchai } }, env)
    expect(dl.status).toBe(200)
  })

  it('คนอื่นดาวน์โหลดไฟล์ที่ไม่ถูกแชร์ให้ไม่ได้ (403)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const form = new FormData()
    form.set('file', new File(['x'], 'private.txt', { type: 'text/plain' }))
    const created = (await (await app.request('/api/my-files/upload', { method: 'POST', headers: { cookie: pond }, body: form }, env)).json()) as { id: string }
    expect((await app.request(`/api/my-files/${created.id}/download`, { headers: { cookie: somchai } }, env)).status).toBe(403)
  })
})

describe('Pronista §My Files — ย้าย (กัน cycle) + ลบ (soft-delete ทั้ง subtree)', () => {
  it('ย้ายโฟลเดอร์ลงใต้ลูกหลานตัวเอง = 409 cycle', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const a = (await (await app.request('/api/my-files', json(pond, { kind: 'folder', name: 'A' }), env)).json()) as { id: string }
    const b = (await (await app.request('/api/my-files', json(pond, { kind: 'folder', name: 'B', parentId: a.id }), env)).json()) as { id: string }
    expect((await app.request(`/api/my-files/${a.id}/move`, json(pond, { parentId: b.id }), env)).status).toBe(409)
  })

  it('ลบโฟลเดอร์ = soft-delete ทั้ง subtree ไม่โผล่ใน list อีก', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const a = (await (await app.request('/api/my-files', json(pond, { kind: 'folder', name: 'จะลบ' }), env)).json()) as { id: string }
    const b = (await (await app.request('/api/my-files', json(pond, { kind: 'page', name: 'ลูกจะลบ', contentMarkdown: 'x', parentId: a.id }), env)).json()) as { id: string }

    const del = (await (await app.request(`/api/my-files/${a.id}`, { method: 'DELETE', headers: { cookie: pond } }, env)).json()) as { deleted: number }
    expect(del.deleted).toBe(2)
    expect((await app.request(`/api/my-files/${b.id}`, { headers: { cookie: pond } }, env)).status).toBe(404)
    const root = (await (await app.request('/api/my-files', { headers: { cookie: pond } }, env)).json()) as { items: { id: string }[] }
    expect(root.items.some((i) => i.id === a.id)).toBe(false)
  })
})
