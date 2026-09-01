import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

// Pronista §My Note Edit (2026-08-27) — สร้าง/แก้ไข/ลบบันทึกส่วนตัว (ไม่มีเทสต์มาก่อนเลยทั้งที่ endpoint นี้ทำงานจริงอยู่แล้ว)

beforeEach(async () => {
  await seedUsers()
})

const json = (cookie: string, body: unknown) => ({ method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const patch = (cookie: string, body: unknown) => ({ ...json(cookie, body), method: 'PATCH' })

describe('Pronista §My Note — CRUD พื้นฐาน', () => {
  it('สร้างบันทึกข้อความ + checklist ได้ · เห็นเฉพาะของตัวเอง', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    await app.request('/api/my-notes', json(pond, { title: 'บันทึกข้อความ', body: { mode: 'text', text: 'สวัสดี' } }), env)
    await app.request('/api/my-notes', json(pond, { title: null, body: { mode: 'checklist', items: [{ id: '1', text: 'ทำอะไรสักอย่าง', done: false }] } }), env)

    const pondList = (await (await app.request('/api/my-notes', { headers: { cookie: pond } }, env)).json()) as { title: string | null }[]
    expect(pondList).toHaveLength(2)
    expect(pondList.some((n) => n.title === 'บันทึกข้อความ')).toBe(true)

    const somchaiList = (await (await app.request('/api/my-notes', { headers: { cookie: somchai } }, env)).json()) as unknown[]
    expect(somchaiList).toHaveLength(0)
  })

  it('แก้ไขบันทึกเดิมได้ทั้ง title และ body (ข้อความ)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/my-notes', json(pond, { title: 'หัวข้อเดิม', body: { mode: 'text', text: 'เนื้อหาเดิม' } }), env)
    ).json()) as { id: string }

    const res = await app.request(`/api/my-notes/${created.id}`, patch(pond, { title: 'หัวข้อใหม่', body: { mode: 'text', text: 'เนื้อหาใหม่' } }), env)
    expect(res.status).toBe(200)

    const list = (await (await app.request('/api/my-notes', { headers: { cookie: pond } }, env)).json()) as { id: string; title: string | null; body: string }[]
    const updated = list.find((n) => n.id === created.id)!
    expect(updated.title).toBe('หัวข้อใหม่')
    expect(JSON.parse(updated.body)).toEqual({ mode: 'text', text: 'เนื้อหาใหม่' })
  })

  it('แก้ไขจากโหมดข้อความเป็น checklist ได้ (เปลี่ยน mode ทั้งยวง)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/my-notes', json(pond, { title: null, body: { mode: 'text', text: 'จะเปลี่ยนเป็น checklist' } }), env)
    ).json()) as { id: string }

    await app.request(
      `/api/my-notes/${created.id}`,
      patch(pond, { body: { mode: 'checklist', items: [{ id: 'a', text: 'ข้อ 1', done: true }] } }),
      env,
    )
    const list = (await (await app.request('/api/my-notes', { headers: { cookie: pond } }, env)).json()) as { id: string; body: string }[]
    const updated = list.find((n) => n.id === created.id)!
    expect(JSON.parse(updated.body)).toEqual({ mode: 'checklist', items: [{ id: 'a', text: 'ข้อ 1', done: true }] })
  })

  it('แก้ไข/ลบบันทึกของคนอื่นที่ไม่ถูกแชร์มาไม่ได้ (403 — mirror ไฟล์ของฉัน) · id ไม่มีจริง = 404', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const created = (await (
      await app.request('/api/my-notes', json(pond, { title: 'ของปอนด์', body: { mode: 'text', text: 'ลับ' } }), env)
    ).json()) as { id: string }

    expect((await app.request(`/api/my-notes/${created.id}`, patch(somchai, { title: 'แอบแก้' }), env)).status).toBe(403)
    expect((await app.request(`/api/my-notes/${created.id}`, { method: 'DELETE', headers: { cookie: somchai } }, env)).status).toBe(403)
    expect((await app.request('/api/my-notes/does-not-exist', patch(somchai, { title: 'x' }), env)).status).toBe(404)
  })

  it('ลบบันทึกได้ · ไม่ login เรียกไม่ได้ (401)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/my-notes', json(pond, { title: 'จะลบ', body: { mode: 'text', text: 'x' } }), env)
    ).json()) as { id: string }
    expect((await app.request(`/api/my-notes/${created.id}`, { method: 'DELETE', headers: { cookie: pond } }, env)).status).toBe(200)
    const list = (await (await app.request('/api/my-notes', { headers: { cookie: pond } }, env)).json()) as { id: string }[]
    expect(list.some((n) => n.id === created.id)).toBe(false)

    expect((await app.request('/api/my-notes', {}, env)).status).toBe(401)
  })
})

