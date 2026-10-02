/**
 * Pronista §Chat links (2026-10-02) — แยกข้อความเป็นช่วงข้อความ/ลิงก์ เพื่อให้แชทกดเปิดลิงก์ได้ (pure — ใช้ฝั่งเว็บ)
 * รับเฉพาะ http/https · ตัดเครื่องหมายท้ายประโยค (. , ! ? ; : ) ] ) ที่ไม่ใช่ส่วนของลิงก์ออก
 */
export type LinkSegment = { type: 'text'; value: string } | { type: 'link'; value: string }

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi
const TRAILING = /[.,!?;:)\]}»…]+$/

export function splitLinks(text: string): LinkSegment[] {
  const out: LinkSegment[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0
    let url = m[0]
    // วงเล็บปิดที่มีวงเล็บเปิดคู่กันอยู่ในลิงก์ (เช่น wikipedia) ถือเป็นส่วนของลิงก์
    let trimmed = url.replace(TRAILING, '')
    if (url.endsWith(')') && (trimmed.match(/\(/g) ?? []).length > (trimmed.match(/\)/g) ?? []).length) trimmed = url.replace(/[.,!?;:\]}»…]+$/, '')
    url = trimmed
    if (!/^https?:\/\/[^/?#\s]+\.[^/?#\s]{2,}|^https?:\/\/localhost/i.test(url)) continue
    if (start > last) out.push({ type: 'text', value: text.slice(last, start) })
    out.push({ type: 'link', value: url })
    last = start + url.length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out
}

/** ลิงก์แรกในข้อความ (ใช้ทำการ์ดตัวอย่าง) */
export function firstLink(text: string): string | null {
  return splitLinks(text).find((s) => s.type === 'link')?.value ?? null
}

/** ชื่อโดเมนที่อ่านง่ายของลิงก์ (ตัด www.) — ไม่ใช่ URL ที่ถูกต้อง = null */
export function linkHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
