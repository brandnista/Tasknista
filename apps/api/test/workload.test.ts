import { env } from 'cloudflare:test'
import { calendarConnections, calendarEvents, companyConfig, createDb, inboxGoogleClients, sprints, tasks } from '@seedoffice/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { encryptSecret } from '../src/lib/crypto'
import { loginAs, seedUsers } from './helpers'

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

async function makeUnrelatedGuest() {
  const owner = await loginAs(app, 'owner@example-co.test')
  const p = (await (await app.request('/api/projects', json(owner, { name: 'โปรเจกต์ของ guest', type: 'project' }), env)).json()) as { id: string }
  await app.request(
    '/api/admin/users',
    json(owner, { email: 'guest-workload@example.com', name: 'ลูกค้า', role: 'guest', projectIds: [p.id] }),
    env,
  )
  return loginAs(app, 'guest-workload@example.com')
}

beforeEach(async () => {
  await seedUsers()
  // storage แชร์ข้าม test file ทั้ง suite (singleWorker) — เคลียร์ manhourMinutesPerDay ให้แน่ใจว่าใช้ค่า fallback 480 คงที่ ไม่ปนกับที่ manhour.test.ts เซ็ตทิ้งไว้
  await createDb(env.DB).update(companyConfig).set({ manhourMinutesPerDay: null }).where(eq(companyConfig.id, 1))
  await env.DB.prepare("DELETE FROM calendar_events WHERE source = 'gcal'").run()
})

async function makeTask(overrides: Partial<typeof tasks.$inferInsert> & { id: string }) {
  const db = createDb(env.DB)
  await db
    .insert(tasks)
    .values({ title: 'งานทดสอบ', createdBy: 'u_owner', status: 'on_processing', assigneeId: 'u_pond', acceptedAt: new Date('2026-09-01T00:00:00Z'), ...overrides })
    .onConflictDoNothing()
}

