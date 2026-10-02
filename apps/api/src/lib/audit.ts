import { auditLogs, createDb } from '@seedoffice/db'
import { sql } from 'drizzle-orm'

export interface AuditInput {
  actorId: string
  action: string // '<entity>.<verb>' เช่น 'rate.create', 'time_entry.delete'
  entity: string
  entityId: string
  meta?: Record<string, unknown> // ใส่ before/after เมื่อเป็นการแก้/ลบ
}

/** เขียน audit log — การเงิน/เวลาทุกการเปลี่ยนต้องเรียกตัวนี้ (SPEC §11) */
export async function writeAudit(env: Env, input: AuditInput): Promise<void> {
  const db = createDb(env.DB)
  await db.insert(auditLogs).values(input)
  // Pronista §D1 row-read quota (2026-10-02) — audit ของ task = โปรเจกต์ของ task นั้นมีความเคลื่อนไหวล่าสุดตอนนี้ (คอลัมน์ projects.last_activity_at ใช้โชว์ "อัปเดตล่าสุด" ที่หน้ารายการโปรเจกต์)
  // อัปเดตด้วยคำสั่งเดียว (หา project_id จาก task ใน subquery) · พังก็ไม่ให้ล้ม action หลัก — audit บันทึกไปแล้ว ส่วนนี้แค่ตัวเลขสรุป
  if (input.entity === 'task') {
    try {
      await db.run(
        sql`UPDATE projects SET last_activity_at = ${Date.now()} WHERE id = (SELECT project_id FROM tasks WHERE id = ${input.entityId})`,
      )
    } catch (err) {
      console.warn('projects.last_activity_at update failed', err)
    }
  }
}
