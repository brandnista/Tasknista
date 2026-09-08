import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

beforeEach(async () => {
  await seedUsers()
  await env.DB.prepare('DELETE FROM secret_vault_items').run()
  await env.DB.prepare('DELETE FROM vault_unlocks').run()
  await env.DB.prepare("UPDATE users SET vault_pin_hash = NULL").run()
})

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/** ตั้ง PIN ให้ owner คนนี้แล้วปลดล็อค คืน cookie รวม (session + vault unlock) พร้อมใช้เรียก endpoint ที่ต้องปลดล็อค */
async function setPinAndUnlock(cookie: string, pin = '1234'): Promise<string> {
  await app.request('/api/vault/pin', json(cookie, { newPin: pin }), env)
  const res = await app.request('/api/vault/unlock', json(cookie, { pin }), env)
  const setCookie = res.headers.get('set-cookie') ?? ''
  const m = /so_vault_unlock=([^;]+)/.exec(setCookie)
  if (!m) throw new Error('ไม่มี vault unlock cookie')
  return `${cookie}; so_vault_unlock=${m[1]}`
}

describe('§Secret Vault — PIN + unlock', () => {
  it('ตั้ง PIN ครั้งแรกไม่ต้อง currentPin → hasPin=true', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    expect((await (await app.request('/api/vault/status', { headers: { cookie: owner } }, env)).json()) as { hasPin: boolean }).toMatchObject({ hasPin: false })
    const res = await app.request('/api/vault/pin', json(owner, { newPin: '1234' }), env)
    expect(res.status).toBe(200)
    expect((await (await app.request('/api/vault/status', { headers: { cookie: owner } }, env)).json()) as { hasPin: boolean }).toMatchObject({ hasPin: true })
  })

  it('เปลี่ยน PIN โดย currentPin ผิด → 403 · ถูก → สำเร็จ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await app.request('/api/vault/pin', json(owner, { newPin: '1234' }), env)
    const wrong = await app.request('/api/vault/pin', json(owner, { currentPin: '9999', newPin: '5678' }), env)
    expect(wrong.status).toBe(403)
    const right = await app.request('/api/vault/pin', json(owner, { currentPin: '1234', newPin: '5678' }), env)
    expect(right.status).toBe(200)
    // ปลดล็อคด้วย PIN เก่าต้องไม่ผ่านแล้ว, ใหม่ต้องผ่าน
    expect((await app.request('/api/vault/unlock', json(owner, { pin: '1234' }), env)).status).toBe(401)
    expect((await app.request('/api/vault/unlock', json(owner, { pin: '5678' }), env)).status).toBe(200)
  })

  it('pin/reset — owner อีกคน reset ให้ได้โดยไม่ต้องรู้ PIN เดิม', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await app.request('/api/vault/pin', json(owner, { newPin: '1234' }), env)
    const reset = await app.request('/api/vault/pin/reset', json(owner, { userId: 'u_owner' }), env)
    expect(reset.status).toBe(200)
    expect((await (await app.request('/api/vault/status', { headers: { cookie: owner } }, env)).json()) as { hasPin: boolean }).toMatchObject({ hasPin: false })
  })

  it('unlock ด้วย PIN ผิด → 401 · ถูก → status.unlocked=true', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await app.request('/api/vault/pin', json(owner, { newPin: '1234' }), env)
    expect((await app.request('/api/vault/unlock', json(owner, { pin: '0000' }), env)).status).toBe(401)
    const cookie = await setPinAndUnlock(owner)
    const status = (await (await app.request('/api/vault/status', { headers: { cookie } }, env)).json()) as { unlocked: boolean }
    expect(status.unlocked).toBe(true)
  })

  it('role อื่น (member/vendor) เรียก endpoint ไหนก็ 403 หมด', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    for (const cookie of [pond, somchai]) {
      expect((await app.request('/api/vault/status', { headers: { cookie } }, env)).status).toBe(403)
      expect((await app.request('/api/vault/items', { headers: { cookie } }, env)).status).toBe(403)
      expect((await app.request('/api/vault/pin', json(cookie, { newPin: '1234' }), env)).status).toBe(403)
    }
  })
})

