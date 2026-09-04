import { daysBetweenISO } from './crm'
import { addDaysISO } from './cycle'
import type { Weekday } from './manhour'

/**
 * Pronista §Workload — เกลี่ยเวลาประเมิน (estimateMinutes) ของ Task 1 ตัว ลงวันปฏิทินที่งานนั้น "ตกอยู่"
 * ไม่มี dueDate เลย = งานยังไม่กำหนดวัน (unscheduled) → คืนว่าง ให้ผู้เรียกไปแยกเข้ากล่อง "งานที่ยังไม่กำหนดวัน" แทน
 * มีแค่ dueDate = กองทั้งหมดวันเดียว · มีทั้ง startDate/dueDate = เกลี่ยเท่าๆ กันทุกวันปฏิทินในช่วง (รวมหัวท้าย)
 * เกลี่ยแบบธรรมดา ไม่ถ่วงน้ำหนักตาม capacity ของวัน — ตรงไปตรงมา เข้าใจง่าย ถ้าเกิน/ไม่พอให้ตัวเลขในตาราง Workload ไฮไลต์บอกเอง
 * estimateMinutes ควรเป็น 0 ถ้า task ไม่มีค่าประเมิน (ผู้เรียก coerce null→0 มาเอง) — ฟังก์ชันนี้แค่เกลี่ยเลขที่ได้รับมา ไม่ตัดสินใจ fallback ค่า
 */
export interface WorkloadTaskInput {
  startDate: string | null
  dueDate: string | null
  estimateMinutes: number
}

export function spreadTaskMinutes(task: WorkloadTaskInput): Record<string, number> {
  if (!task.dueDate) return {}
  if (!task.startDate || task.startDate > task.dueDate) return { [task.dueDate]: task.estimateMinutes }

  const days = daysBetweenISO(task.startDate, task.dueDate) + 1
  const base = Math.floor(task.estimateMinutes / days)
  const remainder = task.estimateMinutes - base * days
  const result: Record<string, number> = {}
  for (let i = 0; i < days; i++) {
    // นาทีที่หารไม่ลงตัว แจกให้วันแรกๆ ทีละ 1 นาที (integer นาทีเท่านั้น ตามกฎเงิน/เวลาของระบบ)
    result[addDaysISO(task.startDate, i)] = base + (i < remainder ? 1 : 0)
  }
  return result
}

const WEEKDAY_BY_JS_DAY: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** วันในสัปดาห์ของ YYYY-MM-DD — ใช้ UTC เที่ยงคืนตรงๆ (date string ล้วนไม่มี timezone ผูกอยู่แล้ว ไม่ต้องแปลง Bangkok offset ซ้ำ) */
export function weekdayOfISO(date: string): Weekday {
  return WEEKDAY_BY_JS_DAY[new Date(`${date}T00:00:00Z`).getUTCDay()]!
}
