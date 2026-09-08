/**
 * Pronista §Secret Vault — hash/verify PIN ปลดล็อค Vault (แยกจาก session login หลัก — auth หลักเป็น Google OAuth ล้วน ไม่มี password hash เดิมในระบบ)
 * PBKDF2-SHA256, salt สุ่ม 16 bytes ต่อคน, 100,000 iterations — เก็บเป็น `v1.<salt b64>.<iterations>.<hash b64>` เผื่อหมุนรูปแบบ/รอบภายหลัง
 */

const VERSION = 'v1'
const ITERATIONS = 100_000
const HASH_BYTES = 32

function b64encode(buf: Uint8Array): string {
  let s = ''
  for (const b of buf) s += String.fromCharCode(b)
  return btoa(s)
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations, hash: 'SHA-256' },
    key,
    HASH_BYTES * 8,
  )
  return new Uint8Array(bits)
}

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(pin, salt, ITERATIONS)
  return `${VERSION}.${b64encode(salt)}.${ITERATIONS}.${b64encode(hash)}`
}

/** เทียบ PIN กับ hash ที่เก็บไว้ — คืน false เสมอถ้า payload ผิดรูปแบบ (ไม่โยน error) */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [version, saltB64, iterationsStr, hashB64] = stored.split('.')
  if (version !== VERSION || !saltB64 || !iterationsStr || !hashB64) return false
  const iterations = Number(iterationsStr)
  if (!Number.isFinite(iterations) || iterations <= 0) return false
  const salt = b64decode(saltB64)
  const expected = b64decode(hashB64)
  const actual = await derive(pin, salt, iterations)
  if (actual.length !== expected.length) return false
  // constant-time compare — กัน timing attack เทียบความยาว/byte ทีละตัวแบบ XOR สะสม
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!
  return diff === 0
}
