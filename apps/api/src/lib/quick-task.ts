import { createDb, projects, taskGroups, tasks } from '@seedoffice/db'
import { asc, eq } from 'drizzle-orm'
import { nextTypedTaskCode, sanitizeCodePrefix } from './task-code'

/**
 * Pronista §Message → Task / Meeting Action Item → Task (2026-08-26) — สร้าง Task แบบเบาที่สุดจากแหล่งอื่น (แชท/action item ประชุม)
 * ลง "ทั่วไป" group เสมอ (สร้างให้ถ้ายังไม่มี) เหมือน POST /projects/:id/tasks ปกติ — คนละที่เรียกใช้โค้ดชุดเดียวกัน กันลอกซ้ำ
 * ผู้เรียกต้องเช็ค getProjectPermissions(...).actions.task.create เองก่อนเรียกฟังก์ชันนี้เสมอ (ไม่เช็คสิทธิ์ในนี้)
 */
export async function createQuickTask(
  db: ReturnType<typeof createDb>,
  opts: { projectId: string; title: string; description?: string | null; assigneeId?: string; createdBy: string },
) {
  const project = (await db.select().from(projects).where(eq(projects.id, opts.projectId)).limit(1))[0]
  if (!project) return null
  let group = (await db.select().from(taskGroups).where(eq(taskGroups.projectId, project.id)).orderBy(asc(taskGroups.sortOrder)).limit(1))[0]
  if (!group) group = (await db.insert(taskGroups).values({ projectId: project.id, name: 'ทั่วไป', sortOrder: 0 }).returning())[0]!
  const siblings = await db.select().from(tasks).where(eq(tasks.groupId, group.id))
  const code = await nextTypedTaskCode(db, sanitizeCodePrefix(project.code, 'TASK'), 'Task')
  return (
    await db
      .insert(tasks)
      .values({
        projectId: project.id,
        groupId: group.id,
        sortOrder: siblings.length,
        createdBy: opts.createdBy,
        code,
        title: opts.title.slice(0, 200),
        description: opts.description ?? null,
        assigneeId: opts.assigneeId,
      })
      .returning()
  )[0]!
}
