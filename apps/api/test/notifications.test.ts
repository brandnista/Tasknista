import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

// Pronista §Notification overhaul (2026-08-27) — จุดรวมศูนย์ notifyUser(): เช็ค notificationPrefs ก่อน insert + ยุบ chat_message เป็นห้องละ 1 แถวที่ยังไม่อ่าน

beforeEach(async () => {
  await seedUsers()
})

const json = (cookie: string, body: unknown) => ({ method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const patch = (cookie: string, body: unknown) => ({ ...json(cookie, body), method: 'PATCH' })

describe('Pronista §Notification overhaul (2026-08-27) — หน้าตั้งค่าแจ้งเตือน (GET/PATCH prefs)', () => {
  it('ค่าเริ่มต้นเปิดรับทุกประเภท (disabledTypes ว่าง) · ปิดได้แล้วอ่านค่ากลับมาถูกต้อง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const got = (await (await app.request('/api/notification-prefs', { headers: { cookie: owner } }, env)).json()) as { disabledTypes: string[] }
    expect(got.disabledTypes).toEqual([])

    const res = await app.request('/api/notification-prefs', patch(owner, { disabledTypes: ['chat_message'] }), env)
    expect(res.status).toBe(200)
    const after = (await (await app.request('/api/notification-prefs', { headers: { cookie: owner } }, env)).json()) as { disabledTypes: string[] }
    expect(after.disabledTypes).toEqual(['chat_message'])
  })

  it('ประเภทไม่รู้จัก → 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request('/api/notification-prefs', patch(owner, { disabledTypes: ['ไม่มีจริง'] }), env)
    expect(res.status).toBe(400)
  })

  it('ไม่ login เรียกไม่ได้ (401)', async () => {
    expect((await app.request('/api/notification-prefs', {}, env)).status).toBe(401)
  })

  it('Pronista §Meeting Schedule Tab — meetingReminderMinutes ค่าเริ่มต้น 5 นาที ตั้งใหม่ได้ (1-120) นอกช่วง = 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const got = (await (await app.request('/api/notification-prefs', { headers: { cookie: owner } }, env)).json()) as { meetingReminderMinutes: number }
    expect(got.meetingReminderMinutes).toBe(5)

    const ok = await app.request('/api/notification-prefs', patch(owner, { meetingReminderMinutes: 15 }), env)
    expect(ok.status).toBe(200)
    const after = (await (await app.request('/api/notification-prefs', { headers: { cookie: owner } }, env)).json()) as { meetingReminderMinutes: number }
    expect(after.meetingReminderMinutes).toBe(15)

    expect((await app.request('/api/notification-prefs', patch(owner, { meetingReminderMinutes: 0 }), env)).status).toBe(400)
    expect((await app.request('/api/notification-prefs', patch(owner, { meetingReminderMinutes: 121 }), env)).status).toBe(400)
  })
})

describe('Pronista §Notification overhaul (2026-08-27) — notifyUser() เช็ค prefs ก่อน insert', () => {
  it('ปิดประเภท meeting_scheduled ไว้ → นัดประชุมแล้วไม่มีแจ้งเตือนประเภทนี้เกิดขึ้นเลย', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    await app.request('/api/notification-prefs', patch(pond, { disabledTypes: ['meeting_scheduled'] }), env)

    const startAt = Date.now() + 3_600_000
    await app.request(
      '/api/meetings',
      json(owner, { title: 'ประชุมทดสอบปิดแจ้งเตือน', startAt, endAt: startAt + 3_600_000, externalMeetingUrl: 'https://meet.jit.si/test-fixed-url', participantIds: ['u_pond'] }),
      env,
    )

    const notifs = (await (await app.request('/api/notifications', { headers: { cookie: pond } }, env)).json()) as { type: string }[]
    expect(notifs.some((n) => n.type === 'meeting_scheduled')).toBe(false)
  })
})

