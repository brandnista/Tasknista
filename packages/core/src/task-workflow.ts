/**
 * Pronista §Task status workflow (2026-10-02) — การไหลของสถานะงานแยกตามประเภทงาน (pure — ใช้ทั้ง API + web)
 *
 * - flow "document": Non Start → On Processing → Waiting for Review → Done (ระบบเดิม)
 * - flow "deployment" (ประเภทงานอื่นทั้งหมด + งานไม่เลือกประเภท): Non Start → On Processing → Ready for STG → Testing on STG → Ready for PRD → Testing on PRD → Done
 * - สวิตช์ `enabled` ปิดไว้ก่อน → ทุกงานใช้ flow เดิมของระบบปัจจุบัน (ขึ้น PRD ได้โดยไม่กระทบทีม)
 * - บทบาท: ผู้รับงาน (Dev, assignee) · ผู้จ่ายงาน (BA, assigner) · ผู้ตรวจ/ผู้ทดสอบ (QA, reviewer = reviewerId ?? assigner) · เจ้าของ (owner bypass)
 * - Ready for STG (2 ต.ค. 69): Dev ส่งงาน → รอผู้ทดสอบ "รับทดสอบ" → Testing on STG (ผู้ทดสอบ = ช่อง "ผู้ตรวจงาน" เดิม เลือกตอนส่งงาน)
 */
import type { TaskType } from './task-type'

export const WORKFLOW_STATUS_IDS = [
  'non_start',
  'on_processing',
  'waiting_for_test',
  'ready_for_stg',
  'testing_stg',
  'ready_for_prd',
  'testing_prd',
  'done',
  'rejected',
  'cancelled',
] as const
export type WorkflowStatus = (typeof WORKFLOW_STATUS_IDS)[number]

/** สถานะที่เป็น "ขั้นบนเส้นทางหลัก" ของ flow (ถูกปฏิเสธ/ยกเลิกเป็นทางข้างผ่านปุ่มเฉพาะ ไม่อยู่ใน steps) */
export const WORKFLOW_STEP_IDS = ['non_start', 'on_processing', 'waiting_for_test', 'ready_for_stg', 'testing_stg', 'ready_for_prd', 'testing_prd', 'done'] as const
export type WorkflowStep = (typeof WORKFLOW_STEP_IDS)[number]

export const WORKFLOW_STATUS_DEFAULT_LABEL: Record<WorkflowStatus, string> = {
  non_start: 'Non Start',
  on_processing: 'On Processing',
  waiting_for_test: 'Waiting for Review',
  ready_for_stg: 'Ready for STG',
  testing_stg: 'Testing on STG',
  ready_for_prd: 'Ready for PRD',
  testing_prd: 'Testing on PRD',
  done: 'Done',
  rejected: 'ถูกปฏิเสธ',
  cancelled: 'ยกเลิกแล้ว',
}

export interface WorkflowDef {
  id: string
  name: string
  steps: WorkflowStep[]
}

export interface WorkflowConfig {
  enabled: boolean
  workflows: WorkflowDef[]
  /** taskType id → workflow id (ตั้งในหน้าตั้งค่า) — ไม่มี = ใช้กฎชื่อ "Document" แล้วค่าเริ่มต้น */
  typeFlows: Record<string, string>
  defaultWorkflowId: string
}

const DOCUMENT_FLOW: WorkflowDef = { id: 'document', name: 'Document', steps: ['non_start', 'on_processing', 'waiting_for_test', 'done'] }
const DEPLOYMENT_FLOW: WorkflowDef = {
  id: 'deployment',
  name: 'Deployment',
  steps: ['non_start', 'on_processing', 'ready_for_stg', 'testing_stg', 'ready_for_prd', 'testing_prd', 'done'],
}
/** ขั้นของ flow Deployment รุ่นก่อนมี Ready for STG — config ที่เก็บไว้ยังเป็นชุดนี้ให้อัปเกรดเป็นชุดใหม่อัตโนมัติ (ไม่ทับ flow ที่ owner ปรับเอง) */
const LEGACY_DEPLOYMENT_STEPS = ['non_start', 'on_processing', 'testing_stg', 'ready_for_prd', 'testing_prd', 'done']

export const DEFAULT_WORKFLOW_CONFIG: WorkflowConfig = {
  enabled: false,
  workflows: [DOCUMENT_FLOW, DEPLOYMENT_FLOW],
  typeFlows: {},
  defaultWorkflowId: 'deployment',
}

