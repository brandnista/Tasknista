/**
 * Pronista §Position-based permission — แคตตาล็อกตำแหน่งระดับบริษัท (BA/PM/Developer/ฯลฯ) เก็บเป็น JSON ใน company_config
 * แต่ละตำแหน่ง assign ต่อโปรเจกต์ผ่าน project_members.positionId (อ้าง id ที่นี่ ไม่มี DB-level FK — เหมือน board-preset.ts)
 * สิทธิ์แบบ checkbox ละเอียด 2 แกน: tabs (มองเห็นเมนู/แท็บไหนในโปรเจกต์) + actions (เพิ่ม/แก้ไข/ลบต่อ resource)
 * ยังไม่ตั้ง → ใช้ DEFAULT (เข้าถึงเต็มรูปแบบ/ดูอย่างเดียว) · pure ล้วน ใช้ทั้ง API + web (mirror project-status.ts/board-preset.ts)
 */

/** ตรงกับแท็บจริงใน ProjectDetail.tsx วันนี้ — top-level (sprint/docs/assets/releases/changeLog/meetings) + sub-tab ใน Backlog (backlog*)
 * เพิ่มแท็บใหม่ที่นี่ทุกครั้งที่เพิ่มแท็บระดับโปรเจกต์ใหม่ใน ProjectDetail.tsx — ไม่งั้นแท็บนั้นจะไม่มีใน myPermissions.tabs เลย ทำให้ filter (`?? true`) fail-open เห็นได้ไม่จำกัด ไม่ผ่านทั้งตำแหน่งและเพดานสิทธิ์ (พบเคสจริงกับแท็บ "ประชุม" — เพิ่มแท็บแล้วลืมเพิ่มที่นี่) */
export const PERMISSION_TAB_KEYS = [
  'sprint', 'docs', 'assets', 'releases', 'changeLog', 'meetings', 'estimate',
  'backlogEpic', 'backlogStory', 'backlogTask', 'backlogDefect', 'backlogCr', 'backlogSummary',
] as const
export type PermissionTabKey = (typeof PERMISSION_TAB_KEYS)[number]

/** Epic/Story ไม่มี action ของตัวเอง (fold เข้า task — เป็นแถวใน tasks table เดียวกัน ไม่มี endpoint แยก) */
export const PERMISSION_RESOURCE_KEYS = ['task', 'doc', 'sprint', 'defect', 'cr', 'release', 'changeLog', 'estimate'] as const
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
// Pronista §Project Estimate permission (2026-09-01) — VIEW_ONLY เห็นได้ "ทุกแท็บ" โดยดีไซน์ ยกเว้น estimate (ข้อมูลต้นทุน/margin ละเอียดอ่อนกว่าแท็บอื่น)
// ใช้เป็นทั้งค่าเริ่มต้นของตำแหน่ง "ดูอย่างเดียว" และ fallback ของ member ที่ยังไม่ได้ตั้งตำแหน่ง — ต้องกด "เข้าถึงเต็มรูปแบบ" หรือเปิด estimate เองในตำแหน่งถึงจะเห็น
export const VIEW_ONLY_PERMISSIONS: PositionPermissions = { tabs: { ...allTabs(true), estimate: false }, actions: allActions(ALL_ACTIONS_FALSE) }

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
 * Pronista §Menu Restructure — เพิ่มหมวด 'membership' (สมาชิก) ไว้ล่วงหน้า — ตั้งชื่อไม่ให้ชนกับ role='member' เดิม (คนละความหมาย: role member = พนักงาน/หมวด staff)
 * ตอนนี้ "สมาชิก" ยังไม่มี login เป็นของตัวเอง (ยังไม่มี role แม็ปมาที่นี่ ดู permissionCategoryOfRole) เพดานหมวดนี้จึงยังไม่ถูกใช้งานจริงที่ไหน
 * เตรียมโครง/ค่า default ไว้รอ flow สมัครสมาชิก+login ในเฟสถัดไป (ยังไม่ตัดสินใจรายละเอียด)
 */
export const PERMISSION_CATEGORIES = ['staff', 'outsource', 'customer', 'membership'] as const
export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number]

export const PERMISSION_CATEGORY_LABEL: Record<PermissionCategory, string> = {
  staff: 'พนักงาน',
  outsource: 'พาร์ทเนอร์',
  customer: 'ลูกค้า',
  membership: 'สมาชิก',
}

