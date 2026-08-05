import { bkkDateOf } from '@seedoffice/core'
import { createDb, epics, tasks } from '@seedoffice/db'
import { eq, like } from 'drizzle-orm'

// Pronista §Back to Basic — ป้ายชื่อประเภทที่ฝังในเลขรหัสรูปแบบใหม่ (แยกจาก tasks.kind: Story/Task ทั้งคู่คือ kind='task' ต่างแค่ตำแหน่งใน hierarchy)
// Pronista §Back to Basic (ต่อยอด) — เพิ่ม 'Backlog' สำหรับงานที่คีย์จากแท็บ "ทั่วไป" (kind='backlog')
export type TaskCodeTypeLabel = 'Epic' | 'Story' | 'Task' | 'Defect' | 'CR' | 'Backlog'

function ddmmyyyy(epochMs: number): string {
  const [y, m, d] = bkkDateOf(epochMs).split('-')
  return `${d}${m}${y}`
}

// Pronista §2.5 — Jira-style task code: BL-N ใน backlog → <projectCode>-N เมื่อผูกโปรเจกต์ (เลขไม่รียูส)
export function sanitizeCodePrefix(raw: string | null | undefined, fallback: string): string {
  const clean = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return clean.slice(0, 6) || fallback
}

export async function nextTaskCode(db: ReturnType<typeof createDb>, prefix: string): Promise<string> {
  const existing = await db.select({ code: tasks.code }).from(tasks).where(like(tasks.code, `${prefix}-%`))
  let max = 0
  for (const row of existing) {
    const suffix = row.code?.slice(prefix.length + 1)
    // Pronista §Back to Basic (bugfix) — LIKE ยังจับ sub-task code ("<prefix>-N.M") ด้วย ต้องกรองออกก่อน ไม่งั้น Number("5.1") ผ่านเป็น 5.1 ทำให้เลขรหัสถัดไปเพี้ยน
    if (suffix && /^\d+$/.test(suffix)) {
      const n = Number(suffix)
      if (n > max) max = n
    }
  }
  return `${prefix}-${max + 1}`
}

// Pronista §Back to Basic — เลขรหัสรูปแบบใหม่: <prefix>-<Type>-<ddmmyyyy>-<0001> นับต่อเนื่องต่อ (โปรเจกต์+ประเภท) ไม่รีเซตรายวัน — ใช้กับ Story/Task/Defect/CR ระดับบนสุดเท่านั้น (ไม่ใช่ sub-task ที่ยังใช้ nextSubTaskCode เดิม)
export async function nextTypedTaskCode(db: ReturnType<typeof createDb>, prefix: string, type: Exclude<TaskCodeTypeLabel, 'Epic'>): Promise<string> {
  const scanPrefix = `${prefix}-${type}-`
  const existing = await db.select({ code: tasks.code }).from(tasks).where(like(tasks.code, `${scanPrefix}%`))
  let max = 0
  for (const row of existing) {
    const suffix = row.code?.slice(scanPrefix.length + 8 /* ddmmyyyy */ + 1)
    // Pronista §Back to Basic (bugfix) — LIKE ยังจับ sub-task code ที่ต่อท้ายด้วย ".N" ด้วย ต้องกรองออกก่อน ไม่งั้น Number("0018.1") ผ่านเป็น 18.1 ทำให้เลขรหัสถัดไปเพี้ยน
    if (suffix && /^\d+$/.test(suffix)) {
      const n = Number(suffix)
      if (n > max) max = n
    }
  }
  return `${scanPrefix}${ddmmyyyy(Date.now())}-${String(max + 1).padStart(4, '0')}`
}

// Pronista §Back to Basic — เหมือน nextTypedTaskCode แต่สแกน epics.code (คนละตารางกับ tasks)
export async function nextTypedEpicCode(db: ReturnType<typeof createDb>, prefix: string): Promise<string> {
  const scanPrefix = `${prefix}-Epic-`
  const existing = await db.select({ code: epics.code }).from(epics).where(like(epics.code, `${scanPrefix}%`))
  let max = 0
  for (const row of existing) {
    const suffix = row.code?.slice(scanPrefix.length + 8 + 1)
    if (suffix && /^\d+$/.test(suffix)) {
      const n = Number(suffix)
      if (n > max) max = n
    }
  }
  return `${scanPrefix}${ddmmyyyy(Date.now())}-${String(max + 1).padStart(4, '0')}`
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
