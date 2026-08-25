/**
 * Pronista §Menu Restructure — เพดานเมนู employees/partners/customers/members
 * เดิม /api/admin/users* และ /api/members* เป็น owner-only ล้วนๆ ตอนนี้ non-owner (staff/outsource/customer)
 * เข้าได้ถ้าเพดานเมนูของหมวดตัวเองอนุญาต แต่ scope เห็น/แก้ได้เฉพาะ record ในหมวดเดียวกัน + ห้ามแตะ role/status/email/สร้างบัญชีใหม่
 */
import { DEFAULT_PERMISSION_CEILINGS, type CeilingPermissions, type PermissionCategory } from '@seedoffice/core'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

beforeEach(async () => {
  await seedUsers()
})

async function saveCeilings(cookie: string, ceilings: Record<PermissionCategory, CeilingPermissions>) {
  return app.request(
    '/api/admin/permission-ceilings',
    { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ceilings }) },
    env,
  )
}
function grantMenu(category: PermissionCategory, menuKey: keyof CeilingPermissions['menus']): Record<PermissionCategory, CeilingPermissions> {
  return {
    staff: { ...DEFAULT_PERMISSION_CEILINGS.staff, menus: { ...DEFAULT_PERMISSION_CEILINGS.staff.menus, ...(category === 'staff' ? { [menuKey]: true } : {}) } },
    outsource: { ...DEFAULT_PERMISSION_CEILINGS.outsource, menus: { ...DEFAULT_PERMISSION_CEILINGS.outsource.menus, ...(category === 'outsource' ? { [menuKey]: true } : {}) } },
    customer: { ...DEFAULT_PERMISSION_CEILINGS.customer, menus: { ...DEFAULT_PERMISSION_CEILINGS.customer.menus, ...(category === 'customer' ? { [menuKey]: true } : {}) } },
    membership: { ...DEFAULT_PERMISSION_CEILINGS.membership, menus: { ...DEFAULT_PERMISSION_CEILINGS.membership.menus, ...(category === 'membership' ? { [menuKey]: true } : {}) } },
  }
}

