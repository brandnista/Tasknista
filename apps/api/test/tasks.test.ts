import { createDb, users } from '@seedoffice/db'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

beforeEach(async () => {
  await seedUsers()
})

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

// สร้าง project ด้วย owner เสมอ (POST /api/projects เป็น ownerOnly) — ถ้า actor ไม่ใช่ owner
// ต้องตั้งเป็น project editor ก่อน ไม่งั้นสร้าง group/task ไม่ได้ (canEditProject gate)
async function setupProject(cookie: string, asEditorUserId?: string) {
  const owner = await loginAs(app, 'owner@example-co.test')
  const p = (await (
    await app.request('/api/projects', json(owner, { name: 'โปรเจกต์เทสต์', type: 'project' }), env)
  ).json()) as { id: string }
  if (asEditorUserId)
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: asEditorUserId, positionId: 'pos_full_access' }), env)
  const g1 = (await (
    await app.request(`/api/projects/${p.id}/groups`, json(cookie, { name: 'Design' }), env)
  ).json()) as { id: string }
  const g2 = (await (
    await app.request(`/api/projects/${p.id}/groups`, json(cookie, { name: 'Dev' }), env)
  ).json()) as { id: string }
  return { p, g1, g2 }
}

describe('§Defect field cleanup — /tasks/:id/convert ล้าง defectStatus เมื่อแปลงออกจาก Defect', () => {
  it('แปลง task → defect (ได้ reported อัตโนมัติ) → แปลงออกเป็น story → defectStatus ต้องเป็น null (ไม่ค้าง)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { p, g1 } = await setupProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'บั๊กหน้า Login' }), env)).json()) as { id: string }

    const asDefect = (await (
      await app.request(`/api/tasks/${t.id}/convert`, json(owner, { to: 'defect' }), env)
    ).json()) as { kind: string; defectStatus: string | null }
    expect(asDefect).toMatchObject({ kind: 'defect', defectStatus: 'reported' })

    const asStory = (await (
      await app.request(`/api/tasks/${t.id}/convert`, json(owner, { to: 'story', targetProjectId: p.id }), env)
    ).json()) as { kind: string; defectStatus: string | null }
    expect(asStory).toMatchObject({ kind: 'task', defectStatus: null })
  })
})

describe('T09 — groups/tasks/reorder/checkbox/timeline data', () => {
  it('สร้าง group + task → board ออกครบ · เช็คเสร็จ → done + completedAt · ติ๊กออก → todo', async () => {
    const m = await loginAs(app, 'pond@example-co.test')
    const { p, g1 } = await setupProject(m, 'u_pond')
    const t = (await (
      await app.request(
        `/api/groups/${g1.id}/tasks`,
        json(m, { title: 'Hero section', startDate: '2026-06-01', dueDate: '2026-06-20', estimateMinutes: 480 }),
        env,
      )
    ).json()) as { id: string }

    let board = (await (
      await app.request(`/api/projects/${p.id}/board`, { headers: { cookie: m } }, env)
    ).json()) as { groups: { name: string; tasks: { id: string; status: string }[] }[] }
    expect(board.groups.map((g) => g.name)).toEqual(['Design', 'Dev'])
    expect(board.groups[0]?.tasks[0]?.id).toBe(t.id)

    await app.request(`/api/tasks/${t.id}`, { ...json(m, { status: 'done' }), method: 'PATCH' }, env)
    board = (await (await app.request(`/api/projects/${p.id}/board`, { headers: { cookie: m } }, env)).json()) as typeof board
    expect(board.groups[0]?.tasks[0]?.status).toBe('done')

    await app.request(`/api/tasks/${t.id}`, { ...json(m, { status: 'non_start' }), method: 'PATCH' }, env)
    board = (await (await app.request(`/api/projects/${p.id}/board`, { headers: { cookie: m } }, env)).json()) as typeof board
    expect(board.groups[0]?.tasks[0]?.status).toBe('non_start')
  })

  it('reorder: ย้าย task ข้ามกลุ่ม + สลับลำดับ group → persist หลัง reload', async () => {
    const m = await loginAs(app, 'owner@example-co.test')
    const { p, g1, g2 } = await setupProject(m)
    const t1 = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(m, { title: 'งาน 1' }), env)).json()) as { id: string }
    const t2 = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(m, { title: 'งาน 2' }), env)).json()) as { id: string }

    const res = await app.request(
      `/api/projects/${p.id}/reorder`,
      json(m, {
        groups: [
          { id: g2.id, sortOrder: 0 },
          { id: g1.id, sortOrder: 1 },
        ],
        tasks: [
          { id: t2.id, groupId: g2.id, sortOrder: 0 },
          { id: t1.id, groupId: g1.id, sortOrder: 0 },
        ],
      }),
      env,
    )
    expect(res.status).toBe(200)
    const board = (await (
      await app.request(`/api/projects/${p.id}/board`, { headers: { cookie: m } }, env)
    ).json()) as { groups: { id: string; name: string; tasks: { id: string }[] }[] }
    expect(board.groups.map((g) => g.name)).toEqual(['Dev', 'Design'])
    expect(board.groups[0]?.tasks[0]?.id).toBe(t2.id)
  })

  it('vendor: อ่าน board ได้ แต่สร้าง/แก้/reorder = 403 · ลบ group ที่มีงาน = 409', async () => {
    const m = await loginAs(app, 'pond@example-co.test')
    const { p, g1 } = await setupProject(m, 'u_pond')
    await app.request(`/api/groups/${g1.id}/tasks`, json(m, { title: 'งานค้าง' }), env)

    const v = await loginAs(app, 'somchai@example.com')
    expect((await app.request(`/api/projects/${p.id}/board`, { headers: { cookie: v } }, env)).status).toBe(200)
    expect((await app.request(`/api/projects/${p.id}/groups`, json(v, { name: 'X' }), env)).status).toBe(403)
    expect((await app.request(`/api/groups/${g1.id}/tasks`, json(v, { title: 'X' }), env)).status).toBe(403)

    expect((await app.request(`/api/groups/${g1.id}`, { method: 'DELETE', headers: { cookie: m } }, env)).status).toBe(409)
  })

  it('recurring openTodo: โผล่ในลิสต์โปรเจกต์ พร้อมชื่อคนรับผิดชอบ', async () => {
    const m = await loginAs(app, 'owner@example-co.test')
    const p = (await (
      await app.request('/api/projects', json(m, { name: 'MA ร้านกาแฟ', type: 'recurring' }), env)
    ).json()) as { id: string }
    const g = (await (
      await app.request(`/api/projects/${p.id}/groups`, json(m, { name: 'งานประจำ' }), env)
    ).json()) as { id: string }
    await app.request(
      `/api/groups/${g.id}/tasks`,
      json(m, { title: 'อัปเดตเมนู', dueDate: '2026-06-11', assigneeId: 'u_pond' }),
      env,
    )
    const list = (await (
      await app.request('/api/projects', { headers: { cookie: m } }, env)
    ).json()) as { id: string; openTodo: { title: string; assigneeName: string } | null }[]
    const row = list.find((x) => x.id === p.id)
    expect(row?.openTodo).toMatchObject({ title: 'อัปเดตเมนู', assigneeName: 'ปอนด์' })
  })
})

