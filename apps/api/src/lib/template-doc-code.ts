import { createDb, docs } from '@seedoffice/db'
import { like } from 'drizzle-orm'

/**
 * Pronista §Document Template — รหัสเอกสาร Template ทั่วไป: "<projectCode>-<docCodePrefix>-<DDMMYYYY>-<NNN>" (เช่น MOM/SRS)
 * นับต่อเนื่องเฉพาะของโปรเจกต์นั้น ไม่สนใจวันที่ในรหัส (mirror nextSrsRefCode's non-resetting scheme — ยืนยันกับผู้ใช้แล้ว)
 * generic ตาม docCodePrefix ของแต่ละ template (def.docCodePrefix ใน registry) — เพิ่ม template ใหม่ใช้ฟังก์ชันนี้ได้เลยไม่ต้องแก้
 */
export async function nextTemplateDocNumber(
  db: ReturnType<typeof createDb>,
  projectCodePrefix: string,
  docCodePrefix: string,
  ddmmyyyy: string,
): Promise<string> {
  const scanPrefix = `${projectCodePrefix}-${docCodePrefix}-`
  const existing = await db.select({ code: docs.templateDocNumber }).from(docs).where(like(docs.templateDocNumber, `${scanPrefix}%`))
  let max = 0
  for (const row of existing) {
    const m = row.code?.match(/-(\d+)$/)
    const n = m ? Number(m[1]) : NaN
    if (Number.isFinite(n) && n > max) max = n
  }
  const padded = String(max + 1).padStart(3, '0')
  return `${projectCodePrefix}-${docCodePrefix}-${ddmmyyyy}-${padded}`
}
