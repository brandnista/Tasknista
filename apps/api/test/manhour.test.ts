import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

beforeEach(async () => {
  await seedUsers()
})

const flat480 = { mon: 480, tue: 480, wed: 480, thu: 480, fri: 480, sat: 480, sun: 480 }
const partnerWeek = { mon: 240, tue: 240, wed: 240, thu: 240, fri: 240, sat: 600, sun: 600 }

describe('Pronista §Workload — /api/admin/manhour (รายวันในสัปดาห์)', () => {
  it('owner เห็น/แก้ได้ · member/vendor 403', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const member = await loginAs(app, 'pond@example-co.test')
    const vendor = await loginAs(app, 'somchai@example.com')

    expect((await app.request('/api/admin/manhour', { headers: { cookie: owner } }, env)).status).toBe(200)
    expect((await app.request('/api/admin/manhour', { headers: { cookie: member } }, env)).status).toBe(403)
    expect((await app.request('/api/admin/manhour', { headers: { cookie: vendor } }, env)).status).toBe(403)
  })

  it('ค่าเริ่มต้น (ยังไม่ตั้ง) = workHourCapMinutes เดิมทุกวันของทั้ง 3 ประเภท', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = (await (await app.request('/api/admin/manhour', { headers: { cookie: owner } }, env)).json()) as {
      manhourMinutesPerDay: Record<string, Record<string, number>>
    }
    expect(res.manhourMinutesPerDay).toEqual({ staff: flat480, outsource: flat480, customer: flat480 })
  })

  it('ตั้งค่าแยกวันธรรมดา/วันหยุดของ outsource แล้วอ่านกลับมาถูกต้อง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const put = await app.request(
      '/api/admin/manhour',
      {
        method: 'PUT',
        headers: { cookie: owner, 'content-type': 'application/json' },
        body: JSON.stringify({ manhourMinutesPerDay: { staff: flat480, outsource: partnerWeek, customer: flat480 } }),
      },
      env,
    )
    expect(put.status).toBe(200)
    const after = (await (await app.request('/api/admin/manhour', { headers: { cookie: owner } }, env)).json()) as {
      manhourMinutesPerDay: Record<string, Record<string, number>>
    }
    expect(after.manhourMinutesPerDay.outsource).toEqual(partnerWeek)
    expect(after.manhourMinutesPerDay.outsource!.sat).toBe(600)
    expect(after.manhourMinutesPerDay.outsource!.mon).toBe(240)
  })

  it('ค่านอกช่วง 0-1440 → 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request(
      '/api/admin/manhour',
      {
        method: 'PUT',
        headers: { cookie: owner, 'content-type': 'application/json' },
        body: JSON.stringify({ manhourMinutesPerDay: { staff: { ...flat480, mon: 1500 }, outsource: flat480, customer: flat480 } }),
      },
      env,
    )
    expect(res.status).toBe(400)
  })

  it('อนุญาตค่า 0 ได้ (วันไม่ทำงาน)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request(
      '/api/admin/manhour',
      {
        method: 'PUT',
        headers: { cookie: owner, 'content-type': 'application/json' },
        body: JSON.stringify({ manhourMinutesPerDay: { staff: { ...flat480, sat: 0, sun: 0 }, outsource: flat480, customer: flat480 } }),
      },
      env,
    )
    expect(res.status).toBe(200)
  })

  it('ขาดวันใดวันหนึ่ง → 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const missingSunday: Record<string, number> = { ...flat480 }
    delete missingSunday.sun
    const res = await app.request(
      '/api/admin/manhour',
      { method: 'PUT', headers: { cookie: owner, 'content-type': 'application/json' }, body: JSON.stringify({ manhourMinutesPerDay: { staff: missingSunday, outsource: flat480, customer: flat480 } }) },
      env,
    )
    expect(res.status).toBe(400)
  })

  it('ขาดประเภทใดประเภทหนึ่ง → 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request(
      '/api/admin/manhour',
      { method: 'PUT', headers: { cookie: owner, 'content-type': 'application/json' }, body: JSON.stringify({ manhourMinutesPerDay: { staff: flat480, outsource: flat480 } }) },
      env,
    )
    expect(res.status).toBe(400)
  })
})
