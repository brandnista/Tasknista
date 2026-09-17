import { createDb, users } from '@seedoffice/db'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

const json = (cookie: string, body: unknown, method = 'POST') => ({
  method,
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const bangkokToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

async function suggestedTaskIds(cookie: string): Promise<string[]> {
  const body = (await (
    await app.request(`/api/daily-reports/suggested?date=${bangkokToday()}`, { headers: { cookie } }, env)
  ).json()) as { tasks: { id: string }[] }
  return body.tasks.map((task) => task.id)
}

async function setupRoleMappedTask(options: { assigneeId: string; reviewerId?: string }) {
  const owner = await loginAs(app, 'owner@example-co.test')
  const project = (await (
    await app.request('/api/projects', json(owner, { name: `Daily role ${crypto.randomUUID()}`, type: 'project' }), env)
  ).json()) as { id: string }
  for (const userId of [...new Set([options.assigneeId, options.reviewerId].filter((id): id is string => !!id && id !== 'u_owner'))]) {
    await app.request(`/api/projects/${project.id}/members`, json(owner, { userId, positionId: 'pos_full_access' }), env)
  }
  const group = (await (
    await app.request(`/api/projects/${project.id}/groups`, json(owner, { name: 'Daily Report' }), env)
  ).json()) as { id: string }
  const task = (await (
    await app.request(
      `/api/groups/${group.id}/tasks`,
      json(owner, { title: `งาน Daily ${crypto.randomUUID()}`, assigneeId: options.assigneeId }),
      env,
    )
  ).json()) as { id: string }
  if (options.reviewerId) {
    const reviewerRes = await app.request(`/api/tasks/${task.id}`, json(owner, { reviewerId: options.reviewerId }, 'PATCH'), env)
    if (reviewerRes.status !== 200) throw new Error(`ตั้ง Reviewer ไม่สำเร็จ (${reviewerRes.status})`)
  }
  return { owner, task }
}

beforeEach(async () => {
  await seedUsers()
  // Pronista §Daily Report multi-recipient — เทสต์นี้ต้องมีผู้รับที่เข้าเงื่อนไข (owner/member) มากกว่า 2 คน seedUsers เดิมมีแค่ owner+pond
  await createDb(env.DB)
    .insert(users)
    .values({ id: 'u_nam', email: 'nam@example-co.test', name: 'น้ำ', role: 'member' })
    .onConflictDoNothing()
})

describe('§Daily Report — Role/Action mapping', () => {
  it('Assignee กดรับงาน → งานปรากฏใน Daily Report ของผู้กด', async () => {
    const { owner, task } = await setupRoleMappedTask({ assigneeId: 'u_pond' })
    await app.request(`/api/tasks/${task.id}/dispatch`, json(owner, {}), env)

    const pond = await loginAs(app, 'pond@example-co.test')
    expect((await app.request(`/api/tasks/${task.id}/accept`, json(pond, {}), env)).status).toBe(200)
    expect(await suggestedTaskIds(pond)).toContain(task.id)
  })

  it('ผู้ใช้หลาย Role ทำหลาย Action ในงานเดียว → แสดงเพียง 1 รายการ', async () => {
    const { owner, task } = await setupRoleMappedTask({ assigneeId: 'u_owner', reviewerId: 'u_owner' })

    expect((await app.request(`/api/tasks/${task.id}`, json(owner, { title: 'แก้รายละเอียดแล้ว', notifyOnUpdate: true }, 'PATCH'), env)).status).toBe(200)
    await app.request(`/api/tasks/${task.id}/dispatch`, json(owner, {}), env)
    await app.request(`/api/tasks/${task.id}/accept`, json(owner, {}), env)
    expect((await app.request(`/api/tasks/${task.id}`, json(owner, { status: 'waiting_for_test', workflowAction: 'submit' }, 'PATCH'), env)).status).toBe(200)

    expect((await suggestedTaskIds(owner)).filter((id) => id === task.id)).toHaveLength(1)
  })

  it('Reviewer กดอนุมัติปิดงาน → งานปรากฏใน Daily Report ของ Reviewer', async () => {
    const { owner, task } = await setupRoleMappedTask({ assigneeId: 'u_pond', reviewerId: 'u_nam' })
    await app.request(`/api/tasks/${task.id}/dispatch`, json(owner, {}), env)
    const pond = await loginAs(app, 'pond@example-co.test')
    await app.request(`/api/tasks/${task.id}/accept`, json(pond, {}), env)
    await app.request(`/api/tasks/${task.id}`, json(pond, { status: 'waiting_for_test', workflowAction: 'submit' }, 'PATCH'), env)

    const nam = await loginAs(app, 'nam@example-co.test')
    expect((await app.request(`/api/tasks/${task.id}`, json(nam, { status: 'done', workflowAction: 'approve' }, 'PATCH'), env)).status).toBe(200)
    expect(await suggestedTaskIds(nam)).toContain(task.id)
  })

  it('Assignee บังคับเปลี่ยนสถานะโดยไม่กด Action ที่กำหนด → งานไม่ถูกนำไปแสดง', async () => {
    const { task } = await setupRoleMappedTask({ assigneeId: 'u_pond' })
    const pond = await loginAs(app, 'pond@example-co.test')

    // งานยังไม่ dispatch จึง PATCH สถานะได้ แต่ไม่มี workflowAction จากปุ่มที่กำหนด
    expect((await app.request(`/api/tasks/${task.id}`, json(pond, { status: 'on_processing' }, 'PATCH'), env)).status).toBe(200)
    expect(await suggestedTaskIds(pond)).not.toContain(task.id)
  })
})

describe('§Daily Report multi-recipient (2026-09-02)', () => {
  it('ส่งถึงหลายคนพร้อมกัน — ทุกคนที่เลือกเข้าถึงรายงานได้ + เห็นในประวัติ scope=received', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-20' }), env)).json()) as { id: string }
    const submitted = await app.request(`/api/daily-reports/${created.id}/submit`, json(pond, { recipientIds: ['u_owner', 'u_nam'] }), env)
    expect(submitted.status).toBe(200)
    const body = (await submitted.json()) as { recipients: { id: string; name: string }[]; status: string }
    expect(body.status).toBe('submitted')
    expect(body.recipients.map((r) => r.id).sort()).toEqual(['u_nam', 'u_owner'])

    const owner = await loginAs(app, 'owner@example-co.test')
    const nam = await loginAs(app, 'nam@example-co.test')
    for (const cookie of [owner, nam]) {
      const detail = await app.request(`/api/daily-reports/${created.id}`, { headers: { cookie } }, env)
      expect(detail.status).toBe(200)
      const hist = (await (await app.request('/api/daily-reports/history?scope=received', { headers: { cookie } }, env)).json()) as { reports: { id: string }[] }
      expect(hist.reports.map((r) => r.id)).toContain(created.id)
    }
  })

  it('คนแรกที่เปิดอ่าน = ล็อกทั้งใบ (reviewed) + reviewedAt ของตัวเอง · คนที่สองเปิดทีหลัง reviewedAt แยกกันไม่ทับกัน', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-21' }), env)).json()) as { id: string }
    await app.request(`/api/daily-reports/${created.id}/submit`, json(pond, { recipientIds: ['u_owner', 'u_nam'] }), env)

    const owner = await loginAs(app, 'owner@example-co.test')
    const afterOwnerOpen = (await (await app.request(`/api/daily-reports/${created.id}`, { headers: { cookie: owner } }, env)).json()) as {
      status: string
      recipients: { id: string; reviewedAt: number | null }[]
    }
    expect(afterOwnerOpen.status).toBe('reviewed') // คนแรกเปิด → ล็อกทั้งใบทันที
    const ownerRow = afterOwnerOpen.recipients.find((r) => r.id === 'u_owner')
    const namRowBeforeOpen = afterOwnerOpen.recipients.find((r) => r.id === 'u_nam')
    expect(ownerRow?.reviewedAt).toBeTruthy()
    expect(namRowBeforeOpen?.reviewedAt).toBeFalsy() // น้ำยังไม่เปิด — ต้องไม่ถูก mark ไปด้วย

    const nam = await loginAs(app, 'nam@example-co.test')
    const afterNamOpen = (await (await app.request(`/api/daily-reports/${created.id}`, { headers: { cookie: nam } }, env)).json()) as {
      recipients: { id: string; reviewedAt: number | null }[]
    }
    expect(afterNamOpen.recipients.find((r) => r.id === 'u_nam')?.reviewedAt).toBeTruthy()
  })

  it('history scope=received: myReviewedAt เป็นของผู้ดูแต่ละคน ไม่ใช่ค่ารวม', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-22' }), env)).json()) as { id: string }
    await app.request(`/api/daily-reports/${created.id}/submit`, json(pond, { recipientIds: ['u_owner', 'u_nam'] }), env)

    const owner = await loginAs(app, 'owner@example-co.test')
    await app.request(`/api/daily-reports/${created.id}`, { headers: { cookie: owner } }, env) // owner เปิดอ่านแล้ว

    const ownerHist = (await (await app.request('/api/daily-reports/history?scope=received', { headers: { cookie: owner } }, env)).json()) as { reports: { id: string; myReviewedAt: number | null }[] }
    expect(ownerHist.reports.find((r) => r.id === created.id)?.myReviewedAt).toBeTruthy()

    const nam = await loginAs(app, 'nam@example-co.test')
    const namHist = (await (await app.request('/api/daily-reports/history?scope=received', { headers: { cookie: nam } }, env)).json()) as { reports: { id: string; myReviewedAt: number | null }[] }
    expect(namHist.reports.find((r) => r.id === created.id)?.myReviewedAt).toBeFalsy() // น้ำยังไม่เปิด
  })

  it('ตัวกรองช่วงวันที่ from/to กรอง history ได้ถูกต้อง', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const r1 = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-01' }), env)).json()) as { id: string }
    const r2 = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-20' }), env)).json()) as { id: string }

    const inRange = (await (await app.request('/api/daily-reports/history?scope=mine&from=2026-08-15&to=2026-08-31', { headers: { cookie: pond } }, env)).json()) as { reports: { id: string }[] }
    const ids = inRange.reports.map((r) => r.id)
    expect(ids).toContain(r2.id)
    expect(ids).not.toContain(r1.id)
  })

  it('คอมเมนต์: ผู้รับคนที่สอง (ไม่ใช่คนแรกที่เปิด) คอมเมนต์ได้ · คนที่ไม่เกี่ยวข้องคอมเมนต์ไม่ได้ (403)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-23' }), env)).json()) as { id: string }
    await app.request(`/api/daily-reports/${created.id}/submit`, json(pond, { recipientIds: ['u_owner', 'u_nam'] }), env)

    const nam = await loginAs(app, 'nam@example-co.test')
    const commentRes = await app.request(`/api/daily-reports/${created.id}/comments`, json(nam, { body: 'รับทราบครับ' }), env)
    expect(commentRes.status).toBe(201)

    const somchai = await loginAs(app, 'somchai@example.com')
    const forbidden = await app.request(`/api/daily-reports/${created.id}/comments`, json(somchai, { body: 'แอบมาคอมเมนต์' }), env)
    expect(forbidden.status).toBe(403)
  })

  it('คนที่ไม่ใช่เจ้าของหรือผู้รับ เปิดรายงานไม่ได้ (403)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-24' }), env)).json()) as { id: string }
    await app.request(`/api/daily-reports/${created.id}/submit`, json(pond, { recipientIds: ['u_nam'] }), env)

    const somchai = await loginAs(app, 'somchai@example.com')
    const res = await app.request(`/api/daily-reports/${created.id}`, { headers: { cookie: somchai } }, env)
    expect(res.status).toBe(403)
  })

  it('owner บริษัทที่ไม่ได้ถูกเลือกเป็นผู้รับ เปิดรายงานไม่ได้ (403)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-19' }), env)).json()) as { id: string }
    await app.request(`/api/daily-reports/${created.id}/submit`, json(pond, { recipientIds: ['u_nam'] }), env)

    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request(`/api/daily-reports/${created.id}`, { headers: { cookie: owner } }, env)
    expect(res.status).toBe(403)
  })
})

