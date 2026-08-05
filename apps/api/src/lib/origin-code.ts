import { createDb, tasks } from '@seedoffice/db'
import { like } from 'drizzle-orm'

/**
 * Pronista §Document Traceability — รหัสอ้างอิงงานที่แตกจากเอกสาร MOM/BRD/SOW/SRS: "<projectCode>-<DOCTYPE>-v<version>-<NNN>"
 * ขนานกับ nextSrsRefCode (srs-code.ts) ที่ SRS จากหน้าโปรเจกต์ยังใช้อยู่ตัวเดิมไม่เปลี่ยน — ตัวนี้ใช้กับ createTasksFromBreakoutItems (generic ทุก docType) เท่านั้น
 * นับต่อเนื่องทั้งโปรเจกต์ข้ามทุกเอกสาร/ทุกเวอร์ชันของ docType เดียวกัน (ไม่ reset ต่อเอกสาร/เวอร์ชัน — mirror nextSrsRefCode)
 */
export async function nextOriginRefCode(
  db: ReturnType<typeof createDb>,
  projectCodePrefix: string,
  docType: string,
  docVersion: string,
): Promise<string> {
  const scanPrefix = `${projectCodePrefix}-${docType}-v`
  const existing = await db.select({ code: tasks.originRefCode }).from(tasks).where(like(tasks.originRefCode, `${scanPrefix}%`))
  let max = 0
  for (const row of existing) {
    const m = row.code?.match(/-(\d+)$/)
    const n = m ? Number(m[1]) : NaN
    if (Number.isFinite(n) && n > max) max = n
  }
  const padded = String(max + 1).padStart(3, '0')
  return `${projectCodePrefix}-${docType}-v${docVersion}-${padded}`
}
