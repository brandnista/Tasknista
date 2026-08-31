import { createDb, docLinks, projects, taskReferences, tasks } from '@seedoffice/db'
import { and, eq } from 'drizzle-orm'
import { writeAudit } from './audit'
import { notifyUser } from './notify'
import { nextOriginRefCode } from './origin-code'
import { nextSubTaskCode, nextTypedTaskCode, sanitizeCodePrefix } from './task-code'
import type { BreakoutItemInput } from './doc-breakout-tasks'

// Pronista §SOW Task/Subtask — เล่มก่อนหน้าของ SOW คือ BRD (traceability-spec.md §2) — คงเดิมจาก EXPECTED_UPSTREAM ใน doc-breakout-tasks.ts (SOW เท่านั้นที่ผ่าน path นี้)
const SOW_UPSTREAM = 'BRD' as const

export interface SowSubtaskInput {
  text: string
  referenceCode: string | null
  assigneeId: string | null
  estimateMinutes: number | null
}

export interface SowBreakoutItemInput extends BreakoutItemInput {
  category?: string
  subtasks: SowSubtaskInput[]
}

/**
 * Pronista §SOW Task/Subtask — สร้าง Task พ่อ (จากแถวตาราง 4.4) + Subtask ลูก (จากย่อหน้าโมดูล 4.1-4.3 ที่ parse แล้ว) พร้อมกัน
 * แยกไฟล์จาก createTasksFromBreakoutItems เดิมโดยตั้งใจ — ไม่แตะ path เดิมของ MOM/BRD/SRS/PEP/UIR (ปิดใช้งานที่ชั้น route แล้ว แต่ historical data/เทสต์เดิมยังอิงโครงเดิมอยู่)
 * Task พ่อ: เหมือน createTasksFromBreakoutItems ทุกอย่าง (dedup ตาม originCode, เดินเลข code/originRefCode, resolve referenceCodes กับ BRD, docLinks, audit)
 * Subtask ลูก: code เดินแบบ sub-task เดิม (<parentCode>.N ผ่าน nextSubTaskCode), originDocType/originCode สืบทอดจาก parent (ทำให้ sprint guard ใหม่ทำงานถูก), ไม่มี originRefCode ของตัวเอง (ใช้ referenceCode ที่ generate ไว้แทน)
 */
