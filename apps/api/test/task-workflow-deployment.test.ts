import { companyConfig, createDb, notifications, tasks, users } from '@seedoffice/db'
import { DEFAULT_WORKFLOW_CONFIG } from '@seedoffice/core'
import { env } from 'cloudflare:test'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

// Pronista §Task status workflow phase 2 (2026-10-02) — flow Deployment: ส่ง→Testing on STG→ผ่าน STG(QA)→อนุมัติ(BA)→Ready for PRD→Deploy แล้ว→Testing on PRD→ผ่าน→Done
const DEV = 'u_dev'
const QA = 'u_qa'
const BA = 'u_ba'

const post = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const put = (cookie: string, body: unknown) => ({ ...post(cookie, body), method: 'PUT' })

async function setConfig(enabled: boolean, extra: Record<string, unknown> = {}) {
  const db = createDb(env.DB)
  await db
    .update(companyConfig)
    .set({ workflowConfig: { ...DEFAULT_WORKFLOW_CONFIG, enabled, ...extra } })
    .where(eq(companyConfig.id, 1))
}

let seq = 0
async function makeTask(over: Partial<typeof tasks.$inferInsert> = {}) {
  const db = createDb(env.DB)
  seq += 1
  const row = (
    await db
      .insert(tasks)
      .values({
        title: `งานเทสต์ ${seq}`,
        sortOrder: seq,
        createdBy: 'u_owner',
        assigneeId: DEV,
        assignedBy: BA,
        reviewerId: QA,
        dispatchedAt: new Date(),
        acceptedAt: new Date(),
        status: 'on_processing',
        ...over,
      })
      .returning()
  )[0]!
  return row
}

const getTask = async (id: string) => (await createDb(env.DB).select().from(tasks).where(eq(tasks.id, id)).limit(1))[0]!
const notifCount = async (userId: string, type: string) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = ?').bind(userId, type).first<{ n: number }>())?.n ?? 0

const act = (cookie: string, id: string, action: string, reason?: string) =>
  app.request(`/api/tasks/${id}/workflow-action`, post(cookie, { action, reason }), env)

let dev: string
let qa: string
let ba: string
let owner: string

beforeEach(async () => {
  await seedUsers()
  const db = createDb(env.DB)
  await db
    .insert(users)
    .values([
      { id: DEV, email: 'dev@example-co.test', name: 'เดฟ', role: 'member' },
      { id: QA, email: 'qa@example-co.test', name: 'คิวเอ', role: 'member' },
      { id: BA, email: 'ba@example-co.test', name: 'บีเอ', role: 'member' },
    ])
    .onConflictDoNothing()
  await env.DB.prepare('DELETE FROM notifications').run()
  await env.DB.prepare('DELETE FROM tasks').run()
  await setConfig(true)
  dev = await loginAs(app, 'dev@example-co.test')
  qa = await loginAs(app, 'qa@example-co.test')
  ba = await loginAs(app, 'ba@example-co.test')
  owner = await loginAs(app, 'owner@example-co.test')
})

afterAll(async () => {
  await createDb(env.DB).update(companyConfig).set({ workflowConfig: null }).where(eq(companyConfig.id, 1))
})

describe('workflow-action — สวิตช์ปิด/ประเภทงาน', () => {
  it('สวิตช์ปิด → 409 workflow_disabled (ไม่แตะงาน)', async () => {
    await setConfig(false)
    const t = await makeTask()
    const res = await act(dev, t.id, 'submit')
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('workflow_disabled')
    expect((await getTask(t.id)).status).toBe('on_processing')
  })

  it('งานประเภท Document ใช้ flow เดิม → 409 not_deployment_flow', async () => {
    const t = await makeTask({ taskType: 'type_document' })
    await createDb(env.DB)
      .update(companyConfig)
      .set({ taskTypes: [{ id: 'type_document', name: 'Document', sortOrder: 1, subTypes: [] }] })
      .where(eq(companyConfig.id, 1))
    const res = await act(dev, t.id, 'submit')
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('not_deployment_flow')
    await createDb(env.DB).update(companyConfig).set({ taskTypes: null }).where(eq(companyConfig.id, 1))
  })

  it('งานที่ยังไม่ได้จ่าย (ไม่มี dispatchedAt) → 400 not_dispatched', async () => {
    const t = await makeTask({ dispatchedAt: null })
    const res = await act(dev, t.id, 'submit')
    expect(res.status).toBe(400)
  })
})

