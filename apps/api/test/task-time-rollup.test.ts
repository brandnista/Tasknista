import { createDb, timeEntries } from '@seedoffice/db'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

// Pronista §Subtask time rollup (2026-10-02) — เวลาของงานย่อยแสดงในหน้างานแม่แบบนับแยก ไม่รวมซ้ำกับเวลาที่ลงที่งานแม่เอง
beforeEach(async () => {
  await seedUsers()
})

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('GET /tasks/:id/detail — เวลารวมงานย่อย', () => {
  it('คืนเวลาของงานย่อยแต่ละชิ้น + ผลรวม (ไม่ปนกับเวลาที่ลงที่งานแม่เอง · รายการที่ลบแล้วไม่นับ)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = (await (await app.request('/api/projects', json(owner, { name: 'โปรเจกต์เวลา', type: 'project' }), env)).json()) as { id: string }
    const g = (await (await app.request(`/api/projects/${p.id}/groups`, json(owner, { name: 'Dev' }), env)).json()) as { id: string }
    const parent = (await (await app.request(`/api/groups/${g.id}/tasks`, json(owner, { title: 'งานแม่' }), env)).json()) as { id: string }
    const s1 = (await (await app.request(`/api/tasks/${parent.id}/subtasks`, json(owner, { title: 'ย่อย 1' }), env)).json()) as { id: string }
    const s2 = (await (await app.request(`/api/tasks/${parent.id}/subtasks`, json(owner, { title: 'ย่อย 2' }), env)).json()) as { id: string }

    const db = createDb(env.DB)
    const entry = (taskId: string, minutes: number, deletedAt: Date | null = null) => ({
      userId: 'u_owner',
      taskId,
      projectId: p.id,
      workDate: '2026-10-01',
      minutes,
      rateSnapshotSatang: 0,
      source: 'manual' as const,
      deletedAt,
    })
    await db.insert(timeEntries).values([entry(parent.id, 60), entry(s1.id, 30), entry(s1.id, 15), entry(s2.id, 120), entry(s2.id, 999, new Date())])

    const d = (await (await app.request(`/api/tasks/${parent.id}/detail`, { headers: { cookie: owner } }, env)).json()) as {
      subtaskMinutes: number
      subtasks: { id: string; actualMinutes: number }[]
    }
    expect(d.subtaskMinutes).toBe(165)
    expect(Object.fromEntries(d.subtasks.map((s) => [s.id, s.actualMinutes]))).toEqual({ [s1.id]: 45, [s2.id]: 120 })

    // งานย่อยเปิดดูเอง: ไม่มีงานย่อยของมัน → รวมเป็น 0
    const child = (await (await app.request(`/api/tasks/${s1.id}/detail`, { headers: { cookie: owner } }, env)).json()) as { subtaskMinutes: number }
    expect(child.subtaskMinutes).toBe(0)
  })
})
