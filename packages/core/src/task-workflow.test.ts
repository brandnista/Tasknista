import { describe, expect, it } from 'vitest'
import { DEFAULT_TASK_TYPES, type TaskType } from './task-type'
import {
  DEFAULT_WORKFLOW_CONFIG,
  actionsFor,
  parentGate,
  resolveWorkflowConfig,
  stageRank,
  validateWorkflowConfig,
  workflowForTask,
  workflowIdForTaskType,
  type Actor,
  type WorkflowConfig,
} from './task-workflow'

// ประเภทงานบน PRD มี Document + Deployment เพิ่มจากค่าเริ่มต้น
const TYPES: TaskType[] = [
  ...DEFAULT_TASK_TYPES,
  { id: 'tt_deployment', name: 'Deployment', sortOrder: 5, subTypes: [{ id: 'tts_dep', name: 'Deployment', sortOrder: 0 }] },
  { id: 'tt_document', name: 'Document', sortOrder: 7, subTypes: [{ id: 'tts_mom', name: 'MOM', sortOrder: 0 }] },
]
const ON: WorkflowConfig = { ...DEFAULT_WORKFLOW_CONFIG, enabled: true }

const actor = (over: Partial<Actor> = {}): Actor => ({ isAssignee: false, isAssigner: false, isReviewer: false, isOwner: false, ...over })
const names = (list: ReturnType<typeof actionsFor>) => list.map((a) => a.action).sort()

describe('ค่าเริ่มต้นของ workflow', () => {
  it('มี 2 flow: document (4 สถานะ) กับ deployment (6 สถานะ) · ปิดสวิตช์ไว้ก่อน · งานไม่มีประเภท = deployment', () => {
    expect(DEFAULT_WORKFLOW_CONFIG.enabled).toBe(false)
    expect(DEFAULT_WORKFLOW_CONFIG.defaultWorkflowId).toBe('deployment')
    const byId = Object.fromEntries(DEFAULT_WORKFLOW_CONFIG.workflows.map((w) => [w.id, w.steps]))
    expect(byId.document).toEqual(['non_start', 'on_processing', 'waiting_for_test', 'done'])
    expect(byId.deployment).toEqual(['non_start', 'on_processing', 'testing_stg', 'ready_for_prd', 'testing_prd', 'done'])
  })
})

describe('resolveWorkflowConfig / validateWorkflowConfig', () => {
  it('ไม่มีค่า/ค่าเสีย → ใช้ค่าเริ่มต้น', () => {
    expect(resolveWorkflowConfig(null)).toEqual(DEFAULT_WORKFLOW_CONFIG)
    expect(resolveWorkflowConfig('x' as never)).toEqual(DEFAULT_WORKFLOW_CONFIG)
  })

  it('คัดสถานะที่ไม่รู้จัก/ซ้ำทิ้ง · typeFlows ที่ชี้ flow ไม่มีจริงถูกตัด · defaultWorkflowId ที่ไม่มีจริงกลับเป็น deployment', () => {
    const cfg = resolveWorkflowConfig({
      enabled: true,
      workflows: [{ id: 'quick', name: 'Quick', steps: ['non_start', 'ไม่มีจริง', 'on_processing', 'on_processing', 'done'] }],
      typeFlows: { tt_design: 'quick', tt_brd: 'ไม่มี' },
      defaultWorkflowId: 'ไม่มี',
    } as never)
    expect(cfg.enabled).toBe(true)
    expect(cfg.workflows.find((w) => w.id === 'quick')?.steps).toEqual(['non_start', 'on_processing', 'done'])
    expect(cfg.typeFlows).toEqual({ tt_design: 'quick' })
    expect(cfg.defaultWorkflowId).toBe('deployment')
    // document/deployment ที่ระบบให้มา ยังอยู่เสมอ
    expect(cfg.workflows.map((w) => w.id)).toEqual(expect.arrayContaining(['document', 'deployment', 'quick']))
  })

  it('validate: flow ต้องขึ้นต้น non_start ลงท้าย done มี on_processing และไม่ซ้ำ · typeFlows/default ต้องชี้ flow ที่มี', () => {
    expect(validateWorkflowConfig(DEFAULT_WORKFLOW_CONFIG)).toEqual({ ok: true })
    const bad = (steps: string[]) =>
      validateWorkflowConfig({ ...DEFAULT_WORKFLOW_CONFIG, workflows: [{ id: 'x', name: 'X', steps: steps as never }, ...DEFAULT_WORKFLOW_CONFIG.workflows] })
    expect(bad(['on_processing', 'done']).ok).toBe(false)
    expect(bad(['non_start', 'on_processing']).ok).toBe(false)
    expect(bad(['non_start', 'done']).ok).toBe(false)
    expect(bad(['non_start', 'on_processing', 'testing_stg', 'testing_stg', 'done']).ok).toBe(false)
    expect(validateWorkflowConfig({ ...DEFAULT_WORKFLOW_CONFIG, defaultWorkflowId: 'zzz' }).ok).toBe(false)
    expect(validateWorkflowConfig({ ...DEFAULT_WORKFLOW_CONFIG, typeFlows: { tt_brd: 'zzz' } }).ok).toBe(false)
  })
})

