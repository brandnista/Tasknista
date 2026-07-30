import { createDb, projectMembers } from '@seedoffice/db'
import { and, eq } from 'drizzle-orm'

export type EffectiveProjectRole = 'owner' | 'editor' | 'viewer'

/**
 * Tasknista §permission — สิทธิ์ระดับโปรเจกต์ (Jira-style) คำนวณจาก global role ก่อน แล้วค่อย fallback ไป project_members.role
 * owner = 'owner' เสมอ (ไม่ผ่าน project_members) · vendor = 'viewer' เสมอ (teamOnly กันการแก้ไขไว้ชั้นนอกอยู่แล้ว)
 * member ที่ไม่มีแถวใน project_members ของโปรเจกต์นี้ = 'viewer' (อ่านอย่างเดียว รวมถึงงานที่ตัวเอง assign)
 */
export async function getProjectRole(
  db: ReturnType<typeof createDb>,
  projectId: string,
  userId: string,
  globalRole: 'owner' | 'member' | 'vendor',
): Promise<EffectiveProjectRole> {
  if (globalRole === 'owner') return 'owner'
  if (globalRole === 'vendor') return 'viewer'
  const rows = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
  return rows.some((r) => r.role === 'editor') ? 'editor' : 'viewer'
}

/** editor ของโปรเจกต์นี้ = แก้ไข task ทั้งหมด + ข้อมูลโปรเจกต์ได้ · viewer = อ่านอย่างเดียว */
export function canEditProject(role: EffectiveProjectRole): boolean {
  return role === 'owner' || role === 'editor'
}

/** Tasknista §Task Detail permission fix — คนที่ถูก assign งานนี้ แก้ไข "งานของตัวเอง" ได้เสมอ แม้ไม่ใช่ editor ของโปรเจกต์
 * (member ที่ไม่มีแถวใน project_members หรือเป็น viewer ของโปรเจกต์ แต่ถูก assign งานตรงๆ — เดิมแก้อะไรไม่ได้เลย ซึ่งผิดจุดประสงค์)
 * ไม่กระทบ endpoint อื่น (ลบ/reassign ให้คนอื่น) เพราะฝั่ง route/UI เหล่านั้นเช็ค !isAssignee แยกอยู่แล้ว */
export async function canEditTask(
  db: ReturnType<typeof createDb>,
  task: { projectId: string | null; assigneeId: string | null },
  me: { id: string; role: 'owner' | 'member' | 'vendor' },
): Promise<boolean> {
  if (!task.projectId) return true // backlog ลอย — ทุกคนแก้ได้ตามเดิม
  if (me.role !== 'member') return true // owner ผ่านเสมอ (vendor ถูกกันที่ teamOnly ไปแล้ว)
  if (task.assigneeId === me.id) return true
  return canEditProject(await getProjectRole(db, task.projectId, me.id, me.role))
}
