import { bkkDateOf } from '@seedoffice/core'
import { createDb, notifications } from '@seedoffice/db'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { cleanupOldNotifications, notifyMeetingReminders, notifyOverdueTasks } from '../src/scheduled'
import { loginAs, seedUsers } from './helpers'

// Pronista §Notification overhaul (2026-08-27) — เตือนงานเลยกำหนดครั้งเดียวตอนเลยกำหนดวันแรก (ไม่ย้อนหลัง)
// ทดสอบผ่าน notifyOverdueTasks() ตรงๆ (ไม่ผ่าน runScheduled ทั้งก้อน กันโดนผลข้างเคียงของงานอื่นในนั้น เช่น runBackup/syncAllCalendars)

beforeEach(async () => {
  await seedUsers()
})

const json = (cookie: string, body: unknown) => ({ method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const patch = (cookie: string, body: unknown) => ({ ...json(cookie, body), method: 'PATCH' })

async function makeOverdueTask(owner: string, assigneeId: string, dueDate: string, title = 'งานทดสอบเลยกำหนด') {
  const p = (await (await app.request('/api/projects', json(owner, { name: `P-${title}`, type: 'project' }), env)).json()) as { id: string }
  const g = (await (await app.request(`/api/projects/${p.id}/groups`, json(owner, { name: 'G' }), env)).json()) as { id: string }
  const t = (await (await app.request(`/api/groups/${g.id}/tasks`, json(owner, { title, assigneeId }), env)).json()) as { id: string }
  await app.request(`/api/tasks/${t.id}`, patch(owner, { dueDate }), env)
  return t
}

const notifCount = async (cookie: string) =>
  ((await (await app.request('/api/notifications', { headers: { cookie } }, env)).json()) as { type: string }[]).filter((n) => n.type === 'task_overdue_reminder').length

describe('Pronista §Notification overhaul (2026-08-27) — เตือนงานเลยกำหนดครั้งเดียว ไม่ย้อนหลัง', () => {
  it('งานเลยกำหนด (ยังไม่เคยแจ้ง) → รันครั้งแรกแจ้งเตือนผู้รับงาน 1 ครั้ง แล้วไม่แจ้งซ้ำรอบถัดไป', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    await makeOverdueTask(owner, 'u_pond', yesterday)

    const db = createDb(env.DB)
    const today = bkkDateOf(Date.now())
    const before = await notifCount(pond)
    await notifyOverdueTasks(db, today)
    expect(await notifCount(pond)).toBe(before + 1)

    // รันซ้ำ (เช่นรันวันถัดไป) — dueNotifiedAt กันไว้แล้ว ไม่แจ้งซ้ำ
    await notifyOverdueTasks(db, today)
    expect(await notifCount(pond)).toBe(before + 1)
  })

  it('ไม่ย้อนหลัง — งานที่ dueNotifiedAt ถูกตั้งไว้แล้ว (จำลอง migration backfill) ไม่ถูกแจ้งซ้ำ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const longAgo = new Date(Date.now() - 79 * 86_400_000).toISOString().slice(0, 10)
    const t = await makeOverdueTask(owner, 'u_pond', longAgo, 'งานเก่าเลยกำหนดมาก')
    // จำลอง migration 0097 backfill — ทำเครื่องหมาย "แจ้งแล้ว" ก่อน cron ตัวจริงจะรันครั้งแรก
    await env.DB.prepare('UPDATE tasks SET due_notified_at = ? WHERE id = ?').bind(Date.now(), t.id).run()

    const db = createDb(env.DB)
    const before = await notifCount(pond)
    await notifyOverdueTasks(db, bkkDateOf(Date.now()))
    expect(await notifCount(pond)).toBe(before) // ไม่เพิ่ม — ไม่ถูกแจ้งย้อนหลัง
  })

  it('แก้ dueDate ใหม่ → เคลียร์เกต ให้เตือนได้อีกครั้งถ้าเลยกำหนดรอบใหม่', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const t = await makeOverdueTask(owner, 'u_pond', yesterday, 'งานแก้กำหนดใหม่')
    const db = createDb(env.DB)
    const today = bkkDateOf(Date.now())
    const before = await notifCount(pond)
    await notifyOverdueTasks(db, today)
    expect(await notifCount(pond)).toBe(before + 1)

    // เลื่อนไปอนาคตแล้วย้อนกลับมาเลยกำหนดอีกที — เกตต้องถูกเคลียร์ตอนแก้ dueDate (routes/tasks.ts PATCH)
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    await app.request(`/api/tasks/${t.id}`, patch(owner, { dueDate: future }), env)
    await app.request(`/api/tasks/${t.id}`, patch(owner, { dueDate: yesterday }), env)
    await notifyOverdueTasks(db, today)
    expect(await notifCount(pond)).toBe(before + 2)
  })

  it('งาน done แล้ว ไม่แจ้งเตือนแม้เลยกำหนด', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const t = await makeOverdueTask(owner, 'u_pond', yesterday, 'งานเสร็จแล้วเลยกำหนด')
    await app.request(`/api/tasks/${t.id}`, patch(owner, { status: 'done' }), env)

    const db = createDb(env.DB)
    const before = await notifCount(pond)
    await notifyOverdueTasks(db, bkkDateOf(Date.now()))
    expect(await notifCount(pond)).toBe(before)
  })
})

