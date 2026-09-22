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

// เลขรหัสมาตรฐาน: <Project Code>-<Work Type Code>-<Running Number>
// เช่น PRON-TSK-0001 / PRO-DEF-0002 — นับต่อเนื่องต่อโปรเจกต์+ประเภทและไม่ผูกกับวันที่
export async function nextTypedTaskCode(db: ReturnType<typeof createDb>, prefix: string, type: Exclude<TaskCodeTypeLabel, 'Epic'>): Promise<string> {
  const scanPrefix = `${prefix}-${TYPE_CODE[type]}-`
  const existing = await db.select({ code: tasks.code }).from(tasks).where(like(tasks.code, `${scanPrefix}%`))
  let max = 0
  for (const row of existing) {
    const suffix = row.code?.slice(scanPrefix.length)
    // LIKE ยังจับ sub-task code ที่ต่อท้ายด้วย ".N" ด้วย ต้องรับเฉพาะเลขล้วน
    if (suffix && /^\d+$/.test(suffix)) {
      const n = Number(suffix)
      if (n > max) max = n
    }
  }
  return `${scanPrefix}${String(max + 1).padStart(4, '0')}`
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
