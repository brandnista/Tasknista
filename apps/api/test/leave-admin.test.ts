import { leaveTypes, createDb } from '@seedoffice/db'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

const json = (cookie: string, body: unknown, method = 'POST') => ({
  method,
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

let sickTypeId: string

beforeEach(async () => {
  await seedUsers()
  const db = createDb(env.DB)
  // ลำดับสำคัญ — leave_balance_adjustments/leave_requests อ้าง leave_types (FK) ต้องลบก่อน ไม่งั้น DELETE leave_types ชน constraint
  // Pronista §Notification Badge Audit เฟส 6b (2026-09-24) — notifications.leave_request_id อ้าง leave_requests แล้ว ต้องลบ notifications ก่อนด้วย ไม่งั้น DELETE leave_requests ชน FK
  await env.DB.prepare('DELETE FROM notifications').run()
  await env.DB.prepare('DELETE FROM leave_balance_adjustments').run()
  await env.DB.prepare('DELETE FROM leave_requests').run()
  await env.DB.prepare('DELETE FROM leave_types').run()
  await env.DB.prepare('DELETE FROM calendar_events').run()
  const sick = (await db.insert(leaveTypes).values({ name: 'ลาป่วย', requiresReason: true, requiresAttachment: false, quotaDaysByRole: { owner: 30, member: 30, vendor: 10 }, sortOrder: 1 }).returning())[0]!
  sickTypeId = sick.id
})

describe('§Leave Request Phase 2 — leave-admin (owner only)', () => {
  it('member/vendor โดน 403 ทุก endpoint ใต้ /api/leave-admin', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const vendor = await loginAs(app, 'somchai@example.com')
    for (const cookie of [pond, vendor]) {
      expect((await app.request('/api/leave-admin/types', { headers: { cookie } }, env)).status).toBe(403)
      expect((await app.request('/api/leave-admin/overview', { headers: { cookie } }, env)).status).toBe(403)
      expect((await app.request('/api/leave-admin/adjustments', json(cookie, { userId: 'u_pond', leaveTypeId: sickTypeId, year: '2026', days: 1 }), env)).status).toBe(403)
    }
  })

  it('GET /types (admin) คืนทุกประเภทรวม inactive', async () => {
    const db = createDb(env.DB)
    await db.insert(leaveTypes).values({ name: 'ปิดใช้งานแล้ว', active: false })
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/leave-admin/types', { headers: { cookie: owner } }, env)).json()) as { types: { name: string; active: boolean }[] }
    expect(res.types.map((t) => t.name)).toContain('ปิดใช้งานแล้ว')
    expect(res.types.some((t) => !t.active)).toBe(true)
  })

  it('POST /types สร้างประเภทใหม่ได้ + PATCH แก้ไข/ปิดใช้งานได้ (soft-delete)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const created = await app.request('/api/leave-admin/types', json(owner, { name: 'ลากิจ', icon: 'briefcase', requiresReason: true, requiresAttachment: false, quotaDaysByRole: { member: 3 }, sortOrder: 2 }), env)
    expect(created.status).toBe(201)
    const type = (await created.json()) as { id: string; active: boolean }
    expect(type.active).toBe(true)

    const patched = await app.request(`/api/leave-admin/types/${type.id}`, json(owner, { active: false }, 'PATCH'), env)
    expect(patched.status).toBe(200)
    expect(((await patched.json()) as { active: boolean }).active).toBe(false)

    // ยังอยู่ในตาราง (ไม่ถูกลบจริง) — เช็คว่า GET /types (admin) ยังเห็นแถวนี้
    const listRes = (await (await app.request('/api/leave-admin/types', { headers: { cookie: owner } }, env)).json()) as { types: { id: string }[] }
    expect(listRes.types.map((t) => t.id)).toContain(type.id)
  })

  it('GET /overview คำนวณ matrix ถูกต้อง รวมยอด adjustment', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const year = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 4)

    const fd = new FormData()
    fd.append('leaveTypeId', sickTypeId)
    fd.append('ranges', JSON.stringify([{ startDate: `${year}-01-10`, endDate: `${year}-01-11` }]))
    fd.append('reason', 'ทดสอบ overview')
    const created = (await (await app.request('/api/leave-requests', { method: 'POST', headers: { cookie: pond }, body: fd }, env)).json()) as { id: string }
    await app.request(`/api/leave-requests/${created.id}/approve`, { method: 'POST', headers: { cookie: owner } }, env)
    await app.request('/api/leave-admin/adjustments', json(owner, { userId: 'u_pond', leaveTypeId: sickTypeId, year, days: 5, note: 'backfill' }), env)

    const overview = (await (await app.request('/api/leave-admin/overview', { headers: { cookie: owner } }, env)).json()) as {
      users: { id: string; name: string }[]
      types: { id: string; name: string }[]
      cells: { userId: string; leaveTypeId: string; quota: number | null; remain: number | null; waiting: number }[]
    }
    expect(overview.users.map((u) => u.id)).toContain('u_pond')
    expect(overview.types.map((t) => t.id)).toContain(sickTypeId)
    const cell = overview.cells.find((c) => c.userId === 'u_pond' && c.leaveTypeId === sickTypeId)!
    expect(cell.quota).toBe(30)
    expect(cell.remain).toBe(23) // 30 - (2 วันอนุมัติ + 5 adjustment)
  })

  it('POST /adjustments เขียน audit log + GET /adjustments กรองได้ + DELETE ลบได้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const year = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 4)
    const created = await app.request('/api/leave-admin/adjustments', json(owner, { userId: 'u_pond', leaveTypeId: sickTypeId, year, days: 3, note: 'backfill ก่อนขึ้นระบบ' }), env)
    expect(created.status).toBe(201)
    const adj = (await created.json()) as { id: string }

    const auditRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id = ? AND action = 'leave_balance_adjustment.create'").bind(adj.id).first<{ n: number }>()
    expect(auditRow?.n).toBe(1)

    const list = (await (await app.request(`/api/leave-admin/adjustments?userId=u_pond&leaveTypeId=${sickTypeId}&year=${year}`, { headers: { cookie: owner } }, env)).json()) as {
      rows: { id: string; createdByName: string | null }[]
    }
    expect(list.rows.map((r) => r.id)).toContain(adj.id)
    expect(list.rows.find((r) => r.id === adj.id)?.createdByName).toBe('เมธ')

    const deleted = await app.request(`/api/leave-admin/adjustments/${adj.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)
    expect(deleted.status).toBe(200)
    const listAfter = (await (await app.request(`/api/leave-admin/adjustments?userId=u_pond`, { headers: { cookie: owner } }, env)).json()) as { rows: { id: string }[] }
    expect(listAfter.rows.map((r) => r.id)).not.toContain(adj.id)
  })

  it('POST /adjustments days=0 → 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request('/api/leave-admin/adjustments', json(owner, { userId: 'u_pond', leaveTypeId: sickTypeId, year: '2026', days: 0 }), env)
    expect(res.status).toBe(400)
  })
})
