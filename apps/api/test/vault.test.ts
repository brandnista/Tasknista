import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

beforeEach(async () => {
  await seedUsers()
  await env.DB.prepare('DELETE FROM secret_vault_items').run()
  await env.DB.prepare('DELETE FROM secret_vault_folders').run()
  await env.DB.prepare('DELETE FROM vault_unlocks').run()
  await env.DB.prepare("UPDATE users SET vault_pin_hash = NULL, vault_pin_failed_attempts = 0, vault_pin_locked_until = NULL").run()
  await env.DB.prepare("UPDATE company_config SET permission_ceilings = NULL").run()
})

const json = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/** ตั้ง PIN ให้ owner คนนี้แล้วปลดล็อค คืน { cookie, token } — token ใช้แนบ header x-vault-token กับ endpoint ที่ต้องปลดล็อค (ไม่มี cookie แล้วตาม §Secret Vault Permission 2026-09-08) */
async function setPinAndUnlock(cookie: string, pin = '1234'): Promise<{ cookie: string; token: string }> {
  await app.request('/api/vault/pin', json(cookie, { newPin: pin }), env)
  const res = await app.request('/api/vault/unlock', json(cookie, { pin }), env)
  const body = (await res.json()) as { token: string }
  return { cookie, token: body.token }
}

const withToken = (cookie: string, token: string) => ({ cookie, 'x-vault-token': token })

/** เปิด/ปิดเพดานสิทธิ์เมนู vault ให้หมวด staff — ใช้ owner cookie ยิง GET/PUT /api/admin/permission-ceilings ทับกันไปมา */
async function setStaffVaultCeiling(owner: string, enabled: boolean): Promise<void> {
  const cfg = await app.request('/api/admin/permission-ceilings', { headers: { cookie: owner } }, env)
  const { ceilings } = (await cfg.json()) as { ceilings: Record<string, { menus: Record<string, boolean> }> }
  ceilings.staff!.menus.vault = enabled
  await app.request('/api/admin/permission-ceilings', { ...json(owner, { ceilings }), method: 'PUT' }, env)
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

  it('GET /vault/users — owner-only, คืนแค่ id/name/email ไม่มี vaultPinHash หลุดมา', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await setStaffVaultCeiling(owner, true)
    const member = await loginAs(app, 'pond@example-co.test')
    expect((await app.request('/api/vault/users', { headers: { cookie: member } }, env)).status).toBe(403)

    const res = await app.request('/api/vault/users', { headers: { cookie: owner } }, env)
    expect(res.status).toBe(200)
    const list = (await res.json()) as Record<string, unknown>[]
    expect(list.length).toBeGreaterThan(0)
    expect(list[0]).not.toHaveProperty('vaultPinHash')
    expect(list[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), email: expect.any(String) })
  })

  it('pin/reset — owner อีกคน reset ให้ได้โดยไม่ต้องรู้ PIN เดิม · non-owner (member) ต้อง 403', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await app.request('/api/vault/pin', json(owner, { newPin: '1234' }), env)
    const reset = await app.request('/api/vault/pin/reset', json(owner, { userId: 'u_owner' }), env)
    expect(reset.status).toBe(200)
    expect((await (await app.request('/api/vault/status', { headers: { cookie: owner } }, env)).json()) as { hasPin: boolean }).toMatchObject({ hasPin: false })

    // §Secret Vault Permission (2026-09-08) — เปิดเมนูให้ member เข้าได้แล้ว ต้องกันไม่ให้ reset PIN คนอื่นได้ (privilege escalation)
    await setStaffVaultCeiling(owner, true)
    const member = await loginAs(app, 'pond@example-co.test')
    const memberReset = await app.request('/api/vault/pin/reset', json(member, { userId: 'u_owner' }), env)
    expect(memberReset.status).toBe(403)
  })

  it('unlock ด้วย PIN ผิด → 401 · ถูก → คืน token ใน body ใช้ยิง endpoint ที่ต้องปลดล็อคได้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await app.request('/api/vault/pin', json(owner, { newPin: '1234' }), env)
    expect((await app.request('/api/vault/unlock', json(owner, { pin: '0000' }), env)).status).toBe(401)
    const { token } = await setPinAndUnlock(owner)
    expect(token).toBeTruthy()
    // status ไม่มี unlocked แล้ว (ไม่มี cookie ให้เช็ค) — token ใช้ยืนยันตัวได้จริงกับ endpoint ที่ต้องปลดล็อค
    const created = await app.request('/api/vault/items', { ...json(owner, { name: 'ทดสอบ token' }), headers: { ...withToken(owner, token), 'content-type': 'application/json' } }, env)
    expect(created.status).toBe(201)
  })

  it('§Security Recheck (2026-09-10) — ใส่ PIN ผิดครบ 5 ครั้งติดต่อกัน → ล็อก 429 แม้ใส่ถูก · reset ตัวนับเมื่อใส่ถูกก่อนครบเพดาน', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await app.request('/api/vault/pin', json(owner, { newPin: '1234' }), env)

    // ผิด 4 ครั้งแล้วใส่ถูก 1 ครั้ง — ตัวนับต้องรีเซ็ต ไม่ล็อก
    for (let i = 0; i < 4; i++) expect((await app.request('/api/vault/unlock', json(owner, { pin: '0000' }), env)).status).toBe(401)
    expect((await app.request('/api/vault/unlock', json(owner, { pin: '1234' }), env)).status).toBe(200)

    // ผิดครบ 5 ครั้งรวด → ล็อก แม้รอบถัดไปจะใส่ถูกก็โดนบล็อกด้วย 429
    for (let i = 0; i < 5; i++) expect((await app.request('/api/vault/unlock', json(owner, { pin: '0000' }), env)).status).toBe(401)
    const lockedRes = await app.request('/api/vault/unlock', json(owner, { pin: '1234' }), env)
    expect(lockedRes.status).toBe(429)
    expect((await lockedRes.json()) as { error: string }).toMatchObject({ error: 'pin_locked' })
  })

  it('role อื่น (member/vendor) เรียก endpoint ไหนก็ 403 หมด (ceiling ปิดอยู่โดย default)', async () => {
    const pond = await loginAs(app, 'pond@example-co.test')
    const somchai = await loginAs(app, 'somchai@example.com')
    for (const cookie of [pond, somchai]) {
      expect((await app.request('/api/vault/status', { headers: { cookie } }, env)).status).toBe(403)
      expect((await app.request('/api/vault/items', { headers: { cookie } }, env)).status).toBe(403)
      expect((await app.request('/api/vault/pin', json(cookie, { newPin: '1234' }), env)).status).toBe(403)
    }
  })

  it('เปิดเพดานสิทธิ์ (staff→vault) แล้ว member เข้าได้จริง · ปิดกลับแล้วเข้าไม่ได้อีก', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await setStaffVaultCeiling(owner, true)

    const member = await loginAs(app, 'pond@example-co.test')
    expect((await app.request('/api/vault/status', { headers: { cookie: member } }, env)).status).toBe(200)

    await setStaffVaultCeiling(owner, false)
    expect((await app.request('/api/vault/status', { headers: { cookie: member } }, env)).status).toBe(403)
  })
})