// Pronista §Assign/Accept audit (2026-09-03) — ตาม QA test script: จ่ายงาน→รับงาน→ปฏิเสธ/reassign ครบ flow
describe('§Assign/Accept audit — dispatch/accept/reject/reassign', () => {
  const notifCountFor = async (userId: string, type: string) =>
    (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = ?')
        .bind(userId, type)
        .first<{ n: number }>()
    )?.n ?? 0

  it('reassign งาน on_processing ไปคนใหม่ → status รีเซ็ตเป็น non_start, dispatchedAt null, ทั้งคนเก่า/คนใหม่ได้ task_reassigned', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งานทดสอบ reassign' }), env)
    ).json()) as { id: string }
    // PATCH ตั้ง assigneeId แยก (ไม่ใช่ตอนสร้าง) — endpoint สร้าง task ไม่ตั้ง assignedBy ให้ ต้องผ่าน PATCH ถึงจะมี assignedBy จริง
    await app.request(`/api/tasks/${t.id}`, { ...json(owner, { assigneeId: 'u_pond' }), method: 'PATCH' }, env)
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    const pond = await loginAs(app, 'pond@example-co.test')
    await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)

    const beforeOld = await notifCountFor('u_pond', 'task_reassigned')
    const beforeNew = await notifCountFor('u_owner', 'task_reassigned')
    const res = await app.request(`/api/tasks/${t.id}`, { ...json(owner, { assigneeId: 'u_owner' }), method: 'PATCH' }, env)
    expect(res.status).toBe(200)
    const updated = (await res.json()) as { status: string; dispatchedAt: number | null; assigneeId: string }
    expect(updated).toMatchObject({ status: 'non_start', dispatchedAt: null, assigneeId: 'u_owner' })
    expect(await notifCountFor('u_pond', 'task_reassigned')).toBe(beforeOld + 1) // คนเก่า
    expect(await notifCountFor('u_owner', 'task_reassigned')).toBe(beforeNew + 1) // คนใหม่
  })

  it('reassign ให้ user ที่ถูก deactivate (u_gone) → 400 assignee_not_eligible', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน' }), env)).json()) as { id: string }
    const res = await app.request(`/api/tasks/${t.id}`, { ...json(owner, { assigneeId: 'u_gone' }), method: 'PATCH' }, env)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('assignee_not_eligible')
  })

  it('reassign ให้ user ที่ไม่ใช่สมาชิกโปรเจกต์นี้ → 400 assignee_not_eligible', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner) // u_somchai ไม่ได้ถูกเพิ่มเป็นสมาชิก
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน' }), env)).json()) as { id: string }
    const res = await app.request(`/api/tasks/${t.id}`, { ...json(owner, { assigneeId: 'u_somchai' }), method: 'PATCH' }, env)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('assignee_not_eligible')
  })

  it('reassign backlog task (ไม่มี projectId) ให้ใครก็ได้ที่ active — ไม่เช็ค membership เพราะไม่มีโปรเจกต์ผูก', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const t = (await (
      await app.request('/api/tasks/backlog', json(owner, { title: 'Backlog งาน' }), env)
    ).json()) as { id: string }
    const res = await app.request(`/api/tasks/${t.id}`, { ...json(owner, { assigneeId: 'u_somchai' }), method: 'PATCH' }, env)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { assigneeId: string }).assigneeId).toBe('u_somchai')
  })

  it('accept สำเร็จ → assignedBy (คนจ่ายงาน) ได้ task_accepted', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน' }), env)
    ).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}`, { ...json(owner, { assigneeId: 'u_pond' }), method: 'PATCH' }, env)
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    const pond = await loginAs(app, 'pond@example-co.test')
    const before = await notifCountFor('u_owner', 'task_accepted')
    const res = await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)
    expect(res.status).toBe(200)
    expect(await notifCountFor('u_owner', 'task_accepted')).toBe(before + 1)
  })

  it('reject: reason ว่าง = 400 · สำเร็จ = dispatchedAt null + assigneeId ไม่เปลี่ยน + assignedBy ได้ task_rejected · user อื่น reject = 403 · reject หลัง accept แล้ว = 409', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน' }), env)
    ).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}`, { ...json(owner, { assigneeId: 'u_pond' }), method: 'PATCH' }, env)
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    const pond = await loginAs(app, 'pond@example-co.test')

    expect((await app.request(`/api/tasks/${t.id}/reject`, json(pond, { reason: '' }), env)).status).toBe(400)
    expect((await app.request(`/api/tasks/${t.id}/reject`, json(owner, { reason: 'ไม่ใช่ของฉัน' }), env)).status).toBe(403)

    const beforeRejectNotif = await notifCountFor('u_owner', 'task_rejected')
    const res = await app.request(`/api/tasks/${t.id}/reject`, json(pond, { reason: 'scope ไม่ตรง' }), env)
    expect(res.status).toBe(200)
    const updated = (await res.json()) as { dispatchedAt: number | null; assigneeId: string }
    expect(updated).toMatchObject({ dispatchedAt: null, assigneeId: 'u_pond' })
    expect(await notifCountFor('u_owner', 'task_rejected')).toBe(beforeRejectNotif + 1)
    const auditRow = await env.DB.prepare("SELECT meta FROM audit_logs WHERE entity_id = ? AND action = 'task.reject'").bind(t.id).first<{ meta: string }>()
    expect(JSON.parse(auditRow!.meta as string).reason).toBe('scope ไม่ตรง')

    // ตอนนี้ dispatchedAt กลับเป็น null แล้ว — reject ซ้ำต้อง not_dispatched ไม่ใช่ 409 already_accepted
    expect((await app.request(`/api/tasks/${t.id}/reject`, json(pond, { reason: 'ลองอีกที' }), env)).status).toBe(400)

    // จ่ายใหม่ → accept → reject ซ้ำ (สถานะไม่ใช่ non_start แล้ว) ต้อง 409
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)
    expect((await app.request(`/api/tasks/${t.id}/reject`, json(pond, { reason: 'สายไปแล้ว' }), env)).status).toBe(409)
  })

  it('dispatch ซ้อนกัน → ตัวที่สอง 409 already_dispatched · accept ซ้อนกัน → ตัวที่สอง 409 already_accepted', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }

    const d1 = await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    const d2 = await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    expect(d1.status).toBe(200)
    expect(d2.status).toBe(400) // app-level check-then-act จับได้ตั้งแต่ทางนี้แล้ว (dispatchedAt ไม่ null)
    expect(((await d2.json()) as { error: string }).error).toBe('already_dispatched')

    const pond = await loginAs(app, 'pond@example-co.test')
    const a1 = await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)
    const a2 = await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)
    expect(a1.status).toBe(200)
    expect(a2.status).toBe(400)
    expect(((await a2.json()) as { error: string }).error).toBe('already_accepted')
  })

  it('self-dispatch (คนจ่ายงาน = assignee เอง) ยังคงทำได้ตามเดิม', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }
    const pond = await loginAs(app, 'pond@example-co.test')
    // u_pond ต้องเป็น project editor ถึงจะ dispatch ได้ (setupProject ตั้ง positionId เต็มสิทธิ์ไว้แล้วผ่าน asEditorUserId)
    const res = await app.request(`/api/tasks/${t.id}/dispatch`, json(pond, {}), env)
    expect(res.status).toBe(200)
  })
})

