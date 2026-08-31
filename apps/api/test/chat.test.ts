import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

// Pronista §Team Chat (2026-08-26) — ห้อง project สร้างอัตโนมัติคู่โปรเจกต์, ห้อง dm/group ตั้งเอง
// mention ต้อง validate เป็นสมาชิกห้องจริงฝั่ง server, convert-to-task ต้องเช็คสิทธิ์ task.create ของโปรเจกต์ปลายทาง

beforeEach(async () => {
  await seedUsers()
})

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

async function makeProject(ownerCookie: string, editorUserId?: string) {
  const p = (await (await app.request('/api/projects', json(ownerCookie, { name: 'โปรเจกต์แชท', type: 'project' }), env)).json()) as { id: string }
  if (editorUserId) await app.request(`/api/projects/${p.id}/members`, json(ownerCookie, { userId: editorUserId, positionId: 'pos_full_access' }), env)
  return p
}

describe('Pronista §Team Chat — channels & messages', () => {
  it('สร้างโปรเจกต์ → ได้ห้องแชท project อัตโนมัติ เห็นเฉพาะสมาชิกโปรเจกต์นั้น', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const p = await makeProject(owner, 'u_pond')

    const ownerChannels = (await (await app.request('/api/chat/channels', { headers: { cookie: owner } }, env)).json()) as { kind: string; projectId: string | null }[]
    expect(ownerChannels.some((c) => c.kind === 'project' && c.projectId === p.id)).toBe(true)

    const pondChannels = (await (await app.request('/api/chat/channels', { headers: { cookie: pond } }, env)).json()) as { projectId: string | null }[]
    expect(pondChannels.some((c) => c.projectId === p.id)).toBe(true)

    // สมชาย (vendor ไม่ได้เป็นสมาชิกโปรเจกต์นี้) ไม่ควรเห็นห้องนี้ในลิสต์ของตัวเอง
    const somchai = await loginAs(app, 'somchai@example.com')
    const somchaiChannels = (await (await app.request('/api/chat/channels', { headers: { cookie: somchai } }, env)).json()) as { projectId: string | null }[]
    expect(somchaiChannels.some((c) => c.projectId === p.id)).toBe(false)
  })

  it('ส่งข้อความในห้อง project ได้ → ปรากฏใน GET messages พร้อมชื่อผู้ส่ง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const channels = (await (await app.request('/api/chat/channels', { headers: { cookie: owner } }, env)).json()) as { id: string; projectId: string | null }[]
    const channelId = channels.find((c) => c.projectId === p.id)!.id

    const sent = await app.request(`/api/chat/channels/${channelId}/messages`, json(owner, { body: 'สวัสดีทีม' }), env)
    expect(sent.status).toBe(201)

    const list = (await (await app.request(`/api/chat/channels/${channelId}/messages`, { headers: { cookie: owner } }, env)).json()) as { body: string; senderName: string }[]
    expect(list.some((m) => m.body === 'สวัสดีทีม' && m.senderName === 'เมธ')).toBe(true)
  })

  it('คนไม่ใช่สมาชิกโปรเจกต์ ส่ง/อ่านข้อความห้อง project ไม่ได้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test') // ไม่ได้ถูกเพิ่มเป็นสมาชิกโปรเจกต์นี้
    const p = await makeProject(owner)
    const channels = (await (await app.request('/api/chat/channels', { headers: { cookie: owner } }, env)).json()) as { id: string; projectId: string | null }[]
    const channelId = channels.find((c) => c.projectId === p.id)!.id

    expect((await app.request(`/api/chat/channels/${channelId}/messages`, { headers: { cookie: pond } }, env)).status).toBe(403)
    expect((await app.request(`/api/chat/channels/${channelId}/messages`, json(pond, { body: 'แอบส่ง' }), env)).status).toBe(403)
  })

  it('สร้างห้อง DM ซ้ำคู่เดิม → ได้ channel เดิม (idempotent)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const first = (await (await app.request('/api/chat/channels', json(owner, { kind: 'dm', userId: 'u_pond' }), env)).json()) as { id: string }
    const second = (await (await app.request('/api/chat/channels', json(owner, { kind: 'dm', userId: 'u_pond' }), env)).json()) as { id: string }
    expect(second.id).toBe(first.id)
  })

  it('mention คนที่ไม่ใช่สมาชิกห้อง — ไม่ insert แจ้งเตือนให้ (validate ฝั่ง server ไม่เชื่อ client)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const dm = (await (await app.request('/api/chat/channels', json(owner, { kind: 'dm', userId: 'u_pond' }), env)).json()) as { id: string }
    // mention กร (u_korn) ที่ไม่ได้อยู่ในห้อง DM นี้เลย
    await app.request(`/api/chat/channels/${dm.id}/messages`, json(owner, { body: 'แจ้ง @กร', mentionedUserIds: ['u_korn'] }), env)
    const pondCookie = await loginAs(app, 'pond@example-co.test')
    const notifs = (await (await app.request('/api/notifications', { headers: { cookie: pondCookie } }, env)).json()) as { type: string }[]
    expect(notifs.some((n) => n.type === 'chat_mention')).toBe(false)

    // mention ปอนด์ (อยู่ในห้อง DM จริง) — ต้องได้แจ้งเตือน
    await app.request(`/api/chat/channels/${dm.id}/messages`, json(owner, { body: 'แจ้ง @ปอนด์', mentionedUserIds: ['u_pond'] }), env)
    const notifs2 = (await (await app.request('/api/notifications', { headers: { cookie: pondCookie } }, env)).json()) as { type: string }[]
    expect(notifs2.some((n) => n.type === 'chat_mention')).toBe(true)
  })

  it('แปลงข้อความเป็น Task ได้เฉพาะคนมีสิทธิ์ task.create ในโปรเจกต์ปลายทาง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = await makeProject(owner)
    const channels = (await (await app.request('/api/chat/channels', { headers: { cookie: owner } }, env)).json()) as { id: string; projectId: string | null }[]
    const channelId = channels.find((c) => c.projectId === p.id)!.id
    const msg = (await (await app.request(`/api/chat/channels/${channelId}/messages`, json(owner, { body: 'ช่วยแก้ปุ่มสีผิด' }), env)).json()) as { id: string }

    const created = await app.request(`/api/chat/messages/${msg.id}/convert-to-task`, json(owner, { projectId: p.id }), env)
    expect(created.status).toBe(201)
    const task = (await created.json()) as { title: string; description: string }
    expect(task.title).toBe('ช่วยแก้ปุ่มสีผิด')
    expect(task.description).toBe('ช่วยแก้ปุ่มสีผิด')

    // ปอนด์ไม่ได้เป็นสมาชิกโปรเจกต์นี้เลย → ไม่มีสิทธิ์ task.create
    const pond = await loginAs(app, 'pond@example-co.test')
    expect((await app.request(`/api/chat/messages/${msg.id}/convert-to-task`, json(pond, { projectId: p.id }), env)).status).toBe(403)
  })
})

