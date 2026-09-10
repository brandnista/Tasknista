import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { loginAs, seedUsers } from './helpers'

beforeEach(async () => {
  await seedUsers()
  await env.DB.prepare('DELETE FROM second_brain_links').run()
  await env.DB.prepare('UPDATE company_config SET permission_ceilings = NULL').run()
})

async function sign(bodyText: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(bodyText))
  let s = ''
  for (const b of new Uint8Array(mac)) s += String.fromCharCode(b)
  return btoa(s)
}

const GROUP_ID = 'Cdevfakegroupid1234567890'

function messageEvent(opts: { messageId: string; text: string; groupId?: string; userId?: string }) {
  return {
    type: 'message',
    message: { type: 'text', id: opts.messageId, text: opts.text },
    source: { type: 'group', groupId: opts.groupId ?? GROUP_ID, userId: opts.userId ?? 'Ufakeuser1' },
  }
}

async function postWebhook(events: unknown[]) {
  const bodyText = JSON.stringify({ events })
  const signature = await sign(bodyText, env.LINE_CHANNEL_SECRET)
  return app.request('/api/line/webhook', { method: 'POST', headers: { 'x-line-signature': signature, 'content-type': 'application/json' }, body: bodyText }, env)
}

describe('§Second Brain — webhook', () => {
  it('signature ถูกต้อง + มีลิงก์ในห้องที่กำหนด → บันทึกเข้า DB', async () => {
    const res = await postWebhook([messageEvent({ messageId: 'm1', text: 'ลองอ่านอันนี้ https://example.com/article' })])
    expect(res.status).toBe(200)
    const rows = await env.DB.prepare('SELECT * FROM second_brain_links').all()
    expect(rows.results.length).toBe(1)
    expect(rows.results[0]?.url).toBe('https://example.com/article')
    expect(rows.results[0]?.message_text).toBe('ลองอ่านอันนี้ https://example.com/article')
  })

  it('signature ผิด → 401 ไม่บันทึกอะไรเลย', async () => {
    const bodyText = JSON.stringify({ events: [messageEvent({ messageId: 'm1', text: 'https://example.com' })] })
    const res = await app.request('/api/line/webhook', { method: 'POST', headers: { 'x-line-signature': 'invalid-signature==', 'content-type': 'application/json' }, body: bodyText }, env)
    expect(res.status).toBe(401)
    const rows = await env.DB.prepare('SELECT * FROM second_brain_links').all()
    expect(rows.results.length).toBe(0)
  })

  it('ยังไม่ตั้ง LINE_CHANNEL_SECRET (ว่าง/undefined) → 401 สะอาดๆ ไม่ crash เป็น 500', async () => {
    const bodyText = JSON.stringify({ events: [] })
    const res = await app.request(
      '/api/line/webhook',
      { method: 'POST', headers: { 'x-line-signature': 'anything', 'content-type': 'application/json' }, body: bodyText },
      { ...env, LINE_CHANNEL_SECRET: '' },
    )
    expect(res.status).toBe(401)
  })

  it('groupId ไม่ตรง LINE_SECOND_BRAIN_GROUP_ID → ไม่บันทึก แต่ยังคืน 200', async () => {
    const res = await postWebhook([messageEvent({ messageId: 'm1', text: 'https://example.com', groupId: 'Cwronggroup' })])
    expect(res.status).toBe(200)
    const rows = await env.DB.prepare('SELECT * FROM second_brain_links').all()
    expect(rows.results.length).toBe(0)
  })

  it('ข้อความไม่มีลิงก์ → ไม่บันทึก แต่ยังคืน 200', async () => {
    const res = await postWebhook([messageEvent({ messageId: 'm1', text: 'วันนี้กินอะไรดี' })])
    expect(res.status).toBe(200)
    const rows = await env.DB.prepare('SELECT * FROM second_brain_links').all()
    expect(rows.results.length).toBe(0)
  })

  it('ยิง event ซ้ำ (messageId+url เดิม เหมือน LINE retry) → บันทึกครั้งเดียว ไม่ซ้ำ', async () => {
    const events = [messageEvent({ messageId: 'm-dup', text: 'https://example.com/x' })]
    await postWebhook(events)
    const res2 = await postWebhook(events)
    expect(res2.status).toBe(200)
    const rows = await env.DB.prepare('SELECT * FROM second_brain_links').all()
    expect(rows.results.length).toBe(1)
  })

  it('ข้อความเดียวมีหลายลิงก์ → บันทึกแยกแถวครบทุกลิงก์', async () => {
    await postWebhook([messageEvent({ messageId: 'm-multi', text: 'https://a.com กับ https://b.com' })])
    const rows = await env.DB.prepare('SELECT url FROM second_brain_links ORDER BY url').all()
    expect(rows.results.map((r) => r.url)).toEqual(['https://a.com', 'https://b.com'])
  })

  it('ลิงก์+โน้ตต่อท้ายในบรรทัดเดียว → note เก็บเฉพาะส่วนโน้ต ไม่มีลิงก์ซ้ำ (กันบั๊กที่เจอจริง)', async () => {
    await postWebhook([messageEvent({ messageId: 'm-note', text: 'https://youtu.be/x อันนี้ดีมะ' })])
    const rows = await env.DB.prepare('SELECT note FROM second_brain_links').all()
    expect(rows.results[0]?.note).toBe('อันนี้ดีมะ')
  })
})

