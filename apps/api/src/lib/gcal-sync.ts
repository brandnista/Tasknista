import {
  calendarConnections,
  calendarEvents,
  createDb,
  inboxGoogleClients,
  type CalendarConnection,
} from '@seedoffice/db'
import { and, eq, isNull } from 'drizzle-orm'
import { decryptSecret } from './crypto'
import { mapGcalEvent, type GcalEvent } from './gcal'
import { ReconnectError } from './inbox-sync'

/**
 * Sync ขาเข้า Google Calendar (SPEC §4.14 · E6) — อ่านอย่างเดียว (calendar.readonly)
 * - initial: ดึง events ตั้งแต่ 30 วันก่อนหน้า (singleEvents = ขยาย recurring) + เก็บ syncToken
 * - incremental: ใช้ syncToken ดึงเฉพาะที่เปลี่ยน (รวม cancelled → ลบของเดิม)
 * - syncToken หมดอายุ (410) → ล้างแล้ว full resync
 * - refresh token เพิกถอน → connection disconnected + lastError
 * - idempotent: upsert ด้วย gcalId (cron ทับซ้อนได้)
 */

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GCAL_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const MAX_PAGES = 20

/** ขอ access token ของ connection (refresh flow) — ใช้ client ตัวเดียวกับอีเมลกลาง
 * Pronista §Google Meet Integration (2026-08-28) — export ให้ gcal-meet.ts (สร้างประชุม+ลิงก์ Meet) เรียกใช้ร่วมกัน ไม่ต้อง implement ซ้ำ */
export async function getCalendarAccessToken(env: Env, conn: CalendarConnection): Promise<string> {
  const db = createDb(env.DB)
  const [client] = await db
    .select()
    .from(inboxGoogleClients)
    .where(and(eq(inboxGoogleClients.id, conn.clientId), isNull(inboxGoogleClients.deletedAt)))
  if (!client) throw new Error('client_not_found')
  if (!conn.refreshTokenEnc) throw new ReconnectError()
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: await decryptSecret(client.clientSecretEnc, env.INBOX_ENC_KEY),
      refresh_token: await decryptSecret(conn.refreshTokenEnc, env.INBOX_ENC_KEY),
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    if (body.error === 'invalid_grant') throw new ReconnectError()
    throw new Error(`token_refresh_failed (${res.status})`)
  }
  const { access_token } = (await res.json()) as { access_token?: string }
  if (!access_token) throw new Error('token_refresh_failed (no access_token)')
  return access_token
}

interface EventsPage {
  items?: GcalEvent[]
  nextPageToken?: string
  nextSyncToken?: string
}

