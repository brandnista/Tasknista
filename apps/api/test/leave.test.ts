import { createDb, leaveBalanceAdjustments, leaveTypes, users } from '@seedoffice/db'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

const json = (cookie: string, body: unknown, method = 'POST') => ({
  method,
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

function leaveForm(cookie: string, fields: Record<string, string>, attachment?: File) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  if (attachment) fd.append('attachment', attachment)
  return { method: 'POST', headers: { cookie }, body: fd }
}

let sickTypeId: string
let certTypeId: string

beforeEach(async () => {
  await seedUsers()
  const db = createDb(env.DB)
  // ลำดับสำคัญ — leave_balance_adjustments/leave_requests อ้าง leave_types (FK) ต้องลบก่อน ไม่งั้น DELETE leave_types ชน constraint
  await env.DB.prepare('DELETE FROM leave_balance_adjustments').run()
  await env.DB.prepare('DELETE FROM leave_requests').run()
  await env.DB.prepare('DELETE FROM leave_types').run()
  await env.DB.prepare('DELETE FROM calendar_events').run()
  // ปอนด์ (u_pond) มี manager = owner (u_owner) — mirror pattern daily report managerId
  await db.update(users).set({ managerId: 'u_owner' }).where(eq(users.id, 'u_pond'))
  const sick = (await db.insert(leaveTypes).values({ name: 'ลาป่วย', requiresReason: true, requiresAttachment: false, quotaDaysByRole: { member: 30 } }).returning())[0]!
  const cert = (await db.insert(leaveTypes).values({ name: 'ลาป่วย (ต้องแนบใบรับรองแพทย์)', requiresReason: true, requiresAttachment: true, quotaDaysByRole: { member: 3 } }).returning())[0]!
  sickTypeId = sick.id
  certTypeId = cert.id
})

describe('§Leave Request — Phase 1', () => {
  it('GET /types คืนโควตา/เหลือ/รออนุมัติถูกต้อง — approved หัก remain, pending ไม่หัก', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: sickTypeId, startDate: '2026-09-22', endDate: '2026-09-22', reason: 'ไม่สบาย' }), env)
    ).json()) as { id: string }
    const owner = await loginAs(app, 'owner@example-co.test')
    await app.request(`/api/leave-requests/${created.id}/approve`, { method: 'POST', headers: { cookie: owner } }, env)

    const second = (await (
      await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: sickTypeId, startDate: '2026-09-23', endDate: '2026-09-24', reason: 'พักต่อ' }), env)
    ).json()) as { id: string }
    expect(second.id).toBeTruthy()

    const types = (await (await app.request('/api/leave-requests/types', { headers: { cookie: pond } }, env)).json()) as {
      types: { id: string; balance: { quota: number; remain: number; waiting: number } }[]
    }
    const sick = types.types.find((t) => t.id === sickTypeId)!
    expect(sick.balance.quota).toBe(30)
    expect(sick.balance.remain).toBe(29) // หักเฉพาะที่อนุมัติแล้ว 1 วัน
    expect(sick.balance.waiting).toBe(2) // pending 2 วัน โชว์แยก ไม่หัก remain
  })

  it('บังคับ reason/attachment ตามประเภท — ไม่กรอกโดน 400', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const noReason = await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: sickTypeId, startDate: '2026-09-22', endDate: '2026-09-22' }), env)
    expect(noReason.status).toBe(400)

    const noAttachment = await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: certTypeId, startDate: '2026-09-22', endDate: '2026-09-22', reason: 'ไม่สบายมาก' }), env)
    expect(noAttachment.status).toBe(400)

    const withAttachment = await app.request(
      '/api/leave-requests',
      leaveForm(pond, { leaveTypeId: certTypeId, startDate: '2026-09-22', endDate: '2026-09-22', reason: 'ไม่สบายมาก' }, new File([new Uint8Array([1, 2, 3])], 'cert.pdf', { type: 'application/pdf' })),
      env,
    )
    expect(withAttachment.status).toBe(201)
  })

  it('startDate>endDate → 400', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const res = await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: sickTypeId, startDate: '2026-09-25', endDate: '2026-09-20', reason: 'x' }), env)
    expect(res.status).toBe(400)
  })

  it('แนบไฟล์เกิน 15MB → 413', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const big = new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' })
    const res = await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: certTypeId, startDate: '2026-09-22', endDate: '2026-09-22', reason: 'x' }, big), env)
    expect(res.status).toBe(413)
  })

  it('approverId snapshot จาก managerId ตอนยื่น — manager เห็นในแท็บรออนุมัติ', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: sickTypeId, startDate: '2026-09-22', endDate: '2026-09-22', reason: 'ไม่สบาย' }), env)
    ).json()) as { id: string; approverId: string }
    expect(created.approverId).toBe('u_owner')

    const owner = await loginAs(app, 'owner@example-co.test')
    const pendingOwner = (await (await app.request('/api/leave-requests/pending', { headers: { cookie: owner } }, env)).json()) as { rows: { id: string }[] }
    expect(pendingOwner.rows.map((r) => r.id)).toContain(created.id)
  })

  it('ไม่มี manager → fallback แจ้ง/ให้ owner ทุกคนเห็นในแท็บรออนุมัติ', async () => {
    const db = createDb(env.DB)
    await db.update(users).set({ managerId: null }).where(eq(users.id, 'u_pond'))
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: sickTypeId, startDate: '2026-09-22', endDate: '2026-09-22', reason: 'ไม่สบาย' }), env)
    ).json()) as { id: string; approverId: string | null }
    expect(created.approverId).toBeNull()

    const owner = await loginAs(app, 'owner@example-co.test')
    const pendingOwner = (await (await app.request('/api/leave-requests/pending', { headers: { cookie: owner } }, env)).json()) as { rows: { id: string }[] }
    expect(pendingOwner.rows.map((r) => r.id)).toContain(created.id)
  })

  it('approve/reject gate: เฉพาะ approver ที่ระบุหรือ owner — คนอื่นโดน 403', async () => {
    const db = createDb(env.DB)
    await db.insert(users).values({ id: 'u_nam', email: 'nam@example-co.test', name: 'น้ำ', role: 'member' }).onConflictDoNothing()
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: sickTypeId, startDate: '2026-09-22', endDate: '2026-09-22', reason: 'ไม่สบาย' }), env)
    ).json()) as { id: string }

    const nam = await loginAs(app, 'nam@example-co.test')
    expect((await app.request(`/api/leave-requests/${created.id}/approve`, { method: 'POST', headers: { cookie: nam } }, env)).status).toBe(403)

    const owner = await loginAs(app, 'owner@example-co.test')
    const approved = await app.request(`/api/leave-requests/${created.id}/approve`, { method: 'POST', headers: { cookie: owner } }, env)
    expect(approved.status).toBe(200)
  })

  it('อนุมัติแล้วสร้าง calendarEvent จริงตรงวันที่ (type=leave)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: sickTypeId, startDate: '2026-09-22', endDate: '2026-09-23', reason: 'ไม่สบาย' }), env)
    ).json()) as { id: string }
    const owner = await loginAs(app, 'owner@example-co.test')
    const approved = (await (await app.request(`/api/leave-requests/${created.id}/approve`, { method: 'POST', headers: { cookie: owner } }, env)).json()) as { calendarEventId: string }
    expect(approved.calendarEventId).toBeTruthy()

    const eventRow = await env.DB.prepare('SELECT type, user_id, start_date, end_date FROM calendar_events WHERE id = ?')
      .bind(approved.calendarEventId)
      .first<{ type: string; user_id: string; start_date: string; end_date: string }>()
    expect(eventRow?.type).toBe('leave')
    expect(eventRow?.user_id).toBe('u_pond')
    expect(eventRow?.start_date).toBe('2026-09-22')
    expect(eventRow?.end_date).toBe('2026-09-23')
  })

  it('reject บังคับเหตุผล — ไม่ใส่ 400, ใส่แล้วสถานะเปลี่ยน', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: sickTypeId, startDate: '2026-09-22', endDate: '2026-09-22', reason: 'ไม่สบาย' }), env)
    ).json()) as { id: string }
    const owner = await loginAs(app, 'owner@example-co.test')
    expect((await app.request(`/api/leave-requests/${created.id}/reject`, json(owner, {}), env)).status).toBe(400)
    const rejected = await app.request(`/api/leave-requests/${created.id}/reject`, json(owner, { reason: 'เอกสารไม่ครบ' }), env)
    expect(rejected.status).toBe(200)
    expect(((await rejected.json()) as { status: string }).status).toBe('rejected')
  })

  it('withdraw ได้เฉพาะตอน pending — เจ้าของเท่านั้น', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: sickTypeId, startDate: '2026-09-22', endDate: '2026-09-22', reason: 'ไม่สบาย' }), env)
    ).json()) as { id: string }

    const owner = await loginAs(app, 'owner@example-co.test')
    expect((await app.request(`/api/leave-requests/${created.id}/withdraw`, { method: 'POST', headers: { cookie: owner } }, env)).status).toBe(403)

    const withdrawn = await app.request(`/api/leave-requests/${created.id}/withdraw`, { method: 'POST', headers: { cookie: pond } }, env)
    expect(withdrawn.status).toBe(200)

    // ถอนแล้วถอนซ้ำไม่ได้ (ไม่ใช่ pending แล้ว)
    expect((await app.request(`/api/leave-requests/${created.id}/withdraw`, { method: 'POST', headers: { cookie: pond } }, env)).status).toBe(409)
  })

  it('POST /api/calendar ปฏิเสธ type=leave แล้ว (กันทางลัดเดิมกลับมา)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request('/api/calendar', json(owner, { title: 'ลาพักร้อน', startDate: '2026-09-22', type: 'leave' }), env)
    expect(res.status).toBe(400)
  })

  it('attachment ดูได้เฉพาะ requester/approver/owner', async () => {
    const db = createDb(env.DB)
    await db.insert(users).values({ id: 'u_nam', email: 'nam@example-co.test', name: 'น้ำ', role: 'member' }).onConflictDoNothing()
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request(
        '/api/leave-requests',
        leaveForm(pond, { leaveTypeId: certTypeId, startDate: '2026-09-22', endDate: '2026-09-22', reason: 'ไม่สบายมาก' }, new File([new Uint8Array([1, 2, 3])], 'cert.pdf', { type: 'application/pdf' })),
        env,
      )
    ).json()) as { id: string }

    const nam = await loginAs(app, 'nam@example-co.test')
    expect((await app.request(`/api/leave-requests/${created.id}/attachment`, { headers: { cookie: nam } }, env)).status).toBe(403)
    expect((await app.request(`/api/leave-requests/${created.id}/attachment`, { headers: { cookie: pond } }, env)).status).toBe(200)

    const owner = await loginAs(app, 'owner@example-co.test')
    expect((await app.request(`/api/leave-requests/${created.id}/attachment`, { headers: { cookie: owner } }, env)).status).toBe(200)
  })

  it('vendor เข้า /api/leave-requests ได้ (roles ที่อนุญาต: owner/member/vendor)', async () => {
    const vendor = await loginAs(app, 'somchai@example.com')
    expect((await app.request('/api/leave-requests/types', { headers: { cookie: vendor } }, env)).status).toBe(200)
  })
})

