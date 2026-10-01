import { ApiError } from './api'

/** Pronista §PRO-0037 — รวมเหตุผลที่ลบไม่สำเร็จ (ข้อความจากหลังบ้านที่อ่านรู้เรื่องอยู่แล้ว) แบบไม่ซ้ำ ใช้ต่อท้ายสรุปตอนลบหลายรายการ แทนที่จะบอกแค่จำนวนที่ล้มเหลว */
export function deleteFailureReasons(results: PromiseSettledResult<unknown>[]): string {
  const reasons = new Set<string>()
  for (const r of results) {
    if (r.status === 'rejected') reasons.add(r.reason instanceof ApiError ? r.reason.message : 'ลบไม่สำเร็จ')
  }
  return [...reasons].join('\n')
}