// Pronista §Google Meet Integration (2026-08-28) — ไม่แปะ externalMeetingUrl = ยิงไป Google Calendar จริง (ดู meetings.test.ts) เทสต์ตรงนี้สนใจแค่ตรรกะเตือนล่วงหน้า เลยแปะ URL ปลอมกันชนกัน
async function makeMeeting(owner: string, startAt: number, endAt: number, participantIds: string[] = []) {
  return (await (
    await app.request('/api/meetings', json(owner, { title: 'ประชุมทดสอบเตือนล่วงหน้า', startAt, endAt, externalMeetingUrl: 'https://meet.jit.si/test-fixed-url', participantIds }), env)
  ).json()) as { id: string }
}

const meetingReminderCount = async (cookie: string) =>
  ((await (await app.request('/api/notifications', { headers: { cookie } }, env)).json()) as { type: string }[]).filter((n) => n.type === 'meeting_reminder').length

describe('Pronista §Meeting Schedule Tab (2026-08-27) — เตือนล่วงหน้าก่อนประชุมเริ่ม (นาทีตั้งได้ต่อคน, ไม่ย้อนหลัง)', () => {
  // ประชุม/ผู้เข้าร่วมที่ยังไม่ถูกเตือนจากเทสต์ก่อนหน้าจะถูก notifyMeetingReminders() ไล่ตรวจซ้ำทุกครั้ง (query กวาดทุกแถวที่ remindedAt ยังว่าง)
  // ล้างให้หมดก่อนแต่ละเทสต์ กันแถวเก่าข้าม it() มาปนกับ assertion แบบ delta ของเทสต์ปัจจุบัน
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM notifications WHERE meeting_id IS NOT NULL').run()
    await env.DB.prepare('DELETE FROM meeting_action_items').run()
    await env.DB.prepare('DELETE FROM meeting_participants').run()
    await env.DB.prepare('DELETE FROM meetings').run()
    await env.DB.prepare('UPDATE users SET meeting_reminder_minutes = NULL').run()
  })

  it('ค่าเริ่มต้น 5 นาที: อยู่ในช่วงเตือน → เตือน 1 ครั้ง แล้วรันซ้ำไม่เตือนซ้ำ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const now = Date.now()
    await makeMeeting(owner, now + 3 * 60_000, now + 63 * 60_000, ['u_pond'])

    const db = createDb(env.DB)
    const before = await meetingReminderCount(pond)
    await notifyMeetingReminders(db, now)
    expect(await meetingReminderCount(pond)).toBe(before + 1)

    await notifyMeetingReminders(db, now + 10_000) // รันซ้ำไม่กี่วิถัดมา — remindedAt กันไว้แล้ว
    expect(await meetingReminderCount(pond)).toBe(before + 1)
  })

  it('ยังไม่ถึงช่วงเตือนของค่าเริ่มต้น (ห่างเกิน 5 นาที) → ยังไม่เตือน', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const now = Date.now()
    await makeMeeting(owner, now + 10 * 60_000, now + 70 * 60_000, ['u_pond'])

    const db = createDb(env.DB)
    const before = await meetingReminderCount(pond)
    await notifyMeetingReminders(db, now)
    expect(await meetingReminderCount(pond)).toBe(before)
  })

  it('ตั้งนาทีล่วงหน้าเองเป็น 15 → ประชุมที่เหลือ 10 นาที เตือนได้ (คนละค่ากับ default 5 ของคนอื่น)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    await app.request('/api/notification-prefs', { ...json(pond, { meetingReminderMinutes: 15 }), method: 'PATCH' }, env)
    const now = Date.now()
    await makeMeeting(owner, now + 10 * 60_000, now + 70 * 60_000, ['u_pond'])

    const db = createDb(env.DB)
    const before = await meetingReminderCount(pond)
    await notifyMeetingReminders(db, now)
    expect(await meetingReminderCount(pond)).toBe(before + 1)
  })

  it('ไม่ย้อนหลัง — ประชุมเริ่มไปแล้วแต่ยังไม่เคยเตือน (เช่น สร้างกระชั้นชิดเกินไป) → ไม่ส่งแจ้งเตือน แต่ mark เตือนแล้วกันค้าง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const now = Date.now()
    await makeMeeting(owner, now - 60_000, now + 59 * 60_000, ['u_pond']) // เริ่มไปแล้ว 1 นาที

    const db = createDb(env.DB)
    const before = await meetingReminderCount(pond)
    await notifyMeetingReminders(db, now)
    expect(await meetingReminderCount(pond)).toBe(before) // ไม่ส่ง — ประชุมเริ่มไปแล้ว เตือน "ล่วงหน้า" ไม่มีความหมาย
  })
})

