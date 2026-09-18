import { env } from 'cloudflare:test'
import { calendarConnections, createDb, inboxGoogleClients } from '@seedoffice/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptSecret } from '../src/lib/crypto'
import { mapGcalEvent, type GcalEvent } from '../src/lib/gcal'
import { syncAllCalendars, syncCalendar } from '../src/lib/gcal-sync'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

describe('E6 — mapGcalEvent (pure)', () => {
  it('all-day วันเดียว: end exclusive → endDate null · allDay=true, ไม่มี startAt/endAt', () => {
    expect(mapGcalEvent({ id: '1', summary: 'หยุด', start: { date: '2026-06-15' }, end: { date: '2026-06-16' } }))
      .toMatchObject({ gcalId: '1', cancelled: false, title: 'หยุด', startDate: '2026-06-15', endDate: null, allDay: true, startAt: null, endAt: null })
  })
  it('all-day หลายวัน: endDate = end.date − 1', () => {
    expect(mapGcalEvent({ id: '2', summary: 'อบรม', start: { date: '2026-06-15' }, end: { date: '2026-06-18' } }))
      .toMatchObject({ startDate: '2026-06-15', endDate: '2026-06-17', allDay: true })
  })
  it('มีเวลา วันเดียวกัน (BKK) → endDate null · allDay=false, มี startAt/endAt เป็น ms จริง', () => {
    expect(mapGcalEvent({ id: '3', summary: 'ประชุม', start: { dateTime: '2026-06-15T14:00:00+07:00' }, end: { dateTime: '2026-06-15T15:00:00+07:00' } }))
      .toMatchObject({
        startDate: '2026-06-15',
        endDate: null,
        allDay: false,
        startAt: new Date('2026-06-15T14:00:00+07:00').getTime(),
        endAt: new Date('2026-06-15T15:00:00+07:00').getTime(),
      })
  })
  it('มีเวลา ข้ามเที่ยงคืนเป็นวันถัดไปในโซน BKK', () => {
    // 2026-06-15T20:00:00Z = 2026-06-16 03:00 BKK
    expect(mapGcalEvent({ id: '4', summary: 'ดึก', start: { dateTime: '2026-06-15T20:00:00Z' }, end: { dateTime: '2026-06-15T21:00:00Z' } }))
      .toMatchObject({ startDate: '2026-06-16', endDate: null })
  })
  it('cancelled → flag true (ไว้ลบของเดิม)', () => {
    expect(mapGcalEvent({ id: '5', status: 'cancelled' })).toMatchObject({ gcalId: '5', cancelled: true })
  })
  it('ไม่มี summary → "(ไม่มีชื่อ)" · ไม่มีวันเริ่ม (ไม่ cancel) → null', () => {
    expect(mapGcalEvent({ id: '6', start: { date: '2026-06-15' } })).toMatchObject({ title: '(ไม่มีชื่อ)' })
    expect(mapGcalEvent({ id: '7' })).toBeNull()
  })
  it('transparency=transparent → busy=false (ว่าง ไม่หัก Workload) · ไม่ระบุ/opaque → busy=true', () => {
    expect(mapGcalEvent({ id: '8', start: { date: '2026-06-15' }, transparency: 'transparent' })).toMatchObject({ busy: false })
    expect(mapGcalEvent({ id: '9', start: { date: '2026-06-15' }, transparency: 'opaque' })).toMatchObject({ busy: true })
    expect(mapGcalEvent({ id: '10', start: { date: '2026-06-15' } })).toMatchObject({ busy: true })
  })
  it('visibility=private/confidential → private=true · default/public/ไม่ระบุ → false', () => {
    expect(mapGcalEvent({ id: '11', start: { date: '2026-06-15' }, visibility: 'private' })).toMatchObject({ private: true })
    expect(mapGcalEvent({ id: '12', start: { date: '2026-06-15' }, visibility: 'confidential' })).toMatchObject({ private: true })
    expect(mapGcalEvent({ id: '13', start: { date: '2026-06-15' }, visibility: 'public' })).toMatchObject({ private: false })
    expect(mapGcalEvent({ id: '14', start: { date: '2026-06-15' } })).toMatchObject({ private: false })
  })
  it('attendee ตัวเอง (self=true) ปฏิเสธแล้ว → declined=true · ตอบรับ/ยังไม่ตอบ → false', () => {
    expect(mapGcalEvent({ id: '15', start: { date: '2026-06-15' }, attendees: [{ self: true, responseStatus: 'declined' }] })).toMatchObject({ declined: true })
    expect(mapGcalEvent({ id: '16', start: { date: '2026-06-15' }, attendees: [{ self: true, responseStatus: 'accepted' }] })).toMatchObject({ declined: false })
    expect(mapGcalEvent({ id: '17', start: { date: '2026-06-15' }, attendees: [{ self: false, responseStatus: 'declined' }] })).toMatchObject({ declined: false }) // คนอื่นปฏิเสธ ไม่ใช่ตัวเอง
    expect(mapGcalEvent({ id: '18', start: { date: '2026-06-15' } })).toMatchObject({ declined: false })
  })
})

