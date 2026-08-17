import { createDb, companyConfig, customerProjects, projectMembers } from '@seedoffice/db'
import {
  FULL_ACCESS_PERMISSIONS,
  intersectPermissions,
  permissionCategoryOfRole,
  resolvePermissionCeilings,
  resolvePositions,
  positionById,
  VIEW_ONLY_PERMISSIONS,
  hasAnyEditRight,
  type PositionPermissions,
} from '@seedoffice/core'
import { and, eq } from 'drizzle-orm'

export type EffectiveProjectRole = 'owner' | 'editor' | 'viewer'

/**
 * Pronista §Customer Project Scope — ลูกค้า (guest) มองเห็นเฉพาะโปรเจกต์ที่ถูกเลือกไว้ตอนตั้งค่าผู้ใช้งาน (customer_projects)
 * หรือถูกเพิ่มเป็นสมาชิกโปรเจกต์ตรงๆ (project_members — เผื่อ owner เพิ่ม guest เข้าโปรเจกต์ทีหลัง)
 * role อื่นไม่ถูกจำกัดด้วยตารางนี้ (คืน true เสมอ) — เรียกใช้ที่ GET /projects (list) + GET /projects/:id (detail)
 */
export async function isProjectVisibleToUser(
  db: ReturnType<typeof createDb>,
  projectId: string,
  userId: string,
  globalRole: 'owner' | 'member' | 'vendor' | 'guest',
): Promise<boolean> {
  if (globalRole !== 'guest') return true
  const [link, member] = await Promise.all([
    db
      .select({ id: customerProjects.id })
      .from(customerProjects)
      .where(and(eq(customerProjects.projectId, projectId), eq(customerProjects.userId, userId)))
      .limit(1),
    db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1),
  ])
  return link.length > 0 || member.length > 0
}

/**
 * Pronista §Position-based permission + §System Requirements Update (เพดานสิทธิ์) — permission bundle เต็มของฉันในโปรเจกต์นี้
 * owner = FULL_ACCESS เสมอ (bypass ทั้งตำแหน่งและเพดาน)
 * member (staff) = intersect(ตำแหน่งที่ assign, เพดาน staff) — ตำแหน่งเป็นชั้นที่ 1, เพดานเป็นชั้นที่ 2 (จำกัดได้อย่างเดียว)
 * vendor(outsource)/guest(customer) ไม่มีตำแหน่งของตัวเอง — เพดานของหมวดนั้นคือสิทธิ์จริงเลย
 * member ที่ไม่มี positionId (ยังไม่ตั้ง/แถวหาย/ตำแหน่งถูกลบไปแล้ว) = fallback VIEW_ONLY ก่อนเข้าเพดาน (ปลอดภัยกว่าสำหรับสมาชิกใหม่)
 */
