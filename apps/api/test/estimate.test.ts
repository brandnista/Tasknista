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

async function setupProjectWithTask(cookie: string, assigneeId: string, estimateMinutes: number, taskType?: string, subTaskType?: string) {
  const p = (await (await app.request('/api/projects', json(cookie, { name: 'Estimate P', type: 'project' }), env)).json()) as { id: string }
  const g = (await (await app.request(`/api/projects/${p.id}/groups`, json(cookie, { name: 'G' }), env)).json()) as { id: string }
  const t = (await (
    await app.request(`/api/groups/${g.id}/tasks`, json(cookie, { title: 'งานประเมิน', assigneeId, estimateMinutes }), env)
  ).json()) as { id: string }
  if (taskType) await app.request(`/api/tasks/${t.id}`, patchJson(cookie, { taskType, subTaskType }), env)
  return { projectId: p.id, taskId: t.id }
}

/** ตั้ง Role + Cost/Day (Parameter Role + Cost Role rate card) แล้วผูกเข้า task — มิเรอร์ CostRoleSettings/ParameterRoleSettings จริง */
async function setupRoleWithCost(cookie: string, taskId: string, costPerDaySatang: number, roleId = 'role_dev') {
  await app.request('/api/admin/parameter-roles', putJson(cookie, { parameterRoles: [{ id: roleId, name: 'Developer', sortOrder: 0 }] }), env)
  await app.request('/api/admin/cost-roles', putJson(cookie, { costRoles: [{ roleId, costPerDaySatang, sortOrder: 0 }] }), env)
  await app.request(`/api/tasks/${taskId}`, patchJson(cookie, { costRoleId: roleId }), env)
  return roleId
}

describe('T?? — Project Estimate v2: GET /api/projects/:id/estimate (ไม่มี checkbox เลือกอีกต่อไป — ดึงทุก task อัตโนมัติ)', () => {
  it('owner: คำนวณ Cost/Hour, Buffer, Net Cost, Margin, Estimate Cost ตรงสูตร · suggestedNetWorkingDays = ceil(max Estimate Day)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId, taskId } = await setupProjectWithTask(owner, 'u_pond', 6600) // 110 ชม.
    // Role "Developer" ต้นทุน ฿80/วัน (8000 สตางค์) → Cost/Hour ฿10/ชม. (1000 สตางค์)
    const roleId = await setupRoleWithCost(owner, taskId, 8000)

    const res = await app.request(`/api/projects/${projectId}/estimate`, { headers: { cookie: owner } }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      rows: Record<string, unknown>[]
      totals: { netCostSatang: number; marginSatang: number; estimateCostSatang: number }
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
      estimateCostSatang: 171600,
      quotationSatang: null, // ยังไม่กรอกราคาที่จะเสนอลูกค้าเอง
    })
    expect(body.totals).toEqual({ netCostSatang: 132000, marginSatang: 39600, estimateCostSatang: 171600 })
    expect(body.suggestedNetWorkingDays).toBe(17) // ceil(16.5)
  })

  it('task ยังไม่เลือก Role → แถวโชว์แต่ cost/margin/estimateCost = null และไม่รวมในยอด', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId } = await setupProjectWithTask(owner, 'u_somchai', 1000) // ยังไม่เลือก Role ให้ task นี้

    const res = await app.request(`/api/projects/${projectId}/estimate`, { headers: { cookie: owner } }, env)
    const body = (await res.json()) as { rows: Record<string, unknown>[]; totals: { netCostSatang: number } }
    expect(body.rows[0]).toMatchObject({
      costRoleId: null,
      roleName: null,
      costPerDaySatang: null,
      costPerHourSatang: null,
      netCostSatang: null,
      marginSatang: null,
      estimateCostSatang: null,
    })
    expect(body.totals.netCostSatang).toBe(0)
  })

  it('task ทุกอันในโปรเจกต์โผล่อัตโนมัติโดยไม่ต้องเลือกอะไรเลย', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId, taskId } = await setupProjectWithTask(owner, 'u_pond', 100)
    await setupRoleWithCost(owner, taskId, 8000)

    const res = await app.request(`/api/projects/${projectId}/estimate`, { headers: { cookie: owner } }, env)
    const body = (await res.json()) as { rows: unknown[] }
    expect(body.rows).toHaveLength(1)
  })

  it('PATCH /tasks/:id ตั้ง quotationSatang (ราคาที่จะเสนอลูกค้าเอง) แล้วสะท้อนกลับมาในแถว', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId, taskId } = await setupProjectWithTask(owner, 'u_pond', 100)
    await app.request(`/api/tasks/${taskId}`, patchJson(owner, { quotationSatang: 500000 }), env)

    const res = await app.request(`/api/projects/${projectId}/estimate`, { headers: { cookie: owner } }, env)
    const body = (await res.json()) as { rows: Record<string, unknown>[] }
    expect(body.rows[0]).toMatchObject({ quotationSatang: 500000 })
  })

  it('member/vendor เรียก → 403 ทั้ง /estimate, /estimate/groups, /estimate/phases, /estimate/extra-costs (ต้นทุนทีมเห็นเฉพาะ owner)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId } = await setupProjectWithTask(owner, 'u_pond', 100)

    const member = await loginAs(app, 'pond@example-co.test')
    expect((await app.request(`/api/projects/${projectId}/estimate`, { headers: { cookie: member } }, env)).status).toBe(403)
    expect((await app.request(`/api/projects/${projectId}/estimate/groups`, { headers: { cookie: member } }, env)).status).toBe(403)
    expect((await app.request(`/api/projects/${projectId}/estimate/phases`, { headers: { cookie: member } }, env)).status).toBe(403)
    expect((await app.request(`/api/projects/${projectId}/estimate/extra-costs`, { headers: { cookie: member } }, env)).status).toBe(403)

    const vendor = await loginAs(app, 'somchai@example.com')
    expect((await app.request(`/api/projects/${projectId}/estimate`, { headers: { cookie: vendor } }, env)).status).toBe(403)
  })
})