describe('workflow-action — เส้นทางหลักครบทุกบทบาท', () => {
  it('Dev ส่ง → QA ผ่าน STG → BA อนุมัติ → Dev Deploy แล้ว → BA ผ่าน PRD → Done พร้อมแจ้งเตือนทุกขั้น', async () => {
    const t = await makeTask()

    // 1) Dev ส่งงาน → Testing on STG · testRound=1 · แจ้ง QA (reviewer) + BA
    let res = await act(dev, t.id, 'submit')
    expect(res.status).toBe(200)
    let row = await getTask(t.id)
    expect(row.status).toBe('testing_stg')
    expect(row.testRound).toBe(1)
    expect(row.stageAt).not.toBeNull()
    expect(row.stgPassedAt).toBeNull()
    expect(await notifCount(QA, 'task_review_requested')).toBe(1)
    expect(await notifCount(BA, 'task_submitted')).toBe(1)

    // 2) QA กด "ผ่าน STG" → สถานะเดิม แต่มี stgPassedAt · แจ้ง BA
    res = await act(qa, t.id, 'stg_pass')
    expect(res.status).toBe(200)
    row = await getTask(t.id)
    expect(row.status).toBe('testing_stg')
    expect(row.stgPassedAt).not.toBeNull()
    expect(row.stgPassedBy).toBe(QA)
    expect(await notifCount(BA, 'task_test_passed')).toBe(1)

    // 3) BA อนุมัติ → Ready for PRD · แจ้ง Dev
    res = await act(ba, t.id, 'stg_approve')
    expect(res.status).toBe(200)
    expect((await getTask(t.id)).status).toBe('ready_for_prd')
    expect(await notifCount(DEV, 'task_stg_approved')).toBe(1)

    // 4) Dev กด "Deploy แล้ว" → Testing on PRD · แจ้ง BA + QA
    res = await act(dev, t.id, 'deployed')
    expect(res.status).toBe(200)
    expect((await getTask(t.id)).status).toBe('testing_prd')
    expect(await notifCount(BA, 'task_deployed')).toBe(1)
    expect(await notifCount(QA, 'task_deployed')).toBe(1)

    // 5) BA ผ่าน PRD → Done · completedAt · แจ้ง Dev + QA
    res = await act(ba, t.id, 'prd_pass')
    expect(res.status).toBe(200)
    row = await getTask(t.id)
    expect(row.status).toBe('done')
    expect(row.completedAt).not.toBeNull()
    expect(await notifCount(DEV, 'task_prd_passed')).toBe(1)
    expect(await notifCount(QA, 'task_prd_passed')).toBe(1)
    expect(row.version).toBeGreaterThan(5)
  })

  it('QA ไม่ผ่าน (fail) ต้องใส่เหตุผล → กลับ On Processing · ล้าง stgPassed · แจ้ง Dev พร้อมเหตุผล', async () => {
    const t = await makeTask({ status: 'testing_stg', testRound: 1, stageAt: new Date() })
    expect((await act(qa, t.id, 'fail')).status).toBe(400) // ไม่มีเหตุผล
    const res = await act(qa, t.id, 'fail', 'ปุ่มบันทึกไม่ทำงาน')
    expect(res.status).toBe(200)
    const row = await getTask(t.id)
    expect(row.status).toBe('on_processing')
    expect(row.stgPassedAt).toBeNull()
    const n = await env.DB.prepare('SELECT message FROM notifications WHERE user_id = ? AND type = ?').bind(DEV, 'task_test_failed').first<{ message: string }>()
    expect(n?.message).toContain('ปุ่มบันทึกไม่ทำงาน')
  })

  it('ส่งรอบสอง (หลัง fail) → testRound เพิ่มเป็น 2', async () => {
    const t = await makeTask({ status: 'testing_stg', testRound: 1 })
    await act(qa, t.id, 'fail', 'พัง')
    await act(dev, t.id, 'submit')
    expect((await getTask(t.id)).testRound).toBe(2)
  })

  it('Dev ดึงงานกลับ (recall) ได้ก่อน QA กดผ่าน แต่หลังผ่านแล้วดึงไม่ได้', async () => {
    const t = await makeTask({ status: 'testing_stg', testRound: 1 })
    expect((await act(dev, t.id, 'recall')).status).toBe(200)
    expect((await getTask(t.id)).status).toBe('on_processing')
    await createDb(env.DB).update(tasks).set({ status: 'testing_stg', stgPassedAt: new Date(), stgPassedBy: QA }).where(eq(tasks.id, t.id))
    expect((await act(dev, t.id, 'recall')).status).toBe(403)
  })

  it('ผู้ตรวจ = ผู้จ่ายงานคนเดียวกัน → อนุมัติ STG ได้เลยไม่ต้องกดผ่านก่อน', async () => {
    const t = await makeTask({ reviewerId: BA, status: 'testing_stg', testRound: 1 })
    expect((await act(ba, t.id, 'stg_approve')).status).toBe(200)
    expect((await getTask(t.id)).status).toBe('ready_for_prd')
  })
})