const jsonReq = (cookie: string, body: unknown) => ({
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

async function setStaffSecondBrainCeiling(owner: string, enabled: boolean): Promise<void> {
  const cfg = await app.request('/api/admin/permission-ceilings', { headers: { cookie: owner } }, env)
  const { ceilings } = (await cfg.json()) as { ceilings: Record<string, { menus: Record<string, boolean> }> }
  ceilings.staff!.menus.secondBrain = enabled
  await app.request('/api/admin/permission-ceilings', { ...jsonReq(owner, { ceilings }), method: 'PUT' }, env)
}

describe('§Second Brain — list/delete (ผ่านเพดานสิทธิ์)', () => {
  it('staff เข้าเมนูได้โดย default (ไม่ต้องเปิดเพดานเอง) — เห็นรายการที่ webhook บันทึกไว้', async () => {
    await postWebhook([messageEvent({ messageId: 'm1', text: 'https://example.com/a' })])
    const member = await loginAs(app, 'pond@example-co.test')
    const res = await app.request('/api/second-brain/links', { headers: { cookie: member } }, env)
    expect(res.status).toBe(200)
    const rows = (await res.json()) as { url: string }[]
    expect(rows.map((r) => r.url)).toEqual(['https://example.com/a'])
  })

  it('outsource (vendor) เข้าเมนูไม่ได้โดย default', async () => {
    const vendor = await loginAs(app, 'somchai@example.com')
    const res = await app.request('/api/second-brain/links', { headers: { cookie: vendor } }, env)
    expect(res.status).toBe(403)
  })

  it('ปิดเพดาน staff แล้ว member เข้าเมนูไม่ได้', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    await setStaffSecondBrainCeiling(owner, false)
    const member = await loginAs(app, 'pond@example-co.test')
    const res = await app.request('/api/second-brain/links', { headers: { cookie: member } }, env)
    expect(res.status).toBe(403)
  })

  it('ลบรายการ (soft-delete) → หายจาก list + มี audit log', async () => {
    await postWebhook([messageEvent({ messageId: 'm1', text: 'https://example.com/del-me' })])
    const owner = await loginAs(app, 'owner@example-co.test')
    const list = (await (await app.request('/api/second-brain/links', { headers: { cookie: owner } }, env)).json()) as { id: string }[]
    const del = await app.request(`/api/second-brain/links/${list[0]!.id}`, { method: 'DELETE', headers: { cookie: owner } }, env)
    expect(del.status).toBe(200)
    const after = (await (await app.request('/api/second-brain/links', { headers: { cookie: owner } }, env)).json()) as unknown[]
    expect(after.length).toBe(0)
    const audit = await env.DB.prepare("SELECT * FROM audit_logs WHERE action = 'second_brain_link.delete'").all()
    expect(audit.results.length).toBe(1)
  })

  it('ลบรายการที่ไม่มีจริง → 404', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request('/api/second-brain/links/not-a-real-id', { method: 'DELETE', headers: { cookie: owner } }, env)
    expect(res.status).toBe(404)
  })
})

