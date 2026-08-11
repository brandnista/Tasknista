/**
 * Pronista §Position-based permission — แคตตาล็อกตำแหน่งระดับบริษัท (BA/PM/Developer/ฯลฯ) เก็บเป็น JSON ใน company_config
 * แต่ละตำแหน่ง assign ต่อโปรเจกต์ผ่าน project_members.positionId (อ้าง id ที่นี่ ไม่มี DB-level FK — เหมือน board-preset.ts)
 * สิทธิ์แบบ checkbox ละเอียด 2 แกน: tabs (มองเห็นเมนู/แท็บไหนในโปรเจกต์) + actions (เพิ่ม/แก้ไข/ลบต่อ resource)
 * ยังไม่ตั้ง → ใช้ DEFAULT (เข้าถึงเต็มรูปแบบ/ดูอย่างเดียว) · pure ล้วน ใช้ทั้ง API + web (mirror project-status.ts/board-preset.ts)
 */

/** ตรงกับแท็บจริงใน ProjectDetail.tsx วันนี้ — top-level (sprint/docs/assets/releases) + sub-tab ใน Backlog (backlog*) */
export const PERMISSION_TAB_KEYS = [
  'sprint', 'docs', 'assets', 'releases',
  'backlogEpic', 'backlogStory', 'backlogTask', 'backlogDefect', 'backlogCr', 'backlogSummary',
] as const
export type PermissionTabKey = (typeof PERMISSION_TAB_KEYS)[number]

/** Epic/Story ไม่มี action ของตัวเอง (fold เข้า task — เป็นแถวใน tasks table เดียวกัน ไม่มี endpoint แยก) */
export const PERMISSION_RESOURCE_KEYS = ['task', 'doc', 'sprint', 'defect', 'cr', 'release'] as const
export type PermissionResourceKey = (typeof PERMISSION_RESOURCE_KEYS)[number]

export interface ResourceActions {
  create: boolean
  edit: boolean
  delete: boolean
}

export interface PositionPermissions {
  tabs: Record<PermissionTabKey, boolean>
  actions: Record<PermissionResourceKey, ResourceActions>
}

export interface Position {
  id: string // slug ถาวร (project_members.positionId อ้างค่านี้)
  name: string
  sortOrder: number
  permissions: PositionPermissions
}

const ALL_ACTIONS_TRUE: ResourceActions = { create: true, edit: true, delete: true }
const ALL_ACTIONS_FALSE: ResourceActions = { create: false, edit: false, delete: false }

function allTabs(value: boolean): Record<PermissionTabKey, boolean> {
  return Object.fromEntries(PERMISSION_TAB_KEYS.map((k) => [k, value])) as Record<PermissionTabKey, boolean>
}
function allActions(value: ResourceActions): Record<PermissionResourceKey, ResourceActions> {
  return Object.fromEntries(PERMISSION_RESOURCE_KEYS.map((k) => [k, value])) as Record<PermissionResourceKey, ResourceActions>
}

export const FULL_ACCESS_PERMISSIONS: PositionPermissions = { tabs: allTabs(true), actions: allActions(ALL_ACTIONS_TRUE) }
export const VIEW_ONLY_PERMISSIONS: PositionPermissions = { tabs: allTabs(true), actions: allActions(ALL_ACTIONS_FALSE) }

export const POSITION_FULL_ACCESS_ID = 'pos_full_access'
export const POSITION_VIEW_ONLY_ID = 'pos_view_only'

/** ค่าเริ่มต้น = 2 ตำแหน่ง lossless เทียบเท่า editor/viewer เดิม (seed ตอน migrate) */
export const DEFAULT_POSITIONS: Position[] = [
  { id: POSITION_FULL_ACCESS_ID, name: 'เข้าถึงเต็มรูปแบบ', sortOrder: 0, permissions: FULL_ACCESS_PERMISSIONS },
  { id: POSITION_VIEW_ONLY_ID, name: 'ดูอย่างเดียว', sortOrder: 1, permissions: VIEW_ONLY_PERMISSIONS },
]

