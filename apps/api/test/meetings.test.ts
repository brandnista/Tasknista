import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

// Pronista §Team Meeting (2026-08-26) — นัดประชุม + Notes/Agenda ร่วมกันได้ทุกคนที่เกี่ยวข้อง (ผู้จัด/ผู้เข้าร่วม/สมาชิกโปรเจกต์ที่ผูกไว้)
// แก้ข้อมูลนัดหมาย (หัวข้อ/เวลา/ลิงก์) จำกัดแค่ผู้จัด/owner · แปลง Action Item เป็น Task ต้องเช็คสิทธิ์ task.create ของโปรเจกต์ปลายทางเสมอ

beforeEach(async () => {
  await seedUsers()
})

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const patch = (cookie: string, body: unknown) => ({ ...json(cookie, body), method: 'PATCH' })

const HOUR = 3_600_000
function nextMeetingPayload(overrides: Record<string, unknown> = {}) {
  const startAt = Date.now() + HOUR
  return { title: 'Weekly Sync', startAt, endAt: startAt + HOUR, ...overrides }
}

async function makeProject(ownerCookie: string, editorUserId?: string) {
  const p = (await (await app.request('/api/projects', json(ownerCookie, { name: 'โปรเจกต์ประชุม', type: 'project' }), env)).json()) as { id: string }
  if (editorUserId) await app.request(`/api/projects/${p.id}/members`, json(ownerCookie, { userId: editorUserId, positionId: 'pos_full_access' }), env)
  return p
}

describe('Pronista §Team Meeting — schedule, notes, action items', () => {
  it('นัดประชุมพร้อมผู้เข้าร่วม → ผู้เข้าร่วมเห็นในลิสต์และได้แจ้งเตือน meeting_scheduled', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = await app.request('/api/meetings', json(owner, nextMeetingPayload({ participantIds: ['u_pond'] })), env)
    expect(created.status).toBe(201)

    const pondList = (await (await app.request('/api/meetings', { headers: { cookie: pond } }, env)).json()) as { title: string }[]
    expect(pondList.some((m) => m.title === 'Weekly Sync')).toBe(true)

    const notifs = (await (await app.request('/api/notifications', { headers: { cookie: pond } }, env)).json()) as { type: string }[]
    expect(notifs.some((n) => n.type === 'meeting_scheduled')).toBe(true)
  })

  it('คนไม่เกี่ยวข้องเลย (ไม่ใช่ผู้จัด/ผู้เข้าร่วม/สมาชิกโปรเจกต์) ไม่เห็นประชุมในลิสต์ และเปิด detail ไม่ได้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    const created = (await (await app.request('/api/meetings', json(owner, nextMeetingPayload()), env)).json()) as { id: string }

    const somchaiList = (await (await app.request('/api/meetings', { headers: { cookie: somchai } }, env)).json()) as { id: string }[]
    expect(somchaiList.some((m) => m.id === created.id)).toBe(false)
    expect((await app.request(`/api/meetings/${created.id}`, { headers: { cookie: somchai } }, env)).status).toBe(403)
  })

  it('แก้ agenda/notes ได้ทุกคนที่เกี่ยวข้อง แต่แก้หัวข้อ/เวลา/ลิงก์ ได้เฉพาะผู้จัดหรือ owner', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/meetings', json(owner, nextMeetingPayload({ participantIds: ['u_pond'] })), env)).json()) as { id: string }

    // ปอนด์ (ผู้เข้าร่วม ไม่ใช่ผู้จัด) แก้ notes ได้
    const notesRes = await app.request(`/api/meetings/${created.id}`, patch(pond, { notes: 'สรุป: ต้องแก้ JWT' }), env)
    expect(notesRes.status).toBe(200)

    // แต่แก้หัวข้อ (ข้อมูลนัดหมาย) ไม่ได้
    expect((await app.request(`/api/meetings/${created.id}`, patch(pond, { title: 'เปลี่ยนหัวข้อ' }), env)).status).toBe(403)

    // owner (คนจัด) แก้หัวข้อได้
    expect((await app.request(`/api/meetings/${created.id}`, patch(owner, { title: 'เปลี่ยนหัวข้อ' }), env)).status).toBe(200)
  })

  it('แปลง Action Item เป็น Task ได้เฉพาะคนมีสิทธิ์ task.create ในโปรเจกต์ปลายทาง และผูก taskId กลับที่ action item', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const p = await makeProject(owner)
    const created = (await (await app.request('/api/meetings', json(owner, nextMeetingPayload({ projectId: p.id, participantIds: ['u_pond'] })), env)).json()) as { id: string }
    const item = (await (await app.request(`/api/meetings/${created.id}/action-items`, json(owner, { text: 'อัปเดต BRD' }), env)).json()) as { id: string }

    // ปอนด์ไม่ได้เป็นสมาชิกโปรเจกต์ p เลย → ไม่มีสิทธิ์ task.create แม้จะเป็นผู้เข้าร่วมประชุม
    expect((await app.request(`/api/meetings/${created.id}/action-items/${item.id}/create-task`, json(pond, { projectId: p.id }), env)).status).toBe(403)

    const taskRes = await app.request(`/api/meetings/${created.id}/action-items/${item.id}/create-task`, json(owner, { projectId: p.id }), env)
    expect(taskRes.status).toBe(201)
    const task = (await taskRes.json()) as { title: string }
    expect(task.title).toBe('อัปเดต BRD')

    const detail = (await (await app.request(`/api/meetings/${created.id}`, { headers: { cookie: owner } }, env)).json()) as { actionItems: { id: string; taskId: string | null }[] }
    expect(detail.actionItems.find((a) => a.id === item.id)?.taskId).toBeTruthy()
  })

  it('ลบประชุมได้เฉพาะผู้จัดหรือ owner', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/meetings', json(owner, nextMeetingPayload({ participantIds: ['u_pond'] })), env)).json()) as { id: string }
    expect((await app.request(`/api/meetings/${created.id}`, { method: 'DELETE', headers: { cookie: pond } }, env)).status).toBe(403)
    expect((await app.request(`/api/meetings/${created.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)).status).toBe(200)
  })
})
