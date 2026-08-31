import { addDaysISO, bkkDateOf, DEFAULT_PERMISSION_CEILINGS, type CeilingPermissions, type PermissionCategory } from '@seedoffice/core'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

// Pronista §Navbar enrichment (2026-08-27) — ค้นหาด่วนข้ามระบบจาก Topbar: owner เห็นทุกโปรเจกต์/งาน, role อื่นเห็นเฉพาะโปรเจกต์ที่ตัวเองเป็นสมาชิก

beforeEach(async () => {
  await seedUsers()
})

const json = (cookie: string, body: unknown) => ({ method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })

async function saveCeilings(cookie: string, ceilings: Record<PermissionCategory, CeilingPermissions>) {
  return app.request('/api/admin/permission-ceilings', { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ceilings }) }, env)
}
function grantMenu(category: PermissionCategory, menuKey: keyof CeilingPermissions['menus']): Record<PermissionCategory, CeilingPermissions> {
  return {
    staff: { ...DEFAULT_PERMISSION_CEILINGS.staff, menus: { ...DEFAULT_PERMISSION_CEILINGS.staff.menus, ...(category === 'staff' ? { [menuKey]: true } : {}) } },
    outsource: { ...DEFAULT_PERMISSION_CEILINGS.outsource, menus: { ...DEFAULT_PERMISSION_CEILINGS.outsource.menus, ...(category === 'outsource' ? { [menuKey]: true } : {}) } },
    customer: { ...DEFAULT_PERMISSION_CEILINGS.customer, menus: { ...DEFAULT_PERMISSION_CEILINGS.customer.menus, ...(category === 'customer' ? { [menuKey]: true } : {}) } },
    membership: { ...DEFAULT_PERMISSION_CEILINGS.membership, menus: { ...DEFAULT_PERMISSION_CEILINGS.membership.menus, ...(category === 'membership' ? { [menuKey]: true } : {}) } },
  }
}