/** vendor คงที่ — ไม่ผูกกับแคตตาล็อกที่แก้ได้ (กันไม่ให้แก้ตำแหน่งกระทบสิทธิ์ vendor โดยไม่ตั้งใจ) */
export const VENDOR_PROJECT_PERMISSIONS: PositionPermissions = VIEW_ONLY_PERMISSIONS

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** ตำแหน่งที่บันทึกไว้ตั้งแต่ก่อนเพิ่ม tab/resource key ใหม่ (เช่น 'releases'/'release') จะไม่มี key นั้นใน JSON เดิม
 * เติมให้ครบด้วยค่า false เสมอ กัน `permissions.actions[k]` เป็น undefined ตอนอ่าน (ทั้งหน้าตั้งค่าและตอนเช็คสิทธิ์จริง) */
function normalizePosition(p: Position): Position {
  return {
    ...p,
    permissions: {
      tabs: { ...allTabs(false), ...p.permissions.tabs },
      actions: { ...allActions(ALL_ACTIONS_FALSE), ...p.permissions.actions },
    },
  }
}

export function resolvePositions(raw: Position[] | null | undefined): Position[] {
  const list = raw && raw.length > 0 ? raw : DEFAULT_POSITIONS
  return [...list].map(normalizePosition).sort((a, b) => a.sortOrder - b.sortOrder)
}

export function positionById(raw: Position[] | null | undefined, id: string | null | undefined): Position | undefined {
  if (!id) return undefined
  return resolvePositions(raw).find((p) => p.id === id)
}

/** true ถ้าตำแหน่งนี้มีสิทธิ์เพิ่ม/แก้ไข/ลบ อย่างน้อย 1 อย่างใน resource ใดก็ได้
 * สะพานเชื่อมกับระบบ editor/viewer เดิม — canEditProject/canEditTask ทุกจุดยังทำงานถูกต้องผ่านค่านี้โดยไม่ต้องแก้ทีละจุด */
export function hasAnyEditRight(perm: PositionPermissions): boolean {
  return PERMISSION_RESOURCE_KEYS.some((k) => {
    const a = perm.actions[k]
    return a.create || a.edit || a.delete
  })
}

/**
 * Pronista §System Requirements Update — ระบบสิทธิ์ 2 ชั้น: "เพดาน" ต่อประเภทผู้ใช้งาน (staff/outsource/customer) ครอบสิทธิ์ตำแหน่งอีกชั้น
 * staff (owner/member) = intersect(ตำแหน่งที่ assign, เพดาน staff) · outsource(vendor)/customer(guest) ไม่มีตำแหน่งของตัวเอง เพดาน = สิทธิ์จริงเลย
 * owner ไม่ผ่านเพดานนี้เลย (bypass ที่ getProjectPermissions อยู่แล้ว)
 */
export const PERMISSION_CATEGORIES = ['staff', 'outsource', 'customer'] as const
export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number]

export const PERMISSION_CATEGORY_LABEL: Record<PermissionCategory, string> = {
  staff: 'พนักงานในระบบ',
  outsource: 'พนักงาน Outsource',
  customer: 'ลูกค้า',
}

/** map global role → หมวดเพดาน — owner ไม่มีหมวด (bypass เพดานเสมอ) */
export function permissionCategoryOfRole(role: 'owner' | 'member' | 'vendor' | 'guest'): PermissionCategory | null {
  if (role === 'owner') return null
  if (role === 'member') return 'staff'
  if (role === 'vendor') return 'outsource'
  return 'customer'
}

/** default lossless เทียบเท่าพฤติกรรมเดิมก่อนมีเพดาน — staff เข้าถึงเต็ม (คุมด้วยตำแหน่งอยู่แล้ว) · outsource/customer ดูอย่างเดียว (ตรงกับค่าคงที่เดิม) */
export const DEFAULT_PERMISSION_CEILINGS: Record<PermissionCategory, PositionPermissions> = {
  staff: FULL_ACCESS_PERMISSIONS,
  outsource: VIEW_ONLY_PERMISSIONS,
  customer: VIEW_ONLY_PERMISSIONS,
}

function normalizeCeiling(p: PositionPermissions): PositionPermissions {
  return {
    tabs: { ...allTabs(false), ...p.tabs },
    actions: { ...allActions(ALL_ACTIONS_FALSE), ...p.actions },
  }
}

