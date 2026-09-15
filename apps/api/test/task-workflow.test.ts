import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

// Pronista §Task Workflow & Kanban drag constraints (2026-08-26)
// เดิม assignee ที่ "เป็น editor ของโปรเจกต์ด้วย" (เช่น จ่ายงานให้ตัวเอง) หลุดเช็ค isAssigneeOnly ไปเลย
// ลากข้าม non_start→done หรือ waiting_for_test→done เองได้อิสระผ่าน PATCH ตรงๆ (บั๊กเดิม)
// เทสต์ชุดนี้ยืนยันว่า assignee (ไม่ว่าจะมีสิทธิ์ editor ด้วยหรือไม่) เปลี่ยนสถานะข้ามขั้นตรวจงานเองไม่ได้แล้ว
// ยกเว้นงานที่ตัวเองคีย์ขึ้นมาเอง (createdBy === ตัวเอง) และฟีเจอร์ "ดึงงานกลับ" (waiting_for_test → on_processing)

beforeEach(async () => {
  await seedUsers()
})

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const patch = (cookie: string, body: unknown) => ({ ...json(cookie, body), method: 'PATCH' })

async function setupProject(ownerCookie: string, editorUserId: string) {
  const p = (await (
    await app.request('/api/projects', json(ownerCookie, { name: 'โปรเจกต์เทสต์', type: 'project' }), env)
  ).json()) as { id: string }
  await app.request(`/api/projects/${p.id}/members`, json(ownerCookie, { userId: editorUserId, positionId: 'pos_full_access' }), env)
  const g = (await (await app.request(`/api/projects/${p.id}/groups`, json(ownerCookie, { name: 'Dev' }), env)).json()) as { id: string }
  return { p, g }
}