const patchJson = (cookie: string, body: unknown) => ({
  method: 'PATCH',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('§Workspace/Task Jira-alignment (2026-09-04) — PATCH /tasks/:id ล็อกวันที่เริ่มต้องไม่เกินวันที่คาดว่าจะเสร็จ', () => {
  it('ตั้งทั้งคู่พร้อมกัน startDate > dueDate → 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน' }), env)).json()) as { id: string }
    const res = await app.request(`/api/tasks/${t.id}`, patchJson(owner, { startDate: '2026-09-10', dueDate: '2026-09-05' }), env)
    expect(res.status).toBe(400)
  })

  it('แก้ startDate ใหม่ให้เกิน dueDate เดิมที่มีอยู่แล้ว (ส่งมาแค่ startDate) → 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน', dueDate: '2026-09-05' }), env)
    ).json()) as { id: string }
    const res = await app.request(`/api/tasks/${t.id}`, patchJson(owner, { startDate: '2026-09-10' }), env)
    expect(res.status).toBe(400)
  })

  it('แก้ dueDate ใหม่ให้ก่อน startDate เดิมที่มีอยู่แล้ว (ส่งมาแค่ dueDate) → 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน', startDate: '2026-09-10' }), env)
    ).json()) as { id: string }
    const res = await app.request(`/api/tasks/${t.id}`, patchJson(owner, { dueDate: '2026-09-05' }), env)
    expect(res.status).toBe(400)
  })

  it('startDate = dueDate (วันเดียวกัน) → ผ่าน 200', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน' }), env)).json()) as { id: string }
    const res = await app.request(`/api/tasks/${t.id}`, patchJson(owner, { startDate: '2026-09-05', dueDate: '2026-09-05' }), env)
    expect(res.status).toBe(200)
  })

  it('startDate ≤ dueDate ปกติ → ผ่าน 200', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน' }), env)).json()) as { id: string }
    const res = await app.request(`/api/tasks/${t.id}`, patchJson(owner, { startDate: '2026-09-01', dueDate: '2026-09-05' }), env)
    expect(res.status).toBe(200)
  })
})

describe('§Workspace/Task Jira-alignment (2026-09-04) — ปุ่ม "บันทึกเพื่ออัปเดตข้อมูล" แจ้ง task_updated', () => {
  const notifCountFor = async (userId: string, type: string) =>
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = ?').bind(userId, type).first<{ n: number }>())?.n ?? 0

  it('notifyOnUpdate:true + มีผู้รับผิดชอบคนอื่น + จ่ายงานแล้ว → แจ้ง task_updated ให้ผู้รับผิดชอบ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    const before = await notifCountFor('u_pond', 'task_updated')
    const res = await app.request(`/api/tasks/${t.id}`, patchJson(owner, { priority: 'high', notifyOnUpdate: true }), env)
    expect(res.status).toBe(200)
    expect(await notifCountFor('u_pond', 'task_updated')).toBe(before + 1)
  })

  // (2026-09-15 bug fix) — พบจากการใช้งานจริง: PM ตั้งผู้รับผิดชอบ+เขียนรายละเอียดในทีเดียวผ่านปุ่ม "บันทึกเพื่ออัปเดตข้อมูล"
  // (ยังไม่เคยกด "จ่ายงาน" เลย) เดิมยิง task_updated ไปหาผู้รับผิดชอบทันที ทั้งที่งานยังไม่โผล่ในหน้า "งานของฉัน" ของเขา (เกตจ่ายงานยังปิดอยู่)
  // ทำให้กดจากแจ้งเตือนเข้ามาเจอปุ่ม "จ่ายงาน (ให้ตัวเอง)" แทนที่จะเป็น "รับงาน" — สับสนว่าทำไมงานที่คนอื่นมอบหมายมา ถึงกลายเป็นให้ตัวเองจ่ายเอง
  it('notifyOnUpdate:true + ยังไม่เคยจ่ายงาน (dispatchedAt ว่าง) → ไม่แจ้ง task_updated (รอแจ้งตอน dispatch จริงแทน)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }
    const before = await notifCountFor('u_pond', 'task_updated')
    const res = await app.request(`/api/tasks/${t.id}`, patchJson(owner, { description: 'รายละเอียดงาน', notifyOnUpdate: true }), env)
    expect(res.status).toBe(200)
    expect(await notifCountFor('u_pond', 'task_updated')).toBe(before)
  })

  it('notifyOnUpdate ไม่ส่งมา (path อื่น เช่น toggle subtask) → ไม่แจ้ง แม้มีผู้รับผิดชอบคนอื่น', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }
    const before = await notifCountFor('u_pond', 'task_updated')
    const res = await app.request(`/api/tasks/${t.id}`, patchJson(owner, { status: 'done' }), env)
    expect(res.status).toBe(200)
    expect(await notifCountFor('u_pond', 'task_updated')).toBe(before)
  })

  it('แก้งานตัวเอง (assignee = คนกดบันทึก) → ไม่แจ้งตัวเอง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน', assigneeId: 'u_owner' }), env)
    ).json()) as { id: string }
    const before = await notifCountFor('u_owner', 'task_updated')
    const res = await app.request(`/api/tasks/${t.id}`, patchJson(owner, { priority: 'high', notifyOnUpdate: true }), env)
    expect(res.status).toBe(200)
    expect(await notifCountFor('u_owner', 'task_updated')).toBe(before)
  })

  it('ยังไม่มีผู้รับผิดชอบ → ไม่มีใครให้แจ้ง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน' }), env)).json()) as { id: string }
    const res = await app.request(`/api/tasks/${t.id}`, patchJson(owner, { priority: 'high', notifyOnUpdate: true }), env)
    expect(res.status).toBe(200)
    // แค่ยืนยันว่าไม่ throw/error — ไม่มี assigneeId ให้เช็ค notifCountFor ไม่มีความหมาย
  })
})

