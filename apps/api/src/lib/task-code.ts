import { createDb, epics, tasks } from '@seedoffice/db'
import { eq, like } from 'drizzle-orm'

// Pronista §Back to Basic — ป้ายชื่อประเภทที่ฝังในเลขรหัสรูปแบบใหม่ (แยกจาก tasks.kind: Story/Task ทั้งคู่คือ kind='task' ต่างแค่ตำแหน่งใน hierarchy)
// Pronista §Back to Basic (ต่อยอด) — เพิ่ม 'Backlog' สำหรับงานที่คีย์จากแท็บ "ทั่วไป" (kind='backlog')
export type TaskCodeTypeLabel = 'Epic' | 'Story' | 'Task' | 'Defect' | 'CR' | 'Backlog'

const TYPE_CODE: Record<TaskCodeTypeLabel, string> = {
  Epic: 'EPC',
  Story: 'STR',
  Task: 'TSK',
  Defect: 'DEF',
  CR: 'CR',
  Backlog: 'BLG',
}

// รหัสที่ผู้ใช้เห็น: <Project Code>-<Running Number> เช่น PRO-0001
// แยกชนิดงานและวันที่ออกไปอยู่ใน URL slug เพื่อให้รหัสอ้างอิงสั้น คงที่ และไม่เปลี่ยนเมื่อแปลง Task ↔ Defect/CR
export function sanitizeCodePrefix(raw: string | null | undefined, fallback: string): string {
  const clean = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return clean.slice(0, 6) || fallback
}

export async function nextTaskCode(db: ReturnType<typeof createDb>, prefix: string): Promise<string> {
  const existing = await db.select({ code: tasks.code }).from(tasks).where(like(tasks.code, `${prefix}-%`))
  let max = 0
  for (const row of existing) {
    const suffix = row.code?.slice(prefix.length + 1)
    // นับต่อจากรหัสใหม่ และรหัสเก่า TSK/DEF/CR/BLG เพื่อไม่ให้ running number วนกลับไปเริ่ม 0001 หลัง rollout
    // ไม่รวม subtask ที่ลงท้าย .N และ Epic ซึ่งเป็นลำดับของอีกตารางหนึ่ง
    const legacy = suffix?.match(/^(?:TSK|STR|DEF|CR|BLG)-(\d+)$/)
    const running = suffix && /^\d+$/.test(suffix) ? suffix : legacy?.[1]
    if (running) {
      const n = Number(running)
      if (n > max) max = n
    }
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

/**
 * Legacy callers ยังส่งชนิดงานเข้ามา แต่ตั้งแต่ Task ID Phase A ชนิดงานไม่อยู่ใน
 * รหัสแสดงผลแล้ว: ทุกชนิดใช้ running number ชุดเดียวกันต่อ project.
 */
export async function nextTypedTaskCode(db: ReturnType<typeof createDb>, prefix: string, type: Exclude<TaskCodeTypeLabel, 'Epic'>): Promise<string> {
  // คง parameter ไว้ให้ caller เดิมเรียกได้; ชนิดงานย้ายไปอยู่ใน URL slug แล้ว
  void type
  return nextTaskCode(db, prefix)
}

// Pronista §Back to Basic — เหมือน nextTypedTaskCode แต่สแกน epics.code (คนละตารางกับ tasks)
export async function nextTypedEpicCode(db: ReturnType<typeof createDb>, prefix: string): Promise<string> {
  const scanPrefix = `${prefix}-${TYPE_CODE.Epic}-`
  const existing = await db.select({ code: epics.code }).from(epics).where(like(epics.code, `${scanPrefix}%`))
  let max = 0
  for (const row of existing) {
    const suffix = row.code?.slice(scanPrefix.length)
    if (suffix && /^\d+$/.test(suffix)) {
      const n = Number(suffix)
      if (n > max) max = n
    }
  }
  return `${scanPrefix}${String(max + 1).padStart(4, '0')}`
}

// Pronista §2.6 — code ของ sub-task = <parentCode>.N (นับจากลูกที่มีอยู่แล้วของ parent เดียวกัน)
export async function nextSubTaskCode(db: ReturnType<typeof createDb>, parentId: string, parentCode: string): Promise<string> {
  const siblings = await db.select({ code: tasks.code }).from(tasks).where(eq(tasks.parentId, parentId))
  let max = 0
  for (const row of siblings) {
    const n = Number(row.code?.split('.').pop())
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${parentCode}.${max + 1}`
}
