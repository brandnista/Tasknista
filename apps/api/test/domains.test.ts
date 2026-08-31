import { bkkDateOf } from '@seedoffice/core'
import { createDb } from '@seedoffice/db'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { notifyDomainExpiry } from '../src/scheduled'
import { loginAs, seedUsers } from './helpers'

// Pronista §Domain Management (2026-08-27) — CRUD (owner-only) + เตือนล่วงหน้าหลายระดับ (30/15/7/1 วัน) + เตือนหมดอายุแยกต่างหาก

beforeEach(async () => {
  await seedUsers()
  await env.DB.prepare('DELETE FROM notifications WHERE domain_id IS NOT NULL').run()
  await env.DB.prepare('DELETE FROM domains').run()
})

const json = (cookie: string, body: unknown) => ({ method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const patch = (cookie: string, body: unknown) => ({ ...json(cookie, body), method: 'PATCH' })

const addDays = (isoToday: string, days: number) => new Date(Date.parse(`${isoToday}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

describe('Pronista §Domain Management — CRUD (owner-only)', () => {
  it('owner สร้าง/แก้ไข/ลบโดเมนได้ · member ทำอะไรไม่ได้เลย (403)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')

    const created = (await (
      await app.request('/api/admin/domains', json(owner, { name: 'pronista.com', expiryDate: '2027-01-01', provider: 'Cloudflare' }), env)
    ).json()) as { id: string; name: string }
    expect(created.name).toBe('pronista.com')

    expect((await app.request('/api/admin/domains', json(pond, { name: 'hack.com', expiryDate: '2027-01-01' }), env)).status).toBe(403)
    expect((await app.request('/api/admin/domains', { headers: { cookie: pond } }, env)).status).toBe(403)

    const patchRes = await app.request(`/api/admin/domains/${created.id}`, patch(owner, { provider: 'GoDaddy' }), env)
    expect(patchRes.status).toBe(200)
    const list = (await (await app.request('/api/admin/domains', { headers: { cookie: owner } }, env)).json()) as { id: string; provider: string | null }[]
    expect(list.find((d) => d.id === created.id)?.provider).toBe('GoDaddy')

    expect((await app.request(`/api/admin/domains/${created.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)).status).toBe(200)
    const after = (await (await app.request('/api/admin/domains', { headers: { cookie: owner } }, env)).json()) as { id: string }[]
    expect(after.some((d) => d.id === created.id)).toBe(false)
  })

  it('GET /domains/:id คืนโดเมนเดี่ยวพร้อม join · ไม่พบ → 404', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const created = (await (
      await app.request('/api/admin/domains', json(owner, { name: 'detail-test.com', expiryDate: '2027-01-01', responsibleUserId: 'u_pond' }), env)
    ).json()) as { id: string }
    const res = await app.request(`/api/admin/domains/${created.id}`, { headers: { cookie: owner } }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ name: 'detail-test.com', responsibleName: 'ปอนด์' })
    expect((await app.request('/api/admin/domains/does-not-exist', { headers: { cookie: owner } }, env)).status).toBe(404)
  })

  it('แก้ nameservers/forwarding/DNS/DS/Google Workspace ผ่าน PATCH ได้ครบ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const created = (await (
      await app.request('/api/admin/domains', json(owner, { name: 'tabs-test.com', expiryDate: '2027-01-01' }), env)
    ).json()) as { id: string }
    const patchBody = {
      nameservers: ['ns1.cf.com', 'ns2.cf.com'],
      forwardingUrl: 'https://example.com',
      forwardingType: '301',
      dnsRecords: [{ id: 'r1', type: 'A', host: '@', value: '1.2.3.4', ttl: 3600 }],
      privacyProtectionEnabled: true,
      googleWorkspaceVerified: true,
      googleWorkspaceNotes: 'ยืนยัน MX แล้ว',
      dsRecords: [{ id: 'd1', keyTag: '12345', algorithm: '13', digestType: '2', digest: 'abcd' }],
    }
    const res = await app.request(`/api/admin/domains/${created.id}`, patch(owner, patchBody), env)
    expect(res.status).toBe(200)
    const detail = (await (await app.request(`/api/admin/domains/${created.id}`, { headers: { cookie: owner } }, env)).json()) as typeof patchBody
    expect(detail).toMatchObject(patchBody)
  })

  it('ค้นชื่อผู้รับผิดชอบ/โปรเจกต์ที่ผูกไว้ถูกต้อง (join)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const p = (await (await app.request('/api/projects', json(owner, { name: 'โปรเจกต์โดเมน', type: 'project' }), env)).json()) as { id: string }
    const created = (await (
      await app.request('/api/admin/domains', json(owner, { name: 'client-site.com', expiryDate: '2027-06-01', responsibleUserId: 'u_pond', projectId: p.id }), env)
    ).json()) as { id: string }
    const list = (await (await app.request('/api/admin/domains', { headers: { cookie: owner } }, env)).json()) as { id: string; responsibleName: string; projectName: string }[]
    const row = list.find((d) => d.id === created.id)!
    expect(row.responsibleName).toBe('ปอนด์')
    expect(row.projectName).toBe('โปรเจกต์โดเมน')
  })

  it('แก้ไขวันหมดอายุใหม่ → เคลียร์เกตแจ้งเตือนเดิมทั้งหมด (notifiedTiers/expiredNotifiedAt รีเซ็ต)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const today = bkkDateOf(Date.now())
    const created = (await (
      await app.request('/api/admin/domains', json(owner, { name: 'reset-test.com', expiryDate: addDays(today, 5) }), env)
    ).json()) as { id: string }

    const db = createDb(env.DB)
    await notifyDomainExpiry(db, today) // เตือนระดับ 7 ไปแล้ว (เหลือ 5 วัน อยู่ในช่วง 7)

    // เลื่อนวันหมดอายุออกไปไกลๆ — เกตต้องถูกเคลียร์ ไม่งั้นจะไม่มีวันเตือนซ้ำรอบใหม่อีกเลย
    await app.request(`/api/admin/domains/${created.id}`, patch(owner, { expiryDate: addDays(today, 40) }), env)
    const list = (await (await app.request('/api/admin/domains', { headers: { cookie: owner } }, env)).json()) as { id: string; notifiedTiers: number[] | null }[]
    expect(list.find((d) => d.id === created.id)?.notifiedTiers).toBeFalsy()
  })
})

