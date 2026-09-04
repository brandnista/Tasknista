import { bkkDateOf } from '@seedoffice/core'
import { createDb } from '@seedoffice/db'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { notifySellnistaExpiry } from '../src/scheduled'
import { loginAs, seedUsers } from './helpers'

// Pronista §System Enhancements — Sellnista: CRUD (owner-only) + เตือนล่วงหน้าหลายระดับ (30/15/7/1 วัน) + เตือนหมดอายุแยกต่างหาก — mirror domains.test.ts เป๊ะ

beforeEach(async () => {
  await seedUsers()
  await env.DB.prepare('DELETE FROM notifications WHERE sellnista_subscription_id IS NOT NULL').run()
  await env.DB.prepare('DELETE FROM sellnista_subscriptions').run()
})

const json = (cookie: string, body: unknown) => ({ method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const patch = (cookie: string, body: unknown) => ({ ...json(cookie, body), method: 'PATCH' })

const addDays = (isoToday: string, days: number) => new Date(Date.parse(`${isoToday}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

describe('Pronista §System Enhancements — Sellnista CRUD (owner-only)', () => {
  it('owner สร้าง/แก้ไข/ลบได้ · member ทำอะไรไม่ได้เลย (403)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')

    const created = (await (
      await app.request('/api/admin/sellnista', json(owner, { name: 'Sellnista Pro', expiryDate: '2027-01-01' }), env)
    ).json()) as { id: string; name: string; notifyEnabled: boolean }
    expect(created.name).toBe('Sellnista Pro')
    expect(created.notifyEnabled).toBe(true) // default เปิด

    expect((await app.request('/api/admin/sellnista', json(pond, { name: 'hack', expiryDate: '2027-01-01' }), env)).status).toBe(403)
    expect((await app.request('/api/admin/sellnista', { headers: { cookie: pond } }, env)).status).toBe(403)

    const patchRes = await app.request(`/api/admin/sellnista/${created.id}`, patch(owner, { name: 'Sellnista Pro (renamed)' }), env)
    expect(patchRes.status).toBe(200)
    const list = (await (await app.request('/api/admin/sellnista', { headers: { cookie: owner } }, env)).json()) as { id: string; name: string }[]
    expect(list.find((d) => d.id === created.id)?.name).toBe('Sellnista Pro (renamed)')

    expect((await app.request(`/api/admin/sellnista/${created.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)).status).toBe(200)
    const after = (await (await app.request('/api/admin/sellnista', { headers: { cookie: owner } }, env)).json()) as { id: string }[]
    expect(after.some((d) => d.id === created.id)).toBe(false)
  })

  it('GET /sellnista/:id คืนรายการเดี่ยว · ไม่พบ → 404', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const created = (await (
      await app.request('/api/admin/sellnista', json(owner, { name: 'detail-test', expiryDate: '2027-01-01' }), env)
    ).json()) as { id: string }
    const res = await app.request(`/api/admin/sellnista/${created.id}`, { headers: { cookie: owner } }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ name: 'detail-test' })
    expect((await app.request('/api/admin/sellnista/does-not-exist', { headers: { cookie: owner } }, env)).status).toBe(404)
  })

  it('แก้ไขวันหมดอายุใหม่ → เคลียร์เกตแจ้งเตือนเดิมทั้งหมด (notifiedTiers/expiredNotifiedAt รีเซ็ต)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const today = bkkDateOf(Date.now())
    const created = (await (
      await app.request('/api/admin/sellnista', json(owner, { name: 'reset-test', expiryDate: addDays(today, 5) }), env)
    ).json()) as { id: string }

    const db = createDb(env.DB)
    await notifySellnistaExpiry(db, today) // เตือนระดับ 7 ไปแล้ว (เหลือ 5 วัน อยู่ในช่วง 7)

    await app.request(`/api/admin/sellnista/${created.id}`, patch(owner, { expiryDate: addDays(today, 40) }), env)
    const list = (await (await app.request('/api/admin/sellnista', { headers: { cookie: owner } }, env)).json()) as { id: string; notifiedTiers: number[] | null }[]
    expect(list.find((d) => d.id === created.id)?.notifiedTiers).toBeFalsy()
  })
})

describe('Pronista §System Enhancements — notifySellnistaExpiry (cron รายวัน)', () => {
  it('เหลือ 30 วันพอดี → เตือน owner ทุกคน ระดับ 30 · รันซ้ำวันเดียวกันไม่เตือนซ้ำ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const today = bkkDateOf(Date.now())
    await app.request('/api/admin/sellnista', json(owner, { name: 'tier30', expiryDate: addDays(today, 30) }), env)

    const db = createDb(env.DB)
    const before = await sellnistaNotifCount(owner)
    await notifySellnistaExpiry(db, today)
    expect(await sellnistaNotifCount(owner)).toBe(before + 1)

    await notifySellnistaExpiry(db, today)
    expect(await sellnistaNotifCount(owner)).toBe(before + 1) // ไม่เตือนซ้ำ
  })

  it('ปิด "แจ้งเตือนหมดอายุ" (notifyEnabled=false) → cron ข้ามรายการนี้ไปเลย', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const today = bkkDateOf(Date.now())
    const created = (await (
      await app.request('/api/admin/sellnista', json(owner, { name: 'muted', expiryDate: addDays(today, 30) }), env)
    ).json()) as { id: string }
    await app.request(`/api/admin/sellnista/${created.id}`, patch(owner, { notifyEnabled: false }), env)

    const db = createDb(env.DB)
    const before = await sellnistaNotifCount(owner)
    await notifySellnistaExpiry(db, today)
    expect(await sellnistaNotifCount(owner)).toBe(before)
  })

  it('ยังไกลเกิน 30 วัน → ยังไม่เตือน', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const today = bkkDateOf(Date.now())
    await app.request('/api/admin/sellnista', json(owner, { name: 'far', expiryDate: addDays(today, 60) }), env)
    const db = createDb(env.DB)
    const before = await sellnistaNotifCount(owner)
    await notifySellnistaExpiry(db, today)
    expect(await sellnistaNotifCount(owner)).toBe(before)
  })

  it('หมดอายุไปแล้ว → เตือนประเภท sellnista_expired แยกต่างหาก ครั้งเดียวไม่ซ้ำ ไม่เตือนล่วงหน้าซ้ำอีก', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const today = bkkDateOf(Date.now())
    await app.request('/api/admin/sellnista', json(owner, { name: 'expired', expiryDate: addDays(today, -3) }), env)

    const db = createDb(env.DB)
    const before = await expiredNotifCount(owner)
    const beforeReminder = await sellnistaNotifCount(owner)
    await notifySellnistaExpiry(db, today)
    expect(await expiredNotifCount(owner)).toBe(before + 1)
    expect(await sellnistaNotifCount(owner)).toBe(beforeReminder) // ไม่ยิง sellnista_expiry_reminder ปนด้วย

    await notifySellnistaExpiry(db, today)
    expect(await expiredNotifCount(owner)).toBe(before + 1) // ไม่เตือนซ้ำ
  })
})

async function sellnistaNotifCount(cookie: string) {
  return (
    (await (await app.request('/api/notifications', { headers: { cookie } }, env)).json()) as { type: string }[]
  ).filter((n) => n.type === 'sellnista_expiry_reminder').length
}
async function expiredNotifCount(cookie: string) {
  return (
    (await (await app.request('/api/notifications', { headers: { cookie } }, env)).json()) as { type: string }[]
  ).filter((n) => n.type === 'sellnista_expired').length
}
