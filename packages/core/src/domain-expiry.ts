import { daysBetweenISO } from './crm'

// Pronista §Domain Management (2026-08-27) — ระดับวันล่วงหน้าที่เตือน (มากไปน้อย) — เตือนล่วงหน้า 30/15/7/1 วันก่อนหมดอายุ
export const DOMAIN_EXPIRY_TIERS = [30, 15, 7, 1] as const

export interface DueDomainReminder {
  /** ระดับที่ต้องส่งแจ้งเตือนจริง (ระดับที่ใกล้หมดอายุที่สุดในบรรดาที่ยังไม่เคยเตือน) */
  tierToAnnounce: number
  /** ทุกระดับที่ถึงกำหนดแล้ว ณ วันนี้ (รวมระดับที่ผ่านไปเงียบๆ เพราะ cron หน่วง) — ต้อง mark ว่าเตือนแล้วทั้งหมด กันเตือนซ้ำระดับเก่าที่ไม่มีความหมายแล้ว */
  allDueTiers: number[]
}

/**
 * โดเมนใกล้หมดอายุถึงระดับไหนแล้วบ้างที่ยังไม่เคยเตือน — คืน null ถ้ายังไม่ถึงระดับไหนเลย หรือหมดอายุไปแล้ว (ดู isDomainExpired แยก)
 * ส่งแจ้งเตือนแค่ 1 ครั้งต่อรอบ (ระดับที่ใกล้สุด) แต่ mark ทุกระดับที่ถึงกำหนดแล้วว่า "เตือนแล้ว" กันระดับเก่าค้างมาเตือนซ้ำทีหลังแบบไม่มีความหมาย
 */
export function dueDomainReminder(expiryDate: string, today: string, alreadyNotifiedTiers: readonly number[]): DueDomainReminder | null {
  const daysLeft = daysBetweenISO(today, expiryDate)
  if (daysLeft < 0) return null // หมดอายุไปแล้ว — ใช้ isDomainExpired แทน
  const dueTiers = DOMAIN_EXPIRY_TIERS.filter((t) => daysLeft <= t && !alreadyNotifiedTiers.includes(t))
  if (dueTiers.length === 0) return null
  return { tierToAnnounce: Math.min(...dueTiers), allDueTiers: dueTiers }
}

/** หมดอายุไปแล้วจริง (เตือนแยกจากล่วงหน้า ครั้งเดียวไม่ซ้ำ — ดู expiredNotifiedAt) */
export function isDomainExpired(expiryDate: string, today: string): boolean {
  return daysBetweenISO(today, expiryDate) < 0
}