describe('§Menu Restructure — /api/admin/users scope ตามเพดาน employees/partners/customers', () => {
  it('ค่าเริ่มต้น (ยังไม่ตั้งเพดาน) — member เห็น /api/admin/users ไม่ได้เหมือนเดิม', async () => {
    const member = await loginAs(app, 'pond@example-co.test')
    expect((await app.request('/api/admin/users', { headers: { cookie: member } }, env)).status).toBe(403)
  })

  it('เปิดเพดาน staff.menus.employees=true — member เห็นได้ แต่เห็นเฉพาะ record หมวด staff (owner/member) ไม่เห็น vendor/guest', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    expect((await saveCeilings(owner, grantMenu('staff', 'employees'))).status).toBe(200)

    const member = await loginAs(app, 'pond@example-co.test')
    const res = await app.request('/api/admin/users', { headers: { cookie: member } }, env)
    expect(res.status).toBe(200)
    const list = (await res.json()) as { role: string }[]
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((u) => u.role === 'owner' || u.role === 'member')).toBe(true)
  })

  it('member ที่ได้เพดาน employees เปิดดู record vendor ทาง /users/:id โดยตรงไม่ได้ (403 กันเดา id ข้ามหมวด)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await saveCeilings(owner, grantMenu('staff', 'employees'))
    const member = await loginAs(app, 'pond@example-co.test')
    expect((await app.request('/api/admin/users/u_somchai', { headers: { cookie: member } }, env)).status).toBe(403)
    // แต่ดู record หมวดตัวเองได้ปกติ
    expect((await app.request('/api/admin/users/u_pond', { headers: { cookie: member } }, env)).status).toBe(200)
  })

  it('member ที่ได้เพดาน employees แก้ฟิลด์โปรไฟล์ปกติ (phone) ของคนหมวดเดียวกันได้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await saveCeilings(owner, grantMenu('staff', 'employees'))
    const member = await loginAs(app, 'pond@example-co.test')
    const res = await app.request(
      '/api/admin/users/u_pond',
      { method: 'PATCH', headers: { cookie: member, 'content-type': 'application/json' }, body: JSON.stringify({ phone: '0812345678' }) },
      env,
    )
    expect(res.status).toBe(200)
  })

  it('member ที่ได้เพดาน employees แก้ role/status/email ไม่ได้เด็ดขาด (403) — กัน privilege escalation', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await saveCeilings(owner, grantMenu('staff', 'employees'))
    const member = await loginAs(app, 'pond@example-co.test')
    const tryPatch = (body: Record<string, unknown>) =>
      app.request(
        '/api/admin/users/u_pond',
        { method: 'PATCH', headers: { cookie: member, 'content-type': 'application/json' }, body: JSON.stringify(body) },
        env,
      )
    expect((await tryPatch({ role: 'owner' })).status).toBe(403)
    expect((await tryPatch({ status: 'disabled' })).status).toBe(403)
    expect((await tryPatch({ email: 'new@example-co.test' })).status).toBe(403)
  })

  it('member ที่ได้เพดาน employees สร้างบัญชีใหม่ไม่ได้ (POST ยัง owner-only เสมอ)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await saveCeilings(owner, grantMenu('staff', 'employees'))
    const member = await loginAs(app, 'pond@example-co.test')
    const res = await app.request(
      '/api/admin/users',
      { method: 'POST', headers: { cookie: member, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@example-co.test', name: 'x', role: 'member' }) },
      env,
    )
    expect(res.status).toBe(403)
  })

  it('เปิดเพดาน outsource.menus.partners=true ให้ vendor — vendor เห็น record หมวด outsource เท่านั้น (ไม่เห็น staff/customer)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await saveCeilings(owner, grantMenu('outsource', 'partners'))
    const vendor = await loginAs(app, 'somchai@example.com')
    const res = await app.request('/api/admin/users', { headers: { cookie: vendor } }, env)
    expect(res.status).toBe(200)
    const list = (await res.json()) as { role: string }[]
    expect(list.every((u) => u.role === 'vendor')).toBe(true)
    // ไม่ได้เพดาน employees ด้วย จะเปิด record staff ไม่ได้
    expect((await app.request('/api/admin/users/u_pond', { headers: { cookie: vendor } }, env)).status).toBe(403)
  })

  it('GET /api/admin/teams เปิดให้ authenticated ทุก role อ่านได้ (ชื่อทีมไม่ sensitive) แต่ POST ยัง owner-only', async () => {
    const member = await loginAs(app, 'pond@example-co.test')
    expect((await app.request('/api/admin/teams', { headers: { cookie: member } }, env)).status).toBe(200)
    expect(
      (await app.request('/api/admin/teams', { method: 'POST', headers: { cookie: member, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ทีมใหม่' }) }, env)).status,
    ).toBe(403)
  })

  it('endpoint owner-only อื่นใต้ /api/admin ยังปิดสนิทแม้เปิดเพดาน employees ให้ staff แล้ว (เช่น /api/admin/config)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await saveCeilings(owner, grantMenu('staff', 'employees'))
    const member = await loginAs(app, 'pond@example-co.test')
    expect((await app.request('/api/admin/config', { headers: { cookie: member } }, env)).status).toBe(403)
  })
})

describe('§Menu Restructure — /api/members* ตามเพดาน members', () => {
  it('ค่าเริ่มต้น (ยังไม่ตั้งเพดาน) — member เข้า /api/members ไม่ได้', async () => {
    const member = await loginAs(app, 'pond@example-co.test')
    expect((await app.request('/api/members', { headers: { cookie: member } }, env)).status).toBe(403)
  })

  it('เปิดเพดาน staff.menus.members=true — member ใช้งาน members ได้เต็ม (list + create) เพราะ members ไม่มี role ให้ escalate', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await saveCeilings(owner, grantMenu('staff', 'members'))
    const member = await loginAs(app, 'pond@example-co.test')
    expect((await app.request('/api/members', { headers: { cookie: member } }, env)).status).toBe(200)
    const created = await app.request(
      '/api/members',
      { method: 'POST', headers: { cookie: member, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'สมาชิกทดสอบ', classificationType: 'ordinary_individual' }) },
      env,
    )
    expect(created.status).toBe(201)
  })
})