interface MockGcal {
  tokenError?: string
  initial?: GcalEvent[]
  incremental?: GcalEvent[]
  expireSyncToken?: boolean // ตอบ 410 ครั้งแรกที่ใช้ syncToken
  calls: string[]
}

function mockGcal(m: MockGcal) {
  let expired410Sent = false
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    m.calls.push(url)
    if (url.startsWith('https://oauth2.googleapis.com/token'))
      return m.tokenError
        ? Response.json({ error: m.tokenError }, { status: 400 })
        : Response.json({ access_token: 'at-gcal' })
    if (url.includes('/calendar/v3/calendars/primary/events')) {
      const usesSync = url.includes('syncToken=')
      if (usesSync && m.expireSyncToken && !expired410Sent) {
        expired410Sent = true
        return new Response('gone', { status: 410 })
      }
      const items = usesSync ? (m.incremental ?? []) : (m.initial ?? [])
      return Response.json({ items, nextSyncToken: 'tok-next' })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

async function seedConnection(opts: { syncToken?: string | null; userId?: string } = {}) {
  const db = createDb(env.DB)
  const [client] = await db
    .insert(inboxGoogleClients)
    .values({
      label: 'SeedWebs',
      clientId: 'gcal-client.apps.googleusercontent.com',
      clientSecretEnc: await encryptSecret('GOCSPX-x', env.INBOX_ENC_KEY),
    })
    .returning()
  const [conn] = await db
    .insert(calendarConnections)
    .values({
      clientId: client!.id,
      userId: opts.userId ?? 'u_owner',
      googleEmail: 'team@example-co.test',
      googleAccountId: 'g-acc-cal',
      refreshTokenEnc: await encryptSecret('rt-cal', env.INBOX_ENC_KEY),
      status: 'connected',
      syncToken: opts.syncToken ?? null,
      connectedAt: new Date(),
    })
    .returning()
  return conn!
}

const gcalEvents = () =>
  env.DB.prepare("SELECT id, title, start_date, end_date, gcal_id FROM calendar_events WHERE source = 'gcal' ORDER BY gcal_id").all()

describe('E6 — syncCalendar (mock Google Calendar API)', () => {
  beforeEach(async () => {
    await seedUsers()
    await env.DB.prepare("DELETE FROM calendar_events WHERE source = 'gcal'").run()
    await env.DB.prepare('DELETE FROM calendar_connections').run()
    await env.DB.prepare('DELETE FROM inbox_google_clients').run()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('initial sync: insert gcal events + เก็บ syncToken', async () => {
    mockGcal({
      calls: [],
      initial: [
        { id: 'e1', summary: 'ประชุมทีม', start: { dateTime: '2026-06-15T10:00:00+07:00' }, end: { dateTime: '2026-06-15T11:00:00+07:00' } },
        { id: 'e2', summary: 'หยุดยาว', start: { date: '2026-07-01' }, end: { date: '2026-07-03' } },
      ],
    })
    const conn = await seedConnection()
    await syncCalendar(env, conn.id)

    const rows = (await gcalEvents()).results as { title: string; start_date: string; end_date: string | null; gcal_id: string }[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ gcal_id: 'e1', title: 'ประชุมทีม', start_date: '2026-06-15', end_date: null })
    expect(rows[1]).toMatchObject({ gcal_id: 'e2', start_date: '2026-07-01', end_date: '2026-07-02' })
    const after = await createDb(env.DB).select().from(calendarConnections).where(eq(calendarConnections.id, conn.id))
    expect(after[0]!.syncToken).toBe('tok-next')
    expect(after[0]!.lastError).toBeNull()
  })

  it('incremental: cancelled → ลบของเดิม · idempotent (รันซ้ำไม่เพิ่ม)', async () => {
    mockGcal({ calls: [], initial: [{ id: 'e1', summary: 'ก', start: { date: '2026-06-20' }, end: { date: '2026-06-21' } }] })
    const conn = await seedConnection()
    await syncCalendar(env, conn.id) // มี e1
    await syncCalendar(env, conn.id) // syncToken=tok-next → incremental ([] default) ไม่เพิ่ม
    expect((await gcalEvents()).results).toHaveLength(1)

    vi.unstubAllGlobals()
    mockGcal({ calls: [], incremental: [{ id: 'e1', status: 'cancelled' }] })
    await syncCalendar(env, conn.id) // e1 cancelled → ลบ
    expect((await gcalEvents()).results).toHaveLength(0)
  })

  it('syncToken หมดอายุ (410) → full resync', async () => {
    const m: MockGcal = { calls: [], expireSyncToken: true, initial: [{ id: 'r1', summary: 'รีซิงก์', start: { date: '2026-06-25' }, end: { date: '2026-06-26' } }] }
    mockGcal(m)
    const conn = await seedConnection({ syncToken: 'old-token' })
    await syncCalendar(env, conn.id)
    // ครั้งแรกใช้ syncToken → 410 → fallback initial (timeMin) ได้ r1
    expect(m.calls.some((u) => u.includes('syncToken=old-token'))).toBe(true)
    expect(m.calls.some((u) => u.includes('timeMin='))).toBe(true)
    expect((await gcalEvents()).results).toHaveLength(1)
  })

  it('token เพิกถอน (invalid_grant) → connection disconnected + lastError (ผ่าน syncAllCalendars)', async () => {
    mockGcal({ calls: [], tokenError: 'invalid_grant' })
    const conn = await seedConnection()
    await syncAllCalendars(env)
    const [after] = await createDb(env.DB).select().from(calendarConnections).where(eq(calendarConnections.id, conn.id))
    expect(after!.status).toBe('disconnected')
    expect(after!.lastError).toContain('เพิกถอน')
  })

  it('connection ที่ยังไม่มี userId (แถวเก่าก่อนฟีเจอร์นี้) → ข้าม sync ไปเงียบๆ ไม่ error', async () => {
    mockGcal({ calls: [], initial: [{ id: 'e1', summary: 'ก', start: { date: '2026-06-20' }, end: { date: '2026-06-21' } }] })
    const db = createDb(env.DB)
    const [client] = await db
      .insert(inboxGoogleClients)
      .values({ label: 'SeedWebs', clientId: 'x.apps.googleusercontent.com', clientSecretEnc: await encryptSecret('s', env.INBOX_ENC_KEY) })
      .returning()
    const [conn] = await db
      .insert(calendarConnections)
      .values({ clientId: client!.id, userId: null, refreshTokenEnc: await encryptSecret('rt', env.INBOX_ENC_KEY), status: 'connected', connectedAt: new Date() })
      .returning()
    await syncCalendar(env, conn!.id)
    expect((await gcalEvents()).results).toHaveLength(0)
  })

  it('sync 2 connection คนละคน ถูกเชิญประชุมเดียวกัน (gcalId ซ้ำ) → ได้ event แยกแถวคนละคน ไม่ทับกัน', async () => {
    mockGcal({ calls: [], initial: [{ id: 'shared-ev', summary: 'ประชุมร่วม', start: { dateTime: '2026-06-15T10:00:00+07:00' }, end: { dateTime: '2026-06-15T11:00:00+07:00' } }] })
    const connA = await seedConnection({ userId: 'u_owner' })
    await syncCalendar(env, connA.id)
    vi.unstubAllGlobals()
    mockGcal({ calls: [], initial: [{ id: 'shared-ev', summary: 'ประชุมร่วม', start: { dateTime: '2026-06-15T10:00:00+07:00' }, end: { dateTime: '2026-06-15T11:00:00+07:00' } }] })
    const connB = await seedConnection({ userId: 'u_pond' })
    await syncCalendar(env, connB.id)

    const rows = (await gcalEvents()).results as { gcal_id: string }[]
    expect(rows).toHaveLength(2) // 2 แถวแยกกัน แม้ gcalId เดียวกัน เพราะคนละ connectionId
  })

  it('event ที่ตัวเอง (self attendee) ปฏิเสธคำเชิญแล้ว → ไม่ sync เข้ามาเลย', async () => {
    mockGcal({
      calls: [],
      initial: [{ id: 'declined-ev', summary: 'ปฏิเสธแล้ว', start: { dateTime: '2026-06-15T10:00:00+07:00' }, end: { dateTime: '2026-06-15T11:00:00+07:00' }, attendees: [{ self: true, responseStatus: 'declined' }] }],
    })
    const conn = await seedConnection()
    await syncCalendar(env, conn.id)
    expect((await gcalEvents()).results).toHaveLength(0)
  })
})

describe('E6 — /api/calendar-connect สิทธิ์ owner+member (เดิม owner เท่านั้น — เปิดให้ member self-service เชื่อมปฏิทินตัวเองได้)', () => {
  beforeEach(async () => {
    await seedUsers()
    await env.DB.prepare("DELETE FROM calendar_events WHERE source = 'gcal'").run()
    await env.DB.prepare('DELETE FROM calendar_connections').run()
    await env.DB.prepare('DELETE FROM inbox_google_clients').run()
  })

  it('vendor → 403 · owner/member → 200 (เห็น connections ของตัวเอง)', async () => {
    const member = await loginAs(app, 'pond@example-co.test')
    const vendor = await loginAs(app, 'somchai@example.com')
    const owner = await loginAs(app, 'owner@example-co.test')
    expect((await app.request('/api/calendar-connect', { headers: { cookie: vendor } }, env)).status).toBe(403)
    const memberRes = await app.request('/api/calendar-connect', { headers: { cookie: member } }, env)
    expect(memberRes.status).toBe(200)
    expect(await memberRes.json()).toHaveProperty('connections')
    const ownerRes = await app.request('/api/calendar-connect', { headers: { cookie: owner } }, env)
    expect(ownerRes.status).toBe(200)
  })

  it('member เห็นแค่ connection ของตัวเอง · owner เห็นของทุกคน', async () => {
    await seedConnection({ userId: 'u_pond' })
    const other = await seedConnection({ userId: 'u_owner' })
    // แก้ googleAccountId ให้ไม่ชนกัน (seedConnection ใช้ค่าคงที่เดียวกัน ไม่กระทบ unique เพราะไม่มี constraint แต่กันสับสน)
    await createDb(env.DB).update(calendarConnections).set({ googleAccountId: 'g-acc-owner' }).where(eq(calendarConnections.id, other.id))

    const member = await loginAs(app, 'pond@example-co.test')
    const memberRes = (await (await app.request('/api/calendar-connect', { headers: { cookie: member } }, env)).json()) as { connections: { userId: string }[] }
    expect(memberRes.connections).toHaveLength(1)
    expect(memberRes.connections[0]!.userId).toBe('u_pond')

    const owner = await loginAs(app, 'owner@example-co.test')
    const ownerRes = (await (await app.request('/api/calendar-connect', { headers: { cookie: owner } }, env)).json()) as { connections: unknown[] }
    expect(ownerRes.connections).toHaveLength(2)
  })

  it('/connect — auto-pick client ตัวแรก ไม่ต้องส่ง clientId · ยังไม่มี client ตั้งค่าไว้เลย → 404', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    // ยังไม่มี inbox_google_clients เลยในเทสต์นี้ (beforeEach ไม่ seed) → 404
    expect((await app.request('/api/calendar-connect/connect', { headers: { cookie: owner }, redirect: 'manual' }, env)).status).toBe(404)

    await createDb(env.DB)
      .insert(inboxGoogleClients)
      .values({ label: 'SeedWebs', clientId: 'x.apps.googleusercontent.com', clientSecretEnc: await encryptSecret('s', env.INBOX_ENC_KEY) })
    const res = await app.request('/api/calendar-connect/connect', { headers: { cookie: owner }, redirect: 'manual' }, env)
    expect(res.status).toBe(302) // redirect ไป Google OAuth ได้เลย ไม่ต้องส่ง clientId
    expect(res.headers.get('location')).toContain('accounts.google.com')
  })

  it('ปลดการเชื่อม (DELETE) — คนอื่น (ไม่ใช่เจ้าของ/owner) ทำไม่ได้ (403) · เจ้าของทำเองได้ (200)', async () => {
    const conn = await seedConnection({ userId: 'u_owner' })
    const member = await loginAs(app, 'pond@example-co.test')
    expect((await app.request(`/api/calendar-connect/${conn.id}`, { method: 'DELETE', headers: { cookie: member } }, env)).status).toBe(403)
    const owner = await loginAs(app, 'owner@example-co.test')
    expect((await app.request(`/api/calendar-connect/${conn.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)).status).toBe(200)
  })
})