describe('workflowIdForTaskType — ประเภทงานไหนใช้ flow ไหน', () => {
  it('Document → document · ประเภทอื่นทั้งหมด + ไม่เลือกประเภท → deployment', () => {
    expect(workflowIdForTaskType(ON, 'tt_document', TYPES)).toBe('document')
    for (const t of ['tt_brd', 'tt_design', 'tt_development', 'tt_internal_testing', 'tt_debug', 'tt_deployment']) {
      expect(workflowIdForTaskType(ON, t, TYPES)).toBe('deployment')
    }
    expect(workflowIdForTaskType(ON, null, TYPES)).toBe('deployment')
    expect(workflowIdForTaskType(ON, 'id-ที่ไม่มีแล้ว', TYPES)).toBe('deployment')
  })

  it('ตั้งค่าเองในหน้าตั้งค่า (typeFlows) ชนะกฎชื่อ Document', () => {
    const cfg: WorkflowConfig = { ...ON, typeFlows: { tt_design: 'document', tt_document: 'deployment' } }
    expect(workflowIdForTaskType(cfg, 'tt_design', TYPES)).toBe('document')
    expect(workflowIdForTaskType(cfg, 'tt_document', TYPES)).toBe('deployment')
  })
})

describe('workflowForTask — งานย่อยตามประเภทงานของตัวเอง ไม่มีก็ตามแม่ · สวิตช์ปิด = พฤติกรรมเดิมทุกงาน', () => {
  it('สวิตช์ปิด → ทุกงานใช้ flow เดิม 4 สถานะ (ไม่กระทบระบบปัจจุบัน)', () => {
    const off = DEFAULT_WORKFLOW_CONFIG
    expect(workflowForTask(off, { taskTypeId: null }, null, TYPES).steps).toEqual(['non_start', 'on_processing', 'waiting_for_test', 'done'])
    expect(workflowForTask(off, { taskTypeId: 'tt_development' }, null, TYPES).steps).toEqual(['non_start', 'on_processing', 'waiting_for_test', 'done'])
  })

  it('สวิตช์เปิด: งานย่อยมีประเภทเอง → ใช้ของตัวเอง · ไม่มี → ใช้ของงานแม่ · แม่ก็ไม่มี → deployment', () => {
    expect(workflowForTask(ON, { taskTypeId: 'tt_document' }, { taskTypeId: 'tt_development' }, TYPES).id).toBe('document')
    expect(workflowForTask(ON, { taskTypeId: null }, { taskTypeId: 'tt_document' }, TYPES).id).toBe('document')
    expect(workflowForTask(ON, { taskTypeId: null }, { taskTypeId: null }, TYPES).id).toBe('deployment')
    expect(workflowForTask(ON, { taskTypeId: null }, null, TYPES).id).toBe('deployment')
  })
})

describe('stageRank — ลำดับความคืบหน้าที่ใช้เทียบงานแม่/งานลูก', () => {
  it('Waiting for Review กับ Testing on STG อยู่ขั้นเดียวกัน · ยกเลิก = ไม่นับ · ถูกปฏิเสธ = ติดลบ', () => {
    expect(stageRank('non_start')).toBe(0)
    expect(stageRank('on_processing')).toBe(1)
    expect(stageRank('waiting_for_test')).toBe(stageRank('testing_stg'))
    expect(stageRank('ready_for_prd')).toBeGreaterThan(stageRank('testing_stg'))
    expect(stageRank('testing_prd')).toBeGreaterThan(stageRank('ready_for_prd'))
    expect(stageRank('done')).toBeGreaterThan(stageRank('testing_prd'))
    expect(stageRank('rejected')).toBeLessThan(0)
    expect(stageRank('cancelled')).toBeNull()
  })
})

