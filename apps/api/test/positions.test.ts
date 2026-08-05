import { DEFAULT_POSITIONS, VIEW_ONLY_PERMISSIONS, type Position } from '@seedoffice/core'
import { createDb, projectMembers } from '@seedoffice/db'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
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
async function savePositions(cookie: string, positions: Position[]) {
  return app.request(
    '/api/admin/positions',
    { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ positions }) },
    env,
  )
}

describe('Pronista §Position-based permission — /api/admin/positions', () => {
  it('owner เห็น/แก้แคตตาล็อกได้ · member/vendor 403', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const member = await loginAs(app, 'pond@example-co.test')
    const vendor = await loginAs(app, 'somchai@example.com')

    expect((await app.request('/api/admin/positions', { headers: { cookie: owner } }, env)).status).toBe(200)
    expect((await app.request('/api/admin/positions', { headers: { cookie: member } }, env)).status).toBe(403)
    expect((await app.request('/api/admin/positions', { headers: { cookie: vendor } }, env)).status).toBe(403)
  })

  it('ค่าเริ่มต้น = 2 ตำแหน่ง (เข้าถึงเต็มรูปแบบ/ดูอย่างเดียว)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/admin/positions', { headers: { cookie: owner } }, env)).json()) as { positions: Position[] }
    expect(res.positions.map((p) => p.id).sort()).toEqual(['pos_full_access', 'pos_view_only'])
  })

  it('กันลบตำแหน่งที่ยังมีสมาชิกโปรเจกต์ใช้อยู่ (409)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = (await (await createProject(owner, { name: 'P orphan', type: 'project' })).json()) as { id: string }
    expect((await assignPosition(owner, p.id, 'u_pond', 'pos_view_only')).status).toBe(200)

    // ลบ pos_view_only ออกจากลิสต์ที่จะบันทึก (เหลือแค่ pos_full_access) — ต้องโดนกันไว้
    const res = await savePositions(owner, [DEFAULT_POSITIONS[0]!])
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('position_in_use')
  })

  it('สร้างตำแหน่งใหม่แบบ checkbox ละเอียด แล้ว assign ต่อโปรเจกต์ได้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const custom: Position = {
      id: 'pos_ba',
      name: 'BA',
      sortOrder: 2,
      permissions: {
        ...VIEW_ONLY_PERMISSIONS,
        actions: { ...VIEW_ONLY_PERMISSIONS.actions, task: { create: false, edit: true, delete: false } },
      },
    }
    const saveRes = await savePositions(owner, [...DEFAULT_POSITIONS, custom])
    expect(saveRes.status).toBe(200)

    const p = (await (await createProject(owner, { name: 'P custom', type: 'project' })).json()) as { id: string }
    expect((await assignPosition(owner, p.id, 'u_pond', 'pos_ba')).status).toBe(200)

    const member = await loginAs(app, 'pond@example-co.test')
    const detail = (await (await app.request(`/api/projects/${p.id}`, { headers: { cookie: member } }, env)).json()) as {
      myRole: string
      myPermissions: { actions: { task: { create: boolean; edit: boolean; delete: boolean } } }
    }
    // hasAnyEditRight ต้องเป็น true (edit:true) → myRole ต้อง derive เป็น 'editor' แม้ create/delete เป็น false ทั้งคู่
    expect(detail.myRole).toBe('editor')
    expect(detail.myPermissions.actions.task).toEqual({ create: false, edit: true, delete: false })
  })
})

describe('Pronista §Position-based permission — flagship: actions.task.create/edit/delete', () => {
  it('ตำแหน่งที่ actions.task.create=false → สร้าง Task ไม่ได้ (403) · true → สร้างได้ (201)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const noCreate: Position = {
      id: 'pos_no_create',
      name: 'ห้ามสร้าง Task',
      sortOrder: 2,
      permissions: {
        ...VIEW_ONLY_PERMISSIONS,
        actions: { ...VIEW_ONLY_PERMISSIONS.actions, task: { create: false, edit: true, delete: true } },
      },
    }
    await savePositions(owner, [...DEFAULT_POSITIONS, noCreate])
    const p = (await (await createProject(owner, { name: 'P flagship', type: 'project' })).json()) as { id: string }
    await assignPosition(owner, p.id, 'u_pond', 'pos_no_create')
    const member = await loginAs(app, 'pond@example-co.test')

    const denied = await app.request(
      `/api/projects/${p.id}/tasks`,
      { method: 'POST', headers: { cookie: member, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'งานที่ควรสร้างไม่ได้' }) },
      env,
    )
    expect(denied.status).toBe(403)

    await assignPosition(owner, p.id, 'u_pond', 'pos_full_access')
    const allowed = await app.request(
      `/api/projects/${p.id}/tasks`,
      { method: 'POST', headers: { cookie: member, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'งานที่ควรสร้างได้' }) },
      env,
    )
    expect(allowed.status).toBe(201)
  })
})