describe('§Second Brain — เพิ่มรายการเอง (Manual)', () => {
  it('เพิ่มแบบ "บทความ" — ได้ url/note, source=manual, คนที่แชร์ = ชื่อจริงตัวเอง', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request('/api/second-brain/links', jsonReq(owner, { kind: 'article', url: 'https://example.com/manual', note: 'บทความดีมาก' }), env)
    expect(res.status).toBe(201)
    const created = (await res.json()) as { kind: string; source: string; url: string; note: string; creatorName: string }
    expect(created).toMatchObject({ kind: 'article', source: 'manual', url: 'https://example.com/manual', note: 'บทความดีมาก', creatorName: 'เมธ' })

    const list = (await (await app.request('/api/second-brain/links', { headers: { cookie: owner } }, env)).json()) as { creatorName: string }[]
    expect(list[0]?.creatorName).toBe('เมธ')
  })

  it('เพิ่มแบบ "Solution" — ได้ problem/solutionText, ไม่มี url', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request(
      '/api/second-brain/links',
      jsonReq(owner, { kind: 'solution', problem: 'ปุ่มชำระเงินกดไม่ติด', solutionText: 'ล้าง cache แล้ว deploy ใหม่' }),
      env,
    )
    expect(res.status).toBe(201)
    const created = (await res.json()) as { kind: string; url: string | null; problem: string; solutionText: string }
    expect(created).toMatchObject({ kind: 'solution', url: null, problem: 'ปุ่มชำระเงินกดไม่ติด', solutionText: 'ล้าง cache แล้ว deploy ใหม่' })
  })

  it('เพิ่มแบบบทความไม่ใส่ url → 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request('/api/second-brain/links', jsonReq(owner, { kind: 'article', note: 'ลืมใส่ลิงก์' }), env)
    expect(res.status).toBe(400)
  })

  it('เพิ่มแบบ Solution ไม่ใส่ solutionText → 400', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request('/api/second-brain/links', jsonReq(owner, { kind: 'solution', problem: 'มีปัญหา' }), env)
    expect(res.status).toBe(400)
  })

  it('§Security Recheck (2026-09-10) — url เป็น javascript:/data: URI → 400 (เดิมรับได้หมด กด XSS ใส่คนอื่นในทีมได้)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    for (const evilUrl of ['javascript:alert(document.cookie)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)']) {
      const res = await app.request('/api/second-brain/links', jsonReq(owner, { kind: 'article', url: evilUrl }), env)
      expect(res.status).toBe(400)
    }
    // http/https ปกติยังผ่านเหมือนเดิม
    const ok = await app.request('/api/second-brain/links', jsonReq(owner, { kind: 'article', url: 'http://example.com' }), env)
    expect(ok.status).toBe(201)
  })
})

describe('§Second Brain — แก้ไขอินไลน์ (PATCH)', () => {
  it('แก้ note ของรายการ kind=article สำเร็จ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const created = (await (await app.request('/api/second-brain/links', jsonReq(owner, { kind: 'article', url: 'https://example.com/edit-note' }), env)).json()) as { id: string }
    const patch = await app.request(`/api/second-brain/links/${created.id}`, { ...jsonReq(owner, { note: 'แก้โน้ตใหม่' }), method: 'PATCH' }, env)
    expect(patch.status).toBe(200)
    const list = (await (await app.request('/api/second-brain/links', { headers: { cookie: owner } }, env)).json()) as { id: string; note: string }[]
    expect(list.find((r) => r.id === created.id)?.note).toBe('แก้โน้ตใหม่')
  })

  it('แก้ problem/solutionText ของรายการ kind=solution สำเร็จ', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const created = (
      await (
        await app.request('/api/second-brain/links', jsonReq(owner, { kind: 'solution', problem: 'ปัญหาเดิม', solutionText: 'วิธีแก้เดิม' }), env)
      ).json()
    ) as { id: string }
    const patch = await app.request(
      `/api/second-brain/links/${created.id}`,
      { ...jsonReq(owner, { problem: 'ปัญหาใหม่', solutionText: 'วิธีแก้ใหม่' }), method: 'PATCH' },
      env,
    )
    expect(patch.status).toBe(200)
    const list = (await (await app.request('/api/second-brain/links', { headers: { cookie: owner } }, env)).json()) as { id: string; problem: string; solutionText: string }[]
    const row = list.find((r) => r.id === created.id)
    expect(row).toMatchObject({ problem: 'ปัญหาใหม่', solutionText: 'วิธีแก้ใหม่' })
  })

  it('ส่ง problem/solutionText มาแก้รายการ kind=article → 400 (ผิดประเภท)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const created = (await (await app.request('/api/second-brain/links', jsonReq(owner, { kind: 'article', url: 'https://example.com/x' }), env)).json()) as { id: string }
    const patch = await app.request(`/api/second-brain/links/${created.id}`, { ...jsonReq(owner, { problem: 'ผิดประเภท' }), method: 'PATCH' }, env)
    expect(patch.status).toBe(400)
  })

  it('ส่ง note มาแก้รายการ kind=solution → 400 (ผิดประเภท)', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const created = (
      await (await app.request('/api/second-brain/links', jsonReq(owner, { kind: 'solution', problem: 'p', solutionText: 's' }), env)).json()
    ) as { id: string }
    const patch = await app.request(`/api/second-brain/links/${created.id}`, { ...jsonReq(owner, { note: 'ผิดประเภท' }), method: 'PATCH' }, env)
    expect(patch.status).toBe(400)
  })

  it('แก้รายการที่ไม่มีจริง → 404', async () => {
    const owner = await loginAs(app, 'owner@example-co.test')
    const res = await app.request('/api/second-brain/links/not-a-real-id', { ...jsonReq(owner, { note: 'x' }), method: 'PATCH' }, env)
    expect(res.status).toBe(404)
  })
})
