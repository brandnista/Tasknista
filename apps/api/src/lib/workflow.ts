import {
  actionsFor,
  resolveTaskTypes,
  resolveWorkflowConfig,
  workflowForTask,
  type AvailableAction,
  type TaskType,
  type WorkflowConfig,
  type WorkflowDef,
  type WorkflowStatus,
} from '@seedoffice/core'
import { companyConfig, createDb, tasks } from '@seedoffice/db'
import { and, eq, isNotNull, isNull, or } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>
type TaskRow = typeof tasks.$inferSelect

/**
 * Pronista §Task status workflow phase 2 (2026-10-02) — ตัวช่วยฝั่ง API ของ flow สถานะงาน (กติกาจริงอยู่ที่ packages/core/src/task-workflow.ts)
 * อ่าน company_config 1 แถวต่อครั้ง (ไม่แคช — แถวเดียว ถูก index ด้วย PK) เพื่อให้สวิตช์ในหน้าตั้งค่ามีผลทันที
 */
export async function loadWorkflowSettings(db: Db): Promise<{ config: WorkflowConfig; taskTypes: TaskType[] }> {
  const row = (await db.select({ workflowConfig: companyConfig.workflowConfig, taskTypes: companyConfig.taskTypes }).from(companyConfig).limit(1))[0]
  return { config: resolveWorkflowConfig(row?.workflowConfig), taskTypes: resolveTaskTypes(row?.taskTypes) }
}

/** flow ของงานชิ้นนี้ — งานย่อยที่ไม่ได้เลือกประเภทเองใช้ประเภทของงานแม่ (ต้อง query แม่ 1 ครั้งเฉพาะกรณีนั้น) */
export async function flowOfTask(db: Db, task: Pick<TaskRow, 'taskType' | 'parentId'>, settings: { config: WorkflowConfig; taskTypes: TaskType[] }): Promise<WorkflowDef> {
  let parentTypeId: string | null = null
  if (settings.config.enabled && !task.taskType && task.parentId) {
    parentTypeId = (await db.select({ taskType: tasks.taskType }).from(tasks).where(eq(tasks.id, task.parentId)).limit(1))[0]?.taskType ?? null
  }
  return workflowForTask(settings.config, { taskTypeId: task.taskType }, parentTypeId ? { taskTypeId: parentTypeId } : null, settings.taskTypes)
}

/** flow ที่มีขั้น "Testing on STG" = flow Deployment (ใช้ปุ่ม action ของ workflow-action แทนการแก้สถานะตรงๆ) */
export const isDeploymentLike = (flow: WorkflowDef): boolean => flow.steps.includes('testing_stg')

/**
 * งานที่ค้างที่ waiting_for_test ทั้งที่ flow เป็น Deployment (เช่น เปลี่ยนประเภทงานระหว่างรอตรวจ) → ถือเป็น Testing on STG
 * เพื่อไม่ให้งานค้างไม่มีปุ่มให้กด
 */
export function effectiveStatus(flow: WorkflowDef, status: WorkflowStatus): WorkflowStatus {
  return status === 'waiting_for_test' && isDeploymentLike(flow) ? 'testing_stg' : status
}

export interface WorkflowActorUser {
  id: string
  role: string
}

/** ปุ่มที่ "คนนี้" กดได้กับงานนี้ — ผู้ตรวจจริง = reviewerId ?? ผู้จ่ายงาน (assignedBy) */
export function availableActionsFor(flow: WorkflowDef, task: TaskRow, me: WorkflowActorUser): AvailableAction[] {
  const effectiveReviewerId = task.reviewerId ?? task.assignedBy
  return actionsFor(
    flow,
    effectiveStatus(flow, task.status as WorkflowStatus),
    {
      isAssignee: task.assigneeId === me.id,
      isAssigner: task.assignedBy === me.id,
      isReviewer: effectiveReviewerId === me.id,
      isOwner: me.role === 'owner',
    },
    { stgPassed: task.stgPassedAt != null, reviewerIsAssigner: effectiveReviewerId != null && effectiveReviewerId === task.assignedBy },
  )
}

