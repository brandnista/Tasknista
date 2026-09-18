import { env } from 'cloudflare:test'
import { calendarEvents, createDb, users } from '@seedoffice/db'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

beforeEach(async () => {
  await seedUsers()
  await env.DB.prepare('DELETE FROM calendar_events').run()
  // สมาชิกอีกคน (ไม่ใช่ u_pond เจ้าของ event ในเทสต์นี้) ไว้ทดสอบว่า "คนอื่นที่มองเห็นปฏิทินได้" (ไม่ใช่แค่เจ้าของ/owner) โดนกรอง private ด้วย
  await createDb(env.DB)
    .insert(users)
    .values({ id: 'u_nam', email: 'nam@example-co.test', name: 'น้ำ', role: 'member' })
    .onConflictDoNothing()
})

async function seedEvent(overrides: Partial<typeof calendarEvents.$inferInsert> & { id: string }) {
  const db = createDb(env.DB)
  await db
    .insert(calendarEvents)
    .values({ title: 'ประชุม', startDate: '2026-09-20', type: 'meeting', source: 'gcal', createdBy: 'u_owner', ...overrides })
    .onConflictDoNothing()
}

describe('Pronista §Calendar/Workload (2026-09-18) — GET /api/calendar ตัวกรองรายคน (userIds)', () => {
  it('ไม่ส่ง userIds มา → เห็นทุก event', async () => {
    await seedEvent({ id: 'ce1', userId: 'u_owner' })
    await seedEvent({ id: 'ce2', userId: 'u_pond' })
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/calendar?from=2026-09-20&to=2026-09-20', { headers: { cookie: owner } }, env)).json()) as { events: { id: string }[] }
    expect(res.events.map((e) => e.id)).toEqual(expect.arrayContaining(['ce1', 'ce2']))
  })

  it('ส่ง userIds มา → เห็นเฉพาะ event ของคนที่เลือก', async () => {
    await seedEvent({ id: 'ce3', userId: 'u_owner' })
    await seedEvent({ id: 'ce4', userId: 'u_pond' })
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/calendar?from=2026-09-20&to=2026-09-20&userIds=u_pond', { headers: { cookie: owner } }, env)).json()) as { events: { id: string }[] }
    const ids = res.events.map((e) => e.id)
    expect(ids).toContain('ce4')
    expect(ids).not.toContain('ce3')
  })
})

describe('Pronista §Calendar/Workload (2026-09-18) — GET /api/calendar private masking', () => {
  it('event private ของคนอื่น → คนทั่วไปเห็นแค่ "ไม่ว่าง" ไม่มี attendees', async () => {
    await seedEvent({ id: 'ce5', userId: 'u_pond', title: 'นัดหมอ', private: true, allDay: false })
    const nam = await loginAs(app, 'nam@example-co.test')
    const res = (await (await app.request('/api/calendar?from=2026-09-20&to=2026-09-20', { headers: { cookie: nam } }, env)).json()) as {
      events: { id: string; title: string; attendees?: unknown[] }[]
    }
    const ev = res.events.find((e) => e.id === 'ce5')!
    expect(ev.title).toBe('ไม่ว่าง')
    expect(ev.attendees).toEqual([])
  })

  it('event private ของตัวเอง → เจ้าของเห็นชื่อเต็ม', async () => {
    await seedEvent({ id: 'ce6', userId: 'u_pond', title: 'นัดหมอ', private: true })
    const pond = await loginAs(app, 'pond@example-co.test')
    const res = (await (await app.request('/api/calendar?from=2026-09-20&to=2026-09-20', { headers: { cookie: pond } }, env)).json()) as { events: { id: string; title: string }[] }
    expect(res.events.find((e) => e.id === 'ce6')!.title).toBe('นัดหมอ')
  })

  it('event private ของคนอื่น → owner bypass เห็นชื่อเต็มเสมอ', async () => {
    await seedEvent({ id: 'ce7', userId: 'u_pond', title: 'นัดหมอ', private: true })
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/calendar?from=2026-09-20&to=2026-09-20', { headers: { cookie: owner } }, env)).json()) as { events: { id: string; title: string }[] }
    expect(res.events.find((e) => e.id === 'ce7')!.title).toBe('นัดหมอ')
  })

  it('event ไม่ private → ทุกคนเห็นชื่อเต็มปกติ', async () => {
    await seedEvent({ id: 'ce8', userId: 'u_pond', title: 'ประชุมทีม', private: false })
    const nam = await loginAs(app, 'nam@example-co.test')
    const res = (await (await app.request('/api/calendar?from=2026-09-20&to=2026-09-20', { headers: { cookie: nam } }, env)).json()) as { events: { id: string; title: string }[] }
    expect(res.events.find((e) => e.id === 'ce8')!.title).toBe('ประชุมทีม')
  })
})