describe('Pronista §Domain Management — notifyDomainExpiry (cron รายวัน)', () => {
  it('เหลือ 30 วันพอดี → เตือนผู้รับผิดชอบ + owner ทุกคน ระดับ 30 · รันซ้ำวันเดียวกันไม่เตือนซ้ำ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const pond = await loginAs(app, 'pond@example-co.test')
    const today = bkkDateOf(Date.now())
    await app.request('/api/admin/domains', json(owner, { name: 'tier30.com', expiryDate: addDays(today, 30), responsibleUserId: 'u_pond' }), env)

    const db = createDb(env.DB)
    const beforeOwner = await domainNotifCount(owner)
    const beforePond = await domainNotifCount(pond)
    await notifyDomainExpiry(db, today)
    expect(await domainNotifCount(owner)).toBe(beforeOwner + 1)
    expect(await domainNotifCount(pond)).toBe(beforePond + 1)

    await notifyDomainExpiry(db, today)
    expect(await domainNotifCount(owner)).toBe(beforeOwner + 1) // ไม่เตือนซ้ำ
  })

  it('ปิด "แจ้งเตือนหมดอายุ" (notifyEnabled=false) → cron ข้ามโดเมนนี้ไปเลย', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const today = bkkDateOf(Date.now())
    const created = (await (
      await app.request('/api/admin/domains', json(owner, { name: 'muted.com', expiryDate: addDays(today, 30) }), env)
    ).json()) as { id: string }
    await app.request(`/api/admin/domains/${created.id}`, patch(owner, { notifyEnabled: false }), env)

    const db = createDb(env.DB)
    const before = await domainNotifCount(owner)
    await notifyDomainExpiry(db, today)
    expect(await domainNotifCount(owner)).toBe(before)
  })

  it('ยังไกลเกิน 30 วัน → ยังไม่เตือน', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const today = bkkDateOf(Date.now())
    await app.request('/api/admin/domains', json(owner, { name: 'far.com', expiryDate: addDays(today, 60) }), env)
    const db = createDb(env.DB)
    const before = await domainNotifCount(owner)
    await notifyDomainExpiry(db, today)
    expect(await domainNotifCount(owner)).toBe(before)
  })

  it('หมดอายุไปแล้ว → เตือนประเภท domain_expired แยกต่างหาก ครั้งเดียวไม่ซ้ำ ไม่เตือนล่วงหน้าซ้ำอีก', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const today = bkkDateOf(Date.now())
    await app.request('/api/admin/domains', json(owner, { name: 'expired.com', expiryDate: addDays(today, -3) }), env)

    const db = createDb(env.DB)
    const before = await expiredNotifCount(owner)
    const beforeReminder = await domainNotifCount(owner)
    await notifyDomainExpiry(db, today)
    expect(await expiredNotifCount(owner)).toBe(before + 1)
    expect(await domainNotifCount(owner)).toBe(beforeReminder) // ไม่ยิง domain_expiry_reminder ปนด้วย

    await notifyDomainExpiry(db, today)
    expect(await expiredNotifCount(owner)).toBe(before + 1) // ไม่เตือนซ้ำ
  })
})

async function domainNotifCount(cookie: string) {
  return (
    (await (await app.request('/api/notifications', { headers: { cookie } }, env)).json()) as { type: string }[]
  ).filter((n) => n.type === 'domain_expiry_reminder').length
}
async function expiredNotifCount(cookie: string) {
  return (
    (await (await app.request('/api/notifications', { headers: { cookie } }, env)).json()) as { type: string }[]
  ).filter((n) => n.type === 'domain_expired').length
}
