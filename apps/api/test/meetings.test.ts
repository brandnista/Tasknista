import { calendarConnections, createDb, inboxGoogleClients } from '@seedoffice/db'
import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptSecret } from '../src/lib/crypto'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

// Pronista §Team Meeting (2026-08-26) — นัดประชุม + Notes/Agenda ร่วมกันได้ทุกคนที่เกี่ยวข้อง (ผู้จัด/ผู้เข้าร่วม/สมาชิกโปรเจกต์ที่ผูกไว้)
// แก้ข้อมูลนัดหมาย (หัวข้อ/เวลา/ลิงก์) จำกัดแค่ผู้จัด/owner · แปลง Action Item เป็น Task ต้องเช็คสิทธิ์ task.create ของโปรเจกต์ปลายทางเสมอ

beforeEach(async () => {
  await seedUsers()
})

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const patch = (cookie: string, body: unknown) => ({ ...json(cookie, body), method: 'PATCH' })

const HOUR = 3_600_000
// Pronista §Google Meet Integration (2026-08-28) — ตอนนี้ไม่แปะ externalMeetingUrl = ยิงไป Google Calendar จริง (ดู gcal-meet.test.ts / describe ท้ายไฟล์นี้)
// เทสต์ CRUD/permission/action-item ทั่วไปในไฟล์นี้ไม่ได้สนใจกลไกสร้างลิงก์ประชุม เลยแปะ URL ปลอมไว้ตรงๆ กันชนกับ Google Calendar
function nextMeetingPayload(overrides: Record<string, unknown> = {}) {
  const startAt = Date.now() + HOUR
  return { title: 'Weekly Sync', startAt, endAt: startAt + HOUR, externalMeetingUrl: 'https://meet.jit.si/test-fixed-url', ...overrides }
}

async function makeProject(ownerCookie: string, editorUserId?: string) {
  const p = (await (await app.request('/api/projects', json(ownerCookie, { name: 'โปรเจกต์ประชุม', type: 'project' }), env)).json()) as { id: string }
  if (editorUserId) await app.request(`/api/projects/${p.id}/members`, json(ownerCookie, { userId: editorUserId, positionId: 'pos_full_access' }), env)
  return p
}