describe('Pronista §Notification overhaul Batch C (2026-08-27) — ลบแจ้งเตือนเก่าที่อ่านแล้วเกิน 30 วันทิ้ง', () => {
  it('ลบเฉพาะที่อ่านแล้ว+เก่าเกิน 30 วัน · ไม่แตะที่ยังไม่อ่าน หรือยังไม่เก่า', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const db = createDb(env.DB)
    const THIRTY_ONE_DAYS = 31 * 86_400_000
    const oldRead = (
      await db.insert(notifications).values({ userId: 'u_owner', type: 'expiry_reminder', message: 'เก่าอ่านแล้ว', isRead: true, createdAt: new Date(Date.now() - THIRTY_ONE_DAYS) }).returning()
    )[0]!
    const oldUnread = (
      await db.insert(notifications).values({ userId: 'u_owner', type: 'expiry_reminder', message: 'เก่ายังไม่อ่าน', isRead: false, createdAt: new Date(Date.now() - THIRTY_ONE_DAYS) }).returning()
    )[0]!
    const recentRead = (
      await db.insert(notifications).values({ userId: 'u_owner', type: 'expiry_reminder', message: 'ใหม่อ่านแล้ว', isRead: true, createdAt: new Date() }).returning()
    )[0]!

    await cleanupOldNotifications(db)

    const remaining = (await (await app.request('/api/notifications', { headers: { cookie: owner } }, env)).json()) as { id: string }[]
    const ids = remaining.map((r) => r.id)
    expect(ids).not.toContain(oldRead.id)
    expect(ids).toContain(oldUnread.id)
    expect(ids).toContain(recentRead.id)
  })
})
