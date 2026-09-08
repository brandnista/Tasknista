import { createDb, vaultUnlocks } from '@seedoffice/db'
import { and, eq, gt } from 'drizzle-orm'
import { newToken } from './session'

/**
 * Pronista §Secret Vault — session ปลดล็อค Vault อายุสั้น แยกจาก session login หลัก (so_session)
 * mirror lib/session.ts เป๊ะ: token สุ่ม 256-bit hex, ฝั่ง DB เก็บ SHA-256 hash เท่านั้น (token หลุดจาก DB ใช้ไม่ได้)
 */

export const VAULT_UNLOCK_COOKIE = 'so_vault_unlock'
const VAULT_UNLOCK_TTL_MS = 15 * 60_000 // 15 นาที

async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function createVaultUnlock(env: Env, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken()
  const expiresAt = new Date(Date.now() + VAULT_UNLOCK_TTL_MS)
  await createDb(env.DB)
    .insert(vaultUnlocks)
    .values({ id: await hashToken(token), userId, expiresAt })
  return { token, expiresAt }
}

/** session ที่ยังไม่หมดอายุ + ต้องเป็นของ userId คนนี้เท่านั้น (กัน token คนอื่นหลุดมาใช้ข้ามบัญชี) */
export async function vaultUnlockValid(env: Env, userId: string, token: string): Promise<boolean> {
  const db = createDb(env.DB)
  const row = (
    await db
      .select({ id: vaultUnlocks.id })
      .from(vaultUnlocks)
      .where(and(eq(vaultUnlocks.id, await hashToken(token)), eq(vaultUnlocks.userId, userId), gt(vaultUnlocks.expiresAt, new Date())))
      .limit(1)
  )[0]
  return !!row
}

export async function revokeVaultUnlock(env: Env, token: string): Promise<void> {
  await createDb(env.DB)
    .delete(vaultUnlocks)
    .where(eq(vaultUnlocks.id, await hashToken(token)))
}
