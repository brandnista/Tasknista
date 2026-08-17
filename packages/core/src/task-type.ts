/**
 * Pronista §System Requirements Update — แคตตาล็อกประเภทงานวิศวกรรม (Task Type) + ตัวเลือกย่อย (Sub-task Type) ต่อประเภท
 * เก็บเป็น JSON ใน company_config.taskTypes · tasks.taskType/subTaskType อ้าง id ที่นี่ (ไม่มี DB-level FK — เหมือน labels/positions)
 * โครงสร้างต่างจาก ServiceType/ProductType ตรงที่มีชั้นซ้อน (แต่ละ type มี subTypes ของตัวเอง)
 */

export interface TaskSubType {
  id: string
  name: string
  sortOrder: number
}

export interface TaskType {
  id: string
  name: string
  sortOrder: number
  subTypes: TaskSubType[]
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** ค่าเริ่มต้นตามที่กำหนดไว้ตอนออกแบบฟีเจอร์ (seed ตอน migrate — แก้ไข/เพิ่ม/ลบได้ที่ตั้งค่าภายหลัง) */
export const DEFAULT_TASK_TYPES: TaskType[] = [
  {
    id: 'tt_brd',
    name: 'BRD',
    sortOrder: 0,
    subTypes: [
      { id: 'tts_project_management', name: 'Project Management', sortOrder: 0 },
      { id: 'tts_biz_requirement_impl', name: 'Business Requirement Implementation', sortOrder: 1 },
    ],
  },
  {
    id: 'tt_design',
    name: 'Design',
    sortOrder: 1,
    subTypes: [{ id: 'tts_ux_ui_design', name: 'UX & UI Design', sortOrder: 0 }],
  },
  {
    id: 'tt_development',
    name: 'Development',
    sortOrder: 2,
    subTypes: [
      { id: 'tts_api', name: 'API', sortOrder: 0 },
      { id: 'tts_backend', name: 'Backend', sortOrder: 1 },
      { id: 'tts_flutter', name: 'Flutter', sortOrder: 2 },
      { id: 'tts_deployment', name: 'Deployment', sortOrder: 3 },
    ],
  },
  {
    id: 'tt_internal_testing',
    name: 'Internal Testing',
    sortOrder: 3,
    subTypes: [{ id: 'tts_internal_testing', name: 'Internal Testing', sortOrder: 0 }],
  },
  {
    id: 'tt_debug',
    name: 'Debug',
    sortOrder: 4,
    subTypes: [{ id: 'tts_debug', name: 'Debug', sortOrder: 0 }],
  },
]

export function resolveTaskTypes(raw: TaskType[] | null | undefined): TaskType[] {
  const list = raw && raw.length > 0 ? raw : DEFAULT_TASK_TYPES
  return [...list]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((t) => ({ ...t, subTypes: [...t.subTypes].sort((a, b) => a.sortOrder - b.sortOrder) }))
}

export function taskTypeById(raw: TaskType[] | null | undefined, id: string | null | undefined): TaskType | undefined {
  if (!id) return undefined
  return resolveTaskTypes(raw).find((t) => t.id === id)
}

export function taskSubTypeById(
  raw: TaskType[] | null | undefined,
  taskTypeId: string | null | undefined,
  subTaskTypeId: string | null | undefined,
): TaskSubType | undefined {
  if (!subTaskTypeId) return undefined
  return taskTypeById(raw, taskTypeId)?.subTypes.find((s) => s.id === subTaskTypeId)
}

/** ตรวจ config ที่จะบันทึก (CRUD ผ่าน API) — คืน error ภาษาไทยถ้าไม่ผ่าน */
export function validateTaskTypes(list: TaskType[]): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'ต้องมีอย่างน้อย 1 ประเภทงาน' }
  const ids = new Set<string>()
  for (const t of list) {
    if (!ID_RE.test(t.id)) return { ok: false, error: `id ประเภทงานไม่ถูกต้อง: ${t.id}` }
    if (ids.has(t.id)) return { ok: false, error: `id ประเภทงานซ้ำ: ${t.id}` }
    ids.add(t.id)
    const name = t.name?.trim() ?? ''
    if (name.length === 0 || name.length > 60) return { ok: false, error: 'ชื่อประเภทงานต้องยาว 1–60 ตัว' }
    if (!Array.isArray(t.subTypes) || t.subTypes.length === 0)
      return { ok: false, error: `ประเภทงาน "${t.name}" ต้องมีตัวเลือกย่อยอย่างน้อย 1 รายการ` }
    const subIds = new Set<string>()
    for (const s of t.subTypes) {
      if (!ID_RE.test(s.id)) return { ok: false, error: `id ตัวเลือกย่อยไม่ถูกต้อง: ${s.id}` }
      if (subIds.has(s.id)) return { ok: false, error: `id ตัวเลือกย่อยซ้ำ: ${s.id}` }
      subIds.add(s.id)
      const subName = s.name?.trim() ?? ''
      if (subName.length === 0 || subName.length > 60) return { ok: false, error: 'ชื่อตัวเลือกย่อยต้องยาว 1–60 ตัว' }
    }
  }
  return { ok: true }
}

/** subTaskType ต้องอยู่ใต้ taskType ที่เลือกจริง (หรือทั้งคู่ว่าง) — ใช้ตอน validate PATCH /tasks/:id */
export function isValidTaskTypePair(
  raw: TaskType[] | null | undefined,
  taskTypeId: string | null | undefined,
  subTaskTypeId: string | null | undefined,
): boolean {
  if (!taskTypeId && !subTaskTypeId) return true
  if (!taskTypeId) return false
  const type = taskTypeById(raw, taskTypeId)
  if (!type) return false
  if (!subTaskTypeId) return true
  return type.subTypes.some((s) => s.id === subTaskTypeId)
}
