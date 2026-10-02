import { createDb, users } from '@seedoffice/db'
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { loginAs, seedUsers } from './helpers'

beforeEach(async () => {
  await seedUsers()
  // storage แชร์ข้ามเทสต์ในไฟล์ + seedUsers = onConflictDoNothing → รีเซ็ตฟิลด์โปรไฟล์ที่แก้เองได้ทุกเทสต์
  await createDb(env.DB).update(users).set({ firstName: null, lastName: null, nickname: null })
})

const appMod = async () => (await import('../src/index')).app
type Me = {
  id: string
  name: string
  email: string
  role: string
  firstName: string | null
  lastName: string | null
  nickname: string | null
}
const patchMe = (app: Awaited<ReturnType<typeof appMod>>, cookie: string, body: unknown) =>
  app.request(
    '/api/me',
    { method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) },
    env,
  )

describe('Profile — /api/me (SPEC §4.1)', () => {
  it('แก้ชื่อเล่น → name = ชื่อเล่น · GET /me สะท้อน', async () => {
    const app = await appMod()
    const cookie = await loginAs(app, 'pond@example-co.test')
    const res = await patchMe(app, cookie, { nickname: 'ปอนด์ดี้' })
    expect(res.status).toBe(200)
    expect((await res.json()) as Me).toMatchObject({ nickname: 'ปอนด์ดี้', name: 'ปอนด์ดี้' })
    const got = (await (await app.request('/api/me', { headers: { cookie } }, env)).json()) as Me
    expect(got).toMatchObject({ nickname: 'ปอนด์ดี้', name: 'ปอนด์ดี้' })
  })

  it('ชื่อจริง+นามสกุล (ไม่มีชื่อเล่น) → name = "ชื่อ นามสกุล"', async () => {
    const app = await appMod()
    const cookie = await loginAs(app, 'pond@example-co.test')
    const me = (await (await patchMe(app, cookie, { firstName: 'ปองพล', lastName: 'ใจดี' })).json()) as Me
    expect(me).toMatchObject({ firstName: 'ปองพล', lastName: 'ใจดี', name: 'ปองพล ใจดี' })
  })

  it('ชื่อเล่นชนะ "ชื่อ นามสกุล" ในการเป็น display name', async () => {
    const app = await appMod()
    const cookie = await loginAs(app, 'pond@example-co.test')
    const me = (await (
      await patchMe(app, cookie, { firstName: 'ปองพล', lastName: 'ใจดี', nickname: 'ปอนด์' })
    ).json()) as Me
    expect(me.name).toBe('ปอนด์')
  })

  it('ล้างชื่อเล่น ("") → กลับไปใช้ "ชื่อ นามสกุล"', async () => {
    const app = await appMod()
    const cookie = await loginAs(app, 'pond@example-co.test')
    await patchMe(app, cookie, { firstName: 'ปองพล', lastName: 'ใจดี', nickname: 'ปอนด์' })
    const me = (await (await patchMe(app, cookie, { nickname: '' })).json()) as Me
    expect(me.nickname).toBeNull()
    expect(me.name).toBe('ปองพล ใจดี')
  })

  it('ทุก role แก้โปรไฟล์ตัวเองได้ (รวม vendor) · email/role ไม่เปลี่ยน', async () => {
    const app = await appMod()
    const cookie = await loginAs(app, 'somchai@example.com')
    const me = (await (await patchMe(app, cookie, { nickname: 'ช่าง' })).json()) as Me
    expect(me).toMatchObject({ nickname: 'ช่าง', email: 'somchai@example.com', role: 'vendor' })
  })

  it('ไม่ login → 401 · body ว่าง → 400', async () => {
    const app = await appMod()
    expect(
      (await app.request('/api/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' }, env)).status,
    ).toBe(401)
    const cookie = await loginAs(app, 'pond@example-co.test')
    expect((await patchMe(app, cookie, {})).status).toBe(400)
  })
})