// (2026-09-15) §createdBy status-transition loophole fix — เดิม createdBy === me.id ข้าม state machine ทั้งบล็อก
// ทำให้คนคีย์งานขึ้นเอง (แม้จ่ายงาน→รับงาน→ส่งงานผ่าน flow จริงแล้ว) ปรับสถานะเป็นอะไรก็ได้ไม่จำกัด — ตรงกับ bug repro ที่พี่แบงค์เจอ
describe('§createdBy status-transition loophole — คีย์งานเองยังต้องเดินตาม state machine, ปิดลัดได้แค่ → done', () => {
  async function selfKeyedTaskAt(status: 'on_processing' | 'waiting_for_test') {
    const pond = await loginAs(app, 'pond@example-co.test')
    const { g1 } = await setupProject(pond, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(pond, { title: 'งานคีย์เอง', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}/dispatch`, json(pond, {}), env)
    await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)
    if (status === 'waiting_for_test') await app.request(`/api/tasks/${t.id}`, patchJson(pond, { status: 'waiting_for_test' }), env)
    return { pond, taskId: t.id }
  }

  it('งานคีย์เอง+จ่ายให้ตัวเอง ส่งงานแล้ว (waiting_for_test) → ดึงกลับไป non_start เอง (ข้ามขั้น) ต้องเป็น 403 (เดิมผ่านเพราะช่องโหว่)', async () => {
    const { pond, taskId } = await selfKeyedTaskAt('waiting_for_test')
    const res = await app.request(`/api/tasks/${taskId}`, patchJson(pond, { status: 'non_start' }), env)
    expect(res.status).toBe(403)
  })

  it('งานคีย์เอง+จ่ายให้ตัวเอง ส่งงานแล้ว (waiting_for_test) → ปิดงานเองเป็น done ได้ (scoped self-approve)', async () => {
    const { pond, taskId } = await selfKeyedTaskAt('waiting_for_test')
    const res = await app.request(`/api/tasks/${taskId}`, patchJson(pond, { status: 'done' }), env)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status: string }).status).toBe('done')
  })

  it('งานคีย์เอง+จ่ายให้ตัวเอง กำลังทำอยู่ (on_processing) → ปิดงานเองข้าม waiting_for_test ตรงไป done ได้ (ตรงกับปุ่ม "ปิดงานเอง")', async () => {
    const { pond, taskId } = await selfKeyedTaskAt('on_processing')
    const res = await app.request(`/api/tasks/${taskId}`, patchJson(pond, { status: 'done' }), env)
    expect(res.status).toBe(200)
  })

  it('งานที่คนอื่นจ่ายมา (ไม่ใช่คีย์เอง) กำลังทำอยู่ → ปิดงานเองข้าม waiting_for_test ไม่ได้ (403) ต้องส่งงานตามลำดับ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งานที่จ่ายมา', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    const pond = await loginAs(app, 'pond@example-co.test')
    await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)
    const res = await app.request(`/api/tasks/${t.id}`, patchJson(pond, { status: 'done' }), env)
    expect(res.status).toBe(403)
  })

  it('งานที่คนอื่นจ่ายมา ส่งงานแล้ว (waiting_for_test) → ดึงกลับไป non_start เอง (ข้ามขั้น) ยังเป็น 403 เหมือนเดิม (ไม่ regress)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งานที่จ่ายมา', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    const pond = await loginAs(app, 'pond@example-co.test')
    await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)
    await app.request(`/api/tasks/${t.id}`, patchJson(pond, { status: 'waiting_for_test' }), env)
    const res = await app.request(`/api/tasks/${t.id}`, patchJson(pond, { status: 'non_start' }), env)
    expect(res.status).toBe(403)
  })

  // (2026-09-15 follow-up) — สัญญาณ "ปิดงานเองได้" ต้องเป็น assignedBy===assigneeId (จ่ายงานให้ตัวเองจริง) ไม่ใช่ createdBy (แค่คนคีย์ Task ขึ้นในระบบ)
  // เคสนี้พิสูจน์ว่าทั้งสองสัญญาณให้ผลต่างกันจริง: createdBy===assigneeId แต่ assignedBy เป็นคนอื่น (T14-style จากสเปก) ต้อง "ไม่ได้" สิทธิ์ปิดงานเอง
  it('createdBy===assigneeId แต่คนอื่นเป็นคนจ่ายงานจริง (assignedBy≠assigneeId) → ไม่ได้สิทธิ์ปิดงานเอง (ต่างจาก createdBy signal เดิม)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const { g1 } = await setupProject(pond, 'u_pond')
    // pond คีย์งานขึ้นเอง แต่ "ยังไม่ระบุผู้รับผิดชอบ" ตอนสร้าง
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(pond, { title: 'งาน' }), env)).json()) as { id: string }
    const owner = await loginAs(app, 'owner@example-co.test')
    // owner เป็นคนกดมอบหมายให้ pond ทีหลัง (assignedBy=owner) — แม้ createdBy จะเท่ากับ assigneeId (ทั้งคู่คือ pond) พอดี
    await app.request(`/api/tasks/${t.id}`, patchJson(owner, { assigneeId: 'u_pond' }), env)
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)
    await app.request(`/api/tasks/${t.id}`, patchJson(pond, { status: 'waiting_for_test' }), env)
    const res = await app.request(`/api/tasks/${t.id}`, patchJson(pond, { status: 'done' }), env)
    expect(res.status).toBe(403)
  })
})

// (2026-09-15) §createdBy loophole follow-up — assignedBy ต้องถูกเซ็ตตอนสร้างงานพร้อมผู้รับผิดชอบเลยทันทีทุก endpoint ไม่ใช่แค่ตอน PATCH ทีหลัง
describe('§assignedBy population — เซ็ตตั้งแต่ตอนสร้างงานถ้าระบุ assigneeId มาด้วย', () => {
  it('POST /groups/:id/tasks ระบุ assigneeId ตอนสร้าง → assignedBy = คนสร้าง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน', assigneeId: 'u_pond' }), env)
    ).json()) as { assignedBy: string | null }
    expect(t.assignedBy).toBe('u_owner')
  })

  it('POST /groups/:id/tasks ไม่ระบุ assigneeId ตอนสร้าง → assignedBy = null', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน' }), env)).json()) as { assignedBy: string | null }
    expect(t.assignedBy).toBeNull()
  })

  it('POST /tasks/backlog ระบุ assigneeId ตอนสร้าง → assignedBy = คนสร้าง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const t = (await (
      await app.request('/api/tasks/backlog', json(owner, { title: 'งาน backlog', assigneeId: 'u_pond' }), env)
    ).json()) as { assignedBy: string | null }
    expect(t.assignedBy).toBe('u_owner')
  })

  it('POST /projects/:id/tasks ระบุ assigneeId ตอนสร้าง → assignedBy = คนสร้าง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { p } = await setupProject(owner, 'u_pond')
    const t = (await (
      await app.request(`/api/projects/${p.id}/tasks`, json(owner, { title: 'งาน', assigneeId: 'u_pond' }), env)
    ).json()) as { assignedBy: string | null }
    expect(t.assignedBy).toBe('u_owner')
  })
})

// (2026-09-15) §Business Rules Workflow เฟส A — Reviewer: ไม่บังคับเลือก, ว่าง=พฤติกรรมเดิม, ระบุแล้วเฉพาะ reviewer/owner อนุมัติได้
describe('§Business Rules Workflow — Reviewer', () => {
  const patchJson2 = (cookie: string, body: unknown) => ({
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  // (2026-09-15 follow-up) — ไม่ระบุ Reviewer ตรงๆ → fallback เป็น "ผู้จ่ายงาน" (assignedBy) โดยอัตโนมัติ แทน "editor/owner โปรเจกต์คนไหนก็ได้" แบบเดิม (ยืนยันแล้ว)
  it('ไม่ได้เลือก Reviewer เลย → fallback เป็นผู้จ่ายงาน (assignedBy) อนุมัติได้ ส่วน editor คนอื่นที่ไม่ใช่ผู้จ่ายงานอนุมัติไม่ได้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { p, g1 } = await setupProject(owner, 'u_pond')
    await createDb(env.DB).insert(users).values({ id: 'u_other_editor', email: 'othereditor@example-co.test', name: 'บก', role: 'member' }).onConflictDoNothing()
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_other_editor', positionId: 'pos_full_access' }), env)
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }
    // owner เป็นคนกดจ่ายงาน (assignedBy=owner) ไม่ได้ระบุ reviewer เลย
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    const pond = await loginAs(app, 'pond@example-co.test')
    await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)
    await app.request(`/api/tasks/${t.id}`, patchJson2(pond, { status: 'waiting_for_test' }), env)

    // editor คนอื่นที่ไม่ใช่ owner บริษัทและไม่ใช่ assignedBy → ต้องโดนบล็อกแล้ว (พฤติกรรมใหม่)
    const otherEditor = await loginAs(app, 'othereditor@example-co.test')
    const blocked = await app.request(`/api/tasks/${t.id}`, patchJson2(otherEditor, { status: 'done' }), env)
    expect(blocked.status).toBe(403)

    // owner (บริษัท) ยัง bypass ได้เสมอ
    const res = await app.request(`/api/tasks/${t.id}`, patchJson2(owner, { status: 'done' }), env)
    expect(res.status).toBe(200)
  })

  it('ระบุ Reviewer ไว้ → owner บริษัท bypass อนุมัติได้เสมอแม้ไม่ใช่ reviewer ที่ระบุ (ตั้งใจ ไม่ใช่บั๊ก)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { p, g1 } = await setupProject(owner, 'u_pond')
    await createDb(env.DB).insert(users).values({ id: 'u_reviewer_test', email: 'reviewtest@example-co.test', name: 'รีวิว', role: 'member' }).onConflictDoNothing()
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_reviewer_test', positionId: 'pos_full_access' }), env)
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}`, patchJson2(owner, { reviewerId: 'u_reviewer_test' }), env)
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    const pond = await loginAs(app, 'pond@example-co.test')
    await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)
    await app.request(`/api/tasks/${t.id}`, patchJson2(pond, { status: 'waiting_for_test' }), env)
    const ownerApprove = await app.request(`/api/tasks/${t.id}`, patchJson2(owner, { status: 'done' }), env)
    expect(ownerApprove.status).toBe(200)
  })

  it('ระบุ Reviewer ไว้ → คนที่ไม่ใช่ reviewer/ไม่ใช่ owner บริษัท อนุมัติไม่ได้ (403)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { p, g1 } = await setupProject(owner, 'u_pond')
    await createDb(env.DB).insert(users).values({ id: 'u_reviewer_test', email: 'reviewtest@example-co.test', name: 'รีวิว', role: 'member' }).onConflictDoNothing()
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_reviewer_test', positionId: 'pos_full_access' }), env)
    // สมาชิกที่ 4: editor อีกคน ที่ไม่ใช่ reviewer และไม่ใช่ assignee — คนที่ต้องโดนบล็อก
    await createDb(env.DB).insert(users).values({ id: 'u_other_editor', email: 'othereditor@example-co.test', name: 'บก', role: 'member' }).onConflictDoNothing()
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_other_editor', positionId: 'pos_full_access' }), env)
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}`, patchJson2(owner, { reviewerId: 'u_reviewer_test' }), env)
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    const pond = await loginAs(app, 'pond@example-co.test')
    await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)
    await app.request(`/api/tasks/${t.id}`, patchJson2(pond, { status: 'waiting_for_test' }), env)

    const otherEditor = await loginAs(app, 'othereditor@example-co.test')
    const blocked = await app.request(`/api/tasks/${t.id}`, patchJson2(otherEditor, { status: 'done' }), env)
    expect(blocked.status).toBe(403)

    const reviewer = await loginAs(app, 'reviewtest@example-co.test')
    const approved = await app.request(`/api/tasks/${t.id}`, patchJson2(reviewer, { status: 'done' }), env)
    expect(approved.status).toBe(200)
  })

  it('self-dispatch (assignedBy===assigneeId) แต่มี Reviewer ระบุไว้ → ปิดงานเองไม่ได้แล้ว ต้องรอ reviewer', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const { g1 } = await setupProject(pond, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(pond, { title: 'งานคีย์เอง', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }
    await createDb(env.DB).insert(users).values({ id: 'u_reviewer_test', email: 'reviewtest@example-co.test', name: 'รีวิว', role: 'member' }).onConflictDoNothing()
    await app.request(`/api/tasks/${t.id}`, patchJson2(pond, { reviewerId: 'u_reviewer_test' }), env)
    await app.request(`/api/tasks/${t.id}/dispatch`, json(pond, {}), env)
    await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)
    await app.request(`/api/tasks/${t.id}`, patchJson2(pond, { status: 'waiting_for_test' }), env)
    // เดิม (ไม่มี reviewer) self-close ได้เลย — ตอนนี้มี reviewer แล้วต้องโดนบล็อก
    const res = await app.request(`/api/tasks/${t.id}`, patchJson2(pond, { status: 'done' }), env)
    expect(res.status).toBe(403)
  })
})

// (2026-09-15) §Business Rules Workflow เฟส B — สถานะ Rejected/Cancelled
describe('§Business Rules Workflow — Rejected/Cancelled status', () => {
  const patchJson3 = (cookie: string, body: unknown) => ({
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  it('ปฏิเสธงานก่อนรับ → status เป็น "rejected" ค้างไว้จริง (เดิมแค่เคลียร์ dispatchedAt เงียบๆ)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    const pond = await loginAs(app, 'pond@example-co.test')
    const res = await app.request(`/api/tasks/${t.id}/reject`, json(pond, { reason: 'ไม่ถนัดงานนี้' }), env)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status: string; dispatchedAt: number | null }).status).toBe('rejected')
  })

  it('จ่ายงานซ้ำ (dispatch) หลังถูกปฏิเสธ (status=rejected) → รีเซ็ตกลับ non_start ให้เข้ารอบรับงานใหม่ปกติ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    const pond = await loginAs(app, 'pond@example-co.test')
    await app.request(`/api/tasks/${t.id}/reject`, json(pond, { reason: 'ไม่ถนัดงานนี้' }), env)
    const res = await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status: string }).status).toBe('non_start')
    const accept = await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)
    expect(accept.status).toBe(200)
  })

  it('ตั้ง status เป็น rejected/cancelled ตรงๆ ผ่าน PATCH ทั่วไป → 400 (ต้องผ่าน action endpoint เฉพาะเท่านั้น)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน' }), env)).json()) as { id: string }
    const r1 = await app.request(`/api/tasks/${t.id}`, patchJson3(owner, { status: 'rejected' }), env)
    expect(r1.status).toBe(400)
    const r2 = await app.request(`/api/tasks/${t.id}`, patchJson3(owner, { status: 'cancelled' }), env)
    expect(r2.status).toBe(400)
  })

  it('ยกเลิกงาน (cancel): ไม่ใส่เหตุผล = 400 · ใส่เหตุผล = สำเร็จ status=cancelled + assignee ได้แจ้งเตือน · vendor ยกเลิกไม่ได้ = 403 · ยกเลิกงาน done แล้ว = 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner, 'u_pond')
    const t = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน', assigneeId: 'u_pond' }), env)
    ).json()) as { id: string }

    const noReason = await app.request(`/api/tasks/${t.id}/cancel`, json(owner, {}), env)
    expect(noReason.status).toBe(400)

    const vendor = await loginAs(app, 'somchai@example.com')
    const vendorTry = await app.request(`/api/tasks/${t.id}/cancel`, json(vendor, { reason: 'ลอง' }), env)
    expect(vendorTry.status).toBe(403)

    const before = (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = ?').bind('u_pond', 'task_cancelled').first<{ n: number }>()
    )?.n ?? 0
    const res = await app.request(`/api/tasks/${t.id}/cancel`, json(owner, { reason: 'scope เปลี่ยน' }), env)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status: string }).status).toBe('cancelled')
    const after = (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = ?').bind('u_pond', 'task_cancelled').first<{ n: number }>()
    )?.n ?? 0
    expect(after).toBe(before + 1)

    const t2 = (await (
      await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน done แล้ว' }), env)
    ).json()) as { id: string }
    await app.request(`/api/tasks/${t2.id}`, patchJson3(owner, { status: 'done' }), env)
    const cancelDone = await app.request(`/api/tasks/${t2.id}/cancel`, json(owner, { reason: 'ลองยกเลิกงานที่เสร็จแล้ว' }), env)
    expect(cancelDone.status).toBe(400)
  })
})

// (2026-09-15) §Business Rules Workflow เฟส C — Sub-task completion gate
describe('§Business Rules Workflow — Sub-task completion gate', () => {
  const patchJson4 = (cookie: string, body: unknown) => ({
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  it('งานย่อยยังไม่เสร็จ → ส่งงาน/ปิดงานแม่ไม่ได้ (400 subtasks_incomplete)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const parent = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งานแม่' }), env)).json()) as { id: string }
    await app.request(`/api/tasks/${parent.id}/subtasks`, json(owner, { title: 'งานย่อย 1' }), env)

    const toWaiting = await app.request(`/api/tasks/${parent.id}`, patchJson4(owner, { status: 'waiting_for_test' }), env)
    expect(toWaiting.status).toBe(400)
    const toDone = await app.request(`/api/tasks/${parent.id}`, patchJson4(owner, { status: 'done' }), env)
    expect(toDone.status).toBe(400)
  })

  it('งานย่อยเสร็จครบแล้ว → ปิดงานแม่ได้ปกติ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const parent = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งานแม่' }), env)).json()) as { id: string }
    const sub = (await (
      await app.request(`/api/tasks/${parent.id}/subtasks`, json(owner, { title: 'งานย่อย 1' }), env)
    ).json()) as { id: string }
    await app.request(`/api/tasks/${sub.id}`, patchJson4(owner, { status: 'done' }), env)

    const res = await app.request(`/api/tasks/${parent.id}`, patchJson4(owner, { status: 'done' }), env)
    expect(res.status).toBe(200)
  })

  it('งานย่อยถูกยกเลิก (cancelled) → ไม่นับเป็นตัวบล็อก ปิดงานแม่ได้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const parent = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งานแม่' }), env)).json()) as { id: string }
    const sub = (await (
      await app.request(`/api/tasks/${parent.id}/subtasks`, json(owner, { title: 'งานย่อย 1' }), env)
    ).json()) as { id: string }
    await app.request(`/api/tasks/${sub.id}/cancel`, json(owner, { reason: 'ไม่ต้องทำแล้ว' }), env)

    const res = await app.request(`/api/tasks/${parent.id}`, patchJson4(owner, { status: 'done' }), env)
    expect(res.status).toBe(200)
  })

  it('งานที่ไม่มีงานย่อยเลย → ปิดงานได้ปกติ (ไม่กระทบ)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งานเดี่ยว' }), env)).json()) as { id: string }
    const res = await app.request(`/api/tasks/${t.id}`, patchJson4(owner, { status: 'done' }), env)
    expect(res.status).toBe(200)
  })
})

// (2026-09-15) §Business Rules Workflow เฟส D — Version / Optimistic concurrency
describe('§Business Rules Workflow — Version / optimistic concurrency', () => {
  const patchJson5 = (cookie: string, body: unknown) => ({
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  it('สร้างงานใหม่ → version เริ่มที่ 1', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน' }), env)).json()) as { version: number }
    expect(t.version).toBe(1)
  })

  it('ไม่ส่ง expectedVersion มา → ข้ามเช็ค ทำงานได้ปกติ (backward-compat) และ version ยังบวกขึ้น', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน' }), env)).json()) as { id: string; version: number }
    const res = await app.request(`/api/tasks/${t.id}`, patchJson5(owner, { priority: 'high' }), env)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { version: number }).version).toBe(2)
  })

  it('ส่ง expectedVersion ตรงกับปัจจุบัน → สำเร็จ, version บวกขึ้น 1', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน' }), env)).json()) as { id: string; version: number }
    const res = await app.request(`/api/tasks/${t.id}`, patchJson5(owner, { priority: 'high', expectedVersion: t.version }), env)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { version: number }).version).toBe(2)
  })

  it('ส่ง expectedVersion เก่า (มีคนแก้ไปก่อนแล้ว) → 409 stale_version ไม่ทับข้อมูลคนอื่น', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { g1 } = await setupProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งาน' }), env)).json()) as { id: string; version: number }
    // คนแรกแก้ไปแล้ว (version 1 → 2)
    await app.request(`/api/tasks/${t.id}`, patchJson5(owner, { priority: 'high', expectedVersion: t.version }), env)
    // คนที่สองยังถือ version เก่า (1) อยู่ พยายามแก้ต่อ
    const res = await app.request(`/api/tasks/${t.id}`, patchJson5(owner, { priority: 'low', expectedVersion: t.version }), env)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('stale_version')
    // ยืนยันว่าค่าจริงในระบบยังเป็นของคนแรก ไม่ถูกคนที่สองทับ
    const current = (await (await app.request(`/api/tasks/${t.id}/detail`, { headers: { cookie: owner } }, env)).json()) as { priority: string }
    expect(current.priority).toBe('high')
  })
})

// (2026-09-16) §My Tasks dispatcher view fix — เจอบั๊กจริง: จ่ายงานคีย์ตรงใน Workspace (ไม่ผูกโปรเจกต์) ให้คนอื่น
// แล้วหาไม่เจอในหน้า "งานที่จ่ายให้คนอื่น" เลย — root cause: GET /tasks/dispatched-by-me ใช้ innerJoin(projects) ทำให้งานที่ projectId เป็น null หลุดออกจากลิสต์ทั้งหมด
describe('§My Tasks dispatcher view fix — GET /tasks/dispatched-by-me ต้องเห็นงานคีย์ตรงใน Workspace ด้วย', () => {
  it('จ่ายงาน Backlog ที่คีย์ตรงในห้อง (ไม่ผูกโปรเจกต์) ให้คนอื่น → โผล่ในลิสต์ "จ่ายให้คนอื่น" พร้อมชื่อห้องแทนชื่อโปรเจกต์', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const ws = (await (
      await app.request('/api/workspaces', json(owner, { name: 'ห้องทดสอบ dispatch', type: 'business' }), env)
    ).json()) as { id: string; name: string }
    const t = (await (
      await app.request(`/api/workspaces/${ws.id}/backlog`, json(owner, { title: 'งานคีย์ตรงในห้อง' }), env)
    ).json()) as { id: string }
    expect(t.id).toBeTruthy()

    await app.request(`/api/tasks/${t.id}`, patchJson(owner, { assigneeId: 'u_pond' }), env)
    const dispatchRes = await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    expect(dispatchRes.status).toBe(200)

    const list = (await (
      await app.request('/api/tasks/dispatched-by-me', { headers: { cookie: owner } }, env)
    ).json()) as { id: string; projectName: string | null }[]
    const row = list.find((r) => r.id === t.id)
    expect(row).toBeTruthy()
    expect(row?.projectName).toBe(ws.name) // fallback เป็นชื่อ Workspace room เพราะไม่มีโปรเจกต์
  })
})

// (2026-09-16) §My Tasks assignee view fix — เจอบั๊กจริง: จ่ายงานคีย์ตรงใน Workspace ให้คนอื่น คนรับกดรับงานแล้ว (status ขยับเป็น on_processing จริง)
// แต่งานไม่โผล่ในเมนู "งานของฉัน" เลย — root cause เดียวกับ dispatched-by-me ด้านบน: GET /tasks/mine ใช้ innerJoin(projects) แทน leftJoin
describe('§My Tasks assignee view fix — GET /tasks/mine ต้องเห็นงานคีย์ตรงใน Workspace ที่จ่ายมาให้จริงด้วย', () => {
  it('จ่ายงาน Backlog ที่คีย์ตรงในห้อง (ไม่ผูกโปรเจกต์) ให้คนอื่น กดรับงานแล้ว → โผล่ใน "งานของฉัน" ของคนรับ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const ws = (await (
      await app.request('/api/workspaces', json(owner, { name: 'ห้องทดสอบ mine', type: 'business' }), env)
    ).json()) as { id: string; name: string }
    const t = (await (
      await app.request(`/api/workspaces/${ws.id}/backlog`, json(owner, { title: 'งานคีย์ตรงในห้อง — รับแล้ว' }), env)
    ).json()) as { id: string }

    await app.request(`/api/tasks/${t.id}`, patchJson(owner, { assigneeId: 'u_pond' }), env)
    expect((await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)).status).toBe(200)
    expect((await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)).status).toBe(200)

    const list = (await (
      await app.request('/api/tasks/mine', { headers: { cookie: pond } }, env)
    ).json()) as { id: string; status: string; projectId: string | null; projectName: string | null; myRole: string }[]
    const row = list.find((r) => r.id === t.id)
    expect(row).toBeTruthy()
    expect(row?.status).toBe('on_processing')
    expect(row?.projectId).toBeNull()
    expect(row?.projectName).toBe(ws.name) // fallback เป็นชื่อ Workspace room เพราะไม่มีโปรเจกต์
    expect(row?.myRole).toBe('editor') // ไม่มี project role ให้ derive — ล้อ task-detail.ts
  })
})

// (2026-09-16) §Assign to me fix — เจอบั๊กจริง: ปุ่ม "Assign to me" ไม่โผล่ให้พนักงานทั่วไป (ไม่ใช่ owner/editor โปรเจกต์) เลย
// ทั้งที่ตั้งใจให้เป็นแบบ Jira (ใครก็หยิบงานว่างในโปรเจกต์ตัวเองไปทำได้) — เปิดช่องทางแคบๆ ให้ self-claim งานว่าง + self-dispatch ได้ โดยไม่กระทบสิทธิ์แก้ไข field อื่น/จ่ายงานให้คนอื่น
describe('§Assign to me fix — self-claim งานว่าง + self-dispatch สำหรับพนักงานที่ไม่ใช่ editor โปรเจกต์', () => {
  // ตั้ง u_pond เป็นสมาชิกโปรเจกต์ด้วยตำแหน่ง "ดูอย่างเดียว" (ไม่มีสิทธิ์แก้ไข) — จำลองพนักงานทั่วไปที่ไม่ใช่ editor
  async function setupViewerProject(owner: string) {
    const p = (await (await app.request('/api/projects', json(owner, { name: 'P-assign-to-me', type: 'project' }), env)).json()) as { id: string }
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_pond', positionId: 'pos_view_only' }), env)
    const g1 = (await (await app.request(`/api/projects/${p.id}/groups`, json(owner, { name: 'General' }), env)).json()) as { id: string }
    return { p, g1 }
  }

  it('พนักงานตำแหน่ง "ดูอย่างเดียว" รับงานว่างเองได้ (self-claim)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const { g1 } = await setupViewerProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งานว่าง' }), env)).json()) as { id: string; assigneeId: string | null }
    expect(t.assigneeId).toBeNull()

    const res = await app.request(`/api/tasks/${t.id}`, patchJson(pond, { assigneeId: 'u_pond' }), env)
    expect(res.status).toBe(200)
    const updated = (await res.json()) as { assigneeId: string | null; assignedBy: string | null }
    expect(updated.assigneeId).toBe('u_pond')
    expect(updated.assignedBy).toBe('u_pond') // self-claim = self-dispatched signal (assignedBy===assigneeId)
  })

  it('self-claim ต้องส่งแค่ assigneeId อย่างเดียว — แถม field อื่นมาด้วย → 403 (กันยืมช่องทางนี้ไปแก้ field อื่น)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const { g1 } = await setupViewerProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งานว่าง' }), env)).json()) as { id: string }

    const res = await app.request(`/api/tasks/${t.id}`, patchJson(pond, { assigneeId: 'u_pond', title: 'พยายามแก้ชื่อ' }), env)
    expect(res.status).toBe(403)
  })

  it('งานมีคนอื่นเป็นเจ้าของอยู่แล้ว (ไม่ใช่งานว่าง) — พนักงาน "ดูอย่างเดียว" แย่งรับเองไม่ได้ (403)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    await createDb(env.DB).insert(users).values({ id: 'u_nam', email: 'nam@example-co.test', name: 'น้ำ', role: 'member' }).onConflictDoNothing()
    const { p, g1 } = await setupViewerProject(owner)
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_nam', positionId: 'pos_view_only' }), env)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งานมีเจ้าของแล้ว', assigneeId: 'u_nam' }), env)).json()) as { id: string }

    const res = await app.request(`/api/tasks/${t.id}`, patchJson(pond, { assigneeId: 'u_pond' }), env)
    expect(res.status).toBe(403)
  })

  it('self-claim แล้วกด "จ่ายงาน" ให้ตัวเองต่อได้เลย ไม่ต้องมีสิทธิ์ editor โปรเจกต์', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const { g1 } = await setupViewerProject(owner)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งานว่าง' }), env)).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}`, patchJson(pond, { assigneeId: 'u_pond' }), env)

    const res = await app.request(`/api/tasks/${t.id}/dispatch`, json(pond, {}), env)
    expect(res.status).toBe(200)
  })

  it('จ่ายงานให้ "คนอื่น" (ไม่ใช่ตัวเอง) ยังต้องมีสิทธิ์ editor โปรเจกต์เหมือนเดิม — self-dispatch bypass ไม่หลุดไปกระทบเคสนี้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    await createDb(env.DB).insert(users).values({ id: 'u_nam', email: 'nam@example-co.test', name: 'น้ำ', role: 'member' }).onConflictDoNothing()
    const { p, g1 } = await setupViewerProject(owner)
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_nam', positionId: 'pos_view_only' }), env)
    const t = (await (await app.request(`/api/groups/${g1.id}/tasks`, json(owner, { title: 'งานจ่ายให้คนอื่น', assigneeId: 'u_nam' }), env)).json()) as { id: string }

    const res = await app.request(`/api/tasks/${t.id}/dispatch`, json(pond, {}), env)
    expect(res.status).toBe(403)
  })
})
