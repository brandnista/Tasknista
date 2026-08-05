import { createDb, companyConfig, projectMembers } from '@seedoffice/db'
import {
  FULL_ACCESS_PERMISSIONS,
  VENDOR_PROJECT_PERMISSIONS,
  VIEW_ONLY_PERMISSIONS,
  hasAnyEditRight,
  positionById,
  resolvePositions,
  type PositionPermissions,
} from '@seedoffice/core'
import { and, eq } from 'drizzle-orm'

export type EffectiveProjectRole = 'owner' | 'editor' | 'viewer'

/**
 * Pronista §Position-based permission — permission bundle เต็มของฉันในโปรเจกต์นี้
 * owner = FULL_ACCESS เสมอ (bypass แคตตาล็อก) · vendor = ค่า hardcode คงที่ (ไม่ผูกกับแคตตาล็อกที่แก้ได้ — กันไม่ให้แก้ตำแหน่งกระทบ vendor)
 * member ที่ไม่มี positionId (ยังไม่ตั้ง/แถวหาย/ตำแหน่งถูกลบไปแล้ว) = fallback VIEW_ONLY (ปลอดภัยกว่าสำหรับสมาชิกใหม่)
 */
export async function getProjectPermissions(
  db: ReturnType<typeof createDb>,
  projectId: string,
  userId: string,
  globalRole: 'owner' | 'member' | 'vendor',
): Promise<PositionPermissions> {
  if (globalRole === 'owner') return FULL_ACCESS_PERMISSIONS
  if (globalRole === 'vendor') return VENDOR_PROJECT_PERMISSIONS
  const row = (
    await db
      .select({ positionId: projectMembers.positionId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1)
  )[0]
  if (!row?.positionId) return VIEW_ONLY_PERMISSIONS
  const cfg = (await db.select({ positions: companyConfig.positions }).from(companyConfig).limit(1))[0]
  return positionById(resolvePositions(cfg?.positions), row.positionId)?.permissions ?? VIEW_ONLY_PERMISSIONS
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
  globalRole: 'owner' | 'member' | 'vendor',
  // Pronista §Position-based permission (Performance review 2026-08-03) — เผื่อ caller คำนวณ permissions ไว้แล้ว ส่งเข้ามาแทนได้ กัน query ซ้ำ (optional เฉยๆ ไม่กระทบ call site เดิม)
  precomputedPermissions?: PositionPermissions,
): Promise<EffectiveProjectRole> {
  if (globalRole === 'owner') return 'owner'
  if (globalRole === 'vendor') return 'viewer'
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
  me: { id: string; role: 'owner' | 'member' | 'vendor' },
  precomputedPermissions?: PositionPermissions,
): Promise<boolean> {
  if (!task.projectId) return true // backlog ลอย — ทุกคนแก้ได้ตามเดิม
  if (me.role !== 'member') return true // owner ผ่านเสมอ (vendor ถูกกันที่ teamOnly ไปแล้ว)
  if (task.assigneeId === me.id) return true
  return canEditProject(await getProjectRole(db, task.projectId, me.id, me.role, precomputedPermissions))
}

/** Pronista §Back to Basic (ต่อยอด) — true เฉพาะเมื่อ canEditTask ผ่านได้เพราะเป็น "assignee เท่านั้น" (ไม่ใช่ owner/editor ของโปรเจกต์)
 * ใช้จำกัดสิทธิ์ผู้รับงานให้แก้ได้แค่ assigneeNotes/checklist(toggle)/attachments/comments ตาม §4 ของ Back to Basic — ไม่ใช่ทุกฟิลด์เหมือน canEditTask */
export async function isAssigneeOnlyEditor(
  db: ReturnType<typeof createDb>,
  task: { projectId: string | null; assigneeId: string | null },
  me: { id: string; role: 'owner' | 'member' | 'vendor' },
  precomputedPermissions?: PositionPermissions,
): Promise<boolean> {
  if (!task.projectId || me.role !== 'member' || task.assigneeId !== me.id) return false
  return !canEditProject(await getProjectRole(db, task.projectId, me.id, me.role, precomputedPermissions))
}
