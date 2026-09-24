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

// Pronista §Leave Management Overhaul เฟส D (2026-09-23) — POST /api/leave-requests เปลี่ยนจาก startDate/endDate เดี่ยว เป็น ranges: [{startDate,endDate}][]
// แปลง startDate/endDate ให้อัตโนมัติที่นี่ที่เดียว กัน test call site เดิมทั้งหมดต้องแก้ (ยังส่งช่วงเดียวเหมือนเดิม แค่ wrap เป็น ranges array ให้)
function leaveForm(cookie: string, fields: Record<string, string>, attachment?: File) {
  const fd = new FormData()
  const { startDate, endDate, ...rest } = fields
  for (const [k, v] of Object.entries(rest)) fd.append(k, v)
  if (startDate && endDate) fd.append('ranges', JSON.stringify([{ startDate, endDate }]))
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

// Pronista §Leave Management Overhaul เฟส D (2026-09-23) — ลาหลายช่วงวันที่ในคำขอเดียว (ติดวันหยุดคั่นกลาง) — sibling rows แชร์ groupId เดียวกัน approve/reject/withdraw ทำทั้งกลุ่มพร้อมกันเสมอ
describe('§Leave Management Overhaul เฟส D — ลาหลายช่วงวันที่ในคำขอเดียว (multi-range)', () => {
  function leaveFormRanges(cookie: string, leaveTypeId: string, ranges: { startDate: string; endDate: string }[], reason = 'ลาหลายช่วง') {
    const fd = new FormData()
    fd.append('leaveTypeId', leaveTypeId)
    fd.append('reason', reason)
    fd.append('ranges', JSON.stringify(ranges))
    return { method: 'POST', headers: { cookie }, body: fd }
  }

  it('ส่งคำขอ 2 ช่วง (12-13, 16 พ.ย.) → ได้ผลลัพธ์เป็น array 2 แถว groupId เดียวกัน · GET /mine เห็นเป็น 1 รายการ พร้อม ranges ครบ', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const res = await app.request(
      '/api/leave-requests',
      leaveFormRanges(pond, sickTypeId, [
        { startDate: '2026-11-12', endDate: '2026-11-13' },
        { startDate: '2026-11-16', endDate: '2026-11-16' },
      ]),
      env,
    )
    expect(res.status).toBe(201)
    const rows = (await res.json()) as { id: string; groupId: string | null }[]
    expect(rows).toHaveLength(2)
    expect(rows[0]!.groupId).toBeTruthy()
    expect(rows[0]!.groupId).toBe(rows[1]!.groupId)

    const mine = (await (await app.request('/api/leave-requests/mine', { headers: { cookie: pond } }, env)).json()) as {
      rows: { groupId: string | null; ranges: { startDate: string; endDate: string }[] }[]
    }
    const grouped = mine.rows.filter((r) => r.groupId === rows[0]!.groupId)
    expect(grouped).toHaveLength(1)
    expect(grouped[0]!.ranges).toHaveLength(2)
    expect(grouped[0]!.ranges.map((r) => r.startDate)).toEqual(['2026-11-12', '2026-11-16'])
  })

  it('ช่วงทับกันในคำขอเดียวกัน → 400', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const res = await app.request(
      '/api/leave-requests',
      leaveFormRanges(pond, sickTypeId, [
        { startDate: '2026-11-12', endDate: '2026-11-14' },
        { startDate: '2026-11-13', endDate: '2026-11-15' },
      ]),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('อนุมัติกลุ่ม → เกิด calendarEvents แยกกันตามจำนวนช่วง ทุกแถวในกลุ่ม approved decidedBy/decidedAt เดียวกัน', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request(
        '/api/leave-requests',
        leaveFormRanges(pond, sickTypeId, [
          { startDate: '2026-11-12', endDate: '2026-11-13' },
          { startDate: '2026-11-16', endDate: '2026-11-16' },
        ]),
        env,
      )
    ).json()) as { id: string }[]

    const owner = await loginAs(app, 'owner@example-co.test')
    const approveRes = await app.request(`/api/leave-requests/${created[0]!.id}/approve`, { method: 'POST', headers: { cookie: owner } }, env)
    expect(approveRes.status).toBe(200)
    const approved = (await approveRes.json()) as { id: string; status: string; decidedBy: string; decidedAt: number; calendarEventId: string | null }[]
    expect(approved).toHaveLength(2)
    expect(approved.every((r) => r.status === 'approved')).toBe(true)
    expect(approved[0]!.decidedBy).toBe(approved[1]!.decidedBy)
    expect(approved[0]!.decidedAt).toBe(approved[1]!.decidedAt)
    expect(approved[0]!.calendarEventId).not.toBe(approved[1]!.calendarEventId) // คนละ event กัน (2 ช่วง = 2 event)
    expect(approved[0]!.calendarEventId).toBeTruthy()
    expect(approved[1]!.calendarEventId).toBeTruthy()

    // ยอดใช้ไปรวม 3 วัน (2+1) ถูกนับครบทั้งกลุ่ม
    const types = (await (await app.request('/api/leave-requests/types', { headers: { cookie: pond } }, env)).json()) as { types: { id: string; balance: { remain: number } }[] }
    expect(types.types.find((t) => t.id === sickTypeId)!.balance.remain).toBe(27) // quota 30 - 3
  })

  it('ปฏิเสธกลุ่ม → ทุกแถวในกลุ่ม rejected เหตุผลเดียวกัน', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request(
        '/api/leave-requests',
        leaveFormRanges(pond, sickTypeId, [
          { startDate: '2026-11-12', endDate: '2026-11-13' },
          { startDate: '2026-11-16', endDate: '2026-11-16' },
        ]),
        env,
      )
    ).json()) as { id: string }[]

    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request(
      `/api/leave-requests/${created[0]!.id}/reject`,
      { method: 'POST', headers: { cookie: owner, 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'ช่วงนี้งานเยอะ' }) },
      env,
    )
    expect(res.status).toBe(200)
    const rejected = (await res.json()) as { status: string; rejectReason: string }[]
    expect(rejected).toHaveLength(2)
    expect(rejected.every((r) => r.status === 'rejected' && r.rejectReason === 'ช่วงนี้งานเยอะ')).toBe(true)
  })

  it('ยกเลิก: ช่วงหนึ่งเริ่มไปแล้ว → บล็อกทั้งกลุ่ม (409) · ทั้งคู่ยังไม่ถึงวัน → ยกเลิกได้ ลบ calendar event ทั้งคู่', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const owner = await loginAs(app, 'owner@example-co.test')

    // กรณีที่ 1: ช่วงหนึ่งเป็นอดีตไปแล้ว (สร้าง+อนุมัติตรงๆ ผ่าน DB ไม่ผ่าน validation อดีต เพราะ POST ไม่ได้ห้ามวันที่อดีต)
    const pastGroup = (await (
      await app.request(
        '/api/leave-requests',
        leaveFormRanges(pond, sickTypeId, [
          { startDate: '2020-01-01', endDate: '2020-01-01' },
          { startDate: '2099-01-01', endDate: '2099-01-01' },
        ]),
        env,
      )
    ).json()) as { id: string }[]
    await app.request(`/api/leave-requests/${pastGroup[0]!.id}/approve`, { method: 'POST', headers: { cookie: owner } }, env)
    const blockedWithdraw = await app.request(`/api/leave-requests/${pastGroup[0]!.id}/withdraw`, { method: 'POST', headers: { cookie: pond } }, env)
    expect(blockedWithdraw.status).toBe(409)

    // กรณีที่ 2: ทั้งคู่ยังไม่ถึงวัน → ยกเลิกได้ ลบ calendar event ทั้งคู่
    const futureGroup = (await (
      await app.request(
        '/api/leave-requests',
        leaveFormRanges(pond, sickTypeId, [
          { startDate: '2099-02-01', endDate: '2099-02-02' },
          { startDate: '2099-02-05', endDate: '2099-02-05' },
        ]),
        env,
      )
    ).json()) as { id: string }[]
    const approvedFuture = (await (
      await app.request(`/api/leave-requests/${futureGroup[0]!.id}/approve`, { method: 'POST', headers: { cookie: owner } }, env)
    ).json()) as { id: string; calendarEventId: string }[]
    const okWithdraw = await app.request(`/api/leave-requests/${futureGroup[0]!.id}/withdraw`, { method: 'POST', headers: { cookie: pond } }, env)
    expect(okWithdraw.status).toBe(200)
    const withdrawn = (await okWithdraw.json()) as { status: string; calendarEventId: string | null }[]
    expect(withdrawn.every((r) => r.status === 'withdrawn' && r.calendarEventId === null)).toBe(true)

    const remainingEvents = await env.DB.prepare('SELECT COUNT(*) AS n FROM calendar_events WHERE id IN (?, ?)')
      .bind(approvedFuture[0]!.calendarEventId, approvedFuture[1]!.calendarEventId)
      .first<{ n: number }>()
    expect(remainingEvents!.n).toBe(0)
  })

  it('GET /pending แสดง 1 การ์ดต่อ 1 คำขอหลายช่วง ไม่ใช่ 2 แถวแยก', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (
      await app.request(
        '/api/leave-requests',
        leaveFormRanges(pond, sickTypeId, [
          { startDate: '2026-11-12', endDate: '2026-11-13' },
          { startDate: '2026-11-16', endDate: '2026-11-16' },
        ]),
        env,
      )
    ).json()) as { id: string; groupId: string }[]

    const owner = await loginAs(app, 'owner@example-co.test')
    const pending = (await (await app.request('/api/leave-requests/pending', { headers: { cookie: owner } }, env)).json()) as {
      rows: { groupId: string | null; ranges: unknown[] }[]
    }
    const matches = pending.rows.filter((r) => r.groupId === created[0]!.groupId)
    expect(matches).toHaveLength(1)
    expect(matches[0]!.ranges).toHaveLength(2)
  })

  it('คำขอช่วงเดียว (ปกติเดิม) — groupId เป็น null, response เป็น object เดี่ยวไม่ใช่ array', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const res = await app.request('/api/leave-requests', leaveForm(pond, { leaveTypeId: sickTypeId, startDate: '2026-09-22', endDate: '2026-09-22', reason: 'ปกติ' }), env)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; groupId: string | null }
    expect(Array.isArray(body)).toBe(false)
    expect(body.groupId).toBeNull()
  })
})
