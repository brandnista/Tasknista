import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

beforeEach(async () => {
  await seedUsers()
})

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

// สร้าง project ด้วย owner เสมอ (POST /api/projects เป็น ownerOnly) — ถ้า actor ไม่ใช่ owner
// ต้องตั้งเป็น project editor ก่อน ไม่งั้นสร้าง group/task ไม่ได้ (canEditProject gate)
async function makeTask(cookie: string, asEditorUserId?: string) {
  const owner = await loginAs(app, 'owner@example-co.test')
  const p = (await (await app.request('/api/projects', json(owner, { name: 'P', type: 'project' }), env)).json()) as { id: string }
  if (asEditorUserId)
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: asEditorUserId, positionId: 'pos_full_access' }), env)
  const g = (await (await app.request(`/api/projects/${p.id}/groups`, json(cookie, { name: 'G' }), env)).json()) as { id: string }
  const t = (await (await app.request(`/api/groups/${g.id}/tasks`, json(cookie, { title: 'งานทดสอบ' }), env)).json()) as { id: string }
  return t
}

describe('T10 — task detail: comments + attachments + activity', () => {
  it('comment ได้ทุก role รวม vendor · เรียงเวลา · ขึ้นใน activity', async () => {
    const m = await loginAs(app, 'pond@example-co.test')
    const t = await makeTask(m, 'u_pond')
    const v = await loginAs(app, 'somchai@example.com')

    await app.request(`/api/tasks/${t.id}/comments`, json(m, { body: 'ใช้ grid เดิมได้เลย' }), env)
    const vRes = await app.request(`/api/tasks/${t.id}/comments`, json(v, { body: 'รับทราบครับ' }), env)
    expect(vRes.status).toBe(201)

    const detail = (await (
      await app.request(`/api/tasks/${t.id}/detail`, { headers: { cookie: m } }, env)
    ).json()) as { comments: { body: string; userName: string }[]; activity: { action: string }[] }
    expect(detail.comments.map((c) => c.userName)).toEqual(['ปอนด์', 'สมชาย'])
    expect(detail.activity.some((a) => a.action === 'task.comment')).toBe(true)
    expect(detail.activity.some((a) => a.action === 'task.create')).toBe(true)
  })

  it('อัปโหลดไฟล์ → R2 → ดาวน์โหลดได้ byte ตรง · ไฟล์ inline เฉพาะรูป · vendor อัปไม่ได้', async () => {
    const m = await loginAs(app, 'pond@example-co.test')
    const t = await makeTask(m, 'u_pond')

    const fd = new FormData()
    fd.append('file', new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'mock.png', { type: 'image/png' }))
    const up = await app.request(`/api/tasks/${t.id}/attachments`, { method: 'POST', headers: { cookie: m }, body: fd }, env)
    expect(up.status).toBe(201)
    const att = (await up.json()) as { id: string; filename: string }
    expect(att.filename).toBe('mock.png')

    const dl = await app.request(`/api/attachments/${att.id}`, { headers: { cookie: m } }, env)
    expect(dl.status).toBe(200)
    expect(dl.headers.get('content-type')).toBe('image/png')
    expect(dl.headers.get('content-disposition')).toContain('inline')
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))

    // ไม่ login โหลดไม่ได้
    expect((await app.request(`/api/attachments/${att.id}`, {}, env)).status).toBe(401)

    // vendor อัปโหลดไม่ได้ (teamOnly)
    const v = await loginAs(app, 'somchai@example.com')
    const fd2 = new FormData()
    fd2.append('file', new File(['x'], 'x.txt', { type: 'text/plain' }))
    expect(
      (await app.request(`/api/tasks/${t.id}/attachments`, { method: 'POST', headers: { cookie: v }, body: fd2 }, env)).status,
    ).toBe(403)
  })

  it('SVG ถูกบังคับดาวน์โหลด (กัน XSS) · ลบไฟล์ได้เฉพาะคนอัป/owner', async () => {
    const m = await loginAs(app, 'pond@example-co.test')
    const t = await makeTask(m, 'u_pond')
    const fd = new FormData()
    fd.append('file', new File(['<svg onload="alert(1)"/>'], 'evil.svg', { type: 'image/svg+xml' }))
    const up = await app.request(`/api/tasks/${t.id}/attachments`, { method: 'POST', headers: { cookie: m }, body: fd }, env)
    const att = (await up.json()) as { id: string }

    const dl = await app.request(`/api/attachments/${att.id}`, { headers: { cookie: m } }, env)
    expect(dl.headers.get('content-type')).toBe('application/octet-stream')
    expect(dl.headers.get('content-disposition')).toContain('attachment')

    const owner = await loginAs(app, 'owner@example-co.test')
    expect((await app.request(`/api/attachments/${att.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)).status).toBe(200)
    expect((await app.request(`/api/attachments/${att.id}`, { headers: { cookie: m } }, env)).status).toBe(404)
  })

  it('activity ไล่ลำดับ: create → status → assign', async () => {
    const m = await loginAs(app, 'owner@example-co.test')
    const t = await makeTask(m)
    await app.request(`/api/tasks/${t.id}`, { ...json(m, { status: 'done' }), method: 'PATCH' }, env)
    await app.request(`/api/tasks/${t.id}`, { ...json(m, { assigneeId: 'u_pond' }), method: 'PATCH' }, env)
    const detail = (await (
      await app.request(`/api/tasks/${t.id}/detail`, { headers: { cookie: m } }, env)
    ).json()) as { activity: { action: string }[] }
    // เรียงล่าสุดก่อน
    expect(detail.activity.map((a) => a.action)).toEqual(['task.assign', 'task.status', 'task.create'])
  })
})

describe('Pronista §Notification overhaul (2026-08-27) — คอมเมนต์ในงานแจ้งเตือนผู้รับงาน+ผู้จ่ายงาน+คนที่เคยคอมเมนต์', () => {
  it('แจ้งผู้รับงาน+ผู้จ่ายงาน+คนที่เคยคอมเมนต์มาก่อน ไม่แจ้งคนคอมเมนต์เอง · ติดขัด (isBlocked) ขึ้นต้นด้วย 🚩', async () => {
    const owner = await loginAs(app, 'owner@example-co.test') // ผู้จ่ายงาน (createdBy)
    const pond = await loginAs(app, 'pond@example-co.test') // ผู้รับงาน (assignee)
    const korn = await loginAs(app, 'korn@example-co.test') // ไม่เกี่ยวข้องเลย จนกว่าจะคอมเมนต์ — auto-provision ตอน login (id จริงเป็น uuid ไม่ใช่ 'u_korn')
    const kornMe = (await (await app.request('/api/me', { headers: { cookie: korn } }, env)).json()) as { id: string }
    const p = (await (await app.request('/api/projects', json(owner, { name: 'P-comment', type: 'project' }), env)).json()) as { id: string }
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_pond', positionId: 'pos_full_access' }), env)
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: kornMe.id, positionId: 'pos_full_access' }), env)
    const g = (await (await app.request(`/api/projects/${p.id}/groups`, json(owner, { name: 'G' }), env)).json()) as { id: string }
    const t = (await (
      await app.request(`/api/groups/${g.id}/tasks`, json(owner, { title: 'งานทดสอบคอมเมนต์', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }

    // ไฟล์นี้ไม่ล้าง DB ระหว่าง it() แต่ละอัน — เทียบผลต่าง (delta) แทนค่านิ่ง กัน notification เก่าจาก test อื่นทับ
    const notifCount = async (cookie: string) =>
      ((await (await app.request('/api/notifications', { headers: { cookie } }, env)).json()) as { type: string }[]).filter((n) => n.type === 'task_commented').length
    const before = { pond: await notifCount(pond), owner: await notifCount(owner), korn: await notifCount(korn) }

    // กร (ไม่เกี่ยวข้องเลย) คอมเมนต์ก่อน — ผู้รับงาน (ปอนด์) + ผู้จ่ายงาน (owner) ต้องได้แจ้งเตือนเพิ่ม กรเองไม่ได้
    await app.request(`/api/tasks/${t.id}/comments`, json(korn, { body: 'เห็นด้วยครับ' }), env)
    expect(await notifCount(pond)).toBe(before.pond + 1)
    expect(await notifCount(owner)).toBe(before.owner + 1)
    expect(await notifCount(korn)).toBe(before.korn)

    // owner คอมเมนต์ต่อ — ปอนด์ (assignee) + กร (เคยคอมเมนต์มาก่อน) ต้องได้เพิ่ม · owner เองไม่ได้แจ้งเตือนตัวเอง
    await app.request(`/api/tasks/${t.id}/comments`, json(owner, { body: 'รับทราบ' }), env)
    expect(await notifCount(pond)).toBe(before.pond + 2)
    expect(await notifCount(korn)).toBe(before.korn + 1)
    expect(await notifCount(owner)).toBe(before.owner + 1) // ไม่เพิ่มจากคอมเมนต์ตัวเอง

    // ปอนด์คอมเมนต์แบบติดขัด (isBlocked) — owner ต้องเห็นข้อความขึ้นต้นด้วย 🚩
    await app.request(`/api/tasks/${t.id}/comments`, json(pond, { body: 'ติดปัญหา API ต้นทาง', isBlocked: true }), env)
    const ownerNotifs = (await (await app.request('/api/notifications', { headers: { cookie: owner } }, env)).json()) as { type: string; message: string }[]
    expect(ownerNotifs.some((n) => n.type === 'task_commented' && n.message.startsWith('🚩'))).toBe(true)
  })
})
