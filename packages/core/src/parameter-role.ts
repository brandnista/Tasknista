/**
 * Pronista §Parameter Role — ข้อมูลกลาง (Master Data) รายชื่อตำแหน่ง/บทบาทงาน ตั้งค่าที่ "ตั้งค่าทั่วไป"
 * ใช้อ้างอิงจากหลายจุดในระบบ: เมนู "กำหนดต้นทุน" (จับคู่ตำแหน่ง↔ต้นทุน/วัน) และ Tab "Project Estimate" (เลือก Role ต่อ Task — ฟีเจอร์อนาคต)
 * แยกจาก positions (สิทธิ์โปรเจกต์) โดยเจตนา — อันนี้เป็นแค่ชื่อตำแหน่งเฉยๆ ไม่มีเรื่องสิทธิ์
 */
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

export interface ParameterRole {
  id: string
  name: string
  sortOrder: number
}

export const DEFAULT_PARAMETER_ROLES: ParameterRole[] = []

export function resolveParameterRoles(raw: ParameterRole[] | null | undefined): ParameterRole[] {
  const list = raw && raw.length > 0 ? raw : DEFAULT_PARAMETER_ROLES
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder)
}

export function parameterRoleById(raw: ParameterRole[] | null | undefined, id: string | null | undefined): ParameterRole | undefined {
  if (!id) return undefined
  return resolveParameterRoles(raw).find((r) => r.id === id)
}

/** ตรวจ config ที่จะบันทึก (CRUD ผ่าน API) — คืน error ภาษาไทยถ้าไม่ผ่าน */
export function validateParameterRoles(list: ParameterRole[]): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(list)) return { ok: false, error: 'ข้อมูลไม่ถูกต้อง' }
  const ids = new Set<string>()
  for (const r of list) {
    if (!ID_RE.test(r.id)) return { ok: false, error: `id ตำแหน่งไม่ถูกต้อง: ${r.id}` }
    if (ids.has(r.id)) return { ok: false, error: `id ตำแหน่งซ้ำ: ${r.id}` }
    ids.add(r.id)
    const name = r.name?.trim() ?? ''
    if (name.length === 0 || name.length > 60) return { ok: false, error: 'ชื่อตำแหน่งต้องยาว 1–60 ตัว' }
  }
  return { ok: true }
}
