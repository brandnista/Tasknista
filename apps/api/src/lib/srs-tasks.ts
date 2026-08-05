import { createDb, docLinks, projects, tasks } from '@seedoffice/db'
import { and, eq } from 'drizzle-orm'
import { writeAudit } from './audit'
import { nextSrsRefCode } from './srs-code'
import { nextTaskCode, sanitizeCodePrefix } from './task-code'

export interface SrsTaskItemInput {
  sourceCode: string | null
  title: string
  description: string
  priority: 'low' | 'normal' | 'high' | null
}

/**
 * Pronista §SRS import — สร้าง Task จริงจากรายการ SRS ที่ผ่านรีวิว/เลือกแล้ว ใช้ร่วมกันทั้ง 2 ทาง:
 * (1) อัปโหลดเอกสาร SRS มาพาร์ส (`docs-srs.ts` POST /docs/srs/confirm)
 * (2) แตกจากตารางความต้องการเชิงฟังก์ชันในเอกสาร Template SRS (`docs.ts` POST /docs/:id/srs-breakout)
 * เดินเลขที่งาน (nextTaskCode) + รหัสอ้างอิง (nextSrsRefCode) + ผูก docLinks(docId, taskId) + เตือนรหัสซ้ำ (ไม่บล็อก แค่เตือนให้รู้)
 */
export async function createTasksFromSrsItems(
  db: ReturnType<typeof createDb>,
  env: Env,
  params: {
    project: typeof projects.$inferSelect
    docId: string
    srsVersion: string
    items: SrsTaskItemInput[]
    createdBy: string
  },
): Promise<{ tasks: (typeof tasks.$inferSelect)[]; duplicateWarnings: string[] }> {
  const { project, docId, srsVersion, items, createdBy } = params
  const codePrefix = sanitizeCodePrefix(project.code, 'TASK')
  const duplicateWarnings: string[] = []
  const createdTasks: (typeof tasks.$inferSelect)[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (item.sourceCode) {
      const dup = (
        await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.projectId, project.id), eq(tasks.srsSourceCode, item.sourceCode)))
          .limit(1)
      )[0]
      if (dup) duplicateWarnings.push(item.sourceCode)
    }
    const code = await nextTaskCode(db, codePrefix)
    const srsRefCode = await nextSrsRefCode(db, codePrefix, srsVersion)
    const created = (
      await db
        .insert(tasks)
        .values({
          projectId: project.id,
          groupId: null,
          sortOrder: i,
          code,
          title: item.title,
          description: item.description,
          priority: item.priority ?? 'normal',
          srsRefCode,
          srsSourceCode: item.sourceCode,
          srsDocId: docId,
          createdBy,
        })
        .returning()
    )[0]!
    createdTasks.push(created)
    await db.insert(docLinks).values({ docId, taskId: created.id, createdBy })
    await writeAudit(env, {
      actorId: createdBy,
      action: 'task.create',
      entity: 'task',
      entityId: created.id,
      meta: { title: created.title, srsImport: true, srsRefCode, srsSourceCode: item.sourceCode },
    })
  }
  return { tasks: createdTasks, duplicateWarnings }
}