describe('Pronista §Workload — GET /api/workload', () => {
  it('owner/member/vendor เข้าได้ (เดิม owner เท่านั้น — เปิดกว้างตามโจทย์) · guest (ลูกค้า) 403', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const guest = await makeUnrelatedGuest()
    expect((await app.request('/api/workload?from=2026-09-01&to=2026-09-07', { headers: { cookie: owner } }, env)).status).toBe(200)
    expect((await app.request('/api/workload?from=2026-09-01&to=2026-09-07', { headers: { cookie: pond } }, env)).status).toBe(200)
    expect((await app.request('/api/workload?from=2026-09-01&to=2026-09-07', { headers: { cookie: somchai } }, env)).status).toBe(200)
    expect((await app.request('/api/workload?from=2026-09-01&to=2026-09-07', { headers: { cookie: guest } }, env)).status).toBe(403)
  })

  it('roster = owner+member+vendor (active) · ไม่รวมคนที่ disabled', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/workload?from=2026-09-01&to=2026-09-07', { headers: { cookie: owner } }, env)).json()) as {
      people: { id: string }[]
    }
    const ids = res.people.map((p) => p.id).sort()
    expect(ids).toEqual(['u_owner', 'u_pond', 'u_somchai'])
  })

  it('งานมีแค่ dueDate (ไม่มี startDate) → กองทั้งหมดวันเดียว', async () => {
    await makeTask({ id: 'wl_t1', dueDate: '2026-10-01', estimateMinutes: 120 })
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/workload?from=2026-10-01&to=2026-10-01', { headers: { cookie: owner } }, env)).json()) as {
      grid: Record<string, Record<string, { usedMinutes: number; taskIds: string[] }>>
    }
    expect(res.grid.u_pond!['2026-10-01']!.usedMinutes).toBe(120)
    expect(res.grid.u_pond!['2026-10-01']!.taskIds).toContain('wl_t1')
  })

  it('ล็อก Slot หลังเคยกดรับโดยไม่สนสถานะ · cancelled และงานที่ยังไม่รับไม่นับ', async () => {
    await makeTask({ id: 'wl_accepted_waiting', status: 'waiting_for_test', dueDate: '2026-10-02', estimateMinutes: 60 })
    await makeTask({ id: 'wl_accepted_done', status: 'done', dueDate: '2026-10-02', estimateMinutes: 90 })
    await makeTask({ id: 'wl_cancelled', status: 'cancelled', dueDate: '2026-10-02', estimateMinutes: 120 })
    await makeTask({ id: 'wl_not_accepted', status: 'on_processing', acceptedAt: null, dueDate: '2026-10-02', estimateMinutes: 180 })
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/workload?from=2026-10-02&to=2026-10-02', { headers: { cookie: owner } }, env)).json()) as {
      grid: Record<string, Record<string, { usedMinutes: number; taskIds: string[] }>>
    }
    const cell = res.grid.u_pond!['2026-10-02']!
    expect(cell.usedMinutes).toBe(150)
    expect(cell.taskIds.sort()).toEqual(['wl_accepted_done', 'wl_accepted_waiting'])
  })

  it('งานมี startDate+dueDate 2 วัน → เกลี่ยเท่ากันทั้งสองวัน', async () => {
    await makeTask({ id: 'wl_t2', startDate: '2026-10-05', dueDate: '2026-10-06', estimateMinutes: 200 })
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/workload?from=2026-10-05&to=2026-10-06', { headers: { cookie: owner } }, env)).json()) as {
      grid: Record<string, Record<string, { usedMinutes: number }>>
    }
    expect(res.grid.u_pond!['2026-10-05']!.usedMinutes).toBe(100)
    expect(res.grid.u_pond!['2026-10-06']!.usedMinutes).toBe(100)
  })

  it('งานเกิน capacity → usedMinutes > capacityMinutes ของวันนั้น (ไม่มีการยกยอดไปวันอื่น)', async () => {
    await makeTask({ id: 'wl_t3', dueDate: '2026-10-12', estimateMinutes: 700 }) // 2026-10-12 = จันทร์ (วันทำงานปกติ)
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/workload?from=2026-10-12&to=2026-10-12', { headers: { cookie: owner } }, env)).json()) as {
      grid: Record<string, Record<string, { usedMinutes: number; capacityMinutes: number }>>
    }
    const cell = res.grid.u_pond!['2026-10-12']!
    expect(cell.usedMinutes).toBe(700)
    expect(cell.capacityMinutes).toBe(480) // ค่าเริ่มต้น workHourCapMinutes ของ seedUsers()
    expect(cell.usedMinutes).toBeGreaterThan(cell.capacityMinutes)
  })

  it('งานไม่มี dueDate เลย → ไม่ขึ้น grid ไปอยู่ unscheduled แทน', async () => {
    await makeTask({ id: 'wl_t4', estimateMinutes: 60 })
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/workload?from=2026-10-13&to=2026-10-13', { headers: { cookie: owner } }, env)).json()) as {
      grid: Record<string, Record<string, { usedMinutes: number }>>
      unscheduled: { id: string; assigneeId: string; estimateMinutes: number }[]
    }
    expect(res.unscheduled.some((u) => u.id === 'wl_t4')).toBe(true)
    expect(res.grid.u_pond!['2026-10-13']!.usedMinutes).toBe(0)
  })

  it('วันลา (calendarEvents type=leave) → capacityMinutes=0 + onLeave=true เฉพาะวันนั้น', async () => {
    const db = createDb(env.DB)
    await db
      .insert(calendarEvents)
      .values({ id: 'wl_lv1', title: 'ลาพักร้อน', type: 'leave', userId: 'u_pond', startDate: '2026-10-20', endDate: '2026-10-20', createdBy: 'u_owner' })
      .onConflictDoNothing()
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/workload?from=2026-10-19&to=2026-10-20', { headers: { cookie: owner } }, env)).json()) as {
      grid: Record<string, Record<string, { capacityMinutes: number; onLeave: boolean; usedMinutes: number; taskIds: string[] }>>
    }
    expect(res.grid.u_pond!['2026-10-20']).toEqual({ capacityMinutes: 0, onLeave: true, usedMinutes: 0, taskMinutes: 0, meetingMinutes: 0, taskIds: [] })
    expect(res.grid.u_pond!['2026-10-19']!.onLeave).toBe(false) // 2026-10-19 = จันทร์
    expect(res.grid.u_pond!['2026-10-19']!.capacityMinutes).toBe(480)
  })

  it('ส่ง sprintId มา → กรองเฉพาะ task ของ sprint นั้น', async () => {
    const db = createDb(env.DB)
    await db.insert(sprints).values({ id: 'wl_sp1', name: 'Sprint ทดสอบ', startDate: '2026-10-01', endDate: '2026-10-31', status: 'active', createdBy: 'u_owner' }).onConflictDoNothing()
    await makeTask({ id: 'wl_t5', dueDate: '2026-10-25', estimateMinutes: 60, sprintId: 'wl_sp1' })
    await makeTask({ id: 'wl_t6', dueDate: '2026-10-25', estimateMinutes: 90 }) // ไม่อยู่ sprint ไหน
    const owner = await loginAs(app, 'owner@example-co.test')
    const withSprint = (await (await app.request('/api/workload?from=2026-10-25&to=2026-10-25&sprintId=wl_sp1', { headers: { cookie: owner } }, env)).json()) as {
      grid: Record<string, Record<string, { usedMinutes: number }>>
    }
    expect(withSprint.grid.u_pond!['2026-10-25']!.usedMinutes).toBe(60)
    const noSprint = (await (await app.request('/api/workload?from=2026-10-25&to=2026-10-25', { headers: { cookie: owner } }, env)).json()) as {
      grid: Record<string, Record<string, { usedMinutes: number }>>
    }
    expect(noSprint.grid.u_pond!['2026-10-25']!.usedMinutes).toBe(150) // wl_t5+wl_t6
  })

  it('from > to → 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    expect((await app.request('/api/workload?from=2026-09-07&to=2026-09-01', { headers: { cookie: owner } }, env)).status).toBe(400)
  })
})

