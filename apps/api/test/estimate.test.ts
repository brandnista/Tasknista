import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const patchJson = (cookie: string, body: unknown) => ({
  method: 'PATCH',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const putJson = (cookie: string, body: unknown) => ({
  method: 'PUT',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

beforeEach(async () => {
  await seedUsers()
})

async function setupProjectWithTask(cookie: string, assigneeId: string, estimateMinutes: number) {
  const p = (await (await app.request('/api/projects', json(cookie, { name: 'Estimate P', type: 'project' }), env)).json()) as { id: string }
  const g = (await (await app.request(`/api/projects/${p.id}/groups`, json(cookie, { name: 'G' }), env)).json()) as { id: string }
  const t = (await (
    await app.request(`/api/groups/${g.id}/tasks`, json(cookie, { title: 'งานประเมิน', assigneeId, estimateMinutes }), env)
  ).json()) as { id: string }
  return { projectId: p.id, taskId: t.id }
}

/** เลือก task เข้าตาราง Estimate ของโปรเจกต์ (full replace ตาม taskIds ที่ส่งมา) */
async function selectForEstimate(cookie: string, projectId: string, taskIds: string[]) {
  await app.request(`/api/projects/${projectId}/estimate/selection`, putJson(cookie, { taskIds }), env)
}

/** ตั้ง Role + Cost/Day (Parameter Role + Cost Role rate card) แล้วผูกเข้า task — มิเรอร์ CostRoleSettings/ParameterRoleSettings จริง */
async function setupRoleWithCost(cookie: string, taskId: string, costPerDaySatang: number) {
  const roleId = 'role_dev'
  await app.request('/api/admin/parameter-roles', putJson(cookie, { parameterRoles: [{ id: roleId, name: 'Developer', sortOrder: 0 }] }), env)
  await app.request('/api/admin/cost-roles', putJson(cookie, { costRoles: [{ roleId, costPerDaySatang, sortOrder: 0 }] }), env)
  await app.request(`/api/tasks/${taskId}`, patchJson(cookie, { costRoleId: roleId }), env)
  return roleId
}

describe('T?? — Project Estimate: GET /api/projects/:id/estimate (role-based — Role ต่อ task จาก Parameter Role, ไม่ผูกกับคน)', () => {
  it('owner: คำนวณ Cost/Hour, Buffer, Net Cost, Margin, Quotation ตรงสูตร · suggestedNetWorkingDays = ceil(max Estimate Day)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId, taskId } = await setupProjectWithTask(owner, 'u_pond', 6600) // 110 ชม.
    // Role "Developer" ต้นทุน ฿80/วัน (8000 สตางค์) → Cost/Hour ฿10/ชม. (1000 สตางค์)
    const roleId = await setupRoleWithCost(owner, taskId, 8000)
    await selectForEstimate(owner, projectId, [taskId])

    const res = await app.request(`/api/projects/${projectId}/estimate`, { headers: { cookie: owner } }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      rows: Record<string, unknown>[]
      totals: { netCostSatang: number; marginSatang: number; quotationSatang: number }
      suggestedNetWorkingDays: number | null
    }
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0]).toMatchObject({
      assigneeId: 'u_pond',
      costRoleId: roleId,
      roleName: 'Developer',
      costPerDaySatang: 8000,
      costPerHourSatang: 1000,
      estimateMinutes: 6600,
      bufferMinutes: 1320, // 20% ของ 6600
      totalMinutes: 7920,
      netCostSatang: 132000, // 7920 นาที × ฿10/ชม. = ฿1,320
      workMinutesPerDay: 480, // ไม่ตั้งไว้ที่ task → fallback company_config
      estimateDays: 16.5,
      marginSatang: 39600, // 30% ของ 132000
      quotationSatang: 171600,
    })
    expect(body.totals).toEqual({ netCostSatang: 132000, marginSatang: 39600, quotationSatang: 171600 })
    expect(body.suggestedNetWorkingDays).toBe(17) // ceil(16.5)
  })

  it('task ยังไม่เลือก Role → แถวโชว์แต่ cost/margin/quotation = null และไม่รวมในยอด', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId, taskId } = await setupProjectWithTask(owner, 'u_somchai', 1000) // ยังไม่เลือก Role ให้ task นี้
    await selectForEstimate(owner, projectId, [taskId])

    const res = await app.request(`/api/projects/${projectId}/estimate`, { headers: { cookie: owner } }, env)
    const body = (await res.json()) as { rows: Record<string, unknown>[]; totals: { netCostSatang: number } }
    expect(body.rows[0]).toMatchObject({
      costRoleId: null,
      roleName: null,
      costPerDaySatang: null,
      costPerHourSatang: null,
      netCostSatang: null,
      marginSatang: null,
      quotationSatang: null,
    })
    expect(body.totals.netCostSatang).toBe(0)
  })

  it('task ที่ไม่ได้ติ๊กเลือกเข้า Estimate ไม่โชว์ในตาราง แม้จะมี Role+estimate ครบ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId, taskId } = await setupProjectWithTask(owner, 'u_pond', 100)
    await setupRoleWithCost(owner, taskId, 8000)
    // ไม่เรียก selectForEstimate — task ยังไม่ถูกเลือกเข้า Estimate

    const res = await app.request(`/api/projects/${projectId}/estimate`, { headers: { cookie: owner } }, env)
    const body = (await res.json()) as { rows: unknown[] }
    expect(body.rows).toHaveLength(0)
  })

  it('member/vendor เรียก → 403 ทั้ง /estimate, /estimate/tasks, /estimate/selection (ต้นทุนทีมเห็นเฉพาะ owner)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId, taskId } = await setupProjectWithTask(owner, 'u_pond', 100)

    const member = await loginAs(app, 'pond@example-co.test')
    expect((await app.request(`/api/projects/${projectId}/estimate`, { headers: { cookie: member } }, env)).status).toBe(403)
    expect((await app.request(`/api/projects/${projectId}/estimate/tasks`, { headers: { cookie: member } }, env)).status).toBe(403)
    expect((await app.request(`/api/projects/${projectId}/estimate/selection`, putJson(member, { taskIds: [taskId] }), env)).status).toBe(403)

    const vendor = await loginAs(app, 'somchai@example.com')
    expect((await app.request(`/api/projects/${projectId}/estimate`, { headers: { cookie: vendor } }, env)).status).toBe(403)
  })
})