describe('actionsFor — flow Deployment: ใครกดอะไรได้ในแต่ละสถานะ', () => {
  const dep = workflowForTask(ON, { taskTypeId: 'tt_development' }, null, TYPES)
  const ctx = { stgPassed: false, reviewerIsAssigner: false }

  it('Non Start: ผู้รับงานรับงาน/ปฏิเสธได้ · คนอื่นไม่ได้', () => {
    expect(names(actionsFor(dep, 'non_start', actor({ isAssignee: true }), ctx))).toEqual(['accept', 'reject'])
    expect(actionsFor(dep, 'non_start', actor({ isAssigner: true }), ctx)).toEqual([])
  })

  it('On Processing: ผู้รับงานส่งงาน → Testing on STG', () => {
    const a = actionsFor(dep, 'on_processing', actor({ isAssignee: true }), ctx)
    expect(a.find((x) => x.action === 'submit')?.to).toBe('testing_stg')
  })

  it('Testing on STG: QA (ผู้ตรวจ) กด "ผ่าน STG" (ยังอยู่ช่องเดิม) หรือ "ไม่ผ่าน" · ผู้รับงานดึงกลับได้ถ้ายังไม่ผ่าน · BA อนุมัติยังไม่ได้จนกว่า QA ผ่าน', () => {
    const qa = actionsFor(dep, 'testing_stg', actor({ isReviewer: true }), ctx)
    expect(names(qa)).toEqual(['fail', 'stg_pass'])
    expect(qa.find((x) => x.action === 'stg_pass')?.to).toBe('testing_stg')
    expect(qa.find((x) => x.action === 'fail')?.to).toBe('on_processing')
    expect(qa.find((x) => x.action === 'fail')?.requiresReason).toBe(true)
    expect(names(actionsFor(dep, 'testing_stg', actor({ isAssignee: true }), ctx))).toEqual(['recall'])
    expect(names(actionsFor(dep, 'testing_stg', actor({ isAssigner: true }), ctx))).toEqual(['fail'])
  })

  it('Testing on STG หลัง QA ผ่าน: BA (ผู้จ่ายงาน) อนุมัติ → Ready for PRD · ผู้รับงานดึงกลับไม่ได้แล้ว', () => {
    const passed = { stgPassed: true, reviewerIsAssigner: false }
    const ba = actionsFor(dep, 'testing_stg', actor({ isAssigner: true }), passed)
    expect(names(ba)).toEqual(['fail', 'stg_approve'])
    expect(ba.find((x) => x.action === 'stg_approve')?.to).toBe('ready_for_prd')
    expect(actionsFor(dep, 'testing_stg', actor({ isAssignee: true }), passed)).toEqual([])
    // QA ที่ผ่านแล้วไม่ต้องกดซ้ำ
    expect(names(actionsFor(dep, 'testing_stg', actor({ isReviewer: true }), passed))).toEqual(['fail'])
  })

  it('ผู้ตรวจเป็นคนเดียวกับผู้จ่ายงาน → ไม่ต้องกดสองชั้น อนุมัติขึ้น PRD ได้เลย', () => {
    const same = { stgPassed: false, reviewerIsAssigner: true }
    expect(names(actionsFor(dep, 'testing_stg', actor({ isAssigner: true, isReviewer: true }), same))).toEqual(['fail', 'stg_approve'])
  })

  it('Ready for PRD: ผู้รับงาน/ผู้จ่ายงาน/เจ้าของ กด "Deploy แล้ว" → Testing on PRD · ผู้ตรวจอย่างเดียวกดไม่ได้', () => {
    for (const a of [actor({ isAssignee: true }), actor({ isAssigner: true }), actor({ isOwner: true })]) {
      expect(actionsFor(dep, 'ready_for_prd', a, ctx).find((x) => x.action === 'deployed')?.to).toBe('testing_prd')
    }
    expect(actionsFor(dep, 'ready_for_prd', actor({ isReviewer: true }), ctx)).toEqual([])
  })

  it('Testing on PRD: ผู้จ่ายงานกด "ผ่าน PRD" → Done · ผู้ตรวจ/ผู้จ่ายงานกด "ไม่ผ่าน" → On Processing · ผู้ตรวจกดผ่านไม่ได้', () => {
    const ba = actionsFor(dep, 'testing_prd', actor({ isAssigner: true }), ctx)
    expect(names(ba)).toEqual(['fail', 'prd_pass'])
    expect(ba.find((x) => x.action === 'prd_pass')?.to).toBe('done')
    expect(names(actionsFor(dep, 'testing_prd', actor({ isReviewer: true }), ctx))).toEqual(['fail'])
    expect(actionsFor(dep, 'testing_prd', actor({ isAssignee: true }), ctx)).toEqual([])
  })

  it('เจ้าของ (owner) ทำได้ทุกอย่างที่ผู้เกี่ยวข้องทำได้ (bypass) · Done แล้วไม่มี action', () => {
    expect(names(actionsFor(dep, 'testing_prd', actor({ isOwner: true }), ctx))).toEqual(['fail', 'prd_pass'])
    expect(actionsFor(dep, 'done', actor({ isOwner: true }), ctx)).toEqual([])
  })
})