describe('§Leave Request — Phase 2', () => {
  it('withdraw ยอมรับ approved+ยังไม่ถึงวันเริ่ม (ยกเลิกเองได้) และลบ calendarEvent ที่ผูกไว้', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: sickTypeId, startDate: '2099-01-01', endDate: '2099-01-02', reason: 'อนาคตไกล' }), env)
    ).json()) as { id: string }
    const owner = await loginAs(app, 'owner@example-co.test')
    const approved = (await (await app.request(`/api/leave-requests/${created.id}/approve`, { method: 'POST', headers: { cookie: owner } }, env)).json()) as { calendarEventId: string }
    expect(approved.calendarEventId).toBeTruthy()

    const cancelled = await app.request(`/api/leave-requests/${created.id}/withdraw`, { method: 'POST', headers: { cookie: pond } }, env)
    expect(cancelled.status).toBe(200)
    expect(((await cancelled.json()) as { status: string }).status).toBe('withdrawn')

    const eventRow = await env.DB.prepare('SELECT id FROM calendar_events WHERE id = ?').bind(approved.calendarEventId).first()
    expect(eventRow).toBeNull()
  })

  it('withdraw ปฏิเสธ approved+ถึงวันแล้ว/ผ่านไปแล้ว → 409', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: sickTypeId, startDate: '2020-01-01', endDate: '2020-01-02', reason: 'ย้อนอดีต' }), env)
    ).json()) as { id: string }
    const owner = await loginAs(app, 'owner@example-co.test')
    await app.request(`/api/leave-requests/${created.id}/approve`, { method: 'POST', headers: { cookie: owner } }, env)

    const res = await app.request(`/api/leave-requests/${created.id}/withdraw`, { method: 'POST', headers: { cookie: pond } }, env)
    expect(res.status).toBe(409)
  })

  it('GET /on-leave คืนเฉพาะ approved ที่ช่วงวันทับซ้อนกับ from..to', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: sickTypeId, startDate: '2031-06-10', endDate: '2031-06-12', reason: 'ทดสอบ on-leave' }), env)
    ).json()) as { id: string }
    const owner = await loginAs(app, 'owner@example-co.test')
    await app.request(`/api/leave-requests/${created.id}/approve`, { method: 'POST', headers: { cookie: owner } }, env)

    const overlap = (await (await app.request('/api/leave-requests/on-leave?from=2031-06-11&to=2031-06-20', { headers: { cookie: pond } }, env)).json()) as { rows: { userId: string }[] }
    expect(overlap.rows.map((r) => r.userId)).toContain('u_pond')

    const noOverlap = (await (await app.request('/api/leave-requests/on-leave?from=2031-07-01&to=2031-07-05', { headers: { cookie: pond } }, env)).json()) as { rows: unknown[] }
    expect(noOverlap.rows).toHaveLength(0)
  })

  it('GET /types พับยอด leave_balance_adjustments (backfill) เข้ายอดที่ใช้ไปด้วย', async () => {
    const db = createDb(env.DB)
    const year = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 4)
    await db.insert(leaveBalanceAdjustments).values({ userId: 'u_pond', leaveTypeId: sickTypeId, year, days: 5, note: 'backfill ก่อนขึ้นระบบ', createdBy: 'u_owner' })

    const pond = await loginAs(app, 'pond@example-co.test')
    const types = (await (await app.request('/api/leave-requests/types', { headers: { cookie: pond } }, env)).json()) as { types: { id: string; balance: { remain: number } }[] }
    const sick = types.types.find((t) => t.id === sickTypeId)!
    expect(sick.balance.remain).toBe(25) // quota 30 - adjustment 5
  })

  it('GET /mine คืนชื่อผู้อนุมัติ/ปฏิเสธ (decidedByName) ถูกต้อง', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: sickTypeId, startDate: '2026-09-22', endDate: '2026-09-22', reason: 'ไม่สบาย' }), env)
    ).json()) as { id: string }
    const owner = await loginAs(app, 'owner@example-co.test')
    await app.request(`/api/leave-requests/${created.id}/approve`, { method: 'POST', headers: { cookie: owner } }, env)

    const mine = (await (await app.request('/api/leave-requests/mine', { headers: { cookie: pond } }, env)).json()) as { rows: { id: string; decidedByName: string | null }[] }
    expect(mine.rows.find((r) => r.id === created.id)?.decidedByName).toBe('เมธ')
  })
})