describe('Pronista §Workload — GET /api/workload/sprints', () => {
  it('คืนเฉพาะ sprint ที่ planned/active · ไม่รวม completed · owner/member/vendor เข้าได้ (เดิม owner เท่านั้น)', async () => {
    const db = createDb(env.DB)
    await db
      .insert(sprints)
      .values([
        { id: 'wl_sp_planned', name: 'วางแผน', startDate: '2026-09-01', endDate: '2026-09-14', status: 'planned', createdBy: 'u_owner' },
        { id: 'wl_sp_active', name: 'กำลังทำ', startDate: '2026-09-01', endDate: '2026-09-14', status: 'active', createdBy: 'u_owner' },
        { id: 'wl_sp_done', name: 'ปิดแล้ว', startDate: '2026-08-01', endDate: '2026-08-14', status: 'completed', createdBy: 'u_owner' },
      ])
      .onConflictDoNothing()
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const guest = await makeUnrelatedGuest()
    expect((await app.request('/api/workload/sprints', { headers: { cookie: pond } }, env)).status).toBe(200)
    expect((await app.request('/api/workload/sprints', { headers: { cookie: guest } }, env)).status).toBe(403)
    const res = (await (await app.request('/api/workload/sprints', { headers: { cookie: owner } }, env)).json()) as { sprints: { id: string }[] }
    const ids = res.sprints.map((s) => s.id)
    expect(ids).toContain('wl_sp_planned')
    expect(ids).toContain('wl_sp_active')
    expect(ids).not.toContain('wl_sp_done')
  })
})