describe('Pronista §My Note sharing (2026-08-28) — mirror กติกาไฟล์ของฉัน (viewer/editor)', () => {
  // Pronista §My Note shared split (2026-09-01) — เดิม /my-notes รวมของฉัน+ที่ถูกแชร์มาเป็นลิสต์เดียว ตอนนี้แยกออกไป /my-notes/shared แล้ว (ดูเมนู "แชร์กับฉัน")
  it('แชร์แบบ viewer → ไม่โผล่ใน /my-notes (ของฉันล้วน) แต่โผล่ใน /my-notes/shared (ownerName+myRole) อ่านได้ แก้ไม่ได้ · แชร์แบบ editor → แก้ได้ด้วย', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const created = (await (
      await app.request('/api/my-notes', json(pond, { title: 'จะแชร์', body: { mode: 'text', text: 'เดิม' } }), env)
    ).json()) as { id: string }

    await app.request(`/api/my-notes/${created.id}/members`, json(pond, { userId: 'u_somchai', role: 'viewer' }), env)

    const somchaiOwn = (await (await app.request('/api/my-notes', { headers: { cookie: somchai } }, env)).json()) as { id: string }[]
    expect(somchaiOwn.some((n) => n.id === created.id)).toBe(false)

    const somchaiShared = (await (await app.request('/api/my-notes/shared', { headers: { cookie: somchai } }, env)).json()) as { id: string; ownerName: string | null; myRole?: string }[]
    const row = somchaiShared.find((n) => n.id === created.id)!
    expect(row).toMatchObject({ ownerName: 'ปอนด์', myRole: 'viewer' })
    expect((await app.request(`/api/my-notes/${created.id}`, patch(somchai, { title: 'แอบแก้' }), env)).status).toBe(403)

    await app.request(`/api/my-notes/${created.id}/members`, json(pond, { userId: 'u_somchai', role: 'editor' }), env)
    expect((await app.request(`/api/my-notes/${created.id}`, patch(somchai, { title: 'แก้ได้แล้ว' }), env)).status).toBe(200)

    // เจ้าของเห็นในลิสต์ตัวเอง ownerName ต้องเป็น null (ไม่ใช่ของที่ถูกแชร์มา) และไม่มี myRole (เจ้าของ ไม่ใช่ member)
    const pondList = (await (await app.request('/api/my-notes', { headers: { cookie: pond } }, env)).json()) as { id: string; ownerName: string | null; myRole?: string }[]
    const pondOwn = pondList.find((n) => n.id === created.id)!
    expect(pondOwn.ownerName).toBeNull()
    expect(pondOwn.myRole).toBeUndefined()
  })

  it('เฉพาะเจ้าของเท่านั้นที่แชร์/ถอนแชร์ได้ (editor ทำไม่ได้)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const created = (await (
      await app.request('/api/my-notes', json(pond, { title: 'สิทธิ์แชร์', body: { mode: 'text', text: 'x' } }), env)
    ).json()) as { id: string }
    await app.request(`/api/my-notes/${created.id}/members`, json(pond, { userId: 'u_somchai', role: 'editor' }), env)

    const res = await app.request(`/api/my-notes/${created.id}/members`, json(somchai, { userId: 'u_pond', role: 'viewer' }), env)
    expect(res.status).toBe(403)
  })
})

