import { DEFAULT_PERMISSION_CEILINGS, type Position, type PositionPermissions } from '@seedoffice/core'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

beforeEach(async () => {
  await seedUsers()
})

async function createProject(cookie: string, body: Record<string, unknown>) {
  return app.request('/api/projects', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env)
}
async function assignPosition(cookie: string, projectId: string, userId: string, positionId: string) {
  return app.request(
    `/api/projects/${projectId}/members`,
    { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ userId, positionId }) },
    env,
  )
}
async function saveCeilings(cookie: string, ceilings: Record<string, PositionPermissions>) {
  return app.request(
    '/api/admin/permission-ceilings',
    { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ceilings }) },
    env,
  )
}
async function createTask(cookie: string, projectId: string, title: string) {
  return app.request(
    `/api/projects/${projectId}/tasks`,
    { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ title }) },
    env,
  )
}

describe('Pronista §System Requirements Update — /api/admin/permission-ceilings', () => {
  it('owner เห็น/แก้ได้ · member/vendor 403', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const member = await loginAs(app, 'pond@example-co.test')
    const vendor = await loginAs(app, 'somchai@example.com')

    expect((await app.request('/api/admin/permission-ceilings', { headers: { cookie: owner } }, env)).status).toBe(200)
    expect((await app.request('/api/admin/permission-ceilings', { headers: { cookie: member } }, env)).status).toBe(403)
    expect((await app.request('/api/admin/permission-ceilings', { headers: { cookie: vendor } }, env)).status).toBe(403)
  })

  it('ค่าเริ่มต้น = staff เข้าถึงเต็ม · outsource/customer ดูอย่างเดียว (lossless เหมือนพฤติกรรมเดิม)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/admin/permission-ceilings', { headers: { cookie: owner } }, env)).json()) as {
      ceilings: Record<string, PositionPermissions>
    }
    expect(res.ceilings.staff).toEqual(DEFAULT_PERMISSION_CEILINGS.staff)
    expect(res.ceilings.outsource).toEqual(DEFAULT_PERMISSION_CEILINGS.outsource)
    expect(res.ceilings.customer).toEqual(DEFAULT_PERMISSION_CEILINGS.customer)
  })

  it('เพดาน staff จำกัดสิทธิ์ตำแหน่งได้ — ตำแหน่ง full access + เพดานปิด task.create → สร้าง Task ไม่ได้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = (await (await createProject(owner, { name: 'P ceiling staff', type: 'project' })).json()) as { id: string }
    await assignPosition(owner, p.id, 'u_pond', 'pos_full_access')
    const member = await loginAs(app, 'pond@example-co.test')

    // ก่อนตั้งเพดาน — ตำแหน่ง full access สร้าง Task ได้ปกติ
    expect((await createTask(member, p.id, 'งานก่อนตั้งเพดาน')).status).toBe(201)

    const restrictedCeilings = {
      ...DEFAULT_PERMISSION_CEILINGS,
      staff: { ...DEFAULT_PERMISSION_CEILINGS.staff, actions: { ...DEFAULT_PERMISSION_CEILINGS.staff.actions, task: { create: false, edit: true, delete: true } } },
    }
    expect((await saveCeilings(owner, restrictedCeilings)).status).toBe(200)

    // หลังตั้งเพดาน — แม้ตำแหน่งยังเป็น full access ก็สร้าง Task ไม่ได้ (เพดานคูณจำกัดอีกชั้น)
    const denied = await createTask(member, p.id, 'งานที่ควรโดนเพดานกัน')
    expect(denied.status).toBe(403)
  })

  it('outsource/customer ไม่มีตำแหน่งของตัวเอง — เพดานคือสิทธิ์จริงเลย (สะท้อนใน myPermissions ของ GET /api/projects/:id)', async () => {
    // หมายเหตุ: การ "สร้าง/แก้/ลบ" ของ vendor/guest ยังโดนกันที่ teamOnly (requireRole owner/member) เสมออยู่แล้ว
    // ไม่ว่าเพดานจะตั้งยังไง — เพดานของ 2 หมวดนี้จึงมีผลจริงแค่กับ myPermissions ที่ frontend ใช้โชว์/ซ่อนเมนู ไม่ใช่ปลดล็อกการเขียนที่ backend
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = (await (await createProject(owner, { name: 'P ceiling outsource', type: 'project' })).json()) as { id: string }
    const vendor = await loginAs(app, 'somchai@example.com')

    const before = (await (await app.request(`/api/projects/${p.id}`, { headers: { cookie: vendor } }, env)).json()) as {
      myPermissions: PositionPermissions
    }
    expect(before.myPermissions.actions.task.create).toBe(false)
    expect(before.myPermissions.tabs.docs).toBe(true) // default outsource ceiling = view-only ทุกแท็บมองเห็นได้ แค่แก้ไม่ได้

    const raisedCeilings = {
      ...DEFAULT_PERMISSION_CEILINGS,
      outsource: { ...DEFAULT_PERMISSION_CEILINGS.outsource, actions: { ...DEFAULT_PERMISSION_CEILINGS.outsource.actions, task: { create: true, edit: true, delete: false } } },
    }
    await saveCeilings(owner, raisedCeilings)

    const after = (await (await app.request(`/api/projects/${p.id}`, { headers: { cookie: vendor } }, env)).json()) as {
      myPermissions: PositionPermissions
    }
    expect(after.myPermissions.actions.task.create).toBe(true)

    // แต่ POST จริงยังโดนกันที่ teamOnly เสมอ — เพดานไม่ปลดล็อกจุดนี้ (คนละชั้นกัน)
    expect((await createTask(vendor, p.id, 'งานที่ vendor ยังสร้างไม่ได้เพราะ teamOnly')).status).toBe(403)
  })

  it('owner bypass เพดานเสมอ ไม่ว่าจะตั้งเพดานเข้มแค่ไหน', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = (await (await createProject(owner, { name: 'P ceiling owner bypass', type: 'project' })).json()) as { id: string }

    const denyAll: Position['permissions'] = { ...DEFAULT_PERMISSION_CEILINGS.staff, tabs: Object.fromEntries(Object.keys(DEFAULT_PERMISSION_CEILINGS.staff.tabs).map((k) => [k, false])) as typeof DEFAULT_PERMISSION_CEILINGS.staff.tabs }
    await saveCeilings(owner, { staff: denyAll, outsource: denyAll, customer: denyAll })

    expect((await createTask(owner, p.id, 'งาน owner ต้องสร้างได้เสมอ')).status).toBe(201)
  })
})

describe('Pronista §System Requirements Update — /api/admin/positions (regression กันเพดานทำ default ตำแหน่งพัง)', () => {
  it('ยังใช้ DEFAULT_POSITIONS ได้ปกติเมื่อยังไม่เคยตั้งเพดาน', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/admin/positions', { headers: { cookie: owner } }, env)).json()) as { positions: Position[] }
    expect(res.positions.map((p) => p.id).sort()).toEqual(['pos_full_access', 'pos_view_only'])
  })
})
