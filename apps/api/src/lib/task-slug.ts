type SluggableTask = {
  code: string | null
  kind: 'task' | 'defect' | 'cr' | 'backlog'
  createdAt: Date
}

const SLUG_TYPE: Record<SluggableTask['kind'], string> = {
  task: 'TSK',
  defect: 'DEF',
  cr: 'CR',
  backlog: 'BLG',
}

// Pronista §PRO-0040 (2026-10-01) — Project Key เป็น Free Key มีขีดได้ (เช่น MAK-DIN) จึงไม่ล็อก 3 ตัวอีกต่อไป (ยึดโครงสร้างจากท้าย: -TYPE-วันที่-เลขรัน)
const PROJECT_KEY = '[A-Z0-9]+(?:-[A-Z0-9]+)*'
const slugPattern = new RegExp(`^(${PROJECT_KEY})-(TSK|DEF|CR|BLG)-(\\d{8})-(\\d{4})$`)
const codePattern = new RegExp(`^(${PROJECT_KEY})-(\\d{4})$`)

function bkkDayCompact(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date)
  const valueOf = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  return `${valueOf('day')}${valueOf('month')}${valueOf('year')}`
}

/** URL มาตรฐานของรหัสใหม่ เช่น PRO-DEF-23092026-0001; งานเก่ายังคงใช้ code/UUID เดิมได้ */
export function taskSlugFor(task: SluggableTask, projectCode: string | null | undefined): string | null {
  const codeMatch = task.code?.match(codePattern)
  const normalizedProjectCode = projectCode?.toUpperCase()
  if (!codeMatch || !normalizedProjectCode || codeMatch[1] !== normalizedProjectCode) return null
  return `${normalizedProjectCode}-${SLUG_TYPE[task.kind]}-${bkkDayCompact(task.createdAt)}-${codeMatch[2]}`
}

export function parseTaskSlug(value: string): { projectCode: string; type: string; date: string; running: string } | null {
  const match = value.toUpperCase().match(slugPattern)
  if (!match) return null
  return { projectCode: match[1]!, type: match[2]!, date: match[3]!, running: match[4]! }
}