describe('Pronista §Calendar/Workload (2026-09-18) — ประชุมจาก Google Calendar หักเข้า Workload', () => {
  async function seedGcalMeeting(opts: { userId: string; startAt: Date; endAt: Date; allDay?: boolean; busy?: boolean }) {
    const db = createDb(env.DB)
    const [gClient] = await db
      .insert(inboxGoogleClients)
      .values({ label: 'test', clientId: 'x.apps.googleusercontent.com', clientSecretEnc: await encryptSecret('s', env.INBOX_ENC_KEY) })
      .returning()
    const [conn] = await db
      .insert(calendarConnections)
      .values({ clientId: gClient!.id, userId: opts.userId, status: 'connected', connectedAt: new Date() })
      .returning()
    await db.insert(calendarEvents).values({
      title: 'ประชุม',
      type: 'meeting',
      source: 'gcal',
      gcalId: `gc-${crypto.randomUUID()}`,
      connectionId: conn!.id,
      userId: opts.userId,
      startDate: opts.startAt.toISOString().slice(0, 10),
      startAt: opts.startAt,
      endAt: opts.endAt,
      allDay: opts.allDay ?? false,
      busy: opts.busy ?? true,
      createdBy: opts.userId,
    })
  }

  it('ประชุม 14:00-16:00 BKK → meetingMinutes=120, usedMinutes รวมด้วย (ตัวอย่างตรงจากโจทย์)', async () => {
    await seedGcalMeeting({ userId: 'u_pond', startAt: new Date('2026-11-05T14:00:00+07:00'), endAt: new Date('2026-11-05T16:00:00+07:00') })
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/workload?from=2026-11-05&to=2026-11-05', { headers: { cookie: owner } }, env)).json()) as {
      grid: Record<string, Record<string, { usedMinutes: number; meetingMinutes: number; taskMinutes: number }>>
    }
    expect(res.grid.u_pond!['2026-11-05']).toMatchObject({ usedMinutes: 120, meetingMinutes: 120, taskMinutes: 0 })
  })

  it('event ทั้งวัน (allDay) → ไม่นับเข้า meetingMinutes เลย', async () => {
    await seedGcalMeeting({ userId: 'u_pond', startAt: new Date('2026-11-06T00:00:00+07:00'), endAt: new Date('2026-11-07T00:00:00+07:00'), allDay: true })
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/workload?from=2026-11-06&to=2026-11-06', { headers: { cookie: owner } }, env)).json()) as {
      grid: Record<string, Record<string, { meetingMinutes: number }>>
    }
    expect(res.grid.u_pond!['2026-11-06']!.meetingMinutes).toBe(0)
  })

  it('busy=false (transparency=transparent, "ว่าง") → ไม่นับเข้า meetingMinutes', async () => {
    await seedGcalMeeting({ userId: 'u_pond', startAt: new Date('2026-11-07T14:00:00+07:00'), endAt: new Date('2026-11-07T15:00:00+07:00'), busy: false })
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/workload?from=2026-11-07&to=2026-11-07', { headers: { cookie: owner } }, env)).json()) as {
      grid: Record<string, Record<string, { meetingMinutes: number }>>
    }
    expect(res.grid.u_pond!['2026-11-07']!.meetingMinutes).toBe(0)
  })

  it('มีทั้ง Task และประชุมในวันเดียวกัน → รวมทั้งสองแหล่งเข้า usedMinutes, แยก breakdown ถูกต้อง', async () => {
    await makeTask({ id: 'wl_t_mix', dueDate: '2026-11-08', estimateMinutes: 60 })
    await seedGcalMeeting({ userId: 'u_pond', startAt: new Date('2026-11-08T14:00:00+07:00'), endAt: new Date('2026-11-08T15:00:00+07:00') })
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/workload?from=2026-11-08&to=2026-11-08', { headers: { cookie: owner } }, env)).json()) as {
      grid: Record<string, Record<string, { usedMinutes: number; taskMinutes: number; meetingMinutes: number }>>
    }
    expect(res.grid.u_pond!['2026-11-08']).toMatchObject({ usedMinutes: 120, taskMinutes: 60, meetingMinutes: 60 })
  })
})