describe('actionsFor — flow Document: เหมือนระบบปัจจุบัน', () => {
  const doc = workflowForTask(ON, { taskTypeId: 'tt_document' }, null, TYPES)
  const ctx = { stgPassed: false, reviewerIsAssigner: false }

  it('ผู้รับงานส่งงาน → Waiting for Review · ผู้ตรวจอนุมัติ → Done หรือตีกลับ', () => {
    expect(actionsFor(doc, 'on_processing', actor({ isAssignee: true }), ctx).find((x) => x.action === 'submit')?.to).toBe('waiting_for_test')
    const rv = actionsFor(doc, 'waiting_for_test', actor({ isReviewer: true }), ctx)
    expect(names(rv)).toEqual(['approve', 'bounce'])
    expect(rv.find((x) => x.action === 'approve')?.to).toBe('done')
    expect(names(actionsFor(doc, 'waiting_for_test', actor({ isAssignee: true }), ctx))).toEqual(['recall'])
  })

  it('flow Document ไม่มี action ของ STG/PRD เลย', () => {
    const all = (['non_start', 'on_processing', 'waiting_for_test', 'done'] as const).flatMap((s) =>
      actionsFor(doc, s, actor({ isOwner: true, isAssignee: true, isAssigner: true, isReviewer: true }), ctx).map((a) => a.action),
    )
    expect(all.some((a) => ['stg_pass', 'stg_approve', 'deployed', 'prd_pass'].includes(a))).toBe(false)
  })
})

describe('parentGate — แม่ห้ามล้ำหน้าลูก (flow Deployment) / กติกาเดิม (flow Document)', () => {
  const dep = workflowForTask(ON, { taskTypeId: 'tt_development' }, null, TYPES)
  const doc = workflowForTask(ON, { taskTypeId: 'tt_document' }, null, TYPES)
  const kids = (...s: string[]) => s.map((status) => ({ status })) as { status: never }[]

  it('Deployment: ส่งแม่เข้า Testing on STG ได้เมื่อลูกทุกชิ้นอย่างน้อยอยู่ Testing on STG (หรือ Waiting for Review) หรือยกเลิก', () => {
    expect(parentGate(dep, 'testing_stg', kids('testing_stg', 'done', 'cancelled'))).toEqual({ ok: true })
    expect(parentGate(dep, 'testing_stg', kids('waiting_for_test'))).toEqual({ ok: true })
    expect(parentGate(dep, 'testing_stg', kids('on_processing', 'testing_stg'))).toEqual({ ok: false, blocked: 1 })
    expect(parentGate(dep, 'testing_stg', kids('non_start', 'on_processing'))).toEqual({ ok: false, blocked: 2 })
  })

  it('Deployment: ขั้นถัดไปต้องรอลูกให้ถึงขั้นเดียวกัน (Ready for PRD → Testing on PRD → Done)', () => {
    expect(parentGate(dep, 'ready_for_prd', kids('ready_for_prd', 'testing_prd', 'done'))).toEqual({ ok: true })
    expect(parentGate(dep, 'ready_for_prd', kids('testing_stg'))).toEqual({ ok: false, blocked: 1 })
    expect(parentGate(dep, 'testing_prd', kids('ready_for_prd'))).toEqual({ ok: false, blocked: 1 })
    expect(parentGate(dep, 'done', kids('done', 'cancelled'))).toEqual({ ok: true })
    expect(parentGate(dep, 'done', kids('testing_prd'))).toEqual({ ok: false, blocked: 1 })
  })

  it('ลูกที่ถูกปฏิเสธบล็อกเสมอ · ไม่มีลูก = ผ่าน · ขั้นต้นๆ (accept/On Processing) ไม่ถูกเช็ค', () => {
    expect(parentGate(dep, 'testing_stg', kids('rejected'))).toEqual({ ok: false, blocked: 1 })
    expect(parentGate(dep, 'done', [])).toEqual({ ok: true })
    expect(parentGate(dep, 'on_processing', kids('non_start'))).toEqual({ ok: true })
  })

  it('Document: ใช้กติกาเดิม — ส่งตรวจ/ปิดงานแม่ได้เมื่อลูกทุกชิ้น Done หรือยกเลิก', () => {
    expect(parentGate(doc, 'waiting_for_test', kids('done', 'cancelled'))).toEqual({ ok: true })
    expect(parentGate(doc, 'waiting_for_test', kids('waiting_for_test'))).toEqual({ ok: false, blocked: 1 })
    expect(parentGate(doc, 'done', kids('on_processing', 'done'))).toEqual({ ok: false, blocked: 1 })
  })

  it('ลูกเป็น flow Document ใต้แม่ Deployment: ขั้น Ready for PRD ขึ้นไปต้องรอลูก Done', () => {
    expect(parentGate(dep, 'testing_stg', kids('waiting_for_test'))).toEqual({ ok: true })
    expect(parentGate(dep, 'ready_for_prd', kids('waiting_for_test'))).toEqual({ ok: false, blocked: 1 })
  })
})