export function resolvePermissionCeilings(
  raw: Partial<Record<PermissionCategory, PositionPermissions>> | null | undefined,
): Record<PermissionCategory, PositionPermissions> {
  return Object.fromEntries(
    PERMISSION_CATEGORIES.map((cat) => [cat, normalizeCeiling(raw?.[cat] ?? DEFAULT_PERMISSION_CEILINGS[cat])]),
  ) as Record<PermissionCategory, PositionPermissions>
}

/** ชั้นที่ 2 คูณกับชั้นที่ 1 — AND ทีละฟิลด์ (จำกัดได้อย่างเดียว ไม่มีทางขยายสิทธิ์เกินตำแหน่งเดิม) */
export function intersectPermissions(a: PositionPermissions, b: PositionPermissions): PositionPermissions {
  return {
    tabs: Object.fromEntries(PERMISSION_TAB_KEYS.map((k) => [k, a.tabs[k] && b.tabs[k]])) as Record<PermissionTabKey, boolean>,
    actions: Object.fromEntries(
      PERMISSION_RESOURCE_KEYS.map((k) => [
        k,
        { create: a.actions[k].create && b.actions[k].create, edit: a.actions[k].edit && b.actions[k].edit, delete: a.actions[k].delete && b.actions[k].delete },
      ]),
    ) as Record<PermissionResourceKey, ResourceActions>,
  }
}

export function validatePermissionCeilings(
  ceilings: Record<string, PositionPermissions>,
): { ok: true } | { ok: false; error: string } {
  for (const cat of PERMISSION_CATEGORIES) {
    const p = ceilings[cat]
    if (!p || typeof p !== 'object') return { ok: false, error: `เพดานสิทธิ์ของ "${PERMISSION_CATEGORY_LABEL[cat]}" ไม่ถูกต้อง` }
    for (const k of PERMISSION_TAB_KEYS) {
      if (typeof p.tabs?.[k] !== 'boolean') return { ok: false, error: `tabs.${k} ของเพดาน "${PERMISSION_CATEGORY_LABEL[cat]}" ต้องเป็น boolean` }
    }
    for (const k of PERMISSION_RESOURCE_KEYS) {
      const a = p.actions?.[k]
      if (!a || typeof a.create !== 'boolean' || typeof a.edit !== 'boolean' || typeof a.delete !== 'boolean')
        return { ok: false, error: `actions.${k} ของเพดาน "${PERMISSION_CATEGORY_LABEL[cat]}" ไม่ถูกต้อง` }
    }
  }
  return { ok: true }
}

/** ตรวจ config ที่จะบันทึก (CRUD ผ่าน API) — คืน error ภาษาไทยถ้าไม่ผ่าน */
export function validatePositions(list: Position[]): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'ต้องมีอย่างน้อย 1 ตำแหน่ง' }
  const ids = new Set<string>()
  for (const p of list) {
    if (!ID_RE.test(p.id)) return { ok: false, error: `id ตำแหน่งไม่ถูกต้อง: ${p.id}` }
    if (ids.has(p.id)) return { ok: false, error: `id ตำแหน่งซ้ำ: ${p.id}` }
    ids.add(p.id)
    const name = p.name?.trim() ?? ''
    if (name.length === 0 || name.length > 60) return { ok: false, error: 'ชื่อตำแหน่งต้องยาว 1–60 ตัว' }
    if (!p.permissions || typeof p.permissions !== 'object')
      return { ok: false, error: `permissions ของตำแหน่ง "${p.name}" ไม่ถูกต้อง` }
    for (const k of PERMISSION_TAB_KEYS) {
      if (typeof p.permissions.tabs?.[k] !== 'boolean')
        return { ok: false, error: `tabs.${k} ของตำแหน่ง "${p.name}" ต้องเป็น boolean` }
    }
    for (const k of PERMISSION_RESOURCE_KEYS) {
      const a = p.permissions.actions?.[k]
      if (!a || typeof a.create !== 'boolean' || typeof a.edit !== 'boolean' || typeof a.delete !== 'boolean')
        return { ok: false, error: `actions.${k} ของตำแหน่ง "${p.name}" ไม่ถูกต้อง` }
    }
  }
  return { ok: true }
}