/** หมวดที่มี role login จริงใน users table วันนี้ (ไม่รวม 'membership' — สมาชิกยังไม่มี login เป็นของตัวเอง) */
export type LoginPermissionCategory = Exclude<PermissionCategory, 'membership'>

/** map global role → หมวดเพดาน — owner ไม่มีหมวด (bypass เพดานเสมอ) */
export function permissionCategoryOfRole(role: 'owner' | 'member' | 'vendor' | 'guest'): LoginPermissionCategory | null {
  if (role === 'owner') return null
  if (role === 'member') return 'staff'
  if (role === 'vendor') return 'outsource'
  return 'customer'
}

/** หมวดผู้ใช้งาน → เมนูจัดการบัญชีของหมวดนั้น — ใช้เช็คเพดานตอนเปิด /api/admin/users ให้ non-owner เข้าถึงแบบ scope ตาม category ของตัวเอง */
export function adminUsersMenuKeyForCategory(category: LoginPermissionCategory): PermissionMenuKey {
  return category === 'staff' ? 'employees' : category === 'outsource' ? 'partners' : 'customers'
}

/** เมนูหลักฝั่ง sidebar ที่คุมได้ต่อประเภทผู้ใช้งาน — ตรงกับ NAV ใน Layout.tsx (ไม่รวม "ตั้งค่า"/"ตั้งค่าผู้ใช้งาน" ซึ่ง owner-only เสมอ ไม่ผ่านเพดานนี้)
 * Pronista §Menu Restructure — employees/partners/customers/members เพิ่มเข้ามาทีหลัง (แยกจาก "ตั้งค่าผู้ใช้งาน" เดิมเป็นเมนูหลัก) ต้อง sync ไว้ที่นี่ด้วย
 * ให้เพดานคุมได้ (ค่า default ปิดหมดกัน privilege escalation โดยไม่ตั้งใจตอน deploy ฟีเจอร์นี้ครั้งแรก — ดู DEFAULT_PERMISSION_CEILINGS) */
// Pronista §Menu Restructure (2026-09-02) — แยก "ไฟล์ของฉัน" ออกจากเมนู "งานของฉัน" เป็นเมนูหลักของตัวเอง ("แชร์กับฉัน" ย้ายไปเป็นเมนูย่อยของมันแทน) จึงต้องมีเพดานแยกจาก myTasks
export const PERMISSION_MENU_KEYS = ['dashboard', 'myTasks', 'myFiles', 'workspace', 'projects', 'team', 'docs', 'docsHistory', 'employees', 'partners', 'customers', 'members'] as const
export type PermissionMenuKey = (typeof PERMISSION_MENU_KEYS)[number]
export const PERMISSION_MENU_LABEL: Record<PermissionMenuKey, string> = {
  dashboard: 'ภาพรวม',
  myTasks: 'งานของฉัน',
  myFiles: 'ไฟล์ของฉัน',
  workspace: 'Workspace',
  projects: 'โปรเจกต์',
  team: 'ทีม',
  docs: 'เอกสาร',
  docsHistory: 'ประวัติเอกสาร',
  employees: 'จัดการพนักงาน',
  partners: 'จัดการพาร์ทเนอร์',
  customers: 'จัดการลูกค้า',
  members: 'จัดการสมาชิก',
}

/** เพดานสิทธิ์ต่อหมวด = สิทธิ์ตำแหน่ง (tabs/actions ระดับโปรเจกต์) + เมนูหลักที่มองเห็นได้ (ระดับ sidebar) */
export interface CeilingPermissions extends PositionPermissions {
  menus: Record<PermissionMenuKey, boolean>
}

function allMenus(value: boolean): Record<PermissionMenuKey, boolean> {
  return Object.fromEntries(PERMISSION_MENU_KEYS.map((k) => [k, value])) as Record<PermissionMenuKey, boolean>
}

