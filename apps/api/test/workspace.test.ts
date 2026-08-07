import { VIEW_ONLY_PERMISSIONS, type Position } from '@seedoffice/core'
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
async function savePositions(cookie: string, positions: Position[]) {
  return app.request(
    '/api/admin/positions',
    { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ positions }) },
    env,
  )
}
async function createBacklogTask(cookie: string, projectId: string, title: string) {
  return app.request(
    `/api/projects/${projectId}/backlog`,
    { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ title, kind: 'backlog' }) },
    env,
  )
}

describe('Pronista §Workspace — /api/workspace/accessible-projects', () => {
  it('owner เห็นทุกโปรเจกต์เสมอ ไม่ต้อง assign ตำแหน่ง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const a = (await (await createProject(owner, { name: 'WS A', type: 'project' })).json()) as { id: string }
    const b = (await (await createProject(owner, { name: 'WS B', type: 'project' })).json()) as { id: string }
    const res = await app.request('/api/workspace/accessible-projects', { headers: { cookie: owner } }, env)
    expect(res.status).toBe(200)
    const list = (await res.json()) as { id: string }[]
    const ids = new Set(list.map((p) => p.id))
    expect(ids.has(a.id)).toBe(true)
    expect(ids.has(b.id)).toBe(true)
  })

  it('member เห็นเฉพาะโปรเจกต์ที่ตำแหน่งเปิด tabs.sprint=true เท่านั้น', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const noSprintTab: Position = {
      id: 'pos_no_sprint_tab',
      name: 'ไม่เห็น Sprint',
      sortOrder: 2,
      permissions: { ...VIEW_ONLY_PERMISSIONS, tabs: { ...VIEW_ONLY_PERMISSIONS.tabs, sprint: false } },
    }
    const saveRes = await savePositions(owner, [...(await (await app.request('/api/admin/positions', { headers: { cookie: owner } }, env)).json() as { positions: Position[] }).positions, noSprintTab])
    expect(saveRes.status).toBe(200)

    const hidden = (await (await createProject(owner, { name: 'WS Hidden', type: 'project' })).json()) as { id: string }
    const visible = (await (await createProject(owner, { name: 'WS Visible', type: 'project' })).json()) as { id: string }
    await assignPosition(owner, hidden.id, 'u_pond', 'pos_no_sprint_tab')
    await assignPosition(owner, visible.id, 'u_pond', 'pos_full_access')

    const member = await loginAs(app, 'pond@example-co.test')
    const list = (await (await app.request('/api/workspace/accessible-projects', { headers: { cookie: member } }, env)).json()) as { id: string }[]
    const ids = new Set(list.map((p) => p.id))
    expect(ids.has(hidden.id)).toBe(false)
    expect(ids.has(visible.id)).toBe(true)
  })
})

