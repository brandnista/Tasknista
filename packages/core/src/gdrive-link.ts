/**
 * Pronista §Project Documents (2026-09-17) — ตรวจ host + ดึง file ID จากลิงก์ Google Drive/Docs
 * ตรวจแค่รูปแบบ URL ไม่ได้ยืนยันสิทธิ์เข้าถึงจริงกับ Google Drive API (ระบบยังไม่มี OAuth scope ของ Drive)
 * ไม่ใช้ `URL` global ตรงๆ — packages/core เป็น pure lib (lib: ES2023 ล้วน ไม่มี DOM) parse ด้วย regex แทน
 */

const DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com'])

const FILE_ID_PATTERNS = [
  /\/d\/([a-zA-Z0-9_-]{10,})/, // /file/d/{id}/... หรือ /document/d/{id}/...
  /\/folders\/([a-zA-Z0-9_-]{10,})/, // /drive/folders/{id}
]

/** แยก host/path/query จาก URL แบบง่าย (เฉพาะ http/https) — คืน null ถ้า parse ไม่ได้ */
function parseUrl(url: string): { host: string; path: string; query: string } | null {
  const m = /^https?:\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?/i.exec(url.trim())
  if (!m) return null
  return { host: m[1]!.replace(/^www\./i, '').toLowerCase(), path: m[2] ?? '', query: m[3] ?? '' }
}

/** true ถ้า host เป็น drive.google.com หรือ docs.google.com (www. ตัดออกก่อนเทียบ) */
export function isGoogleDriveUrl(url: string): boolean {
  const parsed = parseUrl(url)
  return !!parsed && DRIVE_HOSTS.has(parsed.host)
}

/** คืน file/folder ID ถ้า url เป็นลิงก์ Google Drive/Docs ที่ parse ได้ ไม่งั้นคืน null (ไม่ throw) */
export function extractGoogleDriveFileId(url: string): string | null {
  const parsed = parseUrl(url)
  if (!parsed || !DRIVE_HOSTS.has(parsed.host)) return null

  for (const re of FILE_ID_PATTERNS) {
    const m = re.exec(parsed.path)
    if (m?.[1]) return m[1]
  }
  const idMatch = /(?:^|&)id=([^&]+)/.exec(parsed.query)
  if (idMatch?.[1]) return decodeURIComponent(idMatch[1])

  return null
}