const isStep = (v: unknown): v is WorkflowStep => typeof v === 'string' && (WORKFLOW_STEP_IDS as readonly string[]).includes(v)

/** อ่านค่าที่เก็บใน company_config → คัดค่าเสีย/ไม่รู้จักทิ้ง · document/deployment ที่ระบบให้มาอยู่เสมอ */
export function resolveWorkflowConfig(raw: unknown): WorkflowConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return JSON.parse(JSON.stringify(DEFAULT_WORKFLOW_CONFIG)) as WorkflowConfig
  const r = raw as Partial<Record<keyof WorkflowConfig, unknown>>
  const byId = new Map<string, WorkflowDef>(DEFAULT_WORKFLOW_CONFIG.workflows.map((w) => [w.id, { ...w, steps: [...w.steps] }]))
  if (Array.isArray(r.workflows)) {
    for (const w of r.workflows as unknown[]) {
      if (!w || typeof w !== 'object') continue
      const wf = w as { id?: unknown; name?: unknown; steps?: unknown }
      if (typeof wf.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(wf.id)) continue
      const steps = [...new Set(Array.isArray(wf.steps) ? (wf.steps as unknown[]).filter(isStep) : [])]
      if (steps.length === 0) continue
      const name = typeof wf.name === 'string' && wf.name.trim() ? wf.name.trim().slice(0, 60) : wf.id
      if (wf.id === 'deployment' && steps.join() === LEGACY_DEPLOYMENT_STEPS.join()) continue // อัปเกรดเป็นชุดใหม่ (มี Ready for STG)
      byId.set(wf.id, { id: wf.id, name, steps })
    }
  }
  const workflows = [...byId.values()]
  const typeFlows: Record<string, string> = {}
  if (r.typeFlows && typeof r.typeFlows === 'object' && !Array.isArray(r.typeFlows)) {
    for (const [typeId, flowId] of Object.entries(r.typeFlows as Record<string, unknown>)) {
      if (typeof flowId === 'string' && byId.has(flowId)) typeFlows[typeId] = flowId
    }
  }
  const defaultWorkflowId = typeof r.defaultWorkflowId === 'string' && byId.has(r.defaultWorkflowId) ? r.defaultWorkflowId : DEFAULT_WORKFLOW_CONFIG.defaultWorkflowId
  return { enabled: r.enabled === true, workflows, typeFlows, defaultWorkflowId }
}

/** ตรวจ config ก่อนบันทึก (หน้าตั้งค่า) — คืนข้อความไทยถ้าไม่ผ่าน */
export function validateWorkflowConfig(cfg: WorkflowConfig): { ok: true } | { ok: false; error: string } {
  const ids = new Set<string>()
  for (const w of cfg.workflows) {
    if (ids.has(w.id)) return { ok: false, error: `id flow ซ้ำ: ${w.id}` }
    ids.add(w.id)
    if (!w.name?.trim()) return { ok: false, error: 'ชื่อ flow ห้ามว่าง' }
    const s = w.steps
    if (s.length < 3) return { ok: false, error: `flow "${w.name}" ต้องมีอย่างน้อย 3 สถานะ` }
    if (s[0] !== 'non_start') return { ok: false, error: `flow "${w.name}" ต้องขึ้นต้นด้วย Non Start` }
    if (s[s.length - 1] !== 'done') return { ok: false, error: `flow "${w.name}" ต้องลงท้ายด้วย Done` }
    if (!s.includes('on_processing')) return { ok: false, error: `flow "${w.name}" ต้องมี On Processing` }
    if (new Set(s).size !== s.length) return { ok: false, error: `flow "${w.name}" มีสถานะซ้ำ` }
    // ลำดับต้องเรียงตามแคตตาล็อก (ไม่ข้ามไปมา) และต้องเป็น flow แบบใดแบบหนึ่ง: Document-like (มี Waiting for Review) หรือ Deployment-like (มี Testing on STG) — ปนกันไม่ได้ เพราะแต่ละแบบใช้ปุ่ม/กติกาคนละชุด
    const idx = s.map((x) => WORKFLOW_STEP_IDS.indexOf(x))
    if (idx.some((v, i) => i > 0 && v < idx[i - 1]!)) return { ok: false, error: `flow "${w.name}" เรียงสถานะผิดลำดับ` }
    if (s.includes('testing_stg') && s.includes('waiting_for_test')) return { ok: false, error: `flow "${w.name}" ใช้ Waiting for Review คู่กับ Testing on STG ไม่ได้ (เลือกแบบใดแบบหนึ่ง)` }
    if (!s.includes('testing_stg') && (s.includes('ready_for_stg') || s.includes('ready_for_prd') || s.includes('testing_prd')))
      return { ok: false, error: `flow "${w.name}" ต้องมี Testing on STG ก่อนถึงจะใช้ Ready for STG / Ready for PRD / Testing on PRD ได้` }
  }
  if (!ids.has(cfg.defaultWorkflowId)) return { ok: false, error: 'flow เริ่มต้นไม่มีอยู่จริง' }
  for (const [typeId, flowId] of Object.entries(cfg.typeFlows)) {
    if (!ids.has(flowId)) return { ok: false, error: `ประเภทงาน ${typeId} ชี้ไป flow ที่ไม่มีอยู่จริง` }
  }
  return { ok: true }
}

