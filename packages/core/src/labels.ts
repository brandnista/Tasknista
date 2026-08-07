/**
 * Pronista §Workspace — แท็กสีบน Task (bug/urgent/blocked/ฯลฯ) เก็บเป็น JSON ใน company_config.labels (ชุดเดียวทั้งบริษัท)
 * tasks.labelIds อ้าง id ที่นี่ (array, ไม่มี DB-level FK — เหมือน positions/serviceTypes)
 * สีใช้ค่าเดียวกับ BOARD_COLOR_KEYS (ไม่สร้าง palette ใหม่) · pure ล้วน mirror subscription.ts
 */
import { BOARD_COLOR_KEYS } from './board-preset'

export interface Label {
  id: string
  name: string
  color: string
  sortOrder: number
}

/** ค่าเริ่มต้น = แท็กพื้นฐานที่ใช้บ่อย (seed ตอน migrate — แก้ไข/เพิ่ม/ลบได้ที่ตั้งค่าภายหลัง) */
export const DEFAULT_LABELS: Label[] = [
  { id: 'lbl_bug', name: 'Bug', color: 'rose', sortOrder: 0 },
  { id: 'lbl_urgent', name: 'Urgent', color: 'amber', sortOrder: 1 },
  { id: 'lbl_blocked', name: 'Blocked', color: 'orange', sortOrder: 2 },
]

export function resolveLabels(raw: Label[] | null | undefined): Label[] {
  const list = raw && raw.length > 0 ? raw : DEFAULT_LABELS
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder)
}

export function labelById(raw: Label[] | null | undefined, id: string | null | undefined): Label | undefined {
  if (!id) return undefined
  return resolveLabels(raw).find((l) => l.id === id)
}

/** resolve tasks.labelIds -> Label[] (ตัด id ที่ไม่มีในแคตตาล็อกทิ้งเงียบๆ — เผื่อกรณีแคตตาล็อกถูกแก้หลังผูกไว้) */
export function labelsByIds(raw: Label[] | null | undefined, ids: string[] | null | undefined): Label[] {
  if (!ids || ids.length === 0) return []
  const resolved = resolveLabels(raw)
  return ids.map((id) => resolved.find((l) => l.id === id)).filter((l): l is Label => l !== undefined)
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** ตรวจ config ที่จะบันทึก (CRUD ผ่าน API) — คืน error ภาษาไทยถ้าไม่ผ่าน */
export function validateLabels(list: Label[]): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'ต้องมีอย่างน้อย 1 label' }
  const ids = new Set<string>()
  for (const l of list) {
    if (!ID_RE.test(l.id)) return { ok: false, error: `id label ไม่ถูกต้อง: ${l.id}` }
    if (ids.has(l.id)) return { ok: false, error: `id label ซ้ำ: ${l.id}` }
    ids.add(l.id)
    const name = l.name?.trim() ?? ''
    if (name.length === 0 || name.length > 60) return { ok: false, error: 'ชื่อ label ต้องยาว 1–60 ตัว' }
    if (!(BOARD_COLOR_KEYS as readonly string[]).includes(l.color)) return { ok: false, error: `สี label ไม่ถูกต้อง: ${l.color}` }
  }
  return { ok: true }
}