describe('Pronista §My Note badge (2026-09-01) — แจ้งเตือนตอนถูกแชร์ Note', () => {
  const notifCount = async (cookie: string) =>
    ((await (await app.request('/api/notifications', { headers: { cookie } }, env)).json()) as { type: string }[]).filter((n) => n.type === 'note_shared').length

  it('แชร์ครั้งแรก → คนที่ถูกแชร์ได้ note_shared 1 รายการ ข้อความมีชื่อ note · แชร์ซ้ำ/เปลี่ยนสิทธิ์ไม่แจ้งซ้ำ', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const created = (await (
      await app.request('/api/my-notes', json(pond, { title: 'บันทึกที่จะแชร์', body: { mode: 'text', text: 'x' } }), env)
    ).json()) as { id: string }

    const before = await notifCount(somchai)
    const idsBefore = new Set(
      ((await (await app.request('/api/notifications', { headers: { cookie: somchai } }, env)).json()) as { id: string; type: string }[])
        .filter((n) => n.type === 'note_shared')
        .map((n) => n.id),
    )
    await app.request(`/api/my-notes/${created.id}/members`, json(pond, { userId: 'u_somchai', role: 'viewer' }), env)
    expect(await notifCount(somchai)).toBe(before + 1)
    const notifs = (await (await app.request('/api/notifications', { headers: { cookie: somchai } }, env)).json()) as { id: string; type: string; message: string }[]
    const fresh = notifs.find((n) => n.type === 'note_shared' && !idsBefore.has(n.id))
    expect(fresh?.message).toBe('ปอนด์ แชร์บันทึก "บันทึกที่จะแชร์" ให้คุณ')

    // เปลี่ยนสิทธิ์เป็น editor — เป็นแค่แก้ role ของคนเดิม ไม่ใช่แชร์ใหม่ ไม่ควรแจ้งซ้ำ
    await app.request(`/api/my-notes/${created.id}/members`, json(pond, { userId: 'u_somchai', role: 'editor' }), env)
    expect(await notifCount(somchai)).toBe(before + 1)
  })
})

