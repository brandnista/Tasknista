import { CheckCircle2, ClipboardCheck, RotateCcw, Rocket, Send } from 'lucide-react'
import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { TASK_STATUS_BADGE, TASK_STATUS_LABEL, type TaskStatus } from '../lib/task-status'
import { useDialog } from './Dialog'
import { useToast } from './Toast'

/** ข้อมูล flow ของงานที่ API ส่งมาใน GET /api/tasks/:id/detail (บล็อก workflow) */
export interface TaskWorkflowInfo {
  enabled: boolean
  flowId: string
  flowName: string
  steps: TaskStatus[]
  actions: { action: WorkflowActionId; to: TaskStatus; requiresReason?: boolean }[]
  testRound: number
  stgPassedAt: string | number | null
  stgPassedByName: string | null
}
export type WorkflowActionId = 'accept' | 'reject' | 'submit' | 'recall' | 'stg_pass' | 'stg_approve' | 'deployed' | 'prd_pass' | 'fail' | 'approve' | 'bounce'

/** ปุ่มเดี่ยว (ไม่ต้องเลือกผล) */
const SIMPLE_ACTIONS: Partial<Record<WorkflowActionId, { label: (to: TaskStatus) => string; icon: typeof Send; primary: boolean }>> = {
  submit: { label: (to) => `ส่งเข้า ${TASK_STATUS_LABEL[to]}`, icon: Send, primary: true },
  recall: { label: () => 'ดึงงานกลับมาแก้ไข', icon: RotateCcw, primary: false },
  deployed: { label: () => 'Deploy แล้ว (ขึ้น PRD เรียบร้อย)', icon: Rocket, primary: true },
}
/** ตัวเลือกใน "ผลการทดสอบ" */
const RESULT_LABEL: Partial<Record<WorkflowActionId, string>> = {
  stg_pass: 'ผ่าน — ทดสอบบน STG ผ่านแล้ว',
  stg_approve: 'อนุมัติ — ให้ขึ้น PRD ได้ (Ready for PRD)',
  prd_pass: 'ผ่าน — ทดสอบบน PRD ผ่าน ปิดงาน',
  fail: 'ไม่ผ่าน — ส่งกลับไปแก้ไข',
}
const RESULT_ORDER: WorkflowActionId[] = ['stg_pass', 'stg_approve', 'prd_pass', 'fail']

const fmtWhen = (v: string | number) => new Date(v).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** ข้อความบอกสถานะ "ตอนนี้งานอยู่ตรงไหน / รอใคร" */
function stageMessage(status: TaskStatus, wf: TaskWorkflowInfo): string | null {
  switch (status) {
    case 'on_processing':
      return null
    case 'waiting_for_test':
    case 'testing_stg':
      return wf.stgPassedAt
        ? `${wf.stgPassedByName ?? 'ผู้ทดสอบ'} ทดสอบผ่านบน STG แล้ว (${fmtWhen(wf.stgPassedAt)}) — รอผู้จ่ายงานอนุมัติให้ขึ้น PRD`
        : 'ส่งมาทดสอบบน STG แล้ว — รอผู้ตรวจ (QA) ทดสอบ'
    case 'ready_for_prd':
      return 'อนุมัติให้ขึ้น PRD แล้ว — รอ Deploy'
    case 'testing_prd':
      return 'Deploy ขึ้น PRD แล้ว — รอทดสอบผลบน PRD'
    case 'done':
      return 'งานเสร็จสมบูรณ์'
    default:
      return null
  }
}

/**
 * Pronista §Task status workflow phase 3 (2026-10-02) — แผงปุ่ม + กล่อง "ผลการทดสอบ" ของงาน flow Deployment ในหน้ารายละเอียดงาน
 * ปุ่มทั้งหมดมาจาก workflow.actions ที่ server คำนวณให้ตามบทบาทของผู้ดู (Dev/BA/QA/owner) — หน้านี้ไม่ตัดสินสิทธิ์เอง
 */
