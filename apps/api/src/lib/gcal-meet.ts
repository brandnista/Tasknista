import { calendarConnections, createDb } from '@seedoffice/db'
import { and, desc, eq } from 'drizzle-orm'
import { getCalendarAccessToken } from './gcal-sync'

/**
 * Pronista §Google Meet Integration (2026-08-28) — สร้าง/แก้ไข/ยกเลิกนัดประชุมบน Google Calendar จริง พร้อมลิงก์ Google Meet อัตโนมัติ
 * ใช้ connection เดียวกับที่เชื่อมไว้ที่ "ตั้งค่า → เชื่อมต่อ Google Calendar" (ต้องเป็น connection ที่ scope มี calendar.events ด้วย ไม่ใช่แค่ readonly เดิม)
 * routes/meetings.ts เรียกใช้ 3 ฟังก์ชันนี้แทนการ gen ลิงก์ Jitsi เอง (พี่ตัดสินใจให้ใช้ Google Meet อย่างเดียว ไม่มี fallback)
 */

const GCAL_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

/** ยังไม่มี connection ที่ใช้สร้างประชุมได้เลย (ไม่ได้เชื่อมต่อ หรือเชื่อมต่อแบบ readonly เดิมที่ยังไม่มี scope calendar.events) */
export class GcalNotConnectedError extends Error {
  constructor() {
    super('ยังไม่ได้เชื่อมต่อ Google Calendar สำหรับสร้างนัดประชุม — ให้ Admin ไปเชื่อมต่อ (หรือเชื่อมต่อใหม่ถ้าเชื่อมไว้ก่อนหน้านี้) ที่หน้าตั้งค่า')
  }
}

async function activeMeetConnection(env: Env) {
  const db = createDb(env.DB)
  // เผื่อมีมากกว่า 1 connection (เช่น reconnect แล้วสร้างแถวใหม่แทนอัปเดตของเดิมในบางเคส) — เอาที่ status connected + มี scope เขียน ล่าสุดสุด
  const [conn] = await db
    .select()
    .from(calendarConnections)
    .where(and(eq(calendarConnections.status, 'connected')))
    .orderBy(desc(calendarConnections.connectedAt))
  if (!conn || !conn.scope?.includes('calendar.events')) throw new GcalNotConnectedError()
  return conn
}

interface MeetEventInput {
  title: string
  startAt: Date
  endAt: Date
}

/** สร้าง event ใหม่พร้อม Google Meet — conferenceDataVersion=1 คือตัวสั่งให้ Google gen ลิงก์ให้ */
export async function createMeetEvent(env: Env, input: MeetEventInput): Promise<{ meetUrl: string; gcalEventId: string }> {
  const conn = await activeMeetConnection(env)
  const token = await getCalendarAccessToken(env, conn)
  const res = await fetch(`${GCAL_EVENTS_URL}?conferenceDataVersion=1`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      summary: input.title,
      start: { dateTime: input.startAt.toISOString() },
      end: { dateTime: input.endAt.toISOString() },
      conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    }),
  })
  if (!res.ok) throw new Error(`gcal_create_event_failed (${res.status})`)
  const data = (await res.json()) as { id: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] } }
  const meetUrl = data.hangoutLink ?? data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri
  if (!meetUrl) throw new Error('gcal_no_meet_link')
  return { meetUrl, gcalEventId: data.id }
}

/** แก้เวลา/หัวข้อ event เดิมตอนเลื่อนนัดในระบบ — ใช้ PATCH (partial update) ไม่แตะ conferenceData เดิม */
export async function updateMeetEvent(env: Env, gcalEventId: string, input: MeetEventInput): Promise<void> {
  const conn = await activeMeetConnection(env)
  const token = await getCalendarAccessToken(env, conn)
  const res = await fetch(`${GCAL_EVENTS_URL}/${gcalEventId}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      summary: input.title,
      start: { dateTime: input.startAt.toISOString() },
      end: { dateTime: input.endAt.toISOString() },
    }),
  })
  if (!res.ok && res.status !== 404) throw new Error(`gcal_update_event_failed (${res.status})`) // 404 = event หายจากฝั่ง Google ไปแล้ว (เช่นถูกลบมือ) ไม่ต้อง fail ทั้ง request
}

/** ยกเลิก event เดิมตอนยกเลิกนัดในระบบ — 404/410 = หายไปแล้วอยู่แล้ว ไม่ต้อง fail */
export async function cancelMeetEvent(env: Env, gcalEventId: string): Promise<void> {
  const conn = await activeMeetConnection(env)
  const token = await getCalendarAccessToken(env, conn)
  const res = await fetch(`${GCAL_EVENTS_URL}/${gcalEventId}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
  if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`gcal_cancel_event_failed (${res.status})`)
}