describe('Pronista §My Note attachments (2026-08-28)', () => {
  it('แนบไฟล์ได้ (owner) · คนที่ถูกแชร์แบบ viewer ดาวน์โหลดได้แต่แนบ/ลบไม่ได้', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const created = (await (
      await app.request('/api/my-notes', json(pond, { title: 'มีไฟล์แนบ', body: { mode: 'text', text: 'x' } }), env)
    ).json()) as { id: string }

    const form = new FormData()
    form.set('file', new File(['เนื้อหาไฟล์แนบ'], 'แนบ.txt', { type: 'text/plain' }))
    const uploadRes = await app.request(`/api/my-notes/${created.id}/attachments`, { method: 'POST', headers: { cookie: pond }, body: form }, env)
    expect(uploadRes.status).toBe(201)
    const att = (await uploadRes.json()) as { id: string; name: string }
    expect(att.name).toBe('แนบ.txt')

    // ยังไม่ถูกแชร์ — somchai แนบ/ดูไม่ได้เลย
    expect((await app.request(`/api/my-notes/${created.id}/attachments`, { headers: { cookie: somchai } }, env)).status).toBe(403)

    await app.request(`/api/my-notes/${created.id}/members`, json(pond, { userId: 'u_somchai', role: 'viewer' }), env)
    const listRes = await app.request(`/api/my-notes/${created.id}/attachments`, { headers: { cookie: somchai } }, env)
    expect(listRes.status).toBe(200)
    expect(((await listRes.json()) as { id: string }[]).some((a) => a.id === att.id)).toBe(true)

    const dl = await app.request(`/api/my-notes/attachments/${att.id}/download`, { headers: { cookie: somchai } }, env)
    expect(dl.status).toBe(200)

    const somchaiForm = new FormData()
    somchaiForm.set('file', new File(['x'], 'แอบแนบ.txt', { type: 'text/plain' }))
    expect((await app.request(`/api/my-notes/${created.id}/attachments`, { method: 'POST', headers: { cookie: somchai }, body: somchaiForm }, env)).status).toBe(403)
    expect((await app.request(`/api/my-notes/attachments/${att.id}`, { method: 'DELETE', headers: { cookie: somchai } }, env)).status).toBe(403)

    // editor แนบ/ลบไฟล์ได้
    await app.request(`/api/my-notes/${created.id}/members`, json(pond, { userId: 'u_somchai', role: 'editor' }), env)
    expect((await app.request(`/api/my-notes/attachments/${att.id}`, { method: 'DELETE', headers: { cookie: somchai } }, env)).status).toBe(200)
  })

  it('ลบบันทึก → ไฟล์แนบหายไปด้วย (ไม่ค้างกำพร้า)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/my-notes', json(pond, { title: 'จะลบพร้อมไฟล์', body: { mode: 'text', text: 'x' } }), env)
    ).json()) as { id: string }
    const form = new FormData()
    form.set('file', new File(['x'], 'ไฟล์.txt', { type: 'text/plain' }))
    const att = (await (await app.request(`/api/my-notes/${created.id}/attachments`, { method: 'POST', headers: { cookie: pond }, body: form }, env)).json()) as { id: string }

    expect((await app.request(`/api/my-notes/${created.id}`, { method: 'DELETE', headers: { cookie: pond } }, env)).status).toBe(200)
    expect((await app.request(`/api/my-notes/attachments/${att.id}/download`, { headers: { cookie: pond } }, env)).status).toBe(404)
  })
})

describe('Pronista §My Note link attachment (2026-09-01) — แนบลิงก์ Google Docs/Drive แทนไฟล์จริง', () => {
  it('แนบลิงก์ได้ (owner) · list เห็น kind=link + externalUrl · ดาวน์โหลดไม่ได้ (404 ไม่ใช่ kind=file)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/my-notes', json(pond, { title: 'มีลิงก์แนบ', body: { mode: 'text', text: 'x' } }), env)
    ).json()) as { id: string }

    const res = await app.request(`/api/my-notes/${created.id}/attachments/link`, json(pond, { name: 'สเปกลูกค้า', externalUrl: 'https://docs.google.com/document/d/abc' }), env)
    expect(res.status).toBe(201)
    const att = (await res.json()) as { id: string; kind: string; externalUrl: string; sizeBytes: number | null }
    expect(att).toMatchObject({ kind: 'link', externalUrl: 'https://docs.google.com/document/d/abc', sizeBytes: null })

    const listRes = await app.request(`/api/my-notes/${created.id}/attachments`, { headers: { cookie: pond } }, env)
    expect(((await listRes.json()) as { id: string; kind: string }[]).find((a) => a.id === att.id)).toMatchObject({ kind: 'link' })

    expect((await app.request(`/api/my-notes/attachments/${att.id}/download`, { headers: { cookie: pond } }, env)).status).toBe(404)
  })

  it('ไม่ใช่ owner/editor แนบลิงก์ไม่ได้ (403) · externalUrl ไม่ใช่ URL ที่ถูกต้อง (400)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const created = (await (
      await app.request('/api/my-notes', json(pond, { title: 'ของปอนด์', body: { mode: 'text', text: 'x' } }), env)
    ).json()) as { id: string }
    expect((await app.request(`/api/my-notes/${created.id}/attachments/link`, json(somchai, { name: 'แอบแนบ', externalUrl: 'https://x.test' }), env)).status).toBe(403)
    expect((await app.request(`/api/my-notes/${created.id}/attachments/link`, json(pond, { name: 'พัง', externalUrl: 'not-a-url' }), env)).status).toBe(400)
  })
})
