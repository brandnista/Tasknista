import { columnsOf, presetById, resolvePresets } from '@seedoffice/core'
import { companyConfig, createDb, sprintTaskSnapshots, sprints, tasks } from '@seedoffice/db'
import { eq } from 'drizzle-orm'

/**
 * ปิด sprint (Pronista §Sprint & Board) — ใช้ทั้งตอนกดปิดเองและ cron ครบกำหนด (scheduled.ts)
 * snapshot done/not-done ลง sprints ก่อน (ต้องมีไว้ดูรายงานย้อนหลัง — หลังจากนี้ query จาก tasks นับใหม่ไม่ได้แล้ว)
 * snapshot ทุก task ลง sprint_task_snapshots ด้วย (ดู Detail Board ย้อนหลังได้ — task จริงจะถูกเคลียร์ sprintId/sprintStatus ทิ้งด้านล่าง ข้อมูลนี้จะหายถ้าไม่เก็บตอนนี้)
 * task ที่ไม่อยู่คอลัมน์สุดท้ายของ preset (Done) เด้งกลับ backlog (sprintId/sprintStatus เคลียร์) · task Done ยังผูก sprintId ไว้เป็นประวัติ
 * หมายเหตุ: คอลัมน์ Done หา id จริงจาก preset ที่ sprint นี้ใช้ (ไม่ hardcode 'done' — preset แก้ id เองได้)
 */
export async function completeSprint(db: ReturnType<typeof createDb>, sprintId: string): Promise<void> {
  const sprint = (await db.select().from(sprints).where(eq(sprints.id, sprintId)).limit(1))[0]
  if (!sprint) return
  const cfg = (await db.select({ boardPresets: companyConfig.boardPresets }).from(companyConfig).limit(1))[0]
  const preset = sprint.boardPresetId ? presetById(resolvePresets(cfg?.boardPresets), sprint.boardPresetId) : undefined
  const cols = preset ? columnsOf(preset) : []
  const doneColumnId = cols[cols.length - 1]?.id ?? 'done'

  const sprintTasks = await db.select().from(tasks).where(eq(tasks.sprintId, sprintId))
  const doneCount = sprintTasks.filter((t) => t.sprintStatus === doneColumnId).length
  const notDoneCount = sprintTasks.length - doneCount

  if (sprintTasks.length > 0) {
    await db.insert(sprintTaskSnapshots).values(
      sprintTasks.map((t) => ({
        sprintId,
        taskId: t.id,
        taskCode: t.code,
        taskTitle: t.title,
        statusIdAtClose: t.sprintStatus,
        priority: t.priority,
        srsRefCode: t.srsRefCode,
      })),
    )
  }

  for (const t of sprintTasks) {
    if (t.sprintStatus !== doneColumnId) {
      await db.update(tasks).set({ sprintId: null, sprintStatus: null }).where(eq(tasks.id, t.id))
    }
  }

  await db
    .update(sprints)
    .set({ status: 'completed', completedAt: new Date(), doneCount, notDoneCount })
    .where(eq(sprints.id, sprintId))
}
