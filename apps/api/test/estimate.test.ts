import type { Position } from '@seedoffice/core'
import { VIEW_ONLY_PERMISSIONS } from '@seedoffice/core'
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
  it('ตารางเริ่มจากว่างเปล่าเสมอ — ต่อให้มี task จริงอยู่ก็ยังไม่โผล่ แต่ไปโผล่ใน available พร้อมจำนวนงาน', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId, taskId } = await setupProjectWithTask(owner, 'u_pond', 6600, 'tt_development', 'tts_api')
    await setupRoleWithCost(owner, taskId, 8000)

    const res = await app.request(`/api/projects/${projectId}/estimate/groups`, { headers: { cookie: owner } }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { groups: unknown[]; available: Record<string, unknown>[] }
    expect(body.groups).toHaveLength(0)
    expect(body.available.find((a) => a.subTaskTypeId === 'tts_api')).toMatchObject({
      taskTypeId: 'tt_development',
      taskTypeName: 'Development',
      name: 'API',
      taskCount: 1,
    })
    // กลุ่มที่ไม่มี task จริงก็อยู่ใน available เหมือนกัน แต่ taskCount = 0
    expect(body.available.find((a) => a.subTaskTypeId === 'tts_debug')).toMatchObject({ taskCount: 0 })
  })

  it('พอ PM เลือกกลุ่มที่มี task จริง → แถวเติมข้อมูลจากงานจริงให้เอง (source=auto) + หายไปจาก available', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId, taskId } = await setupProjectWithTask(owner, 'u_pond', 6600, 'tt_development', 'tts_api')
    await setupRoleWithCost(owner, taskId, 8000)

    await app.request(
      `/api/projects/${projectId}/estimate/groups/override`,
      putJson(owner, { taskTypeId: 'tt_development', subTaskTypeId: 'tts_api' }),
      env,
    )

    const body = (await (
      await app.request(`/api/projects/${projectId}/estimate/groups`, { headers: { cookie: owner } }, env)
    ).json()) as { groups: Record<string, unknown>[]; available: Record<string, unknown>[] }
    expect(body.groups).toHaveLength(1)
    expect(body.groups[0]).toMatchObject({
      source: 'auto',
      taskTypeName: 'Development',
      teamMemberIds: ['u_pond'],
      role: 'Developer',
      estimateMinutes: 6600,
      netCostSatang: 132000,
    })
    expect(body.available.find((a) => a.subTaskTypeId === 'tts_api')).toBeUndefined()
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

  it('ค่าใช้จ่ายนอกระบบ (AEX/OPEX) — netCostSatang กรอกเองแล้ว margin/estimateCost คำนวณจาก company margin% รวมเข้ายอดรวมของ Tab Task Group', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId } = await setupProjectWithTask(owner, 'u_pond', 100)

    const created = (await (
      await app.request(`/api/projects/${projectId}/estimate/extra-costs`, json(owner, { category: 'aex', name: 'Cloud Hosting' }), env)
    ).json()) as { id: string; category: string }
    expect(created.category).toBe('aex')
    await app.request(`/api/projects/${projectId}/estimate/extra-costs/${created.id}`, patchJson(owner, { netCostSatang: 300000 }), env)

    const res = await app.request(`/api/projects/${projectId}/estimate/groups`, { headers: { cookie: owner } }, env)
    const body = (await res.json()) as {
      extraCosts: { id: string; category: string; netCostSatang: number; marginSatang: number; estimateCostSatang: number }[]
      totals: { extraCostsSatang: number; netCostSatang: number; marginSatang: number; estimateCostSatang: number }
    }
    expect(body.extraCosts).toHaveLength(1)
    expect(body.extraCosts[0]).toMatchObject({ category: 'aex', netCostSatang: 300000, marginSatang: 90000, estimateCostSatang: 390000 })
    expect(body.totals.extraCostsSatang).toBe(300000)
    expect(body.totals.netCostSatang).toBeGreaterThanOrEqual(300000)
    expect(body.totals.marginSatang).toBeGreaterThanOrEqual(90000)
    expect(body.totals.estimateCostSatang).toBeGreaterThanOrEqual(390000)
  })
})