export async function getProjectPermissions(
  db: ReturnType<typeof createDb>,
  projectId: string,
  userId: string,
  globalRole: 'owner' | 'member' | 'vendor' | 'guest',
): Promise<PositionPermissions> {
  if (globalRole === 'owner') return FULL_ACCESS_PERMISSIONS
  const category = permissionCategoryOfRole(globalRole)
  const cfg = (await db.select({ positions: companyConfig.positions, permissionCeilings: companyConfig.permissionCeilings }).from(companyConfig).limit(1))[0]
  const ceiling = resolvePermissionCeilings(cfg?.permissionCeilings)[category!]
  // Pronista §User Role — guest ได้เพดานหมวด 'customer' ตรงๆ เหมือน vendor ได้หมวด 'outsource' (ไม่มีตำแหน่งของตัวเอง)
  if (globalRole === 'vendor' || globalRole === 'guest') return ceiling
  const row = (
    await db
      .select({ positionId: projectMembers.positionId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1)
  )[0]
  const positionPermissions = row?.positionId
    ? (positionById(resolvePositions(cfg?.positions), row.positionId)?.permissions ?? VIEW_ONLY_PERMISSIONS)
    : VIEW_ONLY_PERMISSIONS
  return intersectPermissions(positionPermissions, ceiling)
}

/**
 * Pronista §permission — สิทธิ์ระดับโปรเจกต์ (Jira-style) คำนวณจาก global role ก่อน แล้วค่อย derive จาก permission bundle ของตำแหน่งที่ assign
 * owner = 'owner' เสมอ (ไม่ผ่าน project_members) · vendor = 'viewer' เสมอ (teamOnly กันการแก้ไขไว้ชั้นนอกอยู่แล้ว)
 * Pronista §Position-based permission — 'editor'/'viewer' ตอนนี้ derive จาก hasAnyEditRight(getProjectPermissions(...)) แทนการอ่าน project_members.role ตรงๆ
 * (role column เดิม deprecated แล้ว ไม่อ่านอีกต่อไป) — signature เดิมไม่เปลี่ยน ทุกจุดที่เรียก canEditProject/canEditTask/isAssigneeOnlyEditor ทำงานถูกต้องอัตโนมัติ
 */
export async function getProjectRole(
  db: ReturnType<typeof createDb>,
  projectId: string,
  userId: string,
  globalRole: 'owner' | 'member' | 'vendor' | 'guest',
  // Pronista §Position-based permission (Performance review 2026-08-03) — เผื่อ caller คำนวณ permissions ไว้แล้ว ส่งเข้ามาแทนได้ กัน query ซ้ำ (optional เฉยๆ ไม่กระทบ call site เดิม)
  precomputedPermissions?: PositionPermissions,
): Promise<EffectiveProjectRole> {
  if (globalRole === 'owner') return 'owner'
  if (globalRole === 'vendor' || globalRole === 'guest') return 'viewer'
  const permissions = precomputedPermissions ?? (await getProjectPermissions(db, projectId, userId, globalRole))
  return hasAnyEditRight(permissions) ? 'editor' : 'viewer'
}

/** editor ของโปรเจกต์นี้ = แก้ไข task ทั้งหมด + ข้อมูลโปรเจกต์ได้ · viewer = อ่านอย่างเดียว */
export function canEditProject(role: EffectiveProjectRole): boolean {
  return role === 'owner' || role === 'editor'
}

/** Pronista §Task Detail permission fix — คนที่ถูก assign งานนี้ แก้ไข "งานของตัวเอง" ได้เสมอ แม้ไม่ใช่ editor ของโปรเจกต์
 * (member ที่ไม่มีแถวใน project_members หรือเป็น viewer ของโปรเจกต์ แต่ถูก assign งานตรงๆ — เดิมแก้อะไรไม่ได้เลย ซึ่งผิดจุดประสงค์)
 * ไม่กระทบ endpoint อื่น (ลบ/reassign ให้คนอื่น) เพราะฝั่ง route/UI เหล่านั้นเช็ค !isAssignee แยกอยู่แล้ว */
export async function canEditTask(
  db: ReturnType<typeof createDb>,
  task: { projectId: string | null; assigneeId: string | null },
  me: { id: string; role: 'owner' | 'member' | 'vendor' | 'guest' },
  precomputedPermissions?: PositionPermissions,
): Promise<boolean> {
  if (!task.projectId) return true // backlog ลอย — ทุกคนแก้ได้ตามเดิม
  if (me.role !== 'member') return true // owner ผ่านเสมอ (vendor/guest ถูกกันที่ teamOnly ไปแล้ว)
  if (task.assigneeId === me.id) return true
  return canEditProject(await getProjectRole(db, task.projectId, me.id, me.role, precomputedPermissions))
}

/** Pronista §System Requirements Update — เวอร์ชัน batch ของ canEditTask ใช้กับ GET /sprints/:id/board (Board.tsx/WorkspaceBoard.tsx)
 * ให้ frontend เช็คสิทธิ์ต่อการ์ดตรงกับ backend จริง (เดิม frontend เช็คแค่ role กว้างๆ ทำให้เห็นว่าลากได้แต่ลากจริงโดน 403)
 * vendor/guest = false เสมอ (ถูกกัน teamOnly ที่ endpoint แก้ไขจริงอยู่แล้ว) · owner/member คำนวณ permissions ต่อโปรเจกต์ครั้งเดียวแล้ว reuse กับทุก task ของโปรเจกต์นั้น กัน query ซ้ำ */
export async function canEditTasksBatch(
  db: ReturnType<typeof createDb>,
  tasksList: { projectId: string | null; assigneeId: string | null }[],
  me: { id: string; role: 'owner' | 'member' | 'vendor' | 'guest' },
): Promise<boolean[]> {
  if (me.role === 'vendor' || me.role === 'guest') return tasksList.map(() => false)
  const permissionsByProject = new Map<string, PositionPermissions>()
  if (me.role === 'member') {
    const projectIds = [...new Set(tasksList.map((t) => t.projectId).filter((id): id is string => id !== null))]
    for (const pid of projectIds) permissionsByProject.set(pid, await getProjectPermissions(db, pid, me.id, me.role))
  }
  return Promise.all(tasksList.map((t) => canEditTask(db, t, me, t.projectId ? permissionsByProject.get(t.projectId) : undefined)))
}

/** Pronista §Back to Basic (ต่อยอด) — true เฉพาะเมื่อ canEditTask ผ่านได้เพราะเป็น "assignee เท่านั้น" (ไม่ใช่ owner/editor ของโปรเจกต์)
 * ใช้จำกัดสิทธิ์ผู้รับงานให้แก้ได้แค่ assigneeNotes/checklist(toggle)/attachments/comments ตาม §4 ของ Back to Basic — ไม่ใช่ทุกฟิลด์เหมือน canEditTask */
export async function isAssigneeOnlyEditor(
  db: ReturnType<typeof createDb>,
  task: { projectId: string | null; assigneeId: string | null },
  me: { id: string; role: 'owner' | 'member' | 'vendor' | 'guest' },
  precomputedPermissions?: PositionPermissions,
): Promise<boolean> {
  if (!task.projectId || me.role !== 'member' || task.assigneeId !== me.id) return false
  return !canEditProject(await getProjectRole(db, task.projectId, me.id, me.role, precomputedPermissions))
}
