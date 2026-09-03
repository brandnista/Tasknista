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

beforeEach(async () => {
  await seedUsers()
  // Pronista §Daily Report multi-recipient — เทสต์นี้ต้องมีผู้รับที่เข้าเงื่อนไข (owner/member) มากกว่า 2 คน seedUsers เดิมมีแค่ owner+pond
  await createDb(env.DB)
    .insert(users)
    .values({ id: 'u_nam', email: 'nam@example-co.test', name: 'น้ำ', role: 'member' })
    .onConflictDoNothing()
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

  it('คนที่ไม่ใช่เจ้าของ/ผู้รับ/owner บริษัท เปิดรายงานไม่ได้ (403)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const created = (await (await app.request('/api/daily-reports', json(pond, { date: '2026-08-24' }), env)).json()) as { id: string }
    await app.request(`/api/daily-reports/${created.id}/submit`, json(pond, { recipientIds: ['u_nam'] }), env)

    const somchai = await loginAs(app, 'somchai@example.com')
    const res = await app.request(`/api/daily-reports/${created.id}`, { headers: { cookie: somchai } }, env)
    expect(res.status).toBe(403)
  })
})
