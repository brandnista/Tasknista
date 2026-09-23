/** formatter ส่วนกลาง (SPEC §9: format เงิน/เวลาด้วย helper ที่เดียว) */

import { SATANG_PER_BAHT } from './constants'

/** แสดงเงินจากสตางค์ เช่น 3840000 → "฿38,400" · 123456 → "฿1,234.56" */
export function formatSatang(satang: number): string {
  if (!Number.isInteger(satang)) throw new TypeError(`satang ต้องเป็น integer ได้ ${satang}`)
  const sign = satang < 0 ? '-' : ''
  const abs = Math.abs(satang)
  const baht = Math.floor(abs / SATANG_PER_BAHT).toLocaleString('en-US')
  const st = abs % SATANG_PER_BAHT
  return st === 0 ? `${sign}฿${baht}` : `${sign}฿${baht}.${String(st).padStart(2, '0')}`
}

/** แสดงชั่วโมงจากนาทีแบบแม่นยำถึง 2 ตำแหน่ง เช่น 15 นาที → "0.25" ไม่ปัดเป็น "0.3" */
export function minutesToHoursLabel(minutes: number): string {
  if (!Number.isInteger(minutes)) throw new TypeError(`minutes ต้องเป็น integer ได้ ${minutes}`)
  const sign = minutes < 0 ? '-' : ''
  const hundredths = Math.round((Math.abs(minutes) * 100) / 60)
  return `${sign}${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`
}

/** วินาที → 'H:MM:SS' (ชั่วโมงหลักเดียวตาม SPEC §4.5) เช่น 13338 → "3:42:18" */
export function formatHMS(totalSeconds: number): string {
  if (!Number.isInteger(totalSeconds) || totalSeconds < 0)
    throw new TypeError(`seconds ต้องเป็น integer ≥ 0 ได้ ${totalSeconds}`)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${h}:${pad(m)}:${pad(s)}`
}