describe('T?? — Project Estimate v2: GET /api/projects/:id/estimate/phases (Tab Phase — รวม Estimate Day ตามหัวข้อหลัก)', () => {
  it('นับเฉพาะกลุ่มที่ PM เลือกไว้ใน Tab Task Group — ข้อมูลตรงกันทุกแท็บ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId, taskId } = await setupProjectWithTask(owner, 'u_pond', 2880, 'tt_development', 'tts_api') // 48 ชม.
    await app.request(`/api/tasks/${taskId}`, patchJson(owner, { costWorkMinutesPerDay: 240 }), env) // 4 ชม./วัน

    // ยังไม่เลือกกลุ่ม → Phase ยังไม่นับ (ตรงกับ Tab Task Group ที่ยังว่างอยู่)
    const before = (await (
      await app.request(`/api/projects/${projectId}/estimate/phases`, { headers: { cookie: owner } }, env)
    ).json()) as { phases: { taskTypeId: string; totalEstimateDays: number }[] }
    expect(before.phases.find((p) => p.taskTypeId === 'tt_development')!.totalEstimateDays).toBe(0)

    await app.request(
      `/api/projects/${projectId}/estimate/groups/override`,
      putJson(owner, { taskTypeId: 'tt_development', subTaskTypeId: 'tts_api' }),
      env,
    )

    const res = await app.request(`/api/projects/${projectId}/estimate/phases`, { headers: { cookie: owner } }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { phases: { taskTypeId: string; name: string; totalEstimateDays: number }[] }
    const dev = body.phases.find((p) => p.taskTypeId === 'tt_development')!
    // 48 ชม. + buffer 20% = 57.6 ชม. ÷ 4 ชม./วัน = 14.4 วัน
    expect(dev.totalEstimateDays).toBeCloseTo(14.4, 5)
  })

  it('extraCostTotals — รวม AEX/OPEX แยกหัวข้อ ตรงกับ Tab Task Group', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId } = await setupProjectWithTask(owner, 'u_pond', 100)

    const aex = (await (
      await app.request(`/api/projects/${projectId}/estimate/extra-costs`, json(owner, { category: 'aex', name: 'Server' }), env)
    ).json()) as { id: string }
    await app.request(`/api/projects/${projectId}/estimate/extra-costs/${aex.id}`, patchJson(owner, { netCostSatang: 100000 }), env)
    const opex = (await (
      await app.request(`/api/projects/${projectId}/estimate/extra-costs`, json(owner, { category: 'opex', name: 'ค่าเดินทาง' }), env)
    ).json()) as { id: string }
    await app.request(`/api/projects/${projectId}/estimate/extra-costs/${opex.id}`, patchJson(owner, { netCostSatang: 50000 }), env)

    const body = (await (
      await app.request(`/api/projects/${projectId}/estimate/phases`, { headers: { cookie: owner } }, env)
    ).json()) as { extraCostTotals: Record<'aex' | 'opex', { netCostSatang: number; estimateCostSatang: number }> }
    expect(body.extraCostTotals.aex.netCostSatang).toBe(100000)
    expect(body.extraCostTotals.aex.estimateCostSatang).toBe(130000) // +30% margin
    expect(body.extraCostTotals.opex.netCostSatang).toBe(50000)
    expect(body.extraCostTotals.opex.estimateCostSatang).toBe(65000)
  })
})

describe('Pronista §Project Estimate permission (2026-09-01) — เปิดให้ BA/PM เข้าถึงผ่านตำแหน่งได้ ไม่ใช่ owner-only ล้วน', () => {
  const assignPosition = (cookie: string, projectId: string, userId: string, positionId: string) =>
    app.request(`/api/projects/${projectId}/members`, json(cookie, { userId, positionId }), env)
  const savePositions = (cookie: string, positions: Position[]) =>
    app.request('/api/admin/positions', putJson(cookie, { positions }), env)

  it('member ไม่มีตำแหน่ง (ไม่ได้ถูกเพิ่มเข้าโปรเจกต์เลย) → ยัง 403 เหมือนเดิม (ค่าเริ่มต้นปลอดภัย ไม่เปิดกว้างเกิน)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId } = await setupProjectWithTask(owner, 'u_pond', 100)
    const member = await loginAs(app, 'pond@example-co.test')
    expect((await app.request(`/api/projects/${projectId}/estimate`, { headers: { cookie: member } }, env)).status).toBe(403)
  })

  it('member ถูก assign ตำแหน่ง "ดูอย่างเดียว" (built-in) → ยังเข้า Estimate ไม่ได้ (View Only เห็นได้ทุกแท็บยกเว้น estimate — ข้อมูลต้นทุน/margin ละเอียดอ่อนกว่าแท็บอื่น)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId } = await setupProjectWithTask(owner, 'u_pond', 100)
    const member = await loginAs(app, 'pond@example-co.test')
    expect((await assignPosition(owner, projectId, 'u_pond', 'pos_view_only')).status).toBe(200)
    expect((await app.request(`/api/projects/${projectId}/estimate`, { headers: { cookie: member } }, env)).status).toBe(403)
  })

  it('member ถูก assign ตำแหน่ง "เข้าถึงเต็มรูปแบบ" (built-in) → เข้า Estimate ได้ทั้งดูและแก้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId } = await setupProjectWithTask(owner, 'u_pond', 100)
    const member = await loginAs(app, 'pond@example-co.test')
    expect((await assignPosition(owner, projectId, 'u_pond', 'pos_full_access')).status).toBe(200)
    expect((await app.request(`/api/projects/${projectId}/estimate`, { headers: { cookie: member } }, env)).status).toBe(200)
    expect(
      (
        await app.request(
          `/api/projects/${projectId}/estimate/extra-costs`,
          json(member, { category: 'aex', name: 'Cloud Hosting' }),
          env,
        )
      ).status,
    ).toBe(200)
  })

  it('ตำแหน่งกำหนดเอง — เปิดแค่ tabs.estimate (ดูได้) แต่ actions.estimate ปิดหมด → ดูได้ แก้ไม่ได้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { projectId } = await setupProjectWithTask(owner, 'u_pond', 100)
    const member = await loginAs(app, 'pond@example-co.test')
    const custom: Position = {
      id: 'pos_ba',
      name: 'BA',
      sortOrder: 2,
      permissions: { ...VIEW_ONLY_PERMISSIONS, tabs: { ...VIEW_ONLY_PERMISSIONS.tabs, estimate: true } },
    }
    expect((await savePositions(owner, [...(await (await app.request('/api/admin/positions', { headers: { cookie: owner } }, env)).json() as { positions: Position[] }).positions, custom])).status).toBe(200)
    expect((await assignPosition(owner, projectId, 'u_pond', 'pos_ba')).status).toBe(200)

    expect((await app.request(`/api/projects/${projectId}/estimate`, { headers: { cookie: member } }, env)).status).toBe(200)
    expect(
      (
        await app.request(
          `/api/projects/${projectId}/estimate/extra-costs`,
          json(member, { category: 'aex', name: 'ควรโดนกัน' }),
          env,
        )
      ).status,
    ).toBe(403)
  })
})