describe('Pronista §Team Meeting — schedule, notes, action items', () => {
  it('นัดประชุมพร้อมผู้เข้าร่วม → ผู้เข้าร่วมเห็นในลิสต์และได้แจ้งเตือน meeting_scheduled', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = await app.request('/api/meetings', json(owner, nextMeetingPayload({ participantIds: ['u_pond'] })), env)
    expect(created.status).toBe(201)

    const pondList = (await (await app.request('/api/meetings', { headers: { cookie: pond } }, env)).json()) as { title: string }[]
    expect(pondList.some((m) => m.title === 'Weekly Sync')).toBe(true)

    const notifs = (await (await app.request('/api/notifications', { headers: { cookie: pond } }, env)).json()) as { type: string }[]
    expect(notifs.some((n) => n.type === 'meeting_scheduled')).toBe(true)
  })

  it('Pronista §Meeting Attendee Filter (2026-09-02) — เชิญ "สมาชิก" (members table ไม่มี login) เข้าประชุมได้ แยกจากผู้เข้าร่วมปกติ · ลบประชุมแล้วลบ external invitee ทิ้งด้วย', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const member = (await (
      await app.request('/api/members', json(owner, { name: 'บริษัท ทดสอบ จำกัด', classificationType: 'ordinary_juristic', businessName: 'Taladi', email: 'contact@taladi.test' }), env)
    ).json()) as { id: string }

    const created = (await (
      await app.request('/api/meetings', json(owner, nextMeetingPayload({ externalInviteeMemberIds: [member.id] })), env)
    ).json()) as { id: string }

    const detail = (await (await app.request(`/api/meetings/${created.id}`, { headers: { cookie: owner } }, env)).json()) as {
      externalInvitees: { memberId: string; name: string; email: string | null }[]
    }
    expect(detail.externalInvitees).toHaveLength(1)
    expect(detail.externalInvitees[0]).toMatchObject({ memberId: member.id, name: 'บริษัท ทดสอบ จำกัด', email: 'contact@taladi.test' })

    expect((await app.request(`/api/meetings/${created.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)).status).toBe(200)
  })

  it('Pronista §Meeting Attendee Filter (2026-09-02) — เชิญด้วยอีเมลเอง (คนนอกระบบ ไม่มีแม้แต่ใน members) ได้ด้วย memberId เป็น null', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const created = (await (
      await app.request('/api/meetings', json(owner, nextMeetingPayload({ externalInviteeEmails: [{ name: 'ลูกค้าภายนอก', email: 'external@client.test' }] })), env)
    ).json()) as { id: string }

    const detail = (await (await app.request(`/api/meetings/${created.id}`, { headers: { cookie: owner } }, env)).json()) as {
      externalInvitees: { memberId: string | null; name: string; email: string | null }[]
    }
    expect(detail.externalInvitees).toHaveLength(1)
    expect(detail.externalInvitees[0]).toMatchObject({ memberId: null, name: 'ลูกค้าภายนอก', email: 'external@client.test' })
  })

  it('Pronista §Meeting Schedule Tab — แจ้งเตือน meeting_scheduled มีครบ 4 ฟิลด์ในข้อความ (ชื่อ/เวลา/Agenda/ผู้เข้าร่วม)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    await app.request('/api/meetings', json(owner, nextMeetingPayload({ agenda: 'คุยเรื่อง Sprint 3', participantIds: ['u_pond'] })), env)

    const notifs = (await (await app.request('/api/notifications', { headers: { cookie: pond } }, env)).json()) as { type: string; message: string }[]
    const n = notifs.find((r) => r.type === 'meeting_scheduled')
    expect(n?.message).toContain('Weekly Sync')
    expect(n?.message).toContain('เวลา:')
    expect(n?.message).toContain('Agenda: คุยเรื่อง Sprint 3')
    expect(n?.message).toContain('ผู้เข้าร่วม:')
    expect(n?.message).toContain('เมธ') // owner (ผู้จัด) ก็เป็นผู้เข้าร่วมด้วย ต้องอยู่ในลิสต์
    expect(n?.message).toContain('ปอนด์')
  })

  it('คนไม่เกี่ยวข้องเลย (ไม่ใช่ผู้จัด/ผู้เข้าร่วม/สมาชิกโปรเจกต์) ไม่เห็นประชุมในลิสต์ และเปิด detail ไม่ได้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const created = (await (await app.request('/api/meetings', json(owner, nextMeetingPayload()), env)).json()) as { id: string }

    const somchaiList = (await (await app.request('/api/meetings', { headers: { cookie: somchai } }, env)).json()) as { id: string }[]
    expect(somchaiList.some((m) => m.id === created.id)).toBe(false)
    expect((await app.request(`/api/meetings/${created.id}`, { headers: { cookie: somchai } }, env)).status).toBe(403)
  })

  it('แก้ agenda/notes ได้ทุกคนที่เกี่ยวข้อง แต่แก้หัวข้อ/เวลา/ลิงก์ ได้เฉพาะผู้จัดหรือ owner', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/meetings', json(owner, nextMeetingPayload({ participantIds: ['u_pond'] })), env)).json()) as { id: string }

    // ปอนด์ (ผู้เข้าร่วม ไม่ใช่ผู้จัด) แก้ notes ได้
    const notesRes = await app.request(`/api/meetings/${created.id}`, patch(pond, { notes: 'สรุป: ต้องแก้ JWT' }), env)
    expect(notesRes.status).toBe(200)

    // แต่แก้หัวข้อ (ข้อมูลนัดหมาย) ไม่ได้
    expect((await app.request(`/api/meetings/${created.id}`, patch(pond, { title: 'เปลี่ยนหัวข้อ' }), env)).status).toBe(403)

    // owner (คนจัด) แก้หัวข้อได้
    expect((await app.request(`/api/meetings/${created.id}`, patch(owner, { title: 'เปลี่ยนหัวข้อ' }), env)).status).toBe(200)
  })

  it('แปลง Action Item เป็น Task ได้เฉพาะคนมีสิทธิ์ task.create ในโปรเจกต์ปลายทาง และผูก taskId กลับที่ action item', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const p = await makeProject(owner)
    const created = (await (await app.request('/api/meetings', json(owner, nextMeetingPayload({ projectId: p.id, participantIds: ['u_pond'] })), env)).json()) as { id: string }
    const item = (await (await app.request(`/api/meetings/${created.id}/action-items`, json(owner, { text: 'อัปเดต BRD' }), env)).json()) as { id: string }

    // ปอนด์ไม่ได้เป็นสมาชิกโปรเจกต์ p เลย → ไม่มีสิทธิ์ task.create แม้จะเป็นผู้เข้าร่วมประชุม
    expect((await app.request(`/api/meetings/${created.id}/action-items/${item.id}/create-task`, json(pond, { projectId: p.id }), env)).status).toBe(403)

    const taskRes = await app.request(`/api/meetings/${created.id}/action-items/${item.id}/create-task`, json(owner, { projectId: p.id }), env)
    expect(taskRes.status).toBe(201)
    const task = (await taskRes.json()) as { title: string }
    expect(task.title).toBe('อัปเดต BRD')

    const detail = (await (await app.request(`/api/meetings/${created.id}`, { headers: { cookie: owner } }, env)).json()) as { actionItems: { id: string; taskId: string | null }[] }
    expect(detail.actionItems.find((a) => a.id === item.id)?.taskId).toBeTruthy()
  })

  it('ลบประชุมได้เฉพาะผู้จัดหรือ owner', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/meetings', json(owner, nextMeetingPayload({ participantIds: ['u_pond'] })), env)).json()) as { id: string }
    expect((await app.request(`/api/meetings/${created.id}`, { method: 'DELETE', headers: { cookie: pond } }, env)).status).toBe(403)
    expect((await app.request(`/api/meetings/${created.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)).status).toBe(200)
  })
})