describe('Pronista §Task Workflow — kanban drag / self-assign status transition guard', () => {
  it('assignee ที่เป็น editor โปรเจกต์ด้วย (self-assign) จ่ายงานให้ตัวเองแล้วยังกรอกฟิลด์ผู้จ่ายงานได้ครบ (estimate/priority ฯลฯ ไม่หายไปหลังเลือกตัวเอง)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const { g } = await setupProject(owner, 'u_pond')
    const t = (await (await app.request(`/api/groups/${g.id}/tasks`, json(pond, { title: 'งานจ่ายให้ตัวเอง' }), env)).json()) as { id: string }

    // pond (editor) มอบหมายให้ตัวเอง — ฟิลด์ผู้จ่ายงาน (estimate/priority) ต้องยังแก้ได้ปกติ (isAssigneeOnly ต้องเป็น false)
    const r1 = await app.request(`/api/tasks/${t.id}`, patch(pond, { assigneeId: 'u_pond', estimateMinutes: 120, priority: 'high' }), env)
    expect(r1.status).toBe(200)
    const body1 = (await r1.json()) as { estimateMinutes: number | null; priority: string }
    expect(body1.estimateMinutes).toBe(120)
    expect(body1.priority).toBe('high')
  })

  it('assignee (self-assign, เป็น editor ด้วย) ข้ามขั้นตอนตรวจงานเองไม่ได้ — ต้องผ่าน ส่งงาน/อนุมัติ ตามลำดับ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const { g } = await setupProject(owner, 'u_pond')
    // owner เป็นคนคีย์งาน (createdBy = owner) แล้วจ่ายให้ pond — pond ไม่ใช่ผู้คีย์งานเอง จึงไม่เข้าข้อยกเว้น
    const t = (await (await app.request(`/api/groups/${g.id}/tasks`, json(owner, { title: 'งานที่ owner คีย์' }), env)).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}`, patch(owner, { assigneeId: 'u_pond' }), env)
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)

    // ข้ามจาก on_processing ไป done ตรงๆ เอง — ต้องโดนกัน แม้ pond จะเป็น editor โปรเจกต์นี้ก็ตาม
    const skip = await app.request(`/api/tasks/${t.id}`, patch(pond, { status: 'done' }), env)
    expect(skip.status).toBe(403)

    // ขั้นตอนปกติ: ส่งงาน (on_processing → waiting_for_test) ทำได้
    const submit = await app.request(`/api/tasks/${t.id}`, patch(pond, { status: 'waiting_for_test' }), env)
    expect(submit.status).toBe(200)

    // pond พยายามอนุมัติปิดงานเอง — ต้องโดนกัน ต้องให้ผู้จ่ายงาน (owner) เป็นคนกด
    const selfApprove = await app.request(`/api/tasks/${t.id}`, patch(pond, { status: 'done' }), env)
    expect(selfApprove.status).toBe(403)

    // owner (ผู้จ่ายงาน ไม่ใช่ assignee) อนุมัติได้ตามปกติ ไม่โดนกฎนี้
    const approve = await app.request(`/api/tasks/${t.id}`, patch(owner, { status: 'done' }), env)
    expect(approve.status).toBe(200)
  })

  it('ดึงงานกลับ (waiting_for_test → on_processing) ทำได้ก่อนถูกอนุมัติ และแจ้งเตือนผู้จ่ายงาน', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const { g } = await setupProject(owner, 'u_pond')
    const t = (await (await app.request(`/api/groups/${g.id}/tasks`, json(owner, { title: 'งานส่งแล้วขอดึงกลับ' }), env)).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}`, patch(owner, { assigneeId: 'u_pond' }), env)
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)
    await app.request(`/api/tasks/${t.id}`, patch(pond, { status: 'waiting_for_test' }), env)

    const recall = await app.request(`/api/tasks/${t.id}`, patch(pond, { status: 'on_processing' }), env)
    expect(recall.status).toBe(200)
    expect(((await recall.json()) as { status: string }).status).toBe('on_processing')

    const notifs = (await (
      await app.request('/api/notifications', { headers: { cookie: owner } }, env)
    ).json()) as { type: string; taskId: string | null; message: string }[]
    expect(notifs.some((n) => n.type === 'task_recalled' && n.taskId === t.id)).toBe(true)
  })

  it('งานที่คีย์เอง (self-keyed) จ่ายให้ตัวเอง ปิดงานเองได้ทันที ข้ามขั้นตอนอนุมัติ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const { g } = await setupProject(owner, 'u_pond')
    // pond คีย์งานเอง (createdBy = pond) และมอบหมายให้ตัวเอง
    const t = (await (await app.request(`/api/groups/${g.id}/tasks`, json(pond, { title: 'งานคีย์เองปิดเอง' }), env)).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}`, patch(pond, { assigneeId: 'u_pond' }), env)

    // ข้ามจาก non_start ไป done ตรงๆ ได้เลย เพราะเป็นผู้คีย์งานเอง
    const closeSelf = await app.request(`/api/tasks/${t.id}`, patch(pond, { status: 'done' }), env)
    expect(closeSelf.status).toBe(200)
    expect(((await closeSelf.json()) as { status: string }).status).toBe('done')
  })

  it('งานที่ยังไม่ถูก "จ่ายงาน" (dispatchedAt ว่าง) เปลี่ยนสถานะเองได้อิสระ แม้ไม่ใช่งานที่คีย์เอง — ยังไม่เข้า workflow ตรวจงานจริง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const { g } = await setupProject(owner, 'u_pond')
    // owner คีย์งานแล้วมอบหมายให้ pond ทันที แต่ "ยังไม่ได้กดจ่ายงาน" (ไม่เรียก /dispatch)
    const t = (await (await app.request(`/api/groups/${g.id}/tasks`, json(owner, { title: 'งานที่ยังไม่จ่าย' }), env)).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}`, patch(owner, { assigneeId: 'u_pond' }), env)

    // pond ข้ามจาก non_start ไป done ตรงๆ ได้ ทั้งที่ไม่ใช่ผู้คีย์งานเอง เพราะงานยังไม่ถูกจ่ายอย่างเป็นทางการ
    const skip = await app.request(`/api/tasks/${t.id}`, patch(pond, { status: 'done' }), env)
    expect(skip.status).toBe(200)
  })

  it('assignee ที่ไม่มีสิทธิ์ editor โปรเจกต์เลย (assignee-only) ยังคงจำกัดแค่กด "ส่งงาน" เหมือนเดิม', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const p = (await (await app.request('/api/projects', json(owner, { name: 'โปรเจกต์ view-only', type: 'project' }), env)).json()) as { id: string }
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_pond', positionId: 'pos_view_only' }), env)
    const g = (await (await app.request(`/api/projects/${p.id}/groups`, json(owner, { name: 'Dev' }), env)).json()) as { id: string }
    const t = (await (await app.request(`/api/groups/${g.id}/tasks`, json(owner, { title: 'งาน view-only' }), env)).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}`, patch(owner, { assigneeId: 'u_pond' }), env)
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)

    // แก้ฟิลด์อื่นนอกจาก assigneeNotes/status ไม่ได้เลย (เดิมมีอยู่แล้ว)
    expect((await app.request(`/api/tasks/${t.id}`, patch(pond, { priority: 'high' }), env)).status).toBe(403)
    // ข้ามสถานะเองไม่ได้ (เดิมมีอยู่แล้ว)
    expect((await app.request(`/api/tasks/${t.id}`, patch(pond, { status: 'done' }), env)).status).toBe(403)
    // ส่งงานได้ปกติ
    expect((await app.request(`/api/tasks/${t.id}`, patch(pond, { status: 'waiting_for_test' }), env)).status).toBe(200)
    // ดึงงานกลับได้เหมือนกัน (ฟีเจอร์ใหม่ ใช้ได้ทั้ง assignee-only และ self-assign editor)
    expect((await app.request(`/api/tasks/${t.id}`, patch(pond, { status: 'on_processing' }), env)).status).toBe(200)
  })

  // Pronista §Workspace/Task Jira-alignment (2026-09-07) — ผู้จ่ายงานจริง (assignedBy) กับผู้รับผิดชอบเป็นคนเดียวกัน ให้แก้ "รายละเอียดจากผู้จ่ายงาน" (description) ได้เอง แม้ภายหลังจะกลายเป็น assignee-only (ตำแหน่งถูกลดสิทธิ์)
  it('assignee-only ที่เคยเป็นผู้จ่ายงานให้ตัวเอง (assignedBy = ตัวเอง) แก้ description ได้ แต่ฟิลด์อื่นยังโดนกันเหมือนเดิม', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const { p, g } = await setupProject(owner, 'u_pond') // pond ได้ pos_full_access (editor) ตอนนี้
    const t = (await (await app.request(`/api/groups/${g.id}/tasks`, json(pond, { title: 'งานจ่ายให้ตัวเองแล้วโดนลดสิทธิ์' }), env)).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}`, patch(pond, { assigneeId: 'u_pond' }), env)
    // pond ยังเป็น editor ตอนนี้ — /dispatch ผ่านได้ → assignedBy บันทึกเป็น pond
    expect((await app.request(`/api/tasks/${t.id}/dispatch`, json(pond, {}), env)).status).toBe(200)
    await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)

    // ลดสิทธิ์ pond เป็น view-only ภายหลัง — ตอนนี้กลายเป็น assignee-only แล้ว
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_pond', positionId: 'pos_view_only' }), env)

    // แก้ description เองได้ เพราะเป็นผู้จ่ายงานตัวเองมาก่อน (assignedBy === assigneeId)
    const editDesc = await app.request(`/api/tasks/${t.id}`, patch(pond, { description: 'อัปเดตรายละเอียดเอง' }), env)
    expect(editDesc.status).toBe(200)
    expect(((await editDesc.json()) as { description: string | null }).description).toBe('อัปเดตรายละเอียดเอง')

    // ฟิลด์อื่นนอกเหนือ description/assigneeNotes/status ยังโดนกันเหมือนเดิม (ไม่ใช่ bypass ทั้งหมด)
    expect((await app.request(`/api/tasks/${t.id}`, patch(pond, { priority: 'high' }), env)).status).toBe(403)
  })

  // Pronista §Workspace/Task Jira-alignment (2026-09-07 fix) — ปุ่ม "บันทึกเพื่ออัปเดตข้อมูล" ใหม่ (เฟส D) ส่ง notifyOnUpdate:true แนบมาด้วยเสมอ
  // ซึ่งไม่ใช่ฟิลด์จริง (ถูกลบออกก่อนบันทึกจริง) — allowedKeys ของ assignee-only ต้องไม่นับ notifyOnUpdate เป็นฟิลด์ต้องห้าม ไม่งั้น assigneeNotes ที่อนุญาตอยู่แล้วจะโดน 403 ไปด้วย
  it('assignee-only บันทึก assigneeNotes ผ่านปุ่มใหม่ (แนบ notifyOnUpdate มาด้วย) ต้องผ่านปกติ ไม่โดน 403', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const p = (await (await app.request('/api/projects', json(owner, { name: 'โปรเจกต์ view-only 2', type: 'project' }), env)).json()) as { id: string }
    await app.request(`/api/projects/${p.id}/members`, json(owner, { userId: 'u_pond', positionId: 'pos_view_only' }), env)
    const g = (await (await app.request(`/api/projects/${p.id}/groups`, json(owner, { name: 'Dev' }), env)).json()) as { id: string }
    const t = (await (await app.request(`/api/groups/${g.id}/tasks`, json(owner, { title: 'งาน view-only 2' }), env)).json()) as { id: string }
    await app.request(`/api/tasks/${t.id}`, patch(owner, { assigneeId: 'u_pond' }), env)
    await app.request(`/api/tasks/${t.id}/dispatch`, json(owner, {}), env)
    await app.request(`/api/tasks/${t.id}/accept`, json(pond, {}), env)

    const save = await app.request(`/api/tasks/${t.id}`, patch(pond, { assigneeNotes: 'ทำไปถึงไหนแล้ว', notifyOnUpdate: true }), env)
    expect(save.status).toBe(200)
    expect(((await save.json()) as { assigneeNotes: string | null }).assigneeNotes).toBe('ทำไปถึงไหนแล้ว')
  })
})
