/**
 * Pronista §Second Brain (2026-09-08) — helper สำหรับเชื่อม LINE Messaging API
 * verify signature ของ webhook (HMAC-SHA256, key = LINE_CHANNEL_SECRET) + ดึงชื่อผู้ส่งแบบ best-effort
 */

function b64encode(buf: ArrayBuffer): string {
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s)
}

/** เทียบ signature แบบ constant-time กัน timing attack */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** ต้องเซ็นจาก raw body text (ก่อน JSON.parse) — signatureB64 มาจาก header X-Line-Signature */
export async function verifyLineSignature(bodyText: string, signatureB64: string, channelSecret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(channelSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(bodyText))
  return safeEqual(b64encode(mac), signatureB64)
}

/** ดึงชื่อผู้ส่งใน group จาก LINE Profile API — best-effort เท่านั้น (คนที่ไม่เคยแอด bot ส่วนตัวจะดึงไม่ได้ เป็นเรื่องปกติของ LINE API) คืน null ถ้าล้มเหลว ไม่ throw */
export async function fetchLineDisplayName(groupId: string, userId: string, accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/group/${groupId}/member/profile/${userId}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { displayName?: string }
    return data.displayName ?? null
  } catch {
    return null
  }
}