export async function createSowTasksFromBreakoutItems(
  db: ReturnType<typeof createDb>,
  env: Env,
  params: {
    project: typeof projects.$inferSelect
    docId: string
    docVersion: string
    // Pronista §Project Refactor — SOW Parser Mode: null เมื่อ mode='V1_SIMPLE_TASK' (ไม่สร้าง Epic เลย, subtask กลายเป็น Task แยกอิสระ)
    epicId: string | null
    // 'flat' = V1_SIMPLE_TASK (โหมดเริ่มต้น) · false/undefined = V2_ADVANCED_HIERARCHY (Epic>Task>Subtask เดิม)
    flat?: boolean
    items: SowBreakoutItemInput[]
    createdBy: string
  },
): Promise<{
  tasks: (typeof tasks.$inferSelect)[]
  subtasks: (typeof tasks.$inferSelect)[]
  duplicateWarnings: string[]
  unresolvedReferences: string[]
}> {
  const { project, docId, docVersion, epicId, flat, items, createdBy } = params
  const codePrefix = sanitizeCodePrefix(project.code, 'TASK')
  const duplicateWarnings: string[] = []
  const unresolvedReferences: string[] = []
  const createdTasks: (typeof tasks.$inferSelect)[] = []
  const createdSubtasks: (typeof tasks.$inferSelect)[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (item.sourceCode) {
      const dup = (
        await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.projectId, project.id), eq(tasks.originCode, item.sourceCode)))
          .limit(1)
      )[0]
      if (dup) duplicateWarnings.push(item.sourceCode)
    }
    // Pronista §Sprint & Board fix — ใช้เลข Task จากเอกสารจริง (sourceCode, แก้ไขได้ในหน้ารีวิว) แทนเลข auto-gen ถ้าเอกสารมีให้ — fallback auto-gen เฉพาะตอนไม่มี/ว่าง
    const code = item.sourceCode?.trim() || (await nextTypedTaskCode(db, codePrefix, 'Task'))
    const originRefCode = await nextOriginRefCode(db, codePrefix, 'SOW', docVersion)
    // Pronista §SOW Task/Subtask — "ประเภท" (auto จากคอลัมน์ 4.4 แก้ไขได้ในหน้ารีวิว) ต่อท้ายเข้า description เดียว ไม่แยก column ใหม่ในตาราง tasks
    const description = [item.category?.trim() ? `ประเภท: ${item.category.trim()}` : null, item.description].filter(Boolean).join('\n\n')
    const parent = (
      await db
        .insert(tasks)
        .values({
          projectId: project.id,
          groupId: null,
          epicId,
          sortOrder: i,
          code,
          title: item.title,
          description,
          priority: item.priority ?? 'normal',
          originDocType: 'SOW',
          originCode: item.sourceCode,
          originRefCode,
          originDocId: docId,
          createdBy,
        })
        .returning()
    )[0]!
    createdTasks.push(parent)
    await db.insert(docLinks).values({ docId, taskId: parent.id, createdBy })
    await writeAudit(env, {
      actorId: createdBy,
      action: 'task.create',
      entity: 'task',
      entityId: parent.id,
      meta: { title: parent.title, docBreakout: true, docType: 'SOW', originRefCode, originCode: item.sourceCode },
    })

    for (const rawRefCode of item.referenceCodes) {
      const refCode = rawRefCode.trim()
      if (!refCode) continue
      const upstream = (
        await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.projectId, project.id), eq(tasks.originCode, refCode), eq(tasks.originDocType, SOW_UPSTREAM)))
          .limit(1)
      )[0]
      if (!upstream) {
        unresolvedReferences.push(refCode)
        continue
      }
      await db.insert(taskReferences).values({ taskId: parent.id, referencesTaskId: upstream.id }).onConflictDoNothing()
    }

    for (let j = 0; j < item.subtasks.length; j++) {
      const sub = item.subtasks[j]!
      if (!sub.text.trim()) continue
      // Pronista §Project Refactor — โหมด V1 (flat): subtask กลายเป็น Task แยกอิสระ (parentId=null, ออกเลข Task ใหม่) แทนที่จะเป็นลูกของ parent เหมือน V2
      const subCode = sub.referenceCode?.trim() || (flat ? await nextTypedTaskCode(db, codePrefix, 'Task') : await nextSubTaskCode(db, parent.id, parent.code!))
      const createdSub = (
        await db
          .insert(tasks)
          .values({
            projectId: project.id,
            groupId: null,
            epicId,
            parentId: flat ? null : parent.id,
            sortOrder: j,
            code: subCode,
            title: sub.text,
            assigneeId: sub.assigneeId,
            assignedBy: sub.assigneeId ? createdBy : null,
            estimateMinutes: sub.estimateMinutes,
            originDocType: 'SOW',
            originCode: sub.referenceCode,
            originDocId: docId,
            createdBy,
          })
          .returning()
      )[0]!
      createdSubtasks.push(createdSub)
      await db.insert(docLinks).values({ docId, taskId: createdSub.id, createdBy })
      await writeAudit(env, {
        actorId: createdBy,
        action: 'task.create',
        entity: 'task',
        entityId: createdSub.id,
        meta: { title: createdSub.title, docBreakout: true, docType: 'SOW', parentId: parent.id, originCode: sub.referenceCode },
      })
      // Pronista §My Work/Notification — assign ตั้งแต่ตอนอัปโหลด (ไม่ผ่าน PATCH) ก็ต้องแจ้งเตือนเหมือนกัน ไม่งั้นตัวนับ "Assign วันนี้" ใน MyTasks.tsx พลาดเคสนี้ไป
      if (sub.assigneeId) {
        await notifyUser(db, {
          userId: sub.assigneeId,
          type: 'subtask_assigned',
          taskId: createdSub.id,
          projectId: project.id,
          message: `คุณได้รับมอบหมายงานย่อย "${createdSub.title}"`,
        })
      }
    }
  }
  return { tasks: createdTasks, subtasks: createdSubtasks, duplicateWarnings, unresolvedReferences }
}
