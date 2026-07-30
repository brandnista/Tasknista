import { createDb, tasks } from '@seedoffice/db'
import { like } from 'drizzle-orm'

/**
 * Tasknista §SRS import — รหัสอ้างอิงงานที่แตกจากเอกสาร SRS: "<projectCode>-SRS-v<version>-<NNN>"
 * นับต่อเนื่องทั้งโปรเจกต์ข้ามทุกเอกสาร/ทุกเวอร์ชัน (ไม่ reset ต่อเอกสาร/เวอร์ชัน — ตามที่ผู้ใช้ยืนยัน)
 * ต่างจาก nextTaskCode ตรงที่ prefix สำหรับหา max ต้องไม่ผูกกับ version ("<prefix>-SRS-v%" ไม่ใช่ "<prefix>-SRS-v<thisVersion>-%")
 * เพราะอัปโหลดเอกสารเวอร์ชันใหม่ต้องนับต่อจากของเวอร์ชันเก่า แต่ตัวรหัสที่สร้างไปแล้วยังโชว์เวอร์ชันเดิมของมันเสมอ
 */
export async function nextSrsRefCode(
  db: ReturnType<typeof createDb>,
  projectCodePrefix: string,
  docVersion: string,
): Promise<string> {
  const scanPrefix = `${projectCodePrefix}-SRS-v`
  const existing = await db.select({ code: tasks.srsRefCode }).from(tasks).where(like(tasks.srsRefCode, `${scanPrefix}%`))
  let max = 0
  for (const row of existing) {
    const m = row.code?.match(/-(\d+)$/)
    const n = m ? Number(m[1]) : NaN
    if (Number.isFinite(n) && n > max) max = n
  }
  const padded = String(max + 1).padStart(3, '0')
  return `${projectCodePrefix}-SRS-v${docVersion}-${padded}`
}
