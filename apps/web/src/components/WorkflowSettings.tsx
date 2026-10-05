/**
 * ตั้งค่า → สถานะงานตามประเภทงาน (Pronista §Task status workflow phase 4, 2026-10-02)
 * owner เปิด/ปิดสวิตช์ flow ใหม่ · แก้ขั้นของแต่ละ flow (เลือกจากแคตตาล็อกสถานะ — สถานะแต่ละตัวมีกติกา/ปุ่ม/แจ้งเตือนผูกอยู่ในระบบ เพิ่มชื่อสถานะใหม่เองไม่ได้)
 * · เลือกว่าประเภทงานไหนใช้ flow ไหน · บันทึกทั้งชุดทีเดียว (PUT /api/admin/workflow-config)
 */
import { WORKFLOW_STEP_IDS, type TaskType, type WorkflowConfig, type WorkflowDef, type WorkflowStep } from '@seedoffice/core'
import { Check, GitBranch, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { TASK_STATUS_BADGE, TASK_STATUS_LABEL } from '../lib/task-status'
import { useLoad } from '../lib/useLoad'
import { refreshWorkflowConfig } from '../lib/workflow-config'
import { useDialog } from './Dialog'
import { useToast } from './Toast'

const LOCKED_STEPS: WorkflowStep[] = ['non_start', 'on_processing', 'done']
const BUILT_IN_IDS = ['document', 'deployment']
const DEPLOYMENT_STEPS: WorkflowStep[] = ['ready_for_stg', 'testing_stg', 'ready_for_prd', 'testing_prd']
const randomFlowId = () => `wf_${Math.random().toString(36).slice(2, 8)}`

/** เรียงตามแคตตาล็อกเสมอ */
const sortSteps = (steps: WorkflowStep[]): WorkflowStep[] => WORKFLOW_STEP_IDS.filter((s) => steps.includes(s))

export function WorkflowSettings() {
  const toast = useToast()
  const { confirmDialog, alertDialog } = useDialog()
  const { data, reload } = useLoad<{ config: WorkflowConfig }>(() => api.get('/api/admin/workflow-config'))
  const { data: typesData } = useLoad<{ taskTypes: TaskType[] }>(() => api.get('/api/admin/task-types'))
  const [cfg, setCfg] = useState<WorkflowConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) setCfg(data.config)
  }, [data])

  if (!cfg) return null
  const taskTypes = typesData?.taskTypes ?? []

  const change = (next: WorkflowConfig) => {
    setCfg(next)
    setSaved(false)
    setError('')
  }
  const updateFlow = (id: string, patch: Partial<WorkflowDef>) =>
    change({ ...cfg, workflows: cfg.workflows.map((w) => (w.id === id ? { ...w, ...patch } : w)) })

  const toggleStep = (flow: WorkflowDef, step: WorkflowStep) => {
    if (LOCKED_STEPS.includes(step)) return
    const has = flow.steps.includes(step)
    let steps = has ? flow.steps.filter((s) => s !== step) : [...flow.steps, step]
    // ชนิด flow: Document-like (Waiting for Review) กับ Deployment-like (Testing on STG...) ใช้ปนกันไม่ได้
    if (!has && step === 'waiting_for_test') steps = steps.filter((s) => !DEPLOYMENT_STEPS.includes(s))
    if (!has && DEPLOYMENT_STEPS.includes(step)) steps = steps.filter((s) => s !== 'waiting_for_test')
    // Ready for STG / Ready for PRD / Testing on PRD ต้องมี Testing on STG
    if (!has && (step === 'ready_for_stg' || step === 'ready_for_prd' || step === 'testing_prd') && !steps.includes('testing_stg')) steps = [...steps, 'testing_stg']
    if (has && step === 'testing_stg') steps = steps.filter((s) => s !== 'ready_for_stg' && s !== 'ready_for_prd' && s !== 'testing_prd')
    updateFlow(flow.id, { steps: sortSteps(steps) })
  }
  const addFlow = () =>
    change({ ...cfg, workflows: [...cfg.workflows, { id: randomFlowId(), name: 'Flow ใหม่', steps: ['non_start', 'on_processing', 'waiting_for_test', 'done'] }] })
  const removeFlow = (id: string) => {
    const typeFlows = Object.fromEntries(Object.entries(cfg.typeFlows).filter(([, f]) => f !== id))
    change({ ...cfg, workflows: cfg.workflows.filter((w) => w.id !== id), typeFlows, defaultWorkflowId: cfg.defaultWorkflowId === id ? 'deployment' : cfg.defaultWorkflowId })
  }
  const setTypeFlow = (typeId: string, flowId: string) => {
    const typeFlows = { ...cfg.typeFlows }
    if (flowId) typeFlows[typeId] = flowId
    else delete typeFlows[typeId]
    change({ ...cfg, typeFlows })
  }

  const save = async () => {
    const turningOn = cfg.enabled && !data?.config.enabled
    if (turningOn) {
      const ok = await confirmDialog({
        title: 'เปิดใช้ flow สถานะงานแบบใหม่?',
        message: 'งานที่ค้างอยู่ที่ Waiting for Review และใช้ flow Deployment จะถูกย้ายไป Ready for STG (รอผู้ทดสอบกดรับ) อัตโนมัติ · การเปลี่ยนสถานะของงานกลุ่มนี้ต้องกดปุ่มในหน้ารายละเอียดงาน (ลากบอร์ดข้ามขั้นไม่ได้แล้ว)',
        confirmLabel: 'เปิดใช้งาน',
      })
      if (!ok) return
    }
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await api.put<{ config: WorkflowConfig; migrated: number }>('/api/admin/workflow-config', {
        config: { ...cfg, workflows: cfg.workflows.map((w) => ({ ...w, name: w.name.trim() })) },
      })
      setSaved(true)
      toast(turningOn && res.migrated > 0 ? `บันทึกสำเร็จ — ย้ายงาน ${res.migrated} ชิ้นไป Ready for STG` : 'บันทึกสำเร็จ')
      await reload()
      await refreshWorkflowConfig()
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ'
      setError(message)
      setSaving(false)
      if (e instanceof ApiError && e.status === 409) await alertDialog({ title: 'บันทึกไม่ได้', message })
    } finally {
      setSaving(false)
    }
  }

  const flowName = (id: string) => cfg.workflows.find((w) => w.id === id)?.name ?? id

  return (
    <div className="bg-white rounded-lg shadow-xs overflow-hidden" data-testid="workflow-settings">
      <div className="p-5 border-b border-border-subtle flex items-center gap-2 flex-wrap">
        <GitBranch className="w-4 h-4 text-muted" />
        <div className="font-semibold text-ink">สถานะงานตามประเภทงาน (Workflow)</div>
        <span className="text-xs text-muted">กำหนดว่างานแต่ละประเภทเดินผ่านสถานะอะไรบ้าง ตั้งแต่รับงานจนปิดงาน</span>
      </div>

      <div className="p-5 space-y-5">
        {/* สวิตช์ */}
        <label className="flex items-start gap-3 rounded-lg border border-border-subtle p-3 cursor-pointer">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => change({ ...cfg, enabled: e.target.checked })} className="mt-1 h-4 w-4" />
          <span className="text-sm">
            <span className="font-medium text-ink">เปิดใช้ flow สถานะงานแบบใหม่</span>
            <span className="block text-xs text-muted mt-0.5">
              ปิดอยู่ = ทุกงานใช้ Non Start → On Processing → Waiting for Review → Done แบบเดิม · เปิดแล้ว งานประเภทที่ตั้งเป็น Deployment จะมีขั้น Ready for STG / Testing on STG / Ready for PRD / Testing on PRD และต้องกดปุ่มผลการทดสอบในหน้ารายละเอียดงาน
            </span>
          </span>
        </label>

        {/* flows */}
        <div className="space-y-3">
          <div className="text-sm font-semibold text-ink">Flow ที่มี</div>
          {cfg.workflows.map((w) => {
            const builtIn = BUILT_IN_IDS.includes(w.id)
            return (
              <div key={w.id} className="border border-border-subtle rounded-lg p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <input
                    value={w.name}
                    onChange={(e) => updateFlow(w.id, { name: e.target.value })}
                    maxLength={60}
                    aria-label="ชื่อ flow"
                    className="flex-1 text-sm font-medium bg-white border border-border rounded-lg px-3 py-1.5 focus:outline-hidden focus:border-brand-400"
                  />
                  {builtIn ? (
                    <span className="text-[11px] text-muted shrink-0">ของระบบ</span>
                  ) : (
                    <button type="button" onClick={() => removeFlow(w.id)} title="ลบ flow นี้" className="text-muted hover:text-danger-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {WORKFLOW_STEP_IDS.map((s) => {
                    const on = w.steps.includes(s)
                    const locked = LOCKED_STEPS.includes(s)
                    return (
                      <label
                        key={s}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? `${TASK_STATUS_BADGE[s]} border-transparent` : 'border-border-subtle text-muted bg-white'} ${locked ? 'opacity-80' : 'cursor-pointer hover:border-brand-300'}`}
                      >
                        <input type="checkbox" checked={on} disabled={locked} onChange={() => toggleStep(w, s)} className="h-3 w-3" />
                        {TASK_STATUS_LABEL[s]}
                      </label>
                    )
                  })}
                </div>
                <div className="text-[11px] text-muted">
                  ลำดับ: {w.steps.map((s) => TASK_STATUS_LABEL[s]).join(' → ')}
                  {w.steps.includes('testing_stg') ? ' · แบบ Deployment (มีปุ่มผลการทดสอบ)' : ' · แบบ Document (ส่งงาน/อนุมัติแบบเดิม)'}
                </div>
              </div>
            )
          })}
          <button type="button" onClick={addFlow} className="text-sm text-brand-700 hover:text-brand-800">+ เพิ่ม flow</button>
          <p className="text-[11px] text-muted">Non Start, On Processing และ Done ต้องมีเสมอ · Waiting for Review ใช้คู่กับ Testing on STG ไม่ได้ · Ready for STG / Ready for PRD / Testing on PRD ต้องมี Testing on STG</p>
        </div>

        {/* ประเภทงาน → flow */}
        <div className="space-y-2">
          <div className="text-sm font-semibold text-ink">ประเภทงาน → Flow</div>
          <div className="border border-border-subtle rounded-lg divide-y divide-divider">
            {taskTypes.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2">
                <span className="flex-1 text-sm text-body truncate">{t.name}</span>
                <select
                  value={cfg.typeFlows[t.id] ?? ''}
                  onChange={(e) => setTypeFlow(t.id, e.target.value)}
                  aria-label={`flow ของประเภท ${t.name}`}
                  className="text-sm border border-border rounded-lg px-2.5 py-1.5 bg-white max-w-[55%]"
                >
                  <option value="">{t.name.trim().toLowerCase() === 'document' ? 'อัตโนมัติ (Document)' : `ตามค่าเริ่มต้น (${flowName(cfg.defaultWorkflowId)})`}</option>
                  {cfg.workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
            ))}
            <div className="flex items-center gap-3 px-3 py-2 bg-hover/60">
              <span className="flex-1 text-sm text-body">ค่าเริ่มต้น (งานที่ไม่ระบุประเภท / ประเภทที่ไม่ได้ตั้งไว้)</span>
              <select
                value={cfg.defaultWorkflowId}
                onChange={(e) => change({ ...cfg, defaultWorkflowId: e.target.value })}
                aria-label="flow ค่าเริ่มต้น"
                className="text-sm border border-border rounded-lg px-2.5 py-1.5 bg-white max-w-[55%]"
              >
                {cfg.workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-muted">งานย่อยที่ไม่ได้เลือกประเภทเองจะใช้ flow ตามงานแม่ · ถ้ามีงานกำลังอยู่ขั้นทดสอบ/PRD ของ flow เดิม จะเปลี่ยน flow ของประเภทนั้นไม่ได้จนกว่างานจะเดินต่อ</p>
        </div>

        {error && <div className="text-xs text-danger-600">{error}</div>}

        <div className="flex items-center gap-3 pt-1">
          <button onClick={() => void save()} disabled={saving} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
            {saving ? 'กำลังบันทึก…' : 'บันทึก Workflow'}
          </button>
          {saved && <span className="text-xs text-success-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> บันทึกแล้ว</span>}
        </div>
      </div>
    </div>
  )
}