/** ดึงทุกหน้า — คืน items รวม + syncToken ล่าสุด · status 410 = syncToken หมดอายุ */
async function fetchEvents(
  token: string,
  syncToken: string | null,
): Promise<{ items: GcalEvent[]; syncToken: string | null; expired: boolean }> {
  const items: GcalEvent[] = []
  let pageToken: string | undefined
  let nextSyncToken: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ maxResults: '250' })
    if (syncToken) params.set('syncToken', syncToken)
    else {
      params.set('singleEvents', 'true')
      params.set('timeMin', new Date(Date.now() - 30 * 86_400_000).toISOString())
    }
    if (pageToken) params.set('pageToken', pageToken)
    const res = await fetch(`${GCAL_EVENTS_URL}?${params}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (res.status === 410) return { items: [], syncToken: null, expired: true }
    if (!res.ok) throw new Error(`gcal_events_failed (${res.status})`)
    const data = (await res.json()) as EventsPage
    if (data.items) items.push(...data.items)
    nextSyncToken = data.nextSyncToken ?? nextSyncToken
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
  }
  return { items, syncToken: nextSyncToken, expired: false }
}

/** เขียน events ที่ map แล้วลง calendar_events (upsert/ลบ ด้วย gcalId+connectionId คู่กัน — ไม่ใช่ gcalId เดี่ยวๆ)
 * Pronista §Calendar/Workload (2026-09-18) — dedup key เดิม (gcalId อย่างเดียว) ทำให้ประชุมเดียวกันที่ถูกเชิญ 2 คน sync ผ่านคนละ connection
 * จะเขียนทับ/ข้ามกันเอง เหลือ event แค่แถวเดียว → Workload หักเวลาได้แค่คนเดียว ทั้งที่ทั้งคู่ควรถูกหัก
 * เปลี่ยนเป็น (gcalId, connectionId) คู่กัน ให้แต่ละคนที่เชื่อมปฏิทินตัวเองได้ event แยกแถวของตัวเอง */
async function applyEvents(env: Env, items: GcalEvent[], conn: { id: string; userId: string }): Promise<void> {
  const db = createDb(env.DB)
  for (const raw of items) {
    const m = mapGcalEvent(raw)
    if (!m) continue
    const [existing] = await db
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .where(and(eq(calendarEvents.gcalId, m.gcalId), eq(calendarEvents.connectionId, conn.id)))
      .limit(1)
    // ยกเลิกแล้ว หรือเจ้าของ connection (self) ปฏิเสธคำเชิญแล้ว — ไม่ต้องมี event ค้างอยู่ (Pronista §3.2: "ไม่คำนวณเหตุการณ์ที่ผู้ใช้ปฏิเสธแล้ว")
    if (m.cancelled || m.declined) {
      if (existing) await db.delete(calendarEvents).where(eq(calendarEvents.id, existing.id))
      continue
    }
    const fields = {
      title: m.title,
      startDate: m.startDate,
      endDate: m.endDate,
      startAt: m.startAt ? new Date(m.startAt) : null,
      endAt: m.endAt ? new Date(m.endAt) : null,
      allDay: m.allDay,
      busy: m.busy,
      private: m.private,
    }
    if (existing) {
      await db.update(calendarEvents).set(fields).where(eq(calendarEvents.id, existing.id))
    } else {
      await db.insert(calendarEvents).values({
        ...fields,
        type: 'meeting',
        source: 'gcal',
        gcalId: m.gcalId,
        connectionId: conn.id,
        userId: conn.userId,
        createdBy: conn.userId,
      })
    }
  }
}

/** sync 1 connection — โยน ReconnectError ถ้า token เพิกถอน (route/cron จัดการ disconnected)
 * Pronista §Calendar/Workload (2026-09-18) — เลิก hardcode "user แรกที่ role=owner" เป็นเจ้าของ event ทุกอันแบบเดิม
 * ใช้ conn.userId (เจ้าของการเชื่อมต่อจริง) แทน — connection เก่าก่อนฟีเจอร์นี้ที่ยังไม่มี userId จะข้าม sync ไปก่อน (ต้องเชื่อมใหม่ผ่าน flow ใหม่) */
export async function syncCalendar(env: Env, connectionId: string): Promise<void> {
  const db = createDb(env.DB)
  const [conn] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, connectionId))
  if (!conn || conn.status !== 'connected' || !conn.userId) return

  const token = await getCalendarAccessToken(env, conn)
  let result = await fetchEvents(token, conn.syncToken)
  if (result.expired) {
    // syncToken หมดอายุ → full resync แล้วตั้ง token ใหม่
    result = await fetchEvents(token, null)
  }
  await applyEvents(env, result.items, { id: conn.id, userId: conn.userId })
  await db
    .update(calendarConnections)
    .set({ syncToken: result.syncToken, lastSyncAt: new Date(), lastError: null })
    .where(eq(calendarConnections.id, conn.id))
}

/** sync ทุก connection ที่เชื่อม (เรียกจาก cron) — กลืน error รายตัวเป็น lastError */
export async function syncAllCalendars(env: Env): Promise<void> {
  const db = createDb(env.DB)
  const conns = await db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(eq(calendarConnections.status, 'connected'))
  for (const c of conns) {
    try {
      await syncCalendar(env, c.id)
    } catch (e) {
      const disconnected = e instanceof ReconnectError
      await db
        .update(calendarConnections)
        .set({
          lastError: disconnected ? 'token ถูกเพิกถอน — กดเชื่อมใหม่' : String(e),
          ...(disconnected ? { status: 'disconnected' as const } : {}),
        })
        .where(eq(calendarConnections.id, c.id))
    }
  }
}
