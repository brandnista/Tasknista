/**
 * Preset สถานะ Sprint Board ปรับเองได้ (Tasknista §Sprint & Board) — เก็บเป็น JSON ใน company_config (ชุดเดียวทั้งบริษัท)
 * แต่ละ preset = ชุดคอลัมน์เรียงตาม sortOrder · sprint หนึ่งอันเลือก preset หนึ่งอันตอนสร้าง (sprints.boardPresetId อ้าง id ที่นี่)
 * ยังไม่ตั้ง → ใช้ DEFAULT (2 ชุดเดิมตามที่ขอ) · pure ล้วน ใช้ทั้ง API + web (mirror project-status.ts)
 */

export interface BoardColumn {
  id: string // slug ถาวรในคอลัมน์ (tasks.sprintStatus อ้างค่านี้) — เปลี่ยนชื่อได้ id คงเดิม
  name: string
  color: string
  sortOrder: number
}

export interface BoardPreset {
  id: string // slug ถาวร (sprints.boardPresetId อ้างค่านี้)
  name: string
  columns: BoardColumn[]
}

export const BOARD_COLOR_KEYS = [
  'slate', 'amber', 'orange', 'yellow', 'emerald', 'teal', 'sky', 'violet', 'rose',
] as const
export type BoardColorKey = (typeof BOARD_COLOR_KEYS)[number]

export const DEFAULT_BOARD_PRESETS: BoardPreset[] = [
  {
    id: 'dev-release',
    name: 'Dev/Release',
    columns: [
      { id: 'todo', name: 'To do', color: 'slate', sortOrder: 0 },
      { id: 'in_progress', name: 'In progress', color: 'sky', sortOrder: 1 },
      { id: 'internal_review', name: 'Internal Review', color: 'amber', sortOrder: 2 },
      { id: 'storage', name: 'Storage', color: 'orange', sortOrder: 3 },
      { id: 'uat', name: 'UAT', color: 'violet', sortOrder: 4 },
      { id: 'production', name: 'Production', color: 'teal', sortOrder: 5 },
      { id: 'done', name: 'Done', color: 'emerald', sortOrder: 6 },
    ],
  },
  {
    id: 'design-cycle',
    name: 'Design/Full-cycle',
    columns: [
      { id: 'todo', name: 'To do', color: 'slate', sortOrder: 0 },
      { id: 'in_progress', name: 'In progress', color: 'sky', sortOrder: 1 },
      { id: 'concept_design', name: 'Concept Design', color: 'amber', sortOrder: 2 },
      { id: 'user_interface', name: 'User Interface', color: 'orange', sortOrder: 3 },
      { id: 'wireframe_design', name: 'Wireframe Design', color: 'yellow', sortOrder: 4 },
      { id: 'database_design', name: 'Database Design', color: 'violet', sortOrder: 5 },
      { id: 'development', name: 'Development', color: 'teal', sortOrder: 6 },
      { id: 'debug', name: 'Debug', color: 'rose', sortOrder: 7 },
      { id: 'done', name: 'Done', color: 'emerald', sortOrder: 8 },
    ],
  },
]

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

export function resolvePresets(raw: BoardPreset[] | null | undefined): BoardPreset[] {
  return raw && raw.length > 0 ? raw : DEFAULT_BOARD_PRESETS
}

export function presetById(raw: BoardPreset[] | null | undefined, id: string): BoardPreset | undefined {
  return resolvePresets(raw).find((p) => p.id === id)
}

export function columnsOf(preset: BoardPreset): BoardColumn[] {
  return [...preset.columns].sort((a, b) => a.sortOrder - b.sortOrder)
}

export function firstColumnId(preset: BoardPreset): string {
  return columnsOf(preset)[0]?.id ?? 'todo'
}

export function isDoneColumn(preset: BoardPreset, columnId: string): boolean {
  const cols = columnsOf(preset)
  return cols[cols.length - 1]?.id === columnId
}

/** ตรวจ config ที่จะบันทึก (CRUD ผ่าน API) — คืน error ภาษาไทยถ้าไม่ผ่าน */
export function validatePresets(list: BoardPreset[]): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'ต้องมีอย่างน้อย 1 preset' }
  const presetIds = new Set<string>()
  for (const p of list) {
    if (!ID_RE.test(p.id)) return { ok: false, error: `id preset ไม่ถูกต้อง: ${p.id}` }
    if (presetIds.has(p.id)) return { ok: false, error: `id preset ซ้ำ: ${p.id}` }
    presetIds.add(p.id)
    const name = p.name?.trim() ?? ''
    if (name.length === 0 || name.length > 60) return { ok: false, error: 'ชื่อ preset ต้องยาว 1–60 ตัว' }
    if (!Array.isArray(p.columns) || p.columns.length < 2)
      return { ok: false, error: `preset "${p.name}" ต้องมีอย่างน้อย 2 คอลัมน์` }
    const colIds = new Set<string>()
    for (const col of p.columns) {
      if (!ID_RE.test(col.id)) return { ok: false, error: `id คอลัมน์ไม่ถูกต้อง: ${col.id}` }
      if (colIds.has(col.id)) return { ok: false, error: `id คอลัมน์ซ้ำใน preset "${p.name}": ${col.id}` }
      colIds.add(col.id)
      const colName = col.name?.trim() ?? ''
      if (colName.length === 0 || colName.length > 40) return { ok: false, error: 'ชื่อคอลัมน์ต้องยาว 1–40 ตัว' }
      if (!(BOARD_COLOR_KEYS as readonly string[]).includes(col.color))
        return { ok: false, error: `สีคอลัมน์ไม่ถูกต้อง: ${col.color}` }
    }
  }
  return { ok: true }
}