describe('workflow-action — สิทธิ์', () => {
  it('คนนอกบทบาทกดไม่ได้ (403) · BA อนุมัติ STG ก่อน QA ผ่านไม่ได้', async () => {
    const t = await makeTask({ status: 'testing_stg', testRound: 1 })
    expect((await act(dev, t.id, 'stg_pass')).status).toBe(403) // Dev ผ่านเองไม่ได้
    expect((await act(ba, t.id, 'stg_approve')).status).toBe(403) // ยังไม่ผ่าน STG
    expect((await act(qa, t.id, 'stg_approve')).status).toBe(403) // QA ไม่ใช่ผู้จ่ายงาน
    expect((await act(qa, t.id, 'prd_pass')).status).toBe(403)
    expect((await getTask(t.id)).status).toBe('testing_stg')
  })

  it('ข้ามขั้นไม่ได้: Dev กด deployed ตอน On Processing → 403', async () => {
    const t = await makeTask()
    expect((await act(dev, t.id, 'deployed')).status).toBe(403)
  })

  it('owner บริษัททำแทนได้ทุกบทบาท', async () => {
    const t = await makeTask({ status: 'ready_for_prd' })
    expect((await act(owner, t.id, 'deployed')).status).toBe(200)
    expect((await act(owner, t.id, 'prd_pass')).status).toBe(200)
    expect((await getTask(t.id)).status).toBe('done')
  })
})

describe('workflow-action — งานแม่/งานลูก (แม่ห้ามล้ำหน้าลูก)', () => {
  it('งานแม่ส่ง STG ไม่ได้ถ้างานลูกยังอยู่ On Processing → 400 subtasks_incomplete', async () => {
    const parent = await makeTask()
    await makeTask({ parentId: parent.id, status: 'on_processing' })
    const res = await act(dev, parent.id, 'submit')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('subtasks_incomplete')
  })

  it('งานลูกถึง STG แล้ว (หรือยกเลิก) → งานแม่ส่งได้ · แต่อนุมัติไป Ready for PRD ต้องรอลูกถึง Ready for PRD', async () => {
    const parent = await makeTask()
    const child = await makeTask({ parentId: parent.id, status: 'testing_stg' })
    await makeTask({ parentId: parent.id, status: 'cancelled' })
    expect((await act(dev, parent.id, 'submit')).status).toBe(200)
    await act(qa, parent.id, 'stg_pass')
    const blocked = await act(ba, parent.id, 'stg_approve')
    expect(blocked.status).toBe(400)
    await createDb(env.DB).update(tasks).set({ status: 'ready_for_prd' }).where(eq(tasks.id, child.id))
    expect((await act(ba, parent.id, 'stg_approve')).status).toBe(200)
  })
})

