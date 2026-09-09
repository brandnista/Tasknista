import { describe, expect, it } from 'vitest'
import { knownSenderName, verifyLineSignature } from '../src/lib/line'

const SECRET = 'test-line-channel-secret'

async function sign(bodyText: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(bodyText))
  let s = ''
  for (const b of new Uint8Array(mac)) s += String.fromCharCode(b)
  return btoa(s)
}

describe('verifyLineSignature', () => {
  it('เซ็นด้วย secret ที่ถูกต้อง — verify ผ่าน', async () => {
    const body = JSON.stringify({ events: [{ type: 'message' }] })
    const signature = await sign(body, SECRET)
    expect(await verifyLineSignature(body, signature, SECRET)).toBe(true)
  })

  it('secret ผิด — verify ไม่ผ่าน', async () => {
    const body = JSON.stringify({ events: [] })
    const signature = await sign(body, SECRET)
    expect(await verifyLineSignature(body, signature, 'wrong-secret')).toBe(false)
  })

  it('body ถูกแก้ไขหลังเซ็น — verify ไม่ผ่าน', async () => {
    const signature = await sign(JSON.stringify({ events: [] }), SECRET)
    expect(await verifyLineSignature(JSON.stringify({ events: [{ tampered: true }] }), signature, SECRET)).toBe(false)
  })

  it('signature ว่างเปล่า/รูปแบบผิด — verify ไม่ผ่าน ไม่ throw', async () => {
    expect(await verifyLineSignature('{}', '', SECRET)).toBe(false)
    expect(await verifyLineSignature('{}', 'not-base64-signature!!', SECRET)).toBe(false)
  })
})

describe('knownSenderName', () => {
  const map = JSON.stringify({ U123: 'อาร์ม' })

  it('userId ตรงกับที่ตั้งไว้ — คืนชื่อ', () => {
    expect(knownSenderName('U123', map)).toBe('อาร์ม')
  })

  it('userId ไม่ตรงกับที่ตั้งไว้ — คืน null', () => {
    expect(knownSenderName('Uxxx', map)).toBeNull()
  })

  it('ไม่ได้ตั้งค่า env นี้เลย (undefined) — คืน null ไม่ throw', () => {
    expect(knownSenderName('U123', undefined)).toBeNull()
  })

  it('ค่าที่ตั้งไม่ใช่ JSON ถูกต้อง — คืน null ไม่ throw', () => {
    expect(knownSenderName('U123', 'not-json{')).toBeNull()
  })
})
