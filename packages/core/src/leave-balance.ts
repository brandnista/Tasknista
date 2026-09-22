import { daysBetweenISO } from './crm'

/** Pronista §Leave Request (2026-09-22, Phase 1) — นับจำนวนวันลาแบบ calendar day รวมหัวท้าย (ไม่ตัดเสาร์-อาทิตย์/วันหยุด ใน Phase 1 นี้) */
export function leaveDaysInclusive(startDate: string, endDate: string): number {
  return daysBetweenISO(startDate, endDate) + 1
}

export interface LeaveBalance {
  /** null = ประเภทลานี้ไม่มีโควตากำหนดไว้สำหรับ role นี้ (ไม่จำกัด/ไม่ track) */
  quota: number | null
  /** null = ไม่มีโควตา (ไม่มีความหมายที่จะคำนวณ "เหลือเท่าไร") */
  remain: number | null
  waiting: number
}

/**
 * Pronista §Leave Request — remain หักเฉพาะวันที่อนุมัติแล้วปีนี้ (ไม่หัก waiting ซ้ำ) ตรงกับภาพระบบเก่าที่ส่งมา
 * (เช่น Sick Leave Quota 30/Remain 29/Waiting 0 = หักเฉพาะที่อนุมัติแล้ว 1 วัน) — waiting โชว์แยกให้ผู้ใช้เห็นเฉยๆ ไม่ไปลด remain
 */
export function computeLeaveBalance(quotaDays: number | null, approvedDaysThisYear: number, pendingDaysThisYear: number): LeaveBalance {
  return {
    quota: quotaDays,
    remain: quotaDays === null ? null : quotaDays - approvedDaysThisYear,
    waiting: pendingDaysThisYear,
  }
}

/** Pronista §Leave Request Phase 2 (2026-09-22) — ตัวเลือกไอคอนที่ Admin เลือกได้ตอนตั้งค่าประเภทลา (ชื่อ string อ้างอิง แม็ปเป็น lucide component จริงฝั่ง frontend) */
export const LEAVE_ICON_NAMES = ['calendar', 'heart-pulse', 'briefcase', 'pause-circle', 'plane', 'baby', 'shield-alert', 'clock'] as const