describe('Pronista §Team Chat — unread count badge', () => {
  async function channelUnread(cookie: string, channelId: string) {
    const list = (await (await app.request('/api/chat/channels', { headers: { cookie } }, env)).json()) as { id: string; unreadCount: number }[]
    return list.find((c) => c.id === channelId)!.unreadCount
  }

  it('ห้อง DM — ข้อความของอีกฝ่ายนับ unread ของเรา ข้อความตัวเองไม่นับ · เปิดอ่าน (POST /read) แล้วรีเซ็ตเป็น 0', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const dm = (await (await app.request('/api/chat/channels', json(owner, { kind: 'dm', userId: 'u_pond' }), env)).json()) as { id: string }
    // เคลียร์อ่านให้ทั้งคู่ก่อน กัน D1 state ค้างจากเทสต์ก่อนหน้าในไฟล์เดียวกัน (DM คู่ owner/pond อาจถูกสร้าง+มีข้อความไว้แล้ว)
    await app.request(`/api/chat/channels/${dm.id}/read`, { method: 'POST', headers: { cookie: owner } }, env)
    await app.request(`/api/chat/channels/${dm.id}/read`, { method: 'POST', headers: { cookie: pond } }, env)

    await app.request(`/api/chat/channels/${dm.id}/messages`, json(owner, { body: 'ข้อความ 1' }), env)
    await app.request(`/api/chat/channels/${dm.id}/messages`, json(owner, { body: 'ข้อความ 2' }), env)
    expect(await channelUnread(pond, dm.id)).toBe(2)
    expect(await channelUnread(owner, dm.id)).toBe(0) // ข้อความตัวเองไม่นับเป็น unread ของตัวเอง

    expect((await app.request(`/api/chat/channels/${dm.id}/read`, { method: 'POST', headers: { cookie: pond } }, env)).status).toBe(200)
    expect(await channelUnread(pond, dm.id)).toBe(0)

    // มีข้อความใหม่มาอีก 1 หลังอ่านแล้ว → unread กลับมาเป็น 1 (นับเฉพาะหลัง lastReadAt)
    await app.request(`/api/chat/channels/${dm.id}/messages`, json(owner, { body: 'ข้อความ 3' }), env)
    expect(await channelUnread(pond, dm.id)).toBe(1)
  })

  it('ห้อง project — ไม่มีแถวสมาชิกมาก่อน (ยังไม่เคยเปิดอ่าน) นับข้อความทั้งหมดที่ไม่ใช่ของตัวเองเป็น unread · เปิดอ่านแล้วสร้างแถวสมาชิกให้อัตโนมัติและรีเซ็ตเป็น 0', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const p = await makeProject(owner, 'u_pond')
    const channels = (await (await app.request('/api/chat/channels', { headers: { cookie: owner } }, env)).json()) as { id: string; projectId: string | null }[]
    const channelId = channels.find((c) => c.projectId === p.id)!.id

    await app.request(`/api/chat/channels/${channelId}/messages`, json(owner, { body: 'งานอัปเดต 1' }), env)
    await app.request(`/api/chat/channels/${channelId}/messages`, json(owner, { body: 'งานอัปเดต 2' }), env)
    expect(await channelUnread(pond, channelId)).toBe(2)

    expect((await app.request(`/api/chat/channels/${channelId}/read`, { method: 'POST', headers: { cookie: pond } }, env)).status).toBe(200)
    expect(await channelUnread(pond, channelId)).toBe(0)
  })

  it('POST /read ห้องที่ไม่มีสิทธิ์เข้าถึง → 403 (กันสร้างแถวสมาชิกปลอมของห้องที่ไม่ใช่ของตัวเอง)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test') // ไม่ได้ถูกเพิ่มเป็นสมาชิกโปรเจกต์นี้
    const p = await makeProject(owner)
    const channels = (await (await app.request('/api/chat/channels', { headers: { cookie: owner } }, env)).json()) as { id: string; projectId: string | null }[]
    const channelId = channels.find((c) => c.projectId === p.id)!.id
    expect((await app.request(`/api/chat/channels/${channelId}/read`, { method: 'POST', headers: { cookie: pond } }, env)).status).toBe(403)
  })
})