describe('PATCH — ปิดช่อง "เปลี่ยนสถานะตรงๆ" ของ flow Deployment', () => {
  const patch = (cookie: string, id: string, body: unknown) =>
    app.request(`/api/tasks/${id}`, { ...post(cookie, body), method: 'PATCH' }, env)

  it('สวิตช์เปิด + flow Deployment → PATCH status เป็น waiting_for_test/done โดนบล็อก use_workflow_action', async () => {
    const t = await makeTask()
    for (const status of ['waiting_for_test', 'done']) {
      const res = await patch(owner, t.id, { status })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('use_workflow_action')
    }
    expect((await getTask(t.id)).status).toBe('on_processing')
  })

  it('PATCH ย้ายงานที่อยู่ Testing on STG ออกตรงๆ ไม่ได้ · แต่แก้ฟิลด์อื่น (ชื่อ) ได้ปกติ', async () => {
    const t = await makeTask({ status: 'testing_stg' })
    expect((await patch(owner, t.id, { status: 'on_processing' })).status).toBe(400)
    expect((await patch(owner, t.id, { title: 'ชื่อใหม่' })).status).toBe(200)
  })

  it('สวิตช์ปิด → ยังใช้ PATCH waiting_for_test แบบเดิมได้ (ไม่กระทบ flow เดิม)', async () => {
    await setConfig(false)
    const t = await makeTask()
    const res = await patch(owner, t.id, { status: 'waiting_for_test' })
    expect(res.status).toBe(200)
  })

  it('งาน Document เปลี่ยนสถานะผ่าน PATCH แบบเดิมได้แม้สวิตช์เปิด', async () => {
    await createDb(env.DB)
      .update(companyConfig)
      .set({ taskTypes: [{ id: 'type_document', name: 'Document', sortOrder: 1, subTypes: [] }] })
      .where(eq(companyConfig.id, 1))
    const t = await makeTask({ taskType: 'type_document' })
    expect((await patch(owner, t.id, { status: 'waiting_for_test' })).status).toBe(200)
    await createDb(env.DB).update(companyConfig).set({ taskTypes: null }).where(eq(companyConfig.id, 1))
  })
})

describe('คิว "งานรอตรวจ" + badge', () => {
  const queue = async (cookie: string) =>
    (await (await app.request('/api/tasks/pending-review', { headers: { cookie } }, env)).json()) as { id: string; queueReason?: string }[]
  const stamp = async (cookie: string) =>
    (await (await app.request('/api/notifications/stamp', { headers: { cookie } }, env)).json()) as { review: number }

  it('QA เห็นงาน STG ที่ยังไม่ผ่าน (review) · พอผ่านแล้วย้ายไปคิวของ BA (approve_stg)', async () => {
    const t = await makeTask({ status: 'testing_stg', testRound: 1, stageAt: new Date() })
    expect((await queue(qa)).map((r) => [r.id, r.queueReason])).toEqual([[t.id, 'review']])
    expect(await queue(ba)).toEqual([])
    expect((await stamp(qa)).review).toBe(1)

    await act(qa, t.id, 'stg_pass')
    expect(await queue(qa)).toEqual([])
    expect((await queue(ba)).map((r) => [r.id, r.queueReason])).toEqual([[t.id, 'approve_stg']])
    expect((await stamp(ba)).review).toBe(1)
  })

  it('Testing on PRD อยู่ในคิวของ BA (confirm_prd)', async () => {
    const t = await makeTask({ status: 'testing_prd', stageAt: new Date() })
    expect((await queue(ba)).map((r) => [r.id, r.queueReason])).toEqual([[t.id, 'confirm_prd']])
  })

  it('กดเข้าเมนู (seen) → badge เป็น 0 · มีขั้นใหม่หลังจากนั้นนับใหม่', async () => {
    const t = await makeTask({ status: 'testing_stg', testRound: 1, stageAt: new Date() })
    expect((await stamp(qa)).review).toBe(1)
    await app.request('/api/tasks/pending-review/seen', post(qa, {}), env)
    expect((await stamp(qa)).review).toBe(0)
    // ผ่านแล้วกลับมาแก้ ส่งรอบใหม่ → ใหม่อีกครั้ง
    await new Promise((r) => setTimeout(r, 5))
    await act(qa, t.id, 'fail', 'พัง')
    await new Promise((r) => setTimeout(r, 5))
    await act(dev, t.id, 'submit')
    expect((await stamp(qa)).review).toBe(1)
  })

  it('สวิตช์ปิด → คิวเหมือนเดิม (เฉพาะ waiting_for_test)', async () => {
    await setConfig(false)
    await makeTask({ status: 'testing_stg' })
    const w = await makeTask({ status: 'waiting_for_test', submittedAt: new Date() })
    const q = await queue(qa)
    expect(q.map((r) => r.id)).toEqual([w.id])
  })
})