describe('Pronista §Navbar enrichment (2026-08-27) — GET /api/search', () => {
  it('ไม่ login เรียกไม่ได้ (401)', async () => {
    expect((await app.request('/api/search?q=ab', {}, env)).status).toBe(401)
  })

  it('คำค้นสั้นกว่า 2 ตัว → คืนลิสต์ว่างทั้งคู่ ไม่ยิง query', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/search?q=a', { headers: { cookie: owner } }, env)).json()) as { projects: unknown[]; tasks: unknown[]; docs: unknown[]; people: unknown[] }
    expect(res).toEqual({ projects: [], tasks: [], docs: [], people: [] })
  })

  it('owner ค้นเจอทั้งโปรเจกต์และงานที่ไม่ได้เป็นสมาชิกด้วย (เห็นหมด)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = (await (await app.request('/api/projects', json(owner, { name: 'โปรเจกต์ค้นหาทดสอบ Zzq', type: 'project' }), env)).json()) as { id: string }
    const g = (await (await app.request(`/api/projects/${p.id}/groups`, json(owner, { name: 'G' }), env)).json()) as { id: string }
    await app.request(`/api/groups/${g.id}/tasks`, json(owner, { title: 'งานค้นหาทดสอบ Zzq' }), env)

    const res = (await (await app.request('/api/search?q=Zzq', { headers: { cookie: owner } }, env)).json()) as {
      projects: { name: string }[]
      tasks: { title: string; projectName: string | null }[]
    }
    expect(res.projects.some((r) => r.name.includes('Zzq'))).toBe(true)
    expect(res.tasks.some((r) => r.title.includes('Zzq') && r.projectName?.includes('Zzq'))).toBe(true)
  })

  it('member ไม่ได้เป็นสมาชิกโปรเจกต์นั้น → ค้นหาไม่เจอทั้งโปรเจกต์และงานในนั้น', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test') // ไม่ได้ถูกเพิ่มเป็นสมาชิก
    const p = (await (await app.request('/api/projects', json(owner, { name: 'โปรเจกต์ลับ Xyw', type: 'project' }), env)).json()) as { id: string }
    const g = (await (await app.request(`/api/projects/${p.id}/groups`, json(owner, { name: 'G' }), env)).json()) as { id: string }
    await app.request(`/api/groups/${g.id}/tasks`, json(owner, { title: 'งานลับ Xyw' }), env)

    const res = (await (await app.request('/api/search?q=Xyw', { headers: { cookie: pond } }, env)).json()) as { projects: unknown[]; tasks: unknown[] }
    expect(res.projects.length).toBe(0)
    expect(res.tasks.length).toBe(0)
  })

  it('member เป็นสมาชิกโปรเจกต์นั้น → ค้นหาเจอ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const p = (await (await app.request('/api/projects', json(owner, { name: 'โปรเจกต์ร่วม Wvu', type: 'project' }), env)).json()) as { id: string }
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_pond', positionId: 'pos_full_access' }), env)

    const res = (await (await app.request('/api/search?q=Wvu', { headers: { cookie: pond } }, env)).json()) as { projects: { name: string }[] }
    expect(res.projects.some((r) => r.name.includes('Wvu'))).toBe(true)
  })

  it('ค้นเอกสาร: team-visibility เห็นได้ทั้ง owner/member · vendor ไม่เห็นเลย', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    await app.request('/api/docs', json(owner, { title: 'คู่มือทีม Docteam' }), env) // default visibility = team

    const asOwner = (await (await app.request('/api/search?q=Docteam', { headers: { cookie: owner } }, env)).json()) as { docs: { title: string }[] }
    expect(asOwner.docs.some((d) => d.title.includes('Docteam'))).toBe(true)

    const asPond = (await (await app.request('/api/search?q=Docteam', { headers: { cookie: pond } }, env)).json()) as { docs: { title: string }[] }
    expect(asPond.docs.some((d) => d.title.includes('Docteam'))).toBe(true)

    const asVendor = (await (await app.request('/api/search?q=Docteam', { headers: { cookie: somchai } }, env)).json()) as { docs: unknown[] }
    expect(asVendor.docs.length).toBe(0)
  })

  it('ค้นเอกสาร private: member ที่ไม่ใช่เจ้าของ/ไม่ใช่สมาชิกเอกสาร → ไม่เห็น · เพิ่มเป็นสมาชิกแล้วเห็น', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const d = (await (await app.request('/api/docs', json(owner, { title: 'เอกสารลับ Docprv', visibility: 'private' }), env)).json()) as { id: string }

    const before = (await (await app.request('/api/search?q=Docprv', { headers: { cookie: pond } }, env)).json()) as { docs: unknown[] }
    expect(before.docs.length).toBe(0)

    await app.request(`/api/docs/${d.id}/members`, json(owner, { userId: 'u_pond', role: 'viewer' }), env)
    const after = (await (await app.request('/api/search?q=Docprv', { headers: { cookie: pond } }, env)).json()) as { docs: { title: string }[] }
    expect(after.docs.some((r) => r.title.includes('Docprv'))).toBe(true)
  })

  it('ค้นคน: owner เห็นทุกหมวด · non-owner หมวดตัวเองถูกปิดไว้เป็นค่าเริ่มต้น (เพดาน default) → ไม่เห็นเลย', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')

    const asOwner = (await (await app.request('/api/search?q=ปอนด์', { headers: { cookie: owner } }, env)).json()) as { people: { name: string }[] }
    expect(asOwner.people.some((p) => p.name === 'ปอนด์')).toBe(true)

    const asPond = (await (await app.request('/api/search?q=ปอนด์', { headers: { cookie: pond } }, env)).json()) as { people: unknown[] }
    expect(asPond.people.length).toBe(0)
  })

  it('ค้นคน: เปิดเพดานเมนู "employees" ให้หมวด staff แล้ว member เห็นเฉพาะหมวดตัวเอง (ไม่เห็น vendor)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const grant = await saveCeilings(owner, grantMenu('staff', 'employees'))
    expect(grant.status).toBe(200)

    const staffHit = (await (await app.request('/api/search?q=ปอนด์', { headers: { cookie: pond } }, env)).json()) as { people: { name: string }[] }
    expect(staffHit.people.some((p) => p.name === 'ปอนด์')).toBe(true)

    const vendorMiss = (await (await app.request('/api/search?q=สมชาย', { headers: { cookie: pond } }, env)).json()) as { people: unknown[] }
    expect(vendorMiss.people.length).toBe(0)
  })

  it('filter งาน: status/assigneeId/due กรองผลลัพธ์ได้ตรงตามเงื่อนไข', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = (await (await app.request('/api/projects', json(owner, { name: 'โปรเจกต์ Filt', type: 'project' }), env)).json()) as { id: string }
    const today = bkkDateOf(Date.now())
    const yesterday = addDaysISO(today, -1)
    const nextWeek = addDaysISO(today, 3)

    await app.request(`/api/projects/${p.id}/tasks`, json(owner, { title: 'งาน Filt เสร็จแล้ว', status: 'done', assigneeId: 'u_owner' }), env)
    await app.request(`/api/projects/${p.id}/tasks`, json(owner, { title: 'งาน Filt ค้างอยู่', status: 'on_processing', assigneeId: 'u_pond', dueDate: yesterday }), env)
    await app.request(`/api/projects/${p.id}/tasks`, json(owner, { title: 'งาน Filt สัปดาห์นี้', status: 'non_start', assigneeId: 'u_pond', dueDate: nextWeek }), env)

    const byStatus = (await (await app.request('/api/search?q=Filt&status=done', { headers: { cookie: owner } }, env)).json()) as { tasks: { title: string }[] }
    expect(byStatus.tasks).toHaveLength(1)
    expect(byStatus.tasks[0]?.title).toBe('งาน Filt เสร็จแล้ว')

    const byAssignee = (await (await app.request('/api/search?q=Filt&assigneeId=u_pond', { headers: { cookie: owner } }, env)).json()) as { tasks: { title: string }[] }
    expect(byAssignee.tasks.map((t) => t.title).sort()).toEqual(['งาน Filt ค้างอยู่', 'งาน Filt สัปดาห์นี้'].sort())

    const overdue = (await (await app.request('/api/search?q=Filt&due=overdue', { headers: { cookie: owner } }, env)).json()) as { tasks: { title: string }[] }
    expect(overdue.tasks).toHaveLength(1)
    expect(overdue.tasks[0]?.title).toBe('งาน Filt ค้างอยู่')

    const week = (await (await app.request('/api/search?q=Filt&due=week', { headers: { cookie: owner } }, env)).json()) as { tasks: { title: string }[] }
    expect(week.tasks).toHaveLength(1)
    expect(week.tasks[0]?.title).toBe('งาน Filt สัปดาห์นี้')
  })
})
