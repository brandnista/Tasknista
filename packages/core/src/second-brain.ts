/**
 * Pronista §Second Brain (2026-09-08) — ดึงลิงก์จากข้อความ LINE (Phase 1: เก็บอย่างเดียว ไม่มี AI สรุป/metadata)
 */

const URL_RE = /https?:\/\/[^\s<>"]+/g
// เครื่องหมายวรรคตอนท้ายประโยคที่มักพิมพ์ต่อท้ายลิงก์โดยไม่ตั้งใจให้เป็นส่วนของ URL (ปีกกา/วงเล็บปิด/จุด/จุลภาค ฯลฯ)
const TRAILING_PUNCTUATION_RE = /[)\]}>,.!?"';:]+$/

/** ดึงลิงก์ทั้งหมดจากข้อความ, ตัดเครื่องหมายวรรคตอนท้ายที่ติดมาออก, dedupe ลิงก์ซ้ำในข้อความเดียวกัน, คงลำดับที่เจอ */
export function extractUrls(text: string): string[] {
  const matches = (text.match(URL_RE) ?? []).map((m) => m.replace(TRAILING_PUNCTUATION_RE, ''))
  return [...new Set(matches)]
}

/** ตัดลิงก์ที่ระบุออกจากข้อความ เหลือแต่ส่วนโน้ต — ใช้ตอนบันทึกจาก LINE กันโน้ตซ้ำกับลิงก์ที่โชว์แยกอยู่แล้ว (เดิมโชว์ messageText ดิบทั้งก้อนซึ่งมีลิงก์ฝังอยู่ด้วย) */
export function stripUrls(text: string, urls: string[]): string {
  let result = text
  for (const url of urls) result = result.split(url).join('')
  return result.replace(/\s+/g, ' ').trim()
}