// Pronista §Daily Report retract (2026-09-14) — ส่งแล้วแต่ยังไม่มีใครเปิดอ่าน ดึงกลับเป็น draft ได้ (แก้ปัญหาเดิมที่ไม่มีทางย้อนกลับเลยนอกจากรอ reviewed ก่อน)
describe('§Daily Report retract', () => {
  it('submitted → draft, ล้างผู้รับทิ้ง, ส่งใหม่ได้สะอาดไม่ซ้ำแถว', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-25' }), env)).json()) as { id: string }
    await app.request(`/api/daily-reports/${created.id}/submit`, json(pond, { recipientIds: ['u_owner', 'u_nam'] }), env)

    const retracted = await app.request(`/api/daily-reports/${created.id}/retract`, json(pond, {}), env)
    expect(retracted.status).toBe(200)
    const retractedBody = (await retracted.json()) as { status: string; recipients: unknown[]; submittedAt: number | null }
    expect(retractedBody.status).toBe('draft')
    expect(retractedBody.recipients).toEqual([])
    expect(retractedBody.submittedAt).toBeFalsy()

    // ส่งใหม่ให้คนละชุดผู้รับ — ต้องไม่มีแถวเก่าจาก u_owner/u_nam ค้างอยู่
    const resubmitted = await app.request(`/api/daily-reports/${created.id}/submit`, json(pond, { recipientIds: ['u_nam'] }), env)
    expect(resubmitted.status).toBe(200)
    const resubmittedBody = (await resubmitted.json()) as { recipients: { id: string }[] }
    expect(resubmittedBody.recipients.map((r) => r.id)).toEqual(['u_nam'])
  })

  it('ไม่ใช่เจ้าของรายงาน ดึงกลับไม่ได้ (403)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-26' }), env)).json()) as { id: string }
    await app.request(`/api/daily-reports/${created.id}/submit`, json(pond, { recipientIds: ['u_owner'] }), env)

    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request(`/api/daily-reports/${created.id}/retract`, json(owner, {}), env)
    expect(res.status).toBe(403)
  })

  it('สถานะยังเป็น draft อยู่ ดึงกลับไม่ได้ (400)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-27' }), env)).json()) as { id: string }
    const res = await app.request(`/api/daily-reports/${created.id}/retract`, json(pond, {}), env)
    expect(res.status).toBe(400)
  })

  it('reviewed แล้ว (มีคนเปิดอ่าน) ดึงกลับด้วย retract ไม่ได้ (400) — ต้องใช้ "ขอแก้ไขรายงาน" แทน', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-28' }), env)).json()) as { id: string }
    await app.request(`/api/daily-reports/${created.id}/submit`, json(pond, { recipientIds: ['u_owner'] }), env)
    const owner = await loginAs(app, 'owner@example-co.test')
    await app.request(`/api/daily-reports/${created.id}`, { headers: { cookie: owner } }, env) // owner เปิดอ่าน → flip เป็น reviewed

    const res = await app.request(`/api/daily-reports/${created.id}/retract`, json(pond, {}), env)
    expect(res.status).toBe(400)
  })
})