/** ที่ผู้ตรวจ/ผู้จ่ายงานต้องทำต่อ ณ ตอนนี้ — ใช้แสดงป้ายในเมนู "งานรอตรวจ" */
export type QueueReason = 'accept_stg' | 'review' | 'approve_stg' | 'confirm_prd'
export function queueReasonOf(task: Pick<TaskRow, 'status' | 'stgPassedAt'>): QueueReason {
  if (task.status === 'ready_for_stg') return 'accept_stg'
  if (task.status === 'testing_prd') return 'confirm_prd'
  if (task.status === 'testing_stg' && task.stgPassedAt != null) return 'approve_stg'
  return 'review'
}

/**
 * เงื่อนไขของคิว "งานรอตรวจ" ของผู้ใช้คนหนึ่ง
 * - เดิม (สวิตช์ปิด/งาน Document): ผู้ตรวจ (reviewerId) + Waiting for Review
 * - flow Deployment (สวิตช์เปิด): ผู้ตรวจ + Ready for STG (รอรับทดสอบ) / Testing on STG ที่ QA ยังไม่กดผ่าน · ผู้จ่ายงาน + (Testing on STG ที่ผ่านแล้ว รออนุมัติ | Testing on PRD รอยืนยัน)
 */
export function reviewQueueWhere(meId: string, workflowEnabled: boolean) {
  // ผู้ตรวจจริง = reviewerId ?? ผู้จ่ายงาน (ตรงกับกฎอนุมัติ/ตีกลับ) — งานที่ส่งตรวจก่อนระบบตั้งผู้ตรวจให้อัตโนมัติ (reviewerId ว่าง) ต้องโผล่ในคิวของผู้จ่ายงานด้วย (แก้ 05/10/69)
  const legacy = and(or(eq(tasks.reviewerId, meId), and(isNull(tasks.reviewerId), eq(tasks.assignedBy, meId))), eq(tasks.status, 'waiting_for_test'))
  if (!workflowEnabled) return legacy
  return or(
    legacy,
    // Ready for STG = รอผู้ทดสอบกดรับ · Testing on STG ที่ยังไม่มีใครกดผ่าน = รอผู้ทดสอบทดสอบ
    and(
      or(eq(tasks.reviewerId, meId), and(isNull(tasks.reviewerId), eq(tasks.assignedBy, meId))),
      or(eq(tasks.status, 'ready_for_stg'), and(eq(tasks.status, 'testing_stg'), isNull(tasks.stgPassedAt))),
    ),
    and(eq(tasks.assignedBy, meId), or(and(eq(tasks.status, 'testing_stg'), isNotNull(tasks.stgPassedAt)), eq(tasks.status, 'testing_prd'))),
  )!
}

/** ยังไม่เคยเห็น หรือมีความเคลื่อนไหวใหม่ (ส่งรอบใหม่/เปลี่ยนขั้น) หลังเข้าเมนูครั้งล่าสุด → นับใน badge */
export function isQueueItemUnseen(t: { reviewSeenAt: Date | null; stageAt: Date | null; submittedAt: Date | null }): boolean {
  if (!t.reviewSeenAt) return true
  const last = Math.max(t.stageAt?.getTime() ?? 0, t.submittedAt?.getTime() ?? 0)
  return last > t.reviewSeenAt.getTime()
}

/** อ่านแค่สถานะสวิตช์ (เบากว่า loadWorkflowSettings — ใช้กับ endpoint ที่ถูก poll) */
export async function loadWorkflowEnabled(db: Db): Promise<boolean> {
  const row = (await db.select({ workflowConfig: companyConfig.workflowConfig }).from(companyConfig).limit(1))[0]
  return row?.workflowConfig?.enabled === true
}