describe('GET /tasks/:id/detail — บล็อก workflow', () => {
  it('คืน flow/ขั้น/ปุ่มที่ฉันกดได้/ผลการทดสอบ', async () => {
    const t = await makeTask({ status: 'testing_stg', testRound: 2, stgPassedAt: new Date(), stgPassedBy: QA })
    const detail = (await (await app.request(`/api/tasks/${t.id}/detail`, { headers: { cookie: ba } }, env)).json()) as {
      workflow: {
        enabled: boolean
        flowId: string
        steps: string[]
        actions: { action: string }[]
        testRound: number
        stgPassedByName: string | null
      }
    }
    expect(detail.workflow.enabled).toBe(true)
    expect(detail.workflow.flowId).toBe('deployment')
    expect(detail.workflow.steps).toContain('testing_stg')
    expect(detail.workflow.testRound).toBe(2)
    expect(detail.workflow.stgPassedByName).toBe('คิวเอ')
    expect(detail.workflow.actions.map((a) => a.action)).toEqual(expect.arrayContaining(['stg_approve', 'fail']))
  })

  it('สวิตช์ปิด → workflow.enabled=false และไม่มีปุ่ม', async () => {
    await setConfig(false)
    const t = await makeTask()
    const detail = (await (await app.request(`/api/tasks/${t.id}/detail`, { headers: { cookie: dev } }, env)).json()) as {
      workflow: { enabled: boolean; actions: unknown[] }
    }
    expect(detail.workflow.enabled).toBe(false)
    expect(detail.workflow.actions).toEqual([])
  })
})

describe('admin workflow-config', () => {
  it('owner เท่านั้นที่อ่าน/แก้ได้', async () => {
    expect((await app.request('/api/admin/workflow-config', { headers: { cookie: dev } }, env)).status).toBe(403)
    const res = await app.request('/api/admin/workflow-config', { headers: { cookie: owner } }, env)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { config: { enabled: boolean } }).config.enabled).toBe(true)
  })

  it('เปิดสวิตช์ครั้งแรก → งาน Deployment ที่ค้าง Waiting for Review ย้ายไป Testing on STG อัตโนมัติ (Document ไม่ย้าย)', async () => {
    await setConfig(false)
    await createDb(env.DB)
      .update(companyConfig)
      .set({ taskTypes: [{ id: 'type_document', name: 'Document', sortOrder: 1, subTypes: [] }] })
      .where(eq(companyConfig.id, 1))
    const dep = await makeTask({ status: 'waiting_for_test', submittedAt: new Date(1000) })
    const doc = await makeTask({ status: 'waiting_for_test', taskType: 'type_document' })
    const res = await app.request(
      '/api/admin/workflow-config',
      put(owner, { config: { ...DEFAULT_WORKFLOW_CONFIG, enabled: true } }),
      env,
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { migrated: number }).migrated).toBe(1)
    const depRow = await getTask(dep.id)
    expect(depRow.status).toBe('testing_stg')
    expect(depRow.testRound).toBe(1)
    expect((await getTask(doc.id)).status).toBe('waiting_for_test')
    await createDb(env.DB).update(companyConfig).set({ taskTypes: null }).where(eq(companyConfig.id, 1))
  })

  it('ปิดสวิตช์ไม่ได้ขณะมีงานค้างอยู่ในขั้นของ Deployment → 409', async () => {
    await makeTask({ status: 'ready_for_prd' })
    const res = await app.request(
      '/api/admin/workflow-config',
      put(owner, { config: { ...DEFAULT_WORKFLOW_CONFIG, enabled: false } }),
      env,
    )
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('workflow_in_use')
  })

  it('config ไม่ถูกต้อง (flow ไม่ขึ้นต้น Non Start) → 400', async () => {
    const bad = { ...DEFAULT_WORKFLOW_CONFIG, enabled: true, workflows: [{ id: 'document', name: 'Document', steps: ['on_processing', 'done'] }] }
    const res = await app.request('/api/admin/workflow-config', put(owner, { config: bad }), env)
    expect(res.status).toBe(400)
  })
})

// กันเงียบ: ตรวจว่า type แจ้งเตือนใหม่ถูกเก็บจริง (ไม่โดน preference ปิด)
describe('แจ้งเตือน', () => {
  it('task_test_failed ถูกเก็บในตารางของ Dev', async () => {
    const t = await makeTask({ status: 'testing_prd' })
    await act(ba, t.id, 'fail', 'PRD พัง')
    const rows = await createDb(env.DB)
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, DEV), eq(notifications.type, 'task_test_failed')))
    expect(rows).toHaveLength(1)
  })
})
