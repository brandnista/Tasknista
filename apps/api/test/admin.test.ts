import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

beforeEach(async () => {
  await seedUsers()
})

describe('T07 — admin users/rates/config', () => {
  it('member/vendor เปิด /api/admin/users ไม่ได้ (403) · owner ได้', async () => {
    const member = await loginAs(app, 'pond@example-co.test')
    const vendor = await loginAs(app, 'somchai@example.com')
    const owner = await loginAs(app, 'owner@example-co.test')
    expect((await app.request('/api/admin/users', { headers: { cookie: member } }, env)).status).toBe(403)
    expect((await app.request('/api/admin/users', { headers: { cookie: vendor } }, env)).status).toBe(403)
    const res = await app.request('/api/admin/users', { headers: { cookie: owner } }, env)
    expect(res.status).toBe(200)
    const list = (await res.json()) as { email: string }[]
    expect(list.length).toBeGreaterThanOrEqual(4)
  })

  // Tasknista เป็น PM app ล้วนๆ ไม่มี UI/API ตั้ง rate ต่อ user แล้ว (admin.ts) — rate ตั้งต้น = 0 อัตโนมัติ
  // กันไม่ให้ time-entry บล็อกเพราะไม่มี rate เท่านั้น ไม่มีเส้นทางดู/แก้ rate ให้เทสต์
  it('owner provision vendor ใหม่ ได้พร้อม jobTitle/costPerDaySatang (Project Estimate)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const created = await app.request(
      '/api/admin/users',
      {
        method: 'POST',
        headers: { cookie: owner, 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'newvendor@example.com',
          name: 'เวนเดอร์ใหม่',
          role: 'vendor',
          jobTitle: 'นักออกแบบ',
          costPerDaySatang: 200_000,
        }),
      },
      env,
    )
    expect(created.status).toBe(201)
    const u = (await created.json()) as { id: string; jobTitle: string; costPerDaySatang: number }
    expect(u).toMatchObject({ jobTitle: 'นักออกแบบ', costPerDaySatang: 200_000 })
  })

  it('email ซ้ำ → 409 · แก้ config ได้เฉพาะ owner + persist', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const dup = await app.request(
      '/api/admin/users',
      {
        method: 'POST',
        headers: { cookie: owner, 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'pond@example-co.test', name: 'ซ้ำ', role: 'member' }),
      },
      env,
    )
    expect(dup.status).toBe(409)

    const patch = await app.request(
      '/api/admin/config',
      {
        method: 'PATCH',
        headers: { cookie: owner, 'content-type': 'application/json' },
        body: JSON.stringify({ workHourCapMinutes: 420 }),
      },
      env,
    )
    expect(patch.status).toBe(200)
    const cfg = await app.request('/api/config', { headers: { cookie: owner } }, env)
    expect(await cfg.json()).toMatchObject({ cutoffDay: 25, workHourCapMinutes: 420 })

    const member = await loginAs(app, 'pond@example-co.test')
    expect(
      (
        await app.request(
          '/api/admin/config',
          {
            method: 'PATCH',
            headers: { cookie: member, 'content-type': 'application/json' },
            body: JSON.stringify({ cutoffDay: 1 }),
          },
          env,
        )
      ).status,
    ).toBe(403)
  })

  it('memberDomain: รูปแบบผิด → 400 · ตั้งค่าได้ (trim+lowercase) + persist', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const patchCfg = (memberDomain: string) =>
      app.request(
        '/api/admin/config',
        {
          method: 'PATCH',
          headers: { cookie: owner, 'content-type': 'application/json' },
          body: JSON.stringify({ memberDomain }),
        },
        env,
      )
    expect((await patchCfg('no-at-sign.com')).status).toBe(400) // ไม่มี @
    expect((await patchCfg('@nodot')).status).toBe(400) // ไม่มีจุด

    expect((await patchCfg(' @New-Co.TEST ')).status).toBe(200)
    const cfg = await app.request('/api/config', { headers: { cookie: owner } }, env)
    expect(await cfg.json()).toMatchObject({ memberDomain: '@new-co.test' })

    expect((await patchCfg('')).status).toBe(200) // ว่าง = ปิด auto-provision
    const cfg2 = await app.request('/api/config', { headers: { cookie: owner } }, env)
    expect(await cfg2.json()).toMatchObject({ memberDomain: '' })
  })
})