describe('§Secret Vault — items', () => {
  it('list ไม่ต้องปลดล็อค แต่ต้องไม่มี password/notes ปนมาเลย', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { token } = await setPinAndUnlock(owner)
    await app.request('/api/vault/items', { ...json(owner, { name: 'cPanel ลูกค้า A', username: 'admin', password: 'S3cret!', notes: 'ลับสุดยอด' }), headers: { ...withToken(owner, token), 'content-type': 'application/json' } }, env)

    const res = await app.request('/api/vault/items', { headers: { cookie: owner } }, env) // ไม่แนบ token เลย ก็ยัง list ได้
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
    const { token } = await setPinAndUnlock(owner)
    const created = (await (
      await app.request('/api/vault/items', { ...json(owner, { name: 'API Key กลาง', username: null, password: 'sk-abc123', url: 'https://x.test', notes: 'หมายเหตุ' }), headers: { ...withToken(owner, token), 'content-type': 'application/json' } }, env)
    ).json()) as { id: string }

    const lockedReveal = await app.request(`/api/vault/items/${created.id}/reveal`, { headers: { cookie: owner } }, env)
    expect(lockedReveal.status).toBe(401)
    expect(((await lockedReveal.json()) as { error: string }).error).toBe('vault_locked')

    const revealed = await app.request(`/api/vault/items/${created.id}/reveal`, { headers: withToken(owner, token) }, env)
    expect(revealed.status).toBe(200)
    expect((await revealed.json()) as { password: string; notes: string }).toMatchObject({ password: 'sk-abc123', notes: 'หมายเหตุ' })

    const auditRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id = ? AND action = 'secret_vault_item.reveal'").bind(created.id).first<{ n: number }>()
    expect(auditRow?.n).toBe(1)
  })

  it('สร้าง/แก้ไข item โดยไม่ปลดล็อค (ไม่มี token) → 401', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await app.request('/api/vault/pin', json(owner, { newPin: '1234' }), env) // ตั้ง PIN แต่ยังไม่ unlock
    expect((await app.request('/api/vault/items', json(owner, { name: 'x' }), env)).status).toBe(401)
  })

  it('soft-delete — หายจาก list, audit log บันทึก, ต้องปลดล็อคก่อนถึงลบได้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { token } = await setPinAndUnlock(owner)
    const created = (await (await app.request('/api/vault/items', { ...json(owner, { name: 'ลบทิ้ง' }), headers: { ...withToken(owner, token), 'content-type': 'application/json' } }, env)).json()) as { id: string }
    const del = await app.request(`/api/vault/items/${created.id}`, { method: 'DELETE', headers: withToken(owner, token) }, env)
    expect(del.status).toBe(200)
    const list = (await (await app.request('/api/vault/items', { headers: { cookie: owner } }, env)).json()) as unknown[]
    expect(list).toHaveLength(0)
    const auditRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id = ? AND action = 'secret_vault_item.delete'").bind(created.id).first<{ n: number }>()
    expect(auditRow?.n).toBe(1)
  })

  it('§Security Recheck — ลบโดยไม่แนบ token ปลดล็อค → 401 (เดิมลบได้เลยไม่ต้องปลดล็อค ถือเป็นช่องโหว่)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { token } = await setPinAndUnlock(owner)
    const created = (await (await app.request('/api/vault/items', { ...json(owner, { name: 'ลบไม่ได้ถ้าไม่ปลดล็อค' }), headers: { ...withToken(owner, token), 'content-type': 'application/json' } }, env)).json()) as { id: string }
    const del = await app.request(`/api/vault/items/${created.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)
    expect(del.status).toBe(401)
  })

  it('แก้ไข password ผ่าน PATCH → reveal คืนค่าใหม่', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { token } = await setPinAndUnlock(owner)
    const created = (await (await app.request('/api/vault/items', { ...json(owner, { name: 'แก้ทีหลัง', password: 'old-pass' }), headers: { ...withToken(owner, token), 'content-type': 'application/json' } }, env)).json()) as { id: string }
    const patch = await app.request(`/api/vault/items/${created.id}`, { ...json(owner, { password: 'new-pass' }), method: 'PATCH', headers: { ...withToken(owner, token), 'content-type': 'application/json' } }, env)
    expect(patch.status).toBe(200)
    const revealed = (await (await app.request(`/api/vault/items/${created.id}/reveal`, { headers: withToken(owner, token) }, env)).json()) as { password: string }
    expect(revealed.password).toBe('new-pass')
  })

  it('type + extraFields — สร้างพร้อม type อื่นๆ ได้ · list เห็น type แต่ extraFields ไม่หลุด · reveal ได้ extraFields ตรงกับที่ set', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { token } = await setPinAndUnlock(owner)
    const created = (await (
      await app.request(
        '/api/vault/items',
        { ...json(owner, { name: 'Paysolution', type: 'payment_gateway', extraFields: [{ label: 'Merchant ID', value: 'M12345' }, { label: 'Secret Key', value: 'sk-secret-xyz' }] }), headers: { ...withToken(owner, token), 'content-type': 'application/json' } },
        env,
      )
    ).json()) as { id: string }

    const list = (await (await app.request('/api/vault/items', { headers: { cookie: owner } }, env)).json()) as { id: string; type: string }[]
    const row = list.find((r) => r.id === created.id)
    expect(row?.type).toBe('payment_gateway')
    expect(JSON.stringify(list)).not.toContain('sk-secret-xyz') // extraFieldsEnc ไม่หลุดมาใน list เด็ดขาด

    const revealed = (await (await app.request(`/api/vault/items/${created.id}/reveal`, { headers: withToken(owner, token) }, env)).json()) as { extraFields: { label: string; value: string }[] }
    expect(revealed.extraFields).toEqual([{ label: 'Merchant ID', value: 'M12345' }, { label: 'Secret Key', value: 'sk-secret-xyz' }])
  })

  it('type ไม่ระบุ → default เป็น website · extraFields ไม่ระบุ → reveal คืน array ว่าง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { token } = await setPinAndUnlock(owner)
    const created = (await (await app.request('/api/vault/items', { ...json(owner, { name: 'ธรรมดา' }), headers: { ...withToken(owner, token), 'content-type': 'application/json' } }, env)).json()) as { id: string }
    const list = (await (await app.request('/api/vault/items', { headers: { cookie: owner } }, env)).json()) as { id: string; type: string }[]
    expect(list.find((r) => r.id === created.id)?.type).toBe('website')
    const revealed = (await (await app.request(`/api/vault/items/${created.id}/reveal`, { headers: withToken(owner, token) }, env)).json()) as { extraFields: unknown[] }
    expect(revealed.extraFields).toEqual([])
  })
})

describe('§Secret Vault — แจ้งเตือนคนอื่นตอน unlock', () => {
  it('unlock สำเร็จ → คนอื่นที่มีสิทธิ์เข้าเมนูได้รับ notification vault_accessed ยกเว้นตัวเอง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    // เปิดเพดานให้ staff เข้า vault ได้ก่อน กัน pond ไม่นับเป็นผู้มีสิทธิ์
    await setStaffVaultCeiling(owner, true)

    await setPinAndUnlock(owner)

    // owner คนอื่น (u_owner) กับ member ที่ ceiling เปิดให้ (u_pond) ต้องได้ — vendor (u_somchai) ต้องไม่ได้ เพราะ ceiling outsource ยังปิดอยู่
    const ownerNotif = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type='vault_accessed'").first<{ n: number }>()
    expect(ownerNotif?.n).toBeGreaterThan(0)
    const selfNotif = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type='vault_accessed' AND user_id='u_owner'").first<{ n: number }>()
    expect(selfNotif?.n).toBe(0) // ไม่แจ้งตัวเอง
    const pondNotif = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type='vault_accessed' AND user_id='u_pond'").first<{ n: number }>()
    expect(pondNotif?.n).toBe(1)
    const somchaiNotif = await env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type='vault_accessed' AND user_id='u_somchai'").first<{ n: number }>()
    expect(somchaiNotif?.n).toBe(0)
  })
})

describe('§Secret Vault — Folder', () => {
  it('สร้าง/แก้ไข/ลบ Folder ได้ · ผูก item เข้า Folder ได้ · ลบ Folder แล้ว item ไม่หาย แค่ folderId กลับเป็น null', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const { token } = await setPinAndUnlock(owner)

    const createRes = await app.request('/api/vault/folders', json(owner, { name: 'เว็บ Seller ร้าน X' }), env)
    expect(createRes.status).toBe(201)
    const folder = (await createRes.json()) as { id: string; name: string }

    const renameRes = await app.request(`/api/vault/folders/${folder.id}`, { ...json(owner, { name: 'เว็บ Seller ร้าน Y' }), method: 'PATCH' }, env)
    expect(renameRes.status).toBe(200)

    const itemRes = await app.request('/api/vault/items', { ...json(owner, { name: 'Login ร้าน Y', folderId: folder.id, password: 'pass1' }), headers: { ...withToken(owner, token), 'content-type': 'application/json' } }, env)
    const item = (await itemRes.json()) as { id: string }

    const listBefore = (await (await app.request('/api/vault/items', { headers: { cookie: owner } }, env)).json()) as { id: string; folderId: string | null; folderName: string | null }[]
    const rowBefore = listBefore.find((r) => r.id === item.id)
    expect(rowBefore).toMatchObject({ folderId: folder.id, folderName: 'เว็บ Seller ร้าน Y' })

    const delRes = await app.request(`/api/vault/folders/${folder.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)
    expect(delRes.status).toBe(200)

    const listAfter = (await (await app.request('/api/vault/items', { headers: { cookie: owner } }, env)).json()) as { id: string; folderId: string | null }[]
    const rowAfter = listAfter.find((r) => r.id === item.id)
    expect(rowAfter?.folderId).toBeNull() // item ไม่หาย แค่หลุดจาก Folder

    const foldersAfter = (await (await app.request('/api/vault/folders', { headers: { cookie: owner } }, env)).json()) as unknown[]
    expect(foldersAfter).toHaveLength(0)
  })
})

describe('§Secret Vault — ประวัติการเข้าใช้งาน', () => {
  it('GET /audit คืนรายการล่าสุด ไม่ต้องปลดล็อคก็ดูได้ ไม่มี plaintext', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await setPinAndUnlock(owner)
    const res = await app.request('/api/vault/audit', { headers: { cookie: owner } }, env)
    expect(res.status).toBe(200)
    const rows = (await res.json()) as { action: string; actorName: string | null }[]
    expect(rows.some((r) => r.action === 'vault.unlock')).toBe(true)
    expect(rows.some((r) => r.action === 'vault_pin.set')).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('1234')
  })
})
