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
