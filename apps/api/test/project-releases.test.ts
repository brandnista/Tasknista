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

beforeEach(async () => {
  await seedUsers()
})

async function makeProject(cookie: string) {
  const p = (await (await app.request('/api/projects', json(cookie, { name: 'Release P', type: 'project' }), env)).json()) as { id: string }
  return p.id
}

interface ReleaseResponse {
  id: string
  version: string
  items: { id: string; section: string | null; text: string; sortOrder: number }[]
}

describe('Pronista §Version Release payload fix (2026-09-23) — D1 bound-parameter limit (100/query) เมื่อ release มี item เยอะ', () => {
  it('สร้าง release ด้วย 21 items (ตามชุดข้อมูลจริงในสเปก) สำเร็จ ไม่ 500 — ก่อนแก้ 17+ items จะพัง (17*6=102 > 100 bound params)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const projectId = await makeProject(owner)
    const items = Array.from({ length: 21 }, (_, i) => ({ text: `ข้อที่ ${i + 1}`, linkedTaskIds: [] }))

    const res = await app.request(`/api/projects/${projectId}/releases`, json(owner, { version: 'v1.0.0', items }), env)
    expect(res.status).toBe(201)
    const body = (await res.json()) as ReleaseResponse
    expect(body.items).toHaveLength(21)
    expect(body.items.map((it) => it.text)).toEqual(items.map((it) => it.text))
  })

  it('boundary เป๊ะๆ: 16 items (96 params) ผ่าน, 17 items (102 params) ก็ต้องผ่านหลังแก้แล้วเหมือนกัน', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const projectId = await makeProject(owner)

    const r16 = await app.request(
      `/api/projects/${projectId}/releases`,
      json(owner, { version: 'v16', items: Array.from({ length: 16 }, (_, i) => ({ text: `a${i}`, linkedTaskIds: [] })) }),
      env,
    )
    expect(r16.status).toBe(201)

    const r17 = await app.request(
      `/api/projects/${projectId}/releases`,
      json(owner, { version: 'v17', items: Array.from({ length: 17 }, (_, i) => ({ text: `b${i}`, linkedTaskIds: [] })) }),
      env,
    )
    expect(r17.status).toBe(201)
    expect(((await r17.json()) as ReleaseResponse).items).toHaveLength(17)
  })

  it('แก้ไข (PATCH) release จากไม่กี่ items ไปเป็น 20 items สำเร็จ ไม่หายหมดเหลือ "—" (ของเดิมลบก่อนค่อย insert ใหม่ — ถ้า insert ใหม่พังจะเหลือ 0 items)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const projectId = await makeProject(owner)
    const created = (await (
      await app.request(`/api/projects/${projectId}/releases`, json(owner, { version: 'v-edit', items: [{ text: 'เดิม', linkedTaskIds: [] }] }), env)
    ).json()) as ReleaseResponse

    const newItems = Array.from({ length: 20 }, (_, i) => ({ text: `ใหม่ ${i + 1}`, linkedTaskIds: [] }))
    const patched = await app.request(`/api/releases/${created.id}`, patchJson(owner, { items: newItems }), env)
    expect(patched.status).toBe(200)
    const body = (await patched.json()) as ReleaseResponse
    expect(body.items).toHaveLength(20)
    expect(body.items.map((it) => it.text)).toEqual(newItems.map((it) => it.text))

    // ยืนยันอีกรอบผ่าน GET list — กันกรณี response ของ PATCH ตรงแต่ DB จริงไม่ตรง (เช่น chunk แรกสำเร็จ chunk หลังพัง)
    const list = (await (await app.request(`/api/projects/${projectId}/releases`, { headers: { cookie: owner } }, env)).json()) as {
      releases: ReleaseResponse[]
    }
    const reloaded = list.releases.find((r) => r.id === created.id)
    expect(reloaded?.items).toHaveLength(20)
  })

  it('item ที่ผูก Task หลายสิบรายการรวมกัน (release_note_item_links) ก็ insert ครบ ไม่พังเหมือนกัน', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const projectId = await makeProject(owner)
    const g = (await (await app.request(`/api/projects/${projectId}/groups`, json(owner, { name: 'G' }), env)).json()) as { id: string }
    const taskIds: string[] = []
    for (let i = 0; i < 25; i++) {
      const t = (await (await app.request(`/api/groups/${g.id}/tasks`, json(owner, { title: `T${i}` }), env)).json()) as { id: string }
      taskIds.push(t.id)
    }
    // 5 items ผูก task คนละ 5 อัน = 25 link rows รวม (เกิน 100/4=25 param safety margin ถ้าไม่ chunk)
    const items = Array.from({ length: 5 }, (_, i) => ({
      text: `ข้อ ${i}`,
      linkedTaskIds: taskIds.slice(i * 5, i * 5 + 5),
    }))
    const res = await app.request(`/api/projects/${projectId}/releases`, json(owner, { version: 'v-links', items }), env)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { items: { linkedTasks: { id: string }[] }[] }
    expect(body.items.reduce((sum, it) => sum + it.linkedTasks.length, 0)).toBe(25)
  })
})