describe('Pronista §Notification overhaul (2026-08-27) — เลื่อน/ยกเลิกประชุม แจ้งผู้เข้าร่วม', () => {
  const notifCount = async (cookie: string, type: string) =>
    ((await (await app.request('/api/notifications', { headers: { cookie } }, env)).json()) as { type: string }[]).filter((n) => n.type === type).length

  it('เลื่อนเวลา/แก้หัวข้อ (ข้อมูลนัดหมายจริง) แจ้งผู้เข้าร่วมทุกคนยกเว้นคนแก้เอง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/meetings', json(owner, nextMeetingPayload({ participantIds: ['u_pond'] })), env)).json()) as { id: string }
    const before = { pond: await notifCount(pond, 'meeting_updated'), owner: await notifCount(owner, 'meeting_updated') }

    const newStart = Date.now() + 2 * HOUR
    const res = await app.request(`/api/meetings/${created.id}`, patch(owner, { startAt: newStart, endAt: newStart + HOUR }), env)
    expect(res.status).toBe(200)
    expect(await notifCount(pond, 'meeting_updated')).toBe(before.pond + 1) // ผู้เข้าร่วมได้แจ้งเตือน
    expect(await notifCount(owner, 'meeting_updated')).toBe(before.owner) // owner แก้เอง ไม่แจ้งตัวเอง
  })

  it('แก้แค่บันทึกการประชุม (notes) ไม่ใช่ข้อมูลนัดหมาย — ไม่ยิงแจ้งเตือน meeting_updated', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/meetings', json(owner, nextMeetingPayload({ participantIds: ['u_pond'] })), env)).json()) as { id: string }
    const before = await notifCount(pond, 'meeting_updated')
    await app.request(`/api/meetings/${created.id}`, patch(pond, { notes: 'สรุปแล้ว' }), env)
    expect(await notifCount(pond, 'meeting_updated')).toBe(before)
  })

  it('ยกเลิกประชุม แจ้งผู้เข้าร่วมทุกคน (meetingId เป็น null เพราะประชุมถูกลบไปแล้ว)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/meetings', json(owner, nextMeetingPayload({ participantIds: ['u_pond'] })), env)).json()) as { id: string }
    const before = await notifCount(pond, 'meeting_cancelled')
    expect((await app.request(`/api/meetings/${created.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)).status).toBe(200)
    const notifs = (await (await app.request('/api/notifications', { headers: { cookie: pond } }, env)).json()) as { type: string; meetingId: string | null }[]
    const cancelled = notifs.filter((n) => n.type === 'meeting_cancelled')
    expect(cancelled.length).toBe(before + 1)
    expect(cancelled.at(-1)?.meetingId).toBeNull()
  })
})

// Pronista §Google Meet Integration (2026-08-28) — ไม่แปะลิงก์เอง = สร้างนัดหมายจริงบน Google Calendar พร้อมลิงก์ Meet (แทน Jitsi auto-gen เดิม)
// mock fetch เลียนแบบ pattern เดียวกับ gcal.test.ts (mockGcal) — คนละ endpoint กัน (events POST/PATCH/DELETE แทน events.list ของ sync)
interface MockGcalEvents { calls: { method: string; url: string }[]; createFails?: boolean }
function mockGcalEvents(m: MockGcalEvents) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const method = init?.method ?? 'GET'
    m.calls.push({ method, url })
    if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'at-meet' })
    if (url.includes('/calendar/v3/calendars/primary/events') && method === 'POST') {
      if (m.createFails) return new Response('fail', { status: 500 })
      return Response.json({ id: 'gcal-evt-1', hangoutLink: 'https://meet.google.com/abc-defg-hij' })
    }
    if (url.includes('/calendar/v3/calendars/primary/events/') && method === 'PATCH') return Response.json({ ok: true })
    if (url.includes('/calendar/v3/calendars/primary/events/') && method === 'DELETE') return new Response(null, { status: 204 })
    throw new Error(`unexpected fetch: ${method} ${url}`)
  })
}

async function seedGcalConnection(scope = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events') {
  const db = createDb(env.DB)
  const [client] = await db
    .insert(inboxGoogleClients)
    .values({ label: 'SeedWebs', clientId: 'gcal-meet-client.apps.googleusercontent.com', clientSecretEnc: await encryptSecret('GOCSPX-x', env.INBOX_ENC_KEY) })
    .returning()
  const [conn] = await db
    .insert(calendarConnections)
    .values({
      clientId: client!.id,
      googleEmail: 'manager@brandnista.co.th',
      googleAccountId: 'g-acc-meet',
      refreshTokenEnc: await encryptSecret('rt-meet', env.INBOX_ENC_KEY),
      scope,
      status: 'connected',
      connectedAt: new Date(),
    })
    .returning()
  return conn!
}

describe('Pronista §Google Meet Integration (2026-08-28) — สร้าง/แก้/ยกเลิกนัดหมายบน Google Calendar', () => {
  beforeEach(async () => {
    await seedUsers()
    await env.DB.prepare('DELETE FROM calendar_connections').run()
    await env.DB.prepare('DELETE FROM inbox_google_clients').run()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('เชื่อมต่อพร้อม scope calendar.events → นัดประชุมไม่แปะลิงก์เอง ได้ลิงก์ Google Meet จริงมา', async () => {
    await seedGcalConnection()
    mockGcalEvents({ calls: [] })
    const owner = await loginAs(app, 'owner@example-co.test')
    const startAt = Date.now() + HOUR
    const res = await app.request('/api/meetings', json(owner, { title: 'ประชุม Google Meet', startAt, endAt: startAt + HOUR }), env)
    expect(res.status).toBe(201)
    const created = (await res.json()) as { externalMeetingUrl: string; gcalEventId: string | null }
    expect(created.externalMeetingUrl).toBe('https://meet.google.com/abc-defg-hij')
    expect(created.gcalEventId).toBe('gcal-evt-1')
  })

  it('ยังไม่ได้เชื่อมต่อ Google Calendar เลย → นัดประชุมไม่ได้ 409 พร้อมข้อความอ่านง่าย', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const startAt = Date.now() + HOUR
    const res = await app.request('/api/meetings', json(owner, { title: 'ประชุมไม่มีบัญชี', startAt, endAt: startAt + HOUR }), env)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; message: string }
    expect(body.error).toBe('gcal_not_connected')
    expect(body.message).toContain('เชื่อมต่อ')
  })

  it('เชื่อมต่อไว้แบบเก่า (readonly อย่างเดียว ยังไม่ได้ reconnect ขอ scope เขียน) → 409 เหมือนไม่ได้เชื่อมต่อ', async () => {
    await seedGcalConnection('https://www.googleapis.com/auth/calendar.readonly')
    const owner = await loginAs(app, 'owner@example-co.test')
    const startAt = Date.now() + HOUR
    const res = await app.request('/api/meetings', json(owner, { title: 'ประชุม scope เก่า', startAt, endAt: startAt + HOUR }), env)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('gcal_not_connected')
  })

  it('แปะลิงก์เองมา → ไม่ยิง Google Calendar เลย (ไม่ต้องเชื่อมต่อก็นัดได้)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    mockGcalEvents({ calls: [] }) // ถ้าดันยิง fetch จะ throw unexpected fetch ทันที ทำให้เทสต์ fail
    const startAt = Date.now() + HOUR
    const res = await app.request('/api/meetings', json(owner, { title: 'แปะลิงก์เอง', startAt, endAt: startAt + HOUR, externalMeetingUrl: 'https://zoom.us/j/123' }), env)
    expect(res.status).toBe(201)
    expect(((await res.json()) as { externalMeetingUrl: string }).externalMeetingUrl).toBe('https://zoom.us/j/123')
  })

  it('เลื่อนเวลาประชุม → อัปเดต event เดิมบน Google Calendar (PATCH) ไม่ใช่สร้างใหม่', async () => {
    await seedGcalConnection()
    const m: MockGcalEvents = { calls: [] }
    mockGcalEvents(m)
    const owner = await loginAs(app, 'owner@example-co.test')
    const startAt = Date.now() + HOUR
    const created = (await (await app.request('/api/meetings', json(owner, { title: 'จะเลื่อนเวลา', startAt, endAt: startAt + HOUR }), env)).json()) as { id: string }

    const newStart = startAt + 2 * HOUR
    const res = await app.request(`/api/meetings/${created.id}`, patch(owner, { startAt: newStart, endAt: newStart + HOUR }), env)
    expect(res.status).toBe(200)
    const patchCall = m.calls.find((c) => c.method === 'PATCH' && c.url.includes('gcal-evt-1'))
    expect(patchCall).toBeTruthy()
  })

  it('ยกเลิกประชุม → ลบ event เดิมบน Google Calendar (DELETE)', async () => {
    await seedGcalConnection()
    const m: MockGcalEvents = { calls: [] }
    mockGcalEvents(m)
    const owner = await loginAs(app, 'owner@example-co.test')
    const startAt = Date.now() + HOUR
    const created = (await (await app.request('/api/meetings', json(owner, { title: 'จะยกเลิก', startAt, endAt: startAt + HOUR }), env)).json()) as { id: string }

    const res = await app.request(`/api/meetings/${created.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)
    expect(res.status).toBe(200)
    const deleteCall = m.calls.find((c) => c.method === 'DELETE' && c.url.includes('gcal-evt-1'))
    expect(deleteCall).toBeTruthy()
  })
})