// Pronista §Daily Report manual item edit (2026-09-16) — เดิม PATCH /items/:itemId รับแค่ note รายการคีย์เอง (manualTitle/manualMinutes) แก้ไม่ได้เลย ต้องลบแล้วเพิ่มใหม่
describe('§Daily Report manual item edit — PATCH /daily-reports/:id/items/:itemId', () => {
  it('แก้ manualTitle/manualMinutes ของรายการคีย์เองได้', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const report = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-29' }), env)).json()) as { id: string }
    const item = (await (
      await app.request(`/api/daily-reports/${report.id}/items`, json(pond, { manualTitle: 'ประชุมลูกค้า', manualMinutes: 60 }), env)
    ).json()) as { id: string }

    const res = await app.request(`/api/daily-reports/${report.id}/items/${item.id}`, json(pond, { manualTitle: 'ประชุมลูกค้า (แก้ไข)', manualMinutes: 90 }, 'PATCH'), env)
    expect(res.status).toBe(200)
    const updated = (await res.json()) as { manualTitle: string; manualMinutes: number }
    expect(updated.manualTitle).toBe('ประชุมลูกค้า (แก้ไข)')
    expect(updated.manualMinutes).toBe(90)
  })

  it('รายการที่ผูก Task จริง แก้ manualTitle ไม่ได้ (400) — แก้ได้แค่ note', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const task = (await (await app.request('/api/tasks/backlog', json(pond, { title: 'งานทดสอบ' }), env)).json()) as { id: string }
    const report = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-30' }), env)).json()) as { id: string }
    const item = (await (await app.request(`/api/daily-reports/${report.id}/items`, json(pond, { taskId: task.id }), env)).json()) as { id: string }

    const res = await app.request(`/api/daily-reports/${report.id}/items/${item.id}`, json(pond, { manualTitle: 'พยายามแก้ชื่อ' }, 'PATCH'), env)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('task_item_not_manual')

    // note ยังแก้ได้ปกติ
    const noteRes = await app.request(`/api/daily-reports/${report.id}/items/${item.id}`, json(pond, { note: 'ทำเสร็จแล้ว' }, 'PATCH'), env)
    expect(noteRes.status).toBe(200)
  })

  it('รายงาน reviewed แล้ว แก้ manual item ไม่ได้ (400 locked)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const report = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-31' }), env)).json()) as { id: string }
    const item = (await (
      await app.request(`/api/daily-reports/${report.id}/items`, json(pond, { manualTitle: 'งานเดิม', manualMinutes: 30 }), env)
    ).json()) as { id: string }
    await app.request(`/api/daily-reports/${report.id}/submit`, json(pond, { recipientIds: ['u_owner'] }), env)
    const owner = await loginAs(app, 'owner@example-co.test')
    await app.request(`/api/daily-reports/${report.id}`, { headers: { cookie: owner } }, env) // owner เปิดอ่าน → flip เป็น reviewed

    const res = await app.request(`/api/daily-reports/${report.id}/items/${item.id}`, json(pond, { manualTitle: 'พยายามแก้' }, 'PATCH'), env)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('locked')
  })
})