describe('Pronista §Workspace — /api/workspace/backlog', () => {
  it('รวม backlog หลายโปรเจกต์ ติด projectId/projectName ถูกต้อง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const a = (await (await createProject(owner, { name: 'WS Backlog A', type: 'project' })).json()) as { id: string }
    const b = (await (await createProject(owner, { name: 'WS Backlog B', type: 'project' })).json()) as { id: string }
    await createBacklogTask(owner, a.id, 'งาน A1')
    await createBacklogTask(owner, b.id, 'งาน B1')

    const res = (await (await app.request(`/api/workspace/backlog?projectIds=${a.id},${b.id}`, { headers: { cookie: owner } }, env)).json()) as {
      tasksByProject: { projectId: string; projectName: string; tasks: { title: string }[] }[]
    }
    const groupA = res.tasksByProject.find((g) => g.projectId === a.id)
    const groupB = res.tasksByProject.find((g) => g.projectId === b.id)
    expect(groupA?.projectName).toBe('WS Backlog A')
    expect(groupA?.tasks.map((t) => t.title)).toEqual(['งาน A1'])
    expect(groupB?.tasks.map((t) => t.title)).toEqual(['งาน B1'])
  })

  it('projectIds narrow ได้ แต่ escalate เกินสิทธิ์ไม่ได้ — id ที่ไม่มีสิทธิ์เห็น ถูกกรองทิ้งเงียบๆ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const noAccess: Position = {
      id: 'pos_no_access_ws',
      name: 'ไม่มีสิทธิ์',
      sortOrder: 3,
      permissions: { ...VIEW_ONLY_PERMISSIONS, tabs: { ...VIEW_ONLY_PERMISSIONS.tabs, sprint: false } },
    }
    await savePositions(owner, [...(await (await app.request('/api/admin/positions', { headers: { cookie: owner } }, env)).json() as { positions: Position[] }).positions, noAccess])

    const forbidden = (await (await createProject(owner, { name: 'WS Forbidden', type: 'project' })).json()) as { id: string }
    const allowed = (await (await createProject(owner, { name: 'WS Allowed', type: 'project' })).json()) as { id: string }
    await assignPosition(owner, forbidden.id, 'u_pond', 'pos_no_access_ws')
    await assignPosition(owner, allowed.id, 'u_pond', 'pos_full_access')
    await createBacklogTask(owner, forbidden.id, 'งานที่ member ไม่ควรเห็น')
    await createBacklogTask(owner, allowed.id, 'งานที่ member เห็นได้')

    const member = await loginAs(app, 'pond@example-co.test')
    // ขอ projectIds ทั้งสอง (รวม forbidden ที่ตัวเองไม่มีสิทธิ์) — server ต้องกรอง forbidden ทิ้ง ไม่คืนข้อมูลของโปรเจกต์นั้น
    const res = (await (await app.request(`/api/workspace/backlog?projectIds=${forbidden.id},${allowed.id}`, { headers: { cookie: member } }, env)).json()) as {
      tasksByProject: { projectId: string }[]
    }
    const ids = new Set(res.tasksByProject.map((g) => g.projectId))
    expect(ids.has(forbidden.id)).toBe(false)
    expect(ids.has(allowed.id)).toBe(true)
  })
})

describe('Pronista §Workspace — /api/workspace/board', () => {
  it('รวม sprint หลายโปรเจกต์ ติด projectId ถูกต้อง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const a = (await (await createProject(owner, { name: 'WS Board A', type: 'project' })).json()) as { id: string }
    const b = (await (await createProject(owner, { name: 'WS Board B', type: 'project' })).json()) as { id: string }
    const sprintA = (await (await app.request(`/api/projects/${a.id}/sprints`, { method: 'POST', headers: { cookie: owner } }, env)).json()) as { id: string }
    const sprintB = (await (await app.request(`/api/projects/${b.id}/sprints`, { method: 'POST', headers: { cookie: owner } }, env)).json()) as { id: string }

    const res = (await (await app.request(`/api/workspace/board?projectIds=${a.id},${b.id}`, { headers: { cookie: owner } }, env)).json()) as {
      sprints: { sprint: { id: string }; projectId: string }[]
    }
    const found = new Map(res.sprints.map((s) => [s.sprint.id, s.projectId]))
    expect(found.get(sprintA.id)).toBe(a.id)
    expect(found.get(sprintB.id)).toBe(b.id)
  })

  it('regression: ลากงานข้ามโปรเจกต์เข้า sprint ยังโดน not_in_backlog (กำแพงเดิมไม่ถูกแตะ) — งาน/sprint ถูกค้นพบผ่าน workspace endpoint', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const a = (await (await createProject(owner, { name: 'WS Guard A', type: 'project' })).json()) as { id: string }
    const b = (await (await createProject(owner, { name: 'WS Guard B', type: 'project' })).json()) as { id: string }
    const sprintA = (await (await app.request(`/api/projects/${a.id}/sprints`, { method: 'POST', headers: { cookie: owner } }, env)).json()) as { id: string }
    const taskB = (await (await createBacklogTask(owner, b.id, 'งานของ B')).json()) as { id: string }

    // ยืนยันว่า sprint ของ A เจอผ่าน workspace board endpoint จริง (ไม่ได้ hardcode id)
    const board = (await (await app.request(`/api/workspace/board?projectIds=${a.id}`, { headers: { cookie: owner } }, env)).json()) as { sprints: { sprint: { id: string } }[] }
    expect(board.sprints.some((s) => s.sprint.id === sprintA.id)).toBe(true)

    const res = await app.request(
      `/api/sprints/${sprintA.id}/tasks`,
      { method: 'POST', headers: { cookie: owner, 'content-type': 'application/json' }, body: JSON.stringify({ taskId: taskB.id }) },
      env,
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('not_in_backlog')
  })
})