/** เพดานเริ่มต้น (ออกแบบใหม่ตาม §System Requirements Update):
 * staff = เข้าถึงเต็ม ทุกเมนู (คุมสิทธิ์จริงด้วยตำแหน่งต่อโปรเจกต์อยู่แล้ว)
 * outsource = เห็นภาพรวม/งานของฉัน/Workspace/โปรเจกต์ ไม่เห็นเอกสาร/ประวัติเอกสาร (เอกสารภายในไม่ใช่ของผู้รับจ้างภายนอก)
 * customer = เห็นเฉพาะโปรเจกต์ + เอกสาร (ตามตัวอย่างที่ขอ) — ไม่เห็น Workspace/ภาพรวม/งานของฉัน/ประวัติเอกสาร
 *            เข้า Workspace ไม่ได้ แต่ต้องคีย์ Backlog/Defect ให้โปรเจกต์ของตัวเองได้ตรงจากแท็บ Sprint ในหน้าโปรเจกต์ (ที่เหลือยังดูอย่างเดียว)
 * Pronista §Menu Restructure — employees/partners/customers/members ปิดไว้เป็นค่าเริ่มต้นทั้ง 3 หมวด (แม้แต่ staff)
 * เพราะเป็นเมนูจัดการข้อมูลคนละหมวด/บัญชี (เดิม owner-only แบบ hardcode) เปิดให้ตั้งใจกดเปิดเองใน "เพดานสิทธิ์" กันสิทธิ์หลุดโดยไม่ตั้งใจตอน deploy ฟีเจอร์นี้ */
export const DEFAULT_PERMISSION_CEILINGS: Record<PermissionCategory, CeilingPermissions> = {
  staff: { ...FULL_ACCESS_PERMISSIONS, menus: { ...allMenus(true), employees: false, partners: false, customers: false, members: false } },
  outsource: {
    ...VIEW_ONLY_PERMISSIONS,
    menus: { ...allMenus(true), docs: false, docsHistory: false, employees: false, partners: false, customers: false, members: false },
  },
  customer: {
    ...VIEW_ONLY_PERMISSIONS,
    actions: { ...VIEW_ONLY_PERMISSIONS.actions, task: { ...VIEW_ONLY_PERMISSIONS.actions.task, create: true }, defect: { ...VIEW_ONLY_PERMISSIONS.actions.defect, create: true } },
    menus: { ...allMenus(false), projects: true, docs: true },
  },
  // ยังไม่มี role/login ให้หมวดนี้จริง (ดู permissionCategoryOfRole) — ปิดทุกเมนูไว้ก่อนทั้งหมด เตรียมไว้เฉยๆ รอ flow สมัครสมาชิก+login
  membership: { ...VIEW_ONLY_PERMISSIONS, menus: allMenus(false) },
}

// เพดานที่บันทึกไว้ตั้งแต่ก่อนเพิ่ม field ใหม่ (เช่น 'menus') จะไม่มี key นั้นใน JSON เดิม — เติมด้วยค่า default ของหมวดนั้น (ไม่ใช่ false เปล่าๆ กัน staff เข้าถึงเต็มโดน fallback เป็นปิดหมดโดยไม่ตั้งใจ)
function normalizeCeiling(p: Partial<CeilingPermissions>, fallback: CeilingPermissions): CeilingPermissions {
  return {
    tabs: { ...fallback.tabs, ...p.tabs },
    actions: { ...fallback.actions, ...p.actions },
    menus: { ...fallback.menus, ...p.menus },
  }
}

export function resolvePermissionCeilings(
  raw: Partial<Record<PermissionCategory, Partial<CeilingPermissions>>> | null | undefined,
): Record<PermissionCategory, CeilingPermissions> {
  return Object.fromEntries(
    PERMISSION_CATEGORIES.map((cat) => [cat, normalizeCeiling(raw?.[cat] ?? {}, DEFAULT_PERMISSION_CEILINGS[cat])]),
  ) as Record<PermissionCategory, CeilingPermissions>
}

/** ชั้นที่ 2 คูณกับชั้นที่ 1 — AND ทีละฟิลด์ (จำกัดได้อย่างเดียว ไม่มีทางขยายสิทธิ์เกินตำแหน่งเดิม) — ใช้กับ tabs/actions ระดับโปรเจกต์เท่านั้น (menus ไม่มีชั้นที่ 1 ให้คูณ) */
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
  ceilings: Record<string, CeilingPermissions>,
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
    for (const k of PERMISSION_MENU_KEYS) {
      if (typeof p.menus?.[k] !== 'boolean') return { ok: false, error: `menus.${k} ของเพดาน "${PERMISSION_CATEGORY_LABEL[cat]}" ต้องเป็น boolean` }
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