describe('T?? — Project Estimate v2: GET /api/projects/:id/estimate/groups (Tab Task Group)', () => {
  it('กลุ่มที่มี task จริง → รวมอัตโนมัติจากงานที่ตั้ง Task Type/Sub-type ตรงกัน', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId, taskId } = await setupProjectWithTask(owner, 'u_pond', 6600, 'tt_development', 'tts_api')
    await setupRoleWithCost(owner, taskId, 8000)

    const res = await app.request(`/api/projects/${projectId}/estimate/groups`, { headers: { cookie: owner } }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { groups: Record<string, unknown>[] }
    const apiGroup = body.groups.find((g) => g.subTaskTypeId === 'tts_api')
    expect(apiGroup).toMatchObject({ source: 'auto', teamMember: 'ปอนด์', role: 'Developer', estimateMinutes: 6600, netCostSatang: 132000 })
  })

  it('กลุ่มที่ไม่มี task เลย และ PM ยังไม่ได้กดเพิ่มแถวเอง → ไม่โชว์แถว จนกว่าจะ PUT override เข้าไป', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId } = await setupProjectWithTask(owner, 'u_pond', 100, 'tt_development', 'tts_api')

    const before = (await (
      await app.request(`/api/projects/${projectId}/estimate/groups`, { headers: { cookie: owner } }, env)
    ).json()) as { groups: Record<string, unknown>[] }
    expect(before.groups.find((g) => g.subTaskTypeId === 'tts_debug')).toBeUndefined()

    await app.request(
      `/api/projects/${projectId}/estimate/groups/override`,
      putJson(owner, { taskTypeId: 'tt_debug', subTaskTypeId: 'tts_debug', teamMemberIds: ['u_pond'], estimateMinutes: 480 }),
      env,
    )
    const after = (await (
      await app.request(`/api/projects/${projectId}/estimate/groups`, { headers: { cookie: owner } }, env)
    ).json()) as { groups: Record<string, unknown>[] }
    const debugAfter = after.groups.find((g) => g.subTaskTypeId === 'tts_debug')
    expect(debugAfter).toMatchObject({ source: 'manual', teamMemberIds: ['u_pond'], estimateMinutes: 480 })

    await app.request(
      `/api/projects/${projectId}/estimate/groups/override?taskTypeId=tt_debug&subTaskTypeId=tts_debug`,
      { method: 'DELETE', headers: { cookie: owner } },
      env,
    )
    const afterDelete = (await (
      await app.request(`/api/projects/${projectId}/estimate/groups`, { headers: { cookie: owner } }, env)
    ).json()) as { groups: Record<string, unknown>[] }
    expect(afterDelete.groups.find((g) => g.subTaskTypeId === 'tts_debug')).toBeUndefined()
  })

  it('ค่าใช้จ่ายนอกระบบ (extra costs) รวมเข้ายอดรวมของ Tab Task Group', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId } = await setupProjectWithTask(owner, 'u_pond', 100)

    await app.request(`/api/projects/${projectId}/estimate/extra-costs`, json(owner, { name: 'Cloud Hosting', amountSatang: 300000 }), env)
    const res = await app.request(`/api/projects/${projectId}/estimate/groups`, { headers: { cookie: owner } }, env)
    const body = (await res.json()) as { extraCosts: Record<string, unknown>[]; totals: { extraCostsSatang: number; netCostSatang: number } }
    expect(body.extraCosts).toHaveLength(1)
    expect(body.totals.extraCostsSatang).toBe(300000)
    expect(body.totals.netCostSatang).toBeGreaterThanOrEqual(300000)
  })
})

describe('T?? — Project Estimate v2: GET /api/projects/:id/estimate/phases (Tab Phase — รวม Estimate Day ตามหัวข้อหลัก)', () => {
  it('รวม Estimate Day ของ Task Group ย่อยเข้าเป็นยอดของ Task Type หลัก', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId, taskId } = await setupProjectWithTask(owner, 'u_pond', 2880, 'tt_development', 'tts_api') // 48 ชม.
    await app.request(`/api/tasks/${taskId}`, patchJson(owner, { costWorkMinutesPerDay: 240 }), env) // 4 ชม./วัน

    const res = await app.request(`/api/projects/${projectId}/estimate/phases`, { headers: { cookie: owner } }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { phases: { taskTypeId: string; name: string; totalEstimateDays: number }[] }
    const dev = body.phases.find((p) => p.taskTypeId === 'tt_development')!
    // 48 ชม. + buffer 20% = 57.6 ชม. ÷ 4 ชม./วัน = 14.4 วัน
    expect(dev.totalEstimateDays).toBeCloseTo(14.4, 5)
  })
})