/** ประเภทงานนี้ใช้ flow ไหน: ตั้งเองในหน้าตั้งค่า → ชื่อประเภท "Document" → document → ที่เหลือ/ไม่เลือกประเภท = flow เริ่มต้น (deployment) */
export function workflowIdForTaskType(cfg: WorkflowConfig, taskTypeId: string | null | undefined, taskTypes: TaskType[] | null | undefined): string {
  const has = (id: string) => cfg.workflows.some((w) => w.id === id)
  if (!taskTypeId) return cfg.defaultWorkflowId
  const explicit = cfg.typeFlows[taskTypeId]
  if (explicit && has(explicit)) return explicit
  const type = (taskTypes ?? []).find((t) => t.id === taskTypeId)
  if (type && type.name.trim().toLowerCase() === 'document' && has('document')) return 'document'
  return cfg.defaultWorkflowId
}

/**
 * flow ของงานชิ้นหนึ่ง — สวิตช์ปิด = flow เดิมของระบบปัจจุบันทุกงาน · งานย่อยมีประเภทเองใช้ของตัวเอง ไม่มีก็ตามงานแม่
 */
export function workflowForTask(
  cfg: WorkflowConfig,
  task: { taskTypeId: string | null | undefined },
  parent: { taskTypeId: string | null | undefined } | null | undefined,
  taskTypes: TaskType[] | null | undefined,
): WorkflowDef {
  if (!cfg.enabled) return DOCUMENT_FLOW
  const typeId = task.taskTypeId ?? parent?.taskTypeId ?? null
  const id = workflowIdForTaskType(cfg, typeId, taskTypes)
  return cfg.workflows.find((w) => w.id === id) ?? DEPLOYMENT_FLOW
}

/** ลำดับความคืบหน้า (ใช้เทียบงานแม่/งานลูก) — null = ไม่นับ (ยกเลิก) · ติดลบ = ถูกปฏิเสธ (บล็อกเสมอ) */
export function stageRank(status: WorkflowStatus): number | null {
  switch (status) {
    case 'non_start':
      return 0
    case 'on_processing':
      return 1
    case 'ready_for_stg':
      return 2
    case 'waiting_for_test':
    case 'testing_stg':
      return 3
    case 'ready_for_prd':
      return 4
    case 'testing_prd':
      return 5
    case 'done':
      return 6
    case 'rejected':
      return -1
    case 'cancelled':
      return null
  }
}

export interface Actor {
  isAssignee: boolean
  isAssigner: boolean
  /** ผู้ตรวจจริง = reviewerId ?? ผู้จ่ายงาน (ผู้เรียกคำนวณให้) */
  isReviewer: boolean
  isOwner: boolean
}
export interface ActionContext {
  /** QA กด "ผ่าน STG" แล้ว (รอ BA อนุมัติ) */
  stgPassed: boolean
  /** ผู้ตรวจเป็นคนเดียวกับผู้จ่ายงาน → ไม่ต้องอนุมัติสองชั้น */
  reviewerIsAssigner: boolean
}
export type WorkflowAction = 'accept' | 'reject' | 'submit' | 'recall' | 'stg_accept' | 'stg_decline' | 'stg_pass' | 'stg_approve' | 'deployed' | 'prd_pass' | 'fail' | 'approve' | 'bounce'
export interface AvailableAction {
  action: WorkflowAction
  to: WorkflowStatus
  requiresReason?: boolean
}

const nextStep = (flow: WorkflowDef, from: WorkflowStep): WorkflowStep | undefined => flow.steps[flow.steps.indexOf(from) + 1]