export function TaskWorkflowPanel({
  taskId,
  status,
  workflow,
  onChanged,
  onSubmitted,
}: {
  taskId: string
  status: TaskStatus
  workflow: TaskWorkflowInfo
  onChanged: () => Promise<void> | void
  /** เรียกหลังกด "ส่ง" สำเร็จ (ให้หน้าเด้งกลับตามพฤติกรรมเดิมของปุ่มส่งงาน) */
  onSubmitted?: () => void
}) {
  const { alertDialog } = useDialog()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<WorkflowActionId | ''>('')
  const [reason, setReason] = useState('')

  const resultActions = RESULT_ORDER.filter((a) => workflow.actions.some((x) => x.action === a))
  const simpleActions = workflow.actions.filter((a) => SIMPLE_ACTIONS[a.action])
  const chosen = workflow.actions.find((a) => a.action === result)
  const effective: TaskStatus = status === 'waiting_for_test' && workflow.steps.includes('testing_stg') ? 'testing_stg' : status
  const message = stageMessage(status, workflow)

  const run = async (action: WorkflowActionId, withReason?: string) => {
    if (busy) return
    setBusy(true)
    try {
      await api.post(`/api/tasks/${taskId}/workflow-action`, { action, ...(withReason ? { reason: withReason } : {}) })
      setResult('')
      setReason('')
      await onChanged()
      toast('บันทึกสำเร็จ')
      if (action === 'submit') onSubmitted?.()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง' })
    } finally {
      setBusy(false)
    }
  }

  const submitResult = () => {
    if (!chosen) return
    if (chosen.requiresReason && !reason.trim()) {
      void alertDialog({ title: 'กรุณาระบุเหตุผลที่ไม่ผ่าน', message: 'ผู้รับงานจะเห็นเหตุผลนี้เพื่อนำไปแก้ไข' })
      return
    }
    void run(chosen.action, chosen.requiresReason ? reason.trim() : undefined)
  }

  return (
    <div className="space-y-3" data-testid="task-workflow-panel">
      {/* เส้นทางของ flow — ขั้นปัจจุบันเน้นสี */}
      <ol className="flex flex-wrap items-center gap-1 text-[10px]" aria-label="ขั้นตอนของงาน">
        {workflow.steps.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            <span className={`px-1.5 py-0.5 rounded-full font-medium ${s === effective ? TASK_STATUS_BADGE[s] : 'bg-hover text-muted'}`} aria-current={s === effective ? 'step' : undefined}>
              {TASK_STATUS_LABEL[s]}
            </span>
            {i < workflow.steps.length - 1 && <span className="text-muted" aria-hidden>›</span>}
          </li>
        ))}
      </ol>

      {workflow.testRound > 0 && <div className="text-[11px] text-muted">รอบทดสอบที่ {workflow.testRound}</div>}
      {message && <div className="bg-info-50 text-info-700 text-xs rounded-lg px-3 py-2">{message}</div>}

      {simpleActions.map((a) => {
        const def = SIMPLE_ACTIONS[a.action]!
        const Icon = def.icon
        return (
          <button
            key={a.action}
            type="button"
            disabled={busy}
            onClick={() => void run(a.action)}
            className={
              def.primary
                ? 'w-full flex items-center justify-center gap-1.5 text-sm bg-success-600 hover:bg-success-700 text-white px-3 py-2 rounded-lg font-medium disabled:opacity-40'
                : 'w-full flex items-center justify-center gap-1.5 text-sm border border-border-subtle text-dim hover:bg-hover px-3 py-2 rounded-lg font-medium disabled:opacity-40'
            }
          >
            <Icon className="w-4 h-4" /> {def.label(a.to)}
          </button>
        )
      })}

      {resultActions.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-hover/60 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <ClipboardCheck className="w-4 h-4 text-brand-600" /> ผลการทดสอบ
          </div>
          <select
            value={result}
            onChange={(e) => setResult(e.target.value as WorkflowActionId | '')}
            aria-label="ผลการทดสอบ"
            className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-white focus:outline-hidden focus:ring-2 focus:ring-brand-500/25"
          >
            <option value="">— เลือกผลการทดสอบ —</option>
            {resultActions.map((a) => <option key={a} value={a}>{RESULT_LABEL[a]}</option>)}
          </select>
          {chosen?.requiresReason && (
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="ระบุเหตุผลที่ไม่ผ่าน (จำเป็น) เช่น ขั้นตอนที่พัง, ผลที่คาดหวัง"
              className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-white focus:outline-hidden focus:ring-2 focus:ring-brand-500/25"
            />
          )}
          <button
            type="button"
            disabled={!chosen || busy}
            onClick={submitResult}
            className={`w-full flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed text-white ${chosen?.action === 'fail' ? 'bg-danger-600 hover:bg-danger-700' : 'bg-success-600 hover:bg-success-700'}`}
          >
            <CheckCircle2 className="w-4 h-4" /> {busy ? 'กำลังบันทึก…' : 'ยืนยันผลการทดสอบ'}
          </button>
        </div>
      )}
    </div>
  )
}