describe('Pronista §Notification overhaul (2026-08-27) — chat_message ยุบเป็นห้องละ 1 แถวที่ยังไม่อ่าน', () => {
  it('ส่งข้อความหลายข้อความติดกันในห้องเดียว → ได้แจ้งเตือนแค่ 1 แถว ข้อความอัปเดตเป็นล่าสุด', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const dm = (await (await app.request('/api/chat/channels', json(owner, { kind: 'dm', userId: 'u_pond' }), env)).json()) as { id: string }

    await app.request(`/api/chat/channels/${dm.id}/messages`, json(owner, { body: 'ข้อความที่ 1' }), env)
    await app.request(`/api/chat/channels/${dm.id}/messages`, json(owner, { body: 'ข้อความที่ 2' }), env)
    await app.request(`/api/chat/channels/${dm.id}/messages`, json(owner, { body: 'ข้อความที่ 3' }), env)

    const notifs = (await (await app.request('/api/notifications', { headers: { cookie: pond } }, env)).json()) as { type: string; message: string }[]
    const chatMsgNotifs = notifs.filter((n) => n.type === 'chat_message')
    expect(chatMsgNotifs.length).toBe(1) // ยุบเหลือแถวเดียว ไม่ใช่ 3 แถว
    expect(chatMsgNotifs[0]?.message).toContain('ข้อความที่ 3') // อัปเดตเป็นข้อความล่าสุด
  })

  it('อ่านแล้ว → ข้อความใหม่ถัดไปเปิดแถวใหม่ (ไม่ทับแถวที่อ่านไปแล้ว)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const dm = (await (await app.request('/api/chat/channels', json(owner, { kind: 'dm', userId: 'u_pond' }), env)).json()) as { id: string }

    await app.request(`/api/chat/channels/${dm.id}/messages`, json(owner, { body: 'รอบแรก' }), env)
    const notifs1 = (await (await app.request('/api/notifications', { headers: { cookie: pond } }, env)).json()) as { id: string; type: string }[]
    const first = notifs1.find((n) => n.type === 'chat_message')!
    await app.request(`/api/notifications/${first.id}/read`, { method: 'POST', headers: { cookie: pond } }, env)

    await app.request(`/api/chat/channels/${dm.id}/messages`, json(owner, { body: 'รอบสอง' }), env)
    const notifs2 = (await (await app.request('/api/notifications', { headers: { cookie: pond } }, env)).json()) as { id: string; type: string; isRead: boolean }[]
    const chatMsgNotifs2 = notifs2.filter((n) => n.type === 'chat_message')
    expect(chatMsgNotifs2.length).toBe(2) // แถวเก่า (อ่านแล้ว) + แถวใหม่ (ยังไม่อ่าน)
    expect(chatMsgNotifs2.some((n) => !n.isRead)).toBe(true)
  })

  it('ปิด "มีข้อความใหม่ในแชท" ไว้ → ส่งข้อความแล้วไม่มีแจ้งเตือนเกิดขึ้นเลย', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    // ใช้กร (คนละคู่จาก test อื่นในไฟล์นี้) กันชนห้อง DM เดิม — สร้าง DM ซ้ำคู่เดิมได้ channel เดิม (idempotent) จะทำให้เจอแถวเก่าที่ยังไม่อ่านจาก test ก่อนหน้า
    // กร auto-provision ตอน login (ไม่ใช่ user seed คงที่ 4 ตัว) → id จริงเป็น uuid ต้องอ่านจาก /api/me ไม่ใช่เดา 'u_korn'
    const korn = await loginAs(app, 'korn@example-co.test')
    const kornMe = (await (await app.request('/api/me', { headers: { cookie: korn } }, env)).json()) as { id: string }
    await app.request('/api/notification-prefs', patch(korn, { disabledTypes: ['chat_message'] }), env)
    const dm = (await (await app.request('/api/chat/channels', json(owner, { kind: 'dm', userId: kornMe.id }), env)).json()) as { id: string }
    await app.request(`/api/chat/channels/${dm.id}/messages`, json(owner, { body: 'ปิดแจ้งเตือนไว้แล้วนะ' }), env)
    const notifs = (await (await app.request('/api/notifications', { headers: { cookie: korn } }, env)).json()) as { type: string; chatChannelId: string | null }[]
    expect(notifs.some((n) => n.type === 'chat_message' && n.chatChannelId === dm.id)).toBe(false)
  })
})

describe('Pronista §Notification overhaul (2026-08-27) — เปิดห้องแชท (POST /chat/channels/:id/read) mark แจ้งเตือนของห้องนั้นอ่านแล้ว', () => {
  it('เปิดห้อง project channel แล้ว chat_mention/chat_message ของห้องนั้นเปลี่ยนเป็นอ่านแล้วทั้งหมด (เดิมห้อง project ไม่มี lastReadAt แต่ต้อง mark แจ้งเตือนได้เหมือนกัน)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const p = (await (await app.request('/api/projects', json(owner, { name: 'P-mark-read', type: 'project', members: ['u_pond'] }), env)).json()) as { id: string }
    const channels = (await (await app.request('/api/chat/channels', { headers: { cookie: pond } }, env)).json()) as { id: string; projectId: string | null }[]
    const channelId = channels.find((c) => c.projectId === p.id)!.id
    await app.request(`/api/chat/channels/${channelId}/messages`, json(owner, { body: 'แจ้ง @ปอนด์', mentionedUserIds: ['u_pond'] }), env)

    const before = (await (await app.request('/api/notifications', { headers: { cookie: pond } }, env)).json()) as { type: string; chatChannelId: string | null; isRead: boolean }[]
    expect(before.some((n) => n.chatChannelId === channelId && !n.isRead)).toBe(true)

    const res = await app.request(`/api/chat/channels/${channelId}/read`, json(pond, {}), env)
    expect(res.status).toBe(200)

    const after = (await (await app.request('/api/notifications', { headers: { cookie: pond } }, env)).json()) as { chatChannelId: string | null; isRead: boolean }[]
    expect(after.some((n) => n.chatChannelId === channelId && !n.isRead)).toBe(false)
  })
})