/** ปุ่ม/การกระทำที่ "คนนี้" กดได้ในสถานะนี้ของ flow นี้ (เจ้าของ = ทำได้เท่าบทบาทที่เกี่ยวข้อง) */
export function actionsFor(flow: WorkflowDef, status: WorkflowStatus, actor: Actor, ctx: ActionContext): AvailableAction[] {
  const out: AvailableAction[] = []
  const o = actor.isOwner
  if (!(flow.steps as readonly string[]).includes(status)) return out
  const step = status as WorkflowStep
  const next = nextStep(flow, step)

  switch (step) {
    case 'non_start':
      if (actor.isAssignee || o) {
        out.push({ action: 'accept', to: 'on_processing' })
        out.push({ action: 'reject', to: 'rejected', requiresReason: true })
      }
      break
    case 'on_processing':
      if ((actor.isAssignee || o) && next) out.push({ action: 'submit', to: next })
      break
    case 'waiting_for_test':
      if ((actor.isReviewer || o) && next) {
        out.push({ action: 'approve', to: next })
        out.push({ action: 'bounce', to: 'non_start' })
      }
      if (actor.isAssignee || o) out.push({ action: 'recall', to: 'on_processing' })
      break
    case 'ready_for_stg':
      // ผู้ทดสอบ (ผู้ตรวจงาน) กดรับทดสอบ หรือไม่รับ (ต้องใส่เหตุผล) · Dev ดึงงานกลับได้ตราบที่ยังไม่มีใครรับ
      if ((actor.isReviewer || o) && next) {
        out.push({ action: 'stg_accept', to: next })
        out.push({ action: 'stg_decline', to: 'on_processing', requiresReason: true })
      }
      if (actor.isAssignee || o) out.push({ action: 'recall', to: 'on_processing' })
      break
    case 'testing_stg':
      if ((actor.isReviewer || o) && !ctx.stgPassed && !ctx.reviewerIsAssigner) out.push({ action: 'stg_pass', to: 'testing_stg' })
      if ((actor.isAssigner || o) && (ctx.stgPassed || ctx.reviewerIsAssigner) && next) out.push({ action: 'stg_approve', to: next })
      if (actor.isReviewer || actor.isAssigner || o) out.push({ action: 'fail', to: 'on_processing', requiresReason: true })
      // flow ที่มีขั้น Ready for STG: รับทดสอบแล้วดึงกลับไม่ได้ (ต้องให้ผู้ทดสอบตีกลับด้วยผล "ไม่ผ่าน")
      if ((actor.isAssignee || o) && !ctx.stgPassed && !flow.steps.includes('ready_for_stg')) out.push({ action: 'recall', to: 'on_processing' })
      break
    case 'ready_for_prd':
      if ((actor.isAssignee || actor.isAssigner || o) && next) out.push({ action: 'deployed', to: next })
      break
    case 'testing_prd':
      if ((actor.isAssigner || o) && next) out.push({ action: 'prd_pass', to: next })
      if (actor.isReviewer || actor.isAssigner || o) out.push({ action: 'fail', to: 'on_processing', requiresReason: true })
      break
    case 'done':
      break
  }
  return out
}

/**
 * กติกางานแม่/งานลูก ก่อนย้ายงานแม่ไปสถานะ target
 * - flow Deployment: "แม่ห้ามล้ำหน้าลูก" — ลูกทุกชิ้นต้องถึงขั้น target อย่างน้อย (ยกเลิก = ไม่นับ · ถูกปฏิเสธ = บล็อก)
 * - flow Document: กติกาเดิม — ส่งตรวจ/ปิดงานแม่ได้เมื่อลูกทุกชิ้น Done หรือยกเลิก
 */
export function parentGate(
  flow: WorkflowDef,
  target: WorkflowStatus,
  children: { status: WorkflowStatus }[],
): { ok: true } | { ok: false; blocked: number } {
  const deploymentLike = flow.steps.includes('testing_stg')
  let blocked = 0
  if (deploymentLike) {
    const required = stageRank(target)
    if (required === null || required < 2) return { ok: true }
    for (const c of children) {
      if (c.status === 'cancelled') continue
      const r = stageRank(c.status)
      if (r === null || r < required) blocked++
    }
  } else {
    if (target !== 'waiting_for_test' && target !== 'done') return { ok: true }
    for (const c of children) if (c.status !== 'done' && c.status !== 'cancelled') blocked++
  }
  return blocked === 0 ? { ok: true } : { ok: false, blocked }
}
