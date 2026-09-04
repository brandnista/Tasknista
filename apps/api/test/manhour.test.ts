import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

beforeEach(async () => {
  await seedUsers()
})

describe('Pronista §System Enhancements — /api/admin/manhour', () => {
  it('owner เห็น/แก้ได้ · member/vendor 403', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const member = await loginAs(app, 'pond@example-co.test')
    const vendor = await loginAs(app, 'somchai@example.com')

    expect((await app.request('/api/admin/manhour', { headers: { cookie: owner } }, env)).status).toBe(200)
    expect((await app.request('/api/admin/manhour', { headers: { cookie: member } }, env)).status).toBe(403)
    expect((await app.request('/api/admin/manhour', { headers: { cookie: vendor } }, env)).status).toBe(403)
  })

  it('ค่าเริ่มต้น (ยังไม่ตั้ง) = workHourCapMinutes เดิมทั้ง 3 ประเภท', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/admin/manhour', { headers: { cookie: owner } }, env)).json()) as {
      manhourMinutesPerDay: Record<string, number>
    }
    expect(res.manhourMinutesPerDay).toEqual({ staff: 480, outsource: 480, customer: 480 })
  })

  it('ตั้งค่าใหม่แล้วอ่านกลับมาถูกต้อง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const put = await app.request(
      '/api/admin/manhour',
      { method: 'PUT', headers: { cookie: owner, 'content-type': 'application/json' }, body: JSON.stringify({ manhourMinutesPerDay: { staff: 480, outsource: 240, customer: 120 } }) },
      env,
    )
    expect(put.status).toBe(200)
    const after = (await (await app.request('/api/admin/manhour', { headers: { cookie: owner } }, env)).json()) as {
      manhourMinutesPerDay: Record<string, number>
    }
    expect(after.manhourMinutesPerDay).toEqual({ staff: 480, outsource: 240, customer: 120 })
  })

  it('ค่านอกช่วง 60-1440 → 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request(
      '/api/admin/manhour',
      { method: 'PUT', headers: { cookie: owner, 'content-type': 'application/json' }, body: JSON.stringify({ manhourMinutesPerDay: { staff: 30, outsource: 240, customer: 120 } }) },
      env,
    )
    expect(res.status).toBe(400)
  })

  it('ขาดประเภทใดประเภทหนึ่ง → 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request(
      '/api/admin/manhour',
      { method: 'PUT', headers: { cookie: owner, 'content-type': 'application/json' }, body: JSON.stringify({ manhourMinutesPerDay: { staff: 480, outsource: 240 } }) },
      env,
    )
    expect(res.status).toBe(400)
  })
})