// Pronista §Profile fields (2026-10-02) — โปรไฟล์ของฉัน กรอกข้อมูลส่วนตัวได้ และข้อมูลไปโผล่ในหน้า จัดการพนักงาน/พาร์ทเนอร์ (ตาราง users เดียวกัน)
describe('Profile — ข้อมูลส่วนตัวที่แก้เองได้ตามกลุ่มผู้ใช้', () => {
  const PERSONAL = ['phone', 'address', 'idCardNumber', 'emergencyContactName', 'emergencyContactPhone', 'businessName', 'specialty', 'bankAccount', 'prefix', 'branchType', 'branchCode', 'jobTitle', 'employeeCode', 'startDate', 'contractType', 'managerId', 'teamId'] as const
  const resetPersonal = async () => {
    const blank = Object.fromEntries(PERSONAL.map((k) => [k, null]))
    await createDb(env.DB).update(users).set(blank)
  }
  beforeEach(resetPersonal)

  const adminView = async (app: Awaited<ReturnType<typeof appMod>>, id: string) => {
    const owner = await loginAs(app, 'owner@example-co.test')
    return (await (await app.request(`/api/admin/users/${id}`, { headers: { cookie: owner } }, env)).json()) as Record<string, unknown>
  }

  it('พนักงาน: กรอกเบอร์/ที่อยู่/เลขบัตร/ผู้ติดต่อฉุกเฉิน → GET /me สะท้อน และหน้าจัดการพนักงานของคนนั้น (admin) เห็นค่าเดียวกัน', async () => {
    const app = await appMod()
    const cookie = await loginAs(app, 'pond@example-co.test')
    const res = await patchMe(app, cookie, {
      phone: '0812345678',
      address: '99 ถ.พระราม 9 กทม.',
      idCardNumber: '1234567890123',
      emergencyContactName: 'แม่ของปอนด์',
      emergencyContactPhone: '0899999999',
    })
    expect(res.status).toBe(200)
    const me = (await (await app.request('/api/me', { headers: { cookie } }, env)).json()) as Record<string, unknown>
    expect(me).toMatchObject({ phone: '0812345678', address: '99 ถ.พระราม 9 กทม.', idCardNumber: '1234567890123', emergencyContactName: 'แม่ของปอนด์', emergencyContactPhone: '0899999999' })
    expect(await adminView(app, 'u_pond')).toMatchObject({ phone: '0812345678', address: '99 ถ.พระราม 9 กทม.', idCardNumber: '1234567890123', emergencyContactName: 'แม่ของปอนด์', emergencyContactPhone: '0899999999' })
  })

  it('ล้างช่อง (ส่งค่าว่าง) → เก็บเป็น null', async () => {
    const app = await appMod()
    const cookie = await loginAs(app, 'pond@example-co.test')
    await patchMe(app, cookie, { phone: '0812345678' })
    expect((await patchMe(app, cookie, { phone: '' })).status).toBe(200)
    const me = (await (await app.request('/api/me', { headers: { cookie } }, env)).json()) as Record<string, unknown>
    expect(me.phone).toBeNull()
  })

  it('พนักงานแก้ฟิลด์ที่ HR ดูแล (ตำแหน่ง/หัวหน้า/รหัสพนักงาน) หรือของพาร์ทเนอร์ (ธนาคาร) ไม่ได้ → 400', async () => {
    const app = await appMod()
    const cookie = await loginAs(app, 'pond@example-co.test')
    for (const body of [{ jobTitle: 'CEO' }, { managerId: 'u_owner' }, { employeeCode: 'E001' }, { bankAccount: 'กสิกร 123' }, { businessName: 'X' }]) {
      const res = await patchMe(app, cookie, body)
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('field_not_allowed')
    }
    const me = (await (await app.request('/api/me', { headers: { cookie } }, env)).json()) as Record<string, unknown>
    expect(me.jobTitle ?? null).toBeNull()
  })

  it('เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก → ผิด = 400 · รหัสสาขาต้อง 5 หลัก', async () => {
    const app = await appMod()
    const pond = await loginAs(app, 'pond@example-co.test')
    expect((await patchMe(app, pond, { idCardNumber: '12345' })).status).toBe(400)
    expect((await patchMe(app, pond, { idCardNumber: '12345678901ab' })).status).toBe(400)
    const vendor = await loginAs(app, 'somchai@example.com')
    expect((await patchMe(app, vendor, { branchType: 'branch', branchCode: '12' })).status).toBe(400)
  })

  it('พาร์ทเนอร์: กรอกชื่อธุรกิจ/ความเชี่ยวชาญ/บัญชีธนาคาร → หน้าจัดการพาร์ทเนอร์เห็น · แก้สัญญา/ประเภทเองไม่ได้', async () => {
    const app = await appMod()
    const cookie = await loginAs(app, 'somchai@example.com')
    const res = await patchMe(app, cookie, { businessName: 'สมชายสตูดิโอ', specialty: 'UI/UX', bankAccount: 'กสิกร 123-4-56789-0', phone: '0811111111', prefix: 'นาย', idCardNumber: '1111111111111' })
    expect(res.status).toBe(200)
    expect(await adminView(app, 'u_somchai')).toMatchObject({ businessName: 'สมชายสตูดิโอ', specialty: 'UI/UX', bankAccount: 'กสิกร 123-4-56789-0', phone: '0811111111', prefix: 'นาย', idCardNumber: '1111111111111' })
    for (const body of [{ contractType: 'รายเดือน' }, { classificationType: 'ordinary_juristic' }, { specialNote: 'x' }, { address: 'x' }]) {
      expect((await patchMe(app, cookie, body)).status).toBe(400)
    }
  })

  it('ชื่อ/ชื่อเล่นเดิมยังแก้ได้ปกติพร้อมกับฟิลด์ใหม่ในคำขอเดียว · ฟิลด์ที่ไม่ส่งมาไม่ถูกแตะ', async () => {
    const app = await appMod()
    const cookie = await loginAs(app, 'pond@example-co.test')
    await patchMe(app, cookie, { phone: '0800000000' })
    const res = await patchMe(app, cookie, { nickname: 'ปอนด์', address: 'บ้านเลขที่ 1' })
    expect(res.status).toBe(200)
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ name: 'ปอนด์', phone: '0800000000', address: 'บ้านเลขที่ 1' })
  })
})