describe('Pronista §Position-based permission — regression: derive อัตโนมัติที่ endpoint เก่า', () => {
  it('ตำแหน่งไม่มี edit right เลย (hasAnyEditRight=false) ต้องโดน 403 ที่ POST epics ด้วย (canEditProject เดิม derive จากตำแหน่งอัตโนมัติ)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = (await (await createProject(owner, { name: 'P regression', type: 'project' })).json()) as { id: string }
    await assignPosition(owner, p.id, 'u_pond', 'pos_view_only')
    const member = await loginAs(app, 'pond@example-co.test')

    const res = await app.request(
      `/api/projects/${p.id}/epics`,
      { method: 'POST', headers: { cookie: member, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Epic ใหม่' }) },
      env,
    )
    expect(res.status).toBe(403)

    await assignPosition(owner, p.id, 'u_pond', 'pos_full_access')
    const res2 = await app.request(
      `/api/projects/${p.id}/epics`,
      { method: 'POST', headers: { cookie: member, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Epic ใหม่' }) },
      env,
    )
    expect(res2.status).toBe(201)
  })

  it('vendor ไม่ถูกกระทบไม่ว่าแคตตาล็อกตำแหน่งจะตั้งยังไง (myRole/myPermissions คงที่)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const allTrue: Position = {
      id: 'pos_god_mode',
      name: 'God mode',
      sortOrder: 9,
      permissions: {
        tabs: Object.fromEntries(Object.keys(VIEW_ONLY_PERMISSIONS.tabs).map((k) => [k, true])) as typeof VIEW_ONLY_PERMISSIONS.tabs,
        actions: Object.fromEntries(
          Object.keys(VIEW_ONLY_PERMISSIONS.actions).map((k) => [k, { create: true, edit: true, delete: true }]),
        ) as typeof VIEW_ONLY_PERMISSIONS.actions,
      },
    }
    await savePositions(owner, [...DEFAULT_POSITIONS, allTrue])
    const p = (await (await createProject(owner, { name: 'P vendor', type: 'project' })).json()) as { id: string }
    const vendor = await loginAs(app, 'somchai@example.com')
    const detail = (await (await app.request(`/api/projects/${p.id}`, { headers: { cookie: vendor } }, env)).json()) as {
      myRole: string
      myPermissions: { actions: { task: { create: boolean } } }
    }
    expect(detail.myRole).toBe('viewer')
    expect(detail.myPermissions.actions.task.create).toBe(false)
  })

  it('owner bypass เสมอ ไม่ต้อง assign ตำแหน่ง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = (await (await createProject(owner, { name: 'P owner', type: 'project' })).json()) as { id: string }
    const detail = (await (await app.request(`/api/projects/${p.id}`, { headers: { cookie: owner } }, env)).json()) as {
      myRole: string
      myPermissions: { actions: { task: { create: boolean; edit: boolean; delete: boolean } } }
    }
    expect(detail.myRole).toBe('owner')
    expect(detail.myPermissions.actions.task).toEqual({ create: true, edit: true, delete: true })
  })
})

describe('Pronista §Position-based permission — DB sanity', () => {
  it('backfill migration 0060: project_members ที่ role เดิมถูกแปลงเป็น positionId ถูกต้อง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = (await (await createProject(owner, { name: 'P backfill', type: 'project' })).json()) as { id: string }
    await assignPosition(owner, p.id, 'u_pond', 'pos_full_access')
    const db = createDb(env.DB)
    const row = (await db.select().from(projectMembers).where(eq(projectMembers.projectId, p.id)))[0]
    expect(row?.positionId).toBe('pos_full_access')
  })
})