describe('§Secret Vault — items', () => {
  it('list ไม่ต้องปลดล็อค แต่ต้องไม่มี password/notes ปนมาเลย', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const unlocked = await setPinAndUnlock(owner)
    await app.request('/api/vault/items', json(unlocked, { name: 'cPanel ลูกค้า A', username: 'admin', password: 'S3cret!', notes: 'ลับสุดยอด' }), env)

    const res = await app.request('/api/vault/items', { headers: { cookie: owner } }, env) // ใช้ cookie ที่ไม่ได้ปลดล็อคด้วยซ้ำ ก็ยัง list ได้
    expect(res.status).toBe(200)
    const list = (await res.json()) as Record<string, unknown>[]
    expect(list).toHaveLength(1)
    const raw = JSON.stringify(list[0])
    expect(raw).not.toContain('S3cret')
    expect(raw).not.toContain('ลับสุดยอด')
    expect(list[0]).not.toHaveProperty('passwordEnc')
    expect(list[0]).not.toHaveProperty('notesEnc')
  })

  it('reveal ไม่ปลดล็อค → 401 vault_locked · ปลดล็อคแล้ว → คืนรหัสผ่าน plaintext ตรงกับที่ set + เขียน audit log', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const unlocked = await setPinAndUnlock(owner)
    const created = (await (
      await app.request('/api/vault/items', json(unlocked, { name: 'API Key กลาง', username: null, password: 'sk-abc123', url: 'https://x.test', notes: 'หมายเหตุ' }), env)
    ).json()) as { id: string }

    const lockedReveal = await app.request(`/api/vault/items/${created.id}/reveal`, { headers: { cookie: owner } }, env)
    expect(lockedReveal.status).toBe(401)
    expect(((await lockedReveal.json()) as { error: string }).error).toBe('vault_locked')

    const revealed = await app.request(`/api/vault/items/${created.id}/reveal`, { headers: { cookie: unlocked } }, env)
    expect(revealed.status).toBe(200)
    expect((await revealed.json()) as { password: string; notes: string }).toMatchObject({ password: 'sk-abc123', notes: 'หมายเหตุ' })

    const auditRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id = ? AND action = 'secret_vault_item.reveal'").bind(created.id).first<{ n: number }>()
    expect(auditRow?.n).toBe(1)
  })

  it('สร้าง/แก้ไข item โดยไม่ปลดล็อค → 401', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await app.request('/api/vault/pin', json(owner, { newPin: '1234' }), env) // ตั้ง PIN แต่ยังไม่ unlock
    expect((await app.request('/api/vault/items', json(owner, { name: 'x' }), env)).status).toBe(401)
  })

  it('soft-delete — หายจาก list, audit log บันทึก, ไม่ต้องปลดล็อค', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const unlocked = await setPinAndUnlock(owner)
    const created = (await (await app.request('/api/vault/items', json(unlocked, { name: 'ลบทิ้ง' }), env)).json()) as { id: string }
    const del = await app.request(`/api/vault/items/${created.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)
    expect(del.status).toBe(200)
    const list = (await (await app.request('/api/vault/items', { headers: { cookie: owner } }, env)).json()) as unknown[]
    expect(list).toHaveLength(0)
    const auditRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id = ? AND action = 'secret_vault_item.delete'").bind(created.id).first<{ n: number }>()
    expect(auditRow?.n).toBe(1)
  })

  it('แก้ไข password ผ่าน PATCH → reveal คืนค่าใหม่', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const unlocked = await setPinAndUnlock(owner)
    const created = (await (await app.request('/api/vault/items', json(unlocked, { name: 'แก้ทีหลัง', password: 'old-pass' }), env)).json()) as { id: string }
    const patch = await app.request(`/api/vault/items/${created.id}`, { ...json(unlocked, { password: 'new-pass' }), method: 'PATCH' }, env)
    expect(patch.status).toBe(200)
    const revealed = (await (await app.request(`/api/vault/items/${created.id}/reveal`, { headers: { cookie: unlocked } }, env)).json()) as { password: string }
    expect(revealed.password).toBe('new-pass')
  })
})
