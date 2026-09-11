import { formatHMS, minutesToHoursLabel, resolveLabels, resolveTaskTypes, suggestEstimateMinutes, type Label, type TaskType, type WeeklyMinutes } from '@seedoffice/core'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  FileText,
  GitBranch,
  Link2,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Avatar } from '../components/Avatar'
import { DateInputTH } from '../components/DateInputTH'
import { useDialog } from '../components/Dialog'
import { LabelChips } from '../components/LabelChips'
import { STATUS_SWATCH } from '../lib/project-ui'
import { TaskPickerModal, type PickableTask } from '../components/TaskPickerModal'
import { TemplatePickerModal } from '../components/doc-templates/TemplatePickerModal'
import { useToast } from '../components/Toast'

// Pronista §Back to Basic — 7 ประเภทเอกสารที่ต้องสร้าง/อัปโหลด/ผูกได้ตรงจากหน้ารายละเอียด Task (เหมือน Docs.tsx)
const TASK_DOC_TYPES = ['MOM', 'BRD', 'SOW', 'SRS', 'PEP', 'UIR', 'CR'] as const
type TaskDocType = (typeof TASK_DOC_TYPES)[number]
interface ProjectDocOpt { id: string; title: string; docType: TaskDocType | 'API' | null }
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { TASK_STATUS_BADGE, TASK_STATUS_LABEL, TASK_STATUS_ORDER, type TaskStatus } from '../lib/task-status'
import { useTimer } from '../lib/timer'
import { useLoad } from '../lib/useLoad'
import { avatarColor } from './ProjectDetail'

interface TimeRow {
  id: string
  userId: string
  userName: string
  workDate: string
  minutes: number
  note: string | null
  source: 'timer' | 'manual'
  editCount: number
}

const bkkToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)

/** Pronista §Task Detail redesign — จับเวลาวันนี้ (ย้ายมาจาก TaskDrawer.tsx เดิมทั้งดุ้น ไม่เปลี่ยน logic) ใช้ร่วมทั้งฝั่งคนถูก Assign (เด่นบน sidebar) และฝั่งคนจ่ายงาน (ย่อไว้เทียบกับประเมิน) */
function TimeSection({
  taskId,
  hasProject,
  rows,
  reload,
  canManage,
  assigneeId,
  assigneeName,
}: {
  taskId: string
  hasProject: boolean
  rows: TimeRow[]
  reload: () => Promise<unknown>
  canManage: boolean
  assigneeId: string | null
  assigneeName: string | null
}) {
  const { user } = useAuth()
  const timer = useTimer()
  const { confirmDialog } = useDialog()
  const [manualOpen, setManualOpen] = useState(false)
  const [mForm, setMForm] = useState({ date: bkkToday(), hours: '', note: '' })
  const [forAssignee, setForAssignee] = useState(false)
  const [mError, setMError] = useState('')
  const [editRow, setEditRow] = useState<TimeRow | null>(null)

  const isRunningHere = timer.active?.taskId === taskId
  const taskSeconds = rows.filter((r) => r.userId === user?.id && r.workDate === bkkToday()).reduce((s, r) => s + r.minutes * 60, 0)
  // Pronista §Retroactive Logging — owner/หัวหน้าโปรเจกต์คีย์เวลาแทนผู้รับผิดชอบได้ (แจ้งปากเปล่าไปแล้ว มาคีย์ log ย้อนหลัง)
  const canLogForAssignee = canManage && !!assigneeId && assigneeId !== user?.id

  const addManual = async () => {
    try {
      setMError('')
      const minutes = Math.round(Number(mForm.hours) * 60)
      await api.post(`/api/tasks/${taskId}/time`, {
        workDate: mForm.date,
        minutes,
        note: mForm.note || undefined,
        userId: canLogForAssignee && forAssignee ? assigneeId! : undefined,
      })
      setManualOpen(false)
      setMForm({ date: bkkToday(), hours: '', note: '' })
      setForAssignee(false)
      await reload()
      await timer.refresh()
    } catch (e) {
      setMError(e instanceof Error ? e.message : 'ผิดพลาด')
    }
  }
  const saveEdit = async () => {
    if (!editRow) return
    await api.patch(`/api/time/${editRow.id}`, { minutes: editRow.minutes, note: editRow.note })
    setEditRow(null)
    await reload()
    await timer.refresh()
  }
  const removeRow = async (r: TimeRow) => {
    const okDelete = await confirmDialog({
      title: 'ลบเวลาที่ลงไว้?',
      message: `${minutesToHoursLabel(r.minutes)} ชม. วันที่ ${r.workDate} จะถูกลบ (เก็บร่องรอยใน audit log)`,
      confirmLabel: 'ลบ',
      danger: true,
    })
    if (!okDelete) return
    await api.delete(`/api/time/${r.id}`)
    await reload()
    await timer.refresh()
  }

  if (!hasProject) {
    return <div className="bg-hover rounded-xl p-3 text-sm text-muted">ต้องผูกโปรเจกต์ก่อนถึงจะลงเวลาได้ (งานนี้ยังอยู่ใน Backlog)</div>
  }

  return (
    <div>
      <div className="bg-brand-50 rounded-xl p-3 flex items-center gap-3">
        <div className="flex-1">
          <div className="text-[11px] text-brand-700">ลงเวลาที่งานนี้ (วันนี้)</div>
          <div className="text-2xl font-bold tabular-nums text-ink">{formatHMS(taskSeconds + (isRunningHere ? timer.runningSeconds : 0))}</div>
        </div>
        {isRunningHere ? (
          <button onClick={() => void timer.stop().then(() => reload())} className="bg-danger-500 text-white px-3 py-2 rounded-lg text-sm flex items-center gap-1">
            <Pause className="w-4 h-4" /> หยุด
          </button>
        ) : (
          <button
            onClick={() =>
              void timer.start(taskId).then((res) => {
                // Pronista §Timer fix — start() เดิม catch error ไว้เงียบๆ แล้วคืน {error} แต่ไม่มีใครอ่านค่านี้ ปุ่มเลยดู "กดไม่ติด" ไม่มีข้อความอะไรเลยตอน no_project/no_rate (cap_reached มี banner อยู่แล้วจาก capMessage)
                if (res.error && res.error !== 'cap_reached') void confirmDialog({ title: 'เริ่มจับเวลาไม่สำเร็จ', message: res.message ?? 'ลองใหม่อีกครั้ง' })
                return reload()
              })
            }
            disabled={timer.capReached}
            title={timer.capReached ? 'ครบเพดานชั่วโมงวันนี้แล้ว' : 'เริ่มจับเวลา'}
            className="bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm flex items-center gap-1"
          >
            <Play className="w-4 h-4" /> จับเวลา
          </button>
        )}
        <button onClick={() => setManualOpen((v) => !v)} className="shadow-xs bg-white px-3 py-2 rounded-lg text-sm">+ manual</button>
      </div>

      {manualOpen && (
        <div className="mt-2 p-3 bg-hover rounded-xl space-y-2">
          <div className="flex gap-2">
            <DateInputTH value={mForm.date} onChange={(v) => setMForm({ ...mForm, date: v })} className="text-sm bg-white shadow-xs rounded-lg px-2.5 py-1.5" />
            <input type="number" step="0.25" min="0" placeholder="ชม." value={mForm.hours} onChange={(e) => setMForm({ ...mForm, hours: e.target.value })} className="w-20 text-sm bg-white shadow-xs rounded-lg px-2.5 py-1.5" />
            <input placeholder="โน้ต (ทำอะไร)" value={mForm.note} onChange={(e) => setMForm({ ...mForm, note: e.target.value })} className="flex-1 min-w-0 text-sm bg-white shadow-xs rounded-lg px-2.5 py-1.5" />
          </div>
          {canLogForAssignee && (
            <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
              <input type="checkbox" checked={forAssignee} onChange={(e) => setForAssignee(e.target.checked)} />
              คีย์แทน {assigneeName} (Log ย้อนหลัง — เช่น แจ้งปากเปล่าแล้วแก้เสร็จจริง)
            </label>
          )}
          {mError && <div className="text-xs text-danger-600">{mError}</div>}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted">manual ถูกบันทึก log และนับเข้า manual% เสมอ</span>
            <button onClick={() => void addManual()} disabled={!mForm.hours} className="text-sm bg-brand-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-40">บันทึกเวลา</button>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 space-y-1">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-xs py-1">
              {editRow?.id === r.id ? (
                <>
                  <span className="text-dim w-20">{r.workDate.slice(5)}</span>
                  <input type="number" value={editRow.minutes} onChange={(e) => setEditRow({ ...editRow, minutes: Number(e.target.value) })} className="w-16 bg-white shadow-xs rounded px-1.5 py-1" title="นาที" />
                  <span className="text-muted">นาที</span>
                  <button onClick={() => void saveEdit()} className="text-brand-600 font-medium">บันทึก</button>
                  <button onClick={() => setEditRow(null)} className="text-muted">ยกเลิก</button>
                </>
              ) : (
                <>
                  <span className="text-dim w-20 shrink-0">{r.workDate.slice(5)}</span>
                  <span className="tabular-nums font-medium text-body">{minutesToHoursLabel(r.minutes)} ชม.</span>
                  <span className={`px-1.5 rounded text-[10px] ${r.source === 'manual' ? 'bg-warning-50 text-warning-600' : 'bg-divider text-dim'}`}>{r.source}</span>
                  <span className="text-muted truncate flex-1">{r.userName}{r.note ? ` · ${r.note}` : ''}{r.editCount > 0 ? ` · แก้ ${r.editCount} ครั้ง` : ''}</span>
                  {(r.userId === user?.id || user?.role === 'owner') && (
                    <span className="shrink-0 flex gap-1">
                      <button onClick={() => setEditRow(r)} title="แก้เวลา" className="text-border hover:text-soft"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => void removeRow(r)} title="ลบเวลา" className="text-border hover:text-danger-600"><Trash2 className="w-3.5 h-3.5" /></button>
                    </span>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface Detail {
  id: string
  projectId: string | null
  // Pronista §Workspace/Task Jira-alignment (2.7, 2026-09-04) — Manhour/วันของหมวด assignee ปัจจุบัน ใช้คำนวณ "ประเมิน ชม." แนะนำตอนเปลี่ยนวันที่
  weeklyMinutes: WeeklyMinutes
  title: string
  // Pronista §Back to Basic (ต่อยอด) — "รายละเอียดของผู้จ่ายงาน" แก้ได้เฉพาะผู้จ่ายงาน
  description: string | null
  // Pronista §Back to Basic (ต่อยอด) — "รายละเอียดของผู้รับงาน" คนละฟิลด์กับ description แก้ได้เฉพาะ assignee ก่อนกดส่งงาน
  assigneeNotes: string | null
  status: TaskStatus
  kind: 'task' | 'defect' | 'cr' | 'backlog'
  defectStatus: 'reported' | 'fixing' | 'waiting_verify' | 'closed' | null
  priority: 'low' | 'normal' | 'high'
  // Pronista §Workspace — แท็กสี (อ้าง id ใน company_config.labels) เลือกได้หลายอัน
  labelIds: string[] | null
  // Pronista §System Requirements Update — ประเภทงาน/ตัวเลือกย่อย (อ้าง id ใน company_config.taskTypes) ใช้กับงานทุก kind
  taskType: string | null
  subTaskType: string | null
  assigneeId: string | null
  assigneeName: string | null
  assigneeAvatarUrl: string | null
  // Pronista §Workspace/Task Jira-alignment (2026-09-04) — "Reporter" สไตล์ Jira: ผู้กด "จ่ายงาน" ล่าสุด (assignedBy)
  assignedBy: string | null
  assignedByName: string | null
  assignedByAvatarUrl: string | null
  createdByName: string | null
  createdByAvatarUrl: string | null
  // Pronista §Back to Basic (ต่อยอด) — เกตจ่ายงาน: null = ยังไม่จ่าย (ยังไม่โผล่ในหน้า "งานของฉัน" ของ assignee)
  dispatchedAt: number | null
  createdBy: string
  myRole: 'owner' | 'editor' | 'viewer'
  sprintActive: boolean
  // Pronista §Workspace/Task Jira-alignment (2026-09-09) — Sprint ที่งานนี้สังกัดอยู่ (แบบ Jira: โชว์ชื่อ + ลิงก์กลับไปบอร์ด) — null = ยังไม่ได้ลากเข้า Sprint ไหน
  sprint: { id: string; name: string | null; status: 'planned' | 'active' | 'completed'; projectId: string | null; workspaceId: string | null } | null
  estimateMinutes: number | null
  costWorkMinutesPerDay: number | null
  startDate: string | null
  dueDate: string | null
  groupName: string | null
  projectName: string | null
  code: string | null
  srsRefCode: string | null
  srsSourceCode: string | null
  srsDocId: string | null
  originDocType: 'MOM' | 'BRD' | 'SOW' | 'SRS' | 'PEP' | 'UIR' | null
  originCode: string | null
  originRefCode: string | null
  originDocId: string | null
  parent: { id: string; title: string; code: string | null } | null
  // Pronista §Epic Layer — Epic ที่ task/subtask นี้สังกัด (null = ไม่ได้มาจากเอกสารที่มี Epic)
  epic: { id: string; title: string; code: string | null } | null
  // Pronista §Task Detail redesign — งานย่อยพี่น้องใน Task พ่อเดียวกัน ใช้ทำ progress pill
  siblings: { id: string; code: string | null; title: string; status: TaskStatus }[]
  subtasks: {
    id: string
    title: string
    code: string | null
    status: TaskStatus
    priority: 'low' | 'normal' | 'high'
    assigneeName: string | null
    estimateMinutes: number | null
    originCode: string | null
  }[]
  // Pronista §Task Detail redesign — เกณฑ์ว่าเสร็จ แยกจาก description อิสระ
  checklist: { id: string; text: string; done: boolean }[]
  customFields: { id: string; label: string; value: string }[]
  comments: { id: string; body: string; userName: string; userAvatarUrl?: string | null; createdAt: number; isBlocked: boolean }[]
  attachments: { id: string; filename: string; mime: string | null; sizeBytes: number | null; externalUrl: string | null; linkType: string | null }[]
  linkedDocuments: { linkId: string; id: string; title: string; kind: 'page' | 'link' | 'file' | 'template' | 'folder'; externalUrl: string | null }[]
  activity: { id: string; action: string; actorName: string; actorAvatarUrl?: string | null; meta: Record<string, unknown> | null; at: number }[]
  // Pronista §Assign/Accept audit (2026-09-03) — สมาชิกโปรเจกต์นี้ (null = backlog task ไม่ผูกโปรเจกต์ ใช้ userOpts ทั้งบริษัทแทน) ใช้กรอง assignee picker
  projectMembers: { id: string; name: string }[] | null
}
// Pronista §Workspace/Task Jira-alignment (2026-09-04) — ฟิลด์ที่ตัด Auto-save ออกทั้งหมด แก้เป็น draft ในเครื่องก่อน รวมบันทึกทีเดียวตอนกด "บันทึกเพื่ออัปเดตข้อมูล"
interface TaskDraftFields {
  title: string
  description: string | null
  assigneeNotes: string | null
  originCode: string | null
  status: TaskStatus
  assigneeId: string | null
  priority: 'low' | 'normal' | 'high'
  labelIds: string[]
  taskType: string | null
  subTaskType: string | null
  startDate: string | null
  dueDate: string | null
  estimateMinutes: number | null
}
interface UserOpt { id: string; name: string }
interface TraceRow {
  id: string
  code: string | null
  title: string
  projectId: string | null
  originDocType: 'MOM' | 'BRD' | 'SOW' | 'SRS' | 'PEP' | 'UIR' | null
  originCode: string | null
  originRefCode: string | null
  originDocId: string | null
}
interface TraceResponse { upstream: TraceRow[]; downstream: TraceRow[] }
// Pronista §Project Refactor — เชื่อมโยง EPIC/Story/Task/CR อิสระ (คนละแนวคิดกับ trace ด้านบนที่เป็นสาย doc traceability)
interface RefRow { refId: string; id: string; code: string | null; title: string; kind: 'task' | 'defect' | 'cr' | 'backlog'; direction: 'outgoing' | 'incoming' }

const PRIORITY_THAI = { low: 'ต่ำ', normal: 'กลาง', high: 'สูง' } as const
const PRIORITY_CLASS = { low: 'bg-divider text-dim', normal: 'bg-info-50 text-info-700', high: 'bg-danger-50 text-danger-600' } as const
const ACTION_LABEL: Record<string, string> = {
  'task.create': 'สร้างงานนี้',
  'task.update': 'แก้รายละเอียดงาน',
  'task.assign': 'เปลี่ยนผู้รับผิดชอบ',
  'task.status': 'เปลี่ยนสถานะ',
  'task.done': 'ทำเสร็จ',
  'task.delete': 'ลบงาน',
  'task.comment': 'คอมเมนต์',
  'task.attach': 'แนบไฟล์',
  'task.attach_delete': 'ลบไฟล์แนบ',
  'task.convert': 'แปลงประเภทงาน',
  'task.dispatch': 'จ่ายงาน',
  'task.accept': 'รับงาน',
  'task.reject': 'ปฏิเสธงาน',
  'time_entry.create': 'ลงเวลา',
  'time_entry.update': 'แก้เวลา',
  'time_entry.delete': 'ลบเวลา',
}
// Pronista §System Requirements Update — แท็บ "ประวัติการเปลี่ยนแปลง" แยกจากฟีดคอมเมนต์ — เฉพาะ action ที่เป็นความเคลื่อนไหวของสถานะ/ผู้รับผิดชอบงาน (ไม่รวมคอมเมนต์/แนบไฟล์/เวลา)
const HISTORY_ACTIONS = new Set(['task.create', 'task.status', 'task.assign', 'task.dispatch', 'task.accept', 'task.reject', 'task.done', 'task.convert', 'task.update'])
// Pronista §Workspace/Task Jira-alignment (3.3, 2026-09-04) — renderer แบบ generic (best-effort) สำหรับ action='task.update' จากปุ่ม "บันทึกเพื่ออัปเดตข้อมูล" — meta.after มีแค่ฟิลด์ที่แก้ (ไม่มี "ค่าเดิม" ต่อฟิลด์ ยกเว้น status/convert ที่มี before ให้เห็นอยู่แล้วด้านบน)
const FIELD_LABEL: Record<string, string> = {
  title: 'ชื่องาน', description: 'รายละเอียดจากผู้จ่ายงาน', assigneeNotes: 'รายละเอียดจากผู้รับงาน', originCode: 'Reference Code',
  assigneeId: 'ผู้รับผิดชอบ', priority: 'ความสำคัญ', labelIds: 'Labels', taskType: 'ประเภทงาน', subTaskType: 'ตัวเลือกย่อย',
  startDate: 'วันที่เริ่ม', dueDate: 'วันที่คาดว่าเสร็จ', estimateMinutes: 'ประเมิน ชม.',
}
function genericChangedFields(after: unknown): string[] {
  if (!after || typeof after !== 'object') return []
  return Object.keys(after as Record<string, unknown>)
    .filter((k) => k !== 'notifyOnUpdate' && k !== 'status' && k !== 'assigneeId')
    .map((k) => FIELD_LABEL[k] ?? k)
}
function isTaskStatus(v: unknown): v is { status: TaskStatus } {
  return !!v && typeof v === 'object' && typeof (v as { status?: unknown }).status === 'string' && (v as { status: string }).status in TASK_STATUS_LABEL
}
const DELETE_TASK_ERROR_LABEL = {
  has_time_entries: 'ลบไม่ได้ เพราะมีการลงเวลาในงานนี้แล้ว (ข้อมูลการเงิน) — ย้ายเวลาไปงานอื่นก่อน หรือเก็บงานนี้ไว้เฉยๆ',
  has_subtasks: 'ลบไม่ได้ เพราะยังมีงานย่อยอยู่ — ลบหรือย้ายงานย่อยออกก่อน',
} as const
const fmtWhen = (ms: number) => new Date(ms).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const fmtAttSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`)

/** Pronista §Task Detail redesign — หน้าเต็มหน้าแทน TaskDrawer เดิม (Drawer แคบไป ยัดทุกอย่างไว้ไม่มีที่หายใจ)
 * แบ่ง 2 คอลัมน์ + จัดลำดับ/เน้นเนื้อหาต่างกันอัตโนมัติตาม "ใครเปิดดู": assignee ของงานนี้ (t.assigneeId === user.id) vs คนอื่นที่แก้ไขได้ (ถือเป็นฝั่งคนจ่ายงาน)
 * ไม่แตะระบบสิทธิ์เดิม (canEdit = owner/editor ของโปรเจกต์) — แค่จัดการมองเห็น/ปุ่มลัดให้คนที่มีสิทธิ์แก้ไขอยู่แล้ว */
export function TaskDetailPage() {
  const { id: taskId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { alertDialog, confirmDialog, promptDialog } = useDialog()
  const toast = useToast()
  const { data: t, reload } = useLoad<Detail>(() => api.get(`/api/tasks/${taskId}/detail`), [taskId])
  // Pronista §Task Detail permission fix — คนที่ถูก assign งานนี้ แก้ไข "งานของตัวเอง" ได้เสมอ แม้ project role เป็นแค่ viewer/ไม่ได้เป็นสมาชิกโปรเจกต์เลย
  const canEdit = user?.role !== 'vendor' && user?.role !== 'guest' && (t?.myRole === 'owner' || t?.myRole === 'editor' || t?.assigneeId === user?.id)
  const { data: userOpts } = useLoad<UserOpt[]>(() => api.get('/api/users'))
  // Pronista §Workspace — แคตตาล็อกแท็กสี ใช้แสดง+เลือกในแถบข้าง
  // Pronista §System Requirements Update — แคตตาล็อกประเภทงาน/ตัวเลือกย่อย ใช้ dependent dropdown ในแถบข้าง
  const { data: cfg } = useLoad<{ labels: Label[]; taskTypes: TaskType[] }>(() => api.get('/api/config'))
  const [labelPickerOpen, setLabelPickerOpen] = useState(false)
  // Pronista §System Requirements Update — สลับฟีด "ความเคลื่อนไหวทั้งหมด" (คอมเมนต์+ประวัติ) กับ "ประวัติการเปลี่ยนแปลง" (เฉพาะสถานะ/ผู้รับผิดชอบ ไม่มีคอมเมนต์)
  // Pronista §Workspace/Task Jira-alignment (3.3, 2026-09-04) — รวม "ความเคลื่อนไหว" (comment+activity) กับ "ประวัติการเปลี่ยนแปลง" เป็นแท็บย่อยเดียวกันสไตล์ Jira Activity (All/Comments/History/Work log) แทนตัวสลับ 2 ทางเดิมที่ซ่อนทั้งหน้าไปเลย
  const [activityTab, setActivityTab] = useState<'all' | 'comments' | 'history' | 'worklog'>('all')
  const { data: trace } = useLoad<TraceResponse>(() => api.get(`/api/tasks/${taskId}/trace`), [taskId])
  // Pronista §Project Refactor — เชื่อมโยง EPIC/Story/Task/CR อิสระ
  const { data: refs, reload: reloadRefs } = useLoad<RefRow[]>(() => api.get(`/api/tasks/${taskId}/references`), [taskId])
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  const { data: linkPickerCandidates } = useLoad<PickableTask[]>(
    () => (linkPickerOpen && t?.projectId ? api.get(`/api/projects/${t.projectId}/tasks/all`) : Promise.resolve([])),
    [linkPickerOpen],
  )
  const { data: timeRows, reload: reloadTime } = useLoad<TimeRow[]>(() => api.get(`/api/tasks/${taskId}/time`), [taskId])
  const [comment, setComment] = useState('')
  const [dispatching, setDispatching] = useState(false)
  // Pronista §Workspace/Task Jira-alignment (2026-09-04) — ตัด Auto-save ทั้งหมด: ทุกฟิลด์ทั่วไปแก้เป็น draft ในเครื่องก่อน ไม่ยิง PATCH จนกว่าจะกด "บันทึกเพื่ออัปเดตข้อมูล"
  // key มีอยู่ใน draft = ผู้ใช้แตะฟิลด์นั้นแล้ว (แม้ค่าจะเป็น null/ว่างก็ตาม) — ไม่มี key = ยังไม่แตะ ใช้ค่าจาก server (t) ตรงๆ ผ่าน draftVal()
  const [draft, setDraft] = useState<Partial<TaskDraftFields>>({})
  const [saving, setSaving] = useState(false)
  const [newSubtask, setNewSubtask] = useState('')
  const [newSubtaskCode, setNewSubtaskCode] = useState('')
  // Pronista §Workspace/Task Jira-alignment (2026-09-04) — เลือกงานย่อยหลายรายการเพื่อลบทีเดียว (คนละ checkbox กับ toggle สถานะ)
  const [selectedSubtasks, setSelectedSubtasks] = useState<Set<string>>(new Set())
  const [deletingSubtasks, setDeletingSubtasks] = useState(false)
  const [newChecklistText, setNewChecklistText] = useState('')
  const [renamingAttachment, setRenamingAttachment] = useState<{ id: string; draft: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Pronista §Task attachments (2026-09-01) — เมนูเดียวรวมทุกวิธีแนบ (ไฟล์/ลิงก์/เอกสาร MOM/BRD/SOW/SRS/PEP/UIR/CR หรือผูกเอกสารที่มีอยู่แล้ว) แทนปุ่มกระจัดกระจาย
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const docUploadRef = useRef<HTMLInputElement>(null)
  const [docUploadPending, setDocUploadPending] = useState<File | null>(null)
  const [docTypeForUpload, setDocTypeForUpload] = useState<TaskDocType | ''>('')
  const [existingDocPickerOpen, setExistingDocPickerOpen] = useState(false)
  const [existingDocQuery, setExistingDocQuery] = useState('')
  const { data: projectDocs } = useLoad<ProjectDocOpt[]>(
    () => (existingDocPickerOpen && t?.projectId ? api.get(`/api/projects/${t.projectId}/docs`) : Promise.resolve([])),
    [existingDocPickerOpen],
  )

  // Pronista §Task Presence — WebSocket เข้า DO ราย task: ใครกำลังเปิด task นี้อยู่ (pattern เดียวกับ Board.tsx)
  const [viewers, setViewers] = useState<{ userId: string; name: string }[]>([])
  const presenceWsRef = useRef<WebSocket | null>(null)
  useEffect(() => {
    if (!taskId) return
    let stopped = false
    let retry: number | null = null
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/api/tasks/${taskId}/presence/ws`)
      presenceWsRef.current = ws
      ws.onmessage = (e) => {
        if (e.data === 'pong') return
        try {
          const msg = JSON.parse(String(e.data)) as { type?: string; viewers?: typeof viewers }
          if (msg.type === 'roster' && msg.viewers) setViewers(msg.viewers)
        } catch {
          // ข้อความนอกรูปแบบ
        }
      }
      ws.onclose = () => {
        if (!stopped) retry = window.setTimeout(connect, 2000)
      }
    }
    connect()
    const ping = window.setInterval(() => {
      if (presenceWsRef.current?.readyState === WebSocket.OPEN) presenceWsRef.current.send('ping')
    }, 30_000)
    return () => {
      stopped = true
      if (retry) window.clearTimeout(retry)
      window.clearInterval(ping)
      presenceWsRef.current?.close()
    }
  }, [taskId])

  if (!t) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>

  // Pronista §Workspace/Task Jira-alignment (2026-09-04) — เฉพาะปุ่ม action หลักทีละคลิก (เริ่มทำ/ปิดงานเอง ฯลฯ) ที่ยังคง instant-patch เดิม ไม่ผ่าน draft (ทีละ action ชัดเจนอยู่แล้ว ไม่ใช่การแก้ฟอร์ม)
  // เคลียร์ key ที่ patch ตรงนี้ออกจาก draft ด้วย (ถ้ามีค้าง) กันสถานะเก่าที่ยังไม่บันทึกจาก dropdown มาทับค่าจริงที่เพิ่ง patch ไป
  const patchNow = async (data: Record<string, unknown>) => {
    await api.patch(`/api/tasks/${t.id}`, data)
    setDraft((d) => {
      const next = { ...d }
      for (const key of Object.keys(data)) delete next[key as keyof TaskDraftFields]
      return next
    })
    await reload()
    toast('บันทึกสำเร็จ')
  }
  // labelIds ใน Detail (server) เป็น string[] | null แต่ draft ประกาศไว้เป็น string[] เสมอ (กัน .includes()/.filter() พังตอนยังไม่เคยตั้งแท็กเลย) — coerce null → [] ตรงนี้ที่เดียว
  const draftVal = <K extends keyof TaskDraftFields>(key: K): TaskDraftFields[K] => {
    if (key in draft) return draft[key] as TaskDraftFields[K]
    const raw = t[key as keyof Detail]
    return (key === 'labelIds' ? (raw ?? []) : raw) as unknown as TaskDraftFields[K]
  }
  const setDraftField = <K extends keyof TaskDraftFields>(key: K, value: TaskDraftFields[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const hasDraft = Object.keys(draft).length > 0
  // Pronista §Workspace/Task Jira-alignment (2.7, 2026-09-04) — เปลี่ยนวันที่เริ่ม/คาดว่าจะเสร็จ → คำนวณ+เติมค่าประเมินแนะนำใน draft ทันที (ปลอดภัยเพราะยังไม่ยิง PATCH จริงจนกว่าจะกด "บันทึก" — ผู้ใช้แก้เลขต่อเองได้เสมอ)
  const applyEstimateSuggestion = (startDate: string | null, dueDate: string | null) => {
    const suggested = suggestEstimateMinutes(startDate, dueDate, t.weeklyMinutes)
    if (suggested > 0) setDraftField('estimateMinutes', suggested)
  }
  const setStartDateDraft = (v: string) => {
    const next = v || null
    const due = draftVal('dueDate')
    if (next && due && next > due) return void alertDialog({ title: 'วันที่เริ่มต้องไม่เกินวันที่คาดว่าเสร็จ' })
    setDraftField('startDate', next)
    applyEstimateSuggestion(next, due)
  }
  const setDueDateDraft = (v: string) => {
    const next = v || null
    const start = draftVal('startDate')
    if (next && start && start > next) return void alertDialog({ title: 'วันที่คาดว่าเสร็จต้องไม่ก่อนวันที่เริ่ม' })
    setDraftField('dueDate', next)
    applyEstimateSuggestion(start, next)
  }
  // Pronista §Workspace/Task Jira-alignment (2026-09-04) — ปุ่มเดียวรวมบันทึกทุกฟิลด์ที่แก้ไว้ใน draft (แทนที่ auto-save เดิมทั้งหมด) + แจ้งผู้รับผิดชอบว่างานถูกอัปเดต (notifyOnUpdate)
  const saveUpdate = async () => {
    if (!hasDraft || saving) return
    const payload: Record<string, unknown> = { ...draft, notifyOnUpdate: true }
    if ('title' in payload) {
      const trimmed = String(payload.title ?? '').trim()
      if (!trimmed) delete payload.title
      else payload.title = trimmed
    }
    setSaving(true)
    try {
      await api.patch(`/api/tasks/${t.id}`, payload)
      setDraft({})
      await reload()
      toast('บันทึกสำเร็จ')
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง' })
    } finally {
      setSaving(false)
    }
  }
  // Pronista §Assign/Accept audit (2026-09-03) — งานที่ผูกโปรเจกต์: กรองตัวเลือกเหลือแค่สมาชิกโปรเจกต์นั้น (เดิมโชว์ active user ทั้งบริษัท)
  // ยังคงโชว์ assignee ปัจจุบันไว้เสมอแม้ไม่อยู่ใน list แล้ว (เช่นถูกถอดออกจากโปรเจกต์หลังถูก assign ไปแล้ว) กัน select โชว์ว่างงงๆ
  const assigneeOptsBase = t.projectMembers ?? userOpts ?? []
  const assigneeOpts =
    t.assigneeId && t.assigneeName && !assigneeOptsBase.some((u) => u.id === t.assigneeId)
      ? [...assigneeOptsBase, { id: t.assigneeId, name: t.assigneeName }]
      : assigneeOptsBase
  // Pronista §Workspace/Task Jira-alignment (3.1, 2026-09-04) — "Assign to me" เหมือน Jira: ตั้ง draft ผู้รับผิดชอบ = ตัวเอง (ยังไม่ยิง PATCH จนกด "บันทึก" ตาม flow draft ใหม่)
  const assignToMe = () => { if (user) setDraftField('assigneeId', user.id) }
  // Pronista §Back to Basic (ต่อยอด) — เกตจ่ายงาน: กดแล้วงานถึงจะโผล่ในหน้า "งานของฉัน" ของ assignee
  // (2026-08-25) กัน busy ระหว่างรอ reload — ดับเบิลคลิกปุ่มก่อนหน้านี้ยิง dispatch ซ้ำ ทำให้แจ้งเตือนเบิ้ล
  const dispatch = async () => {
    if (dispatching) return
    setDispatching(true)
    try {
      await api.post(`/api/tasks/${t.id}/dispatch`, {})
      await reload()
      toast('จ่ายงานสำเร็จ')
    } finally {
      setDispatching(false)
    }
  }
  // Pronista §Task lifecycle accept step — assignee กดรับงานเอง ถึงจะเปลี่ยนเป็นกำลังทำ
  const accept = async () => {
    await api.post(`/api/tasks/${t.id}/accept`, {})
    await reload()
  }
  // Pronista §Assign/Accept audit (2026-09-03) — assignee ปฏิเสธงานที่จ่ายมา (ก่อนกดรับ) ต้องกรอกเหตุผลให้ผู้จ่ายงานรู้
  const reject = async () => {
    const reason = await promptDialog({ title: 'ปฏิเสธงาน', message: 'บอกเหตุผลให้ผู้จ่ายงานรู้ทันที', placeholder: 'เช่น scope ไม่ตรง / ยังไม่มีคิวว่าง', confirmLabel: 'ปฏิเสธงาน' })
    if (!reason?.trim()) return
    await api.post(`/api/tasks/${t.id}/reject`, { reason: reason.trim() })
    await reload()
  }
  const addReference = async (picked: PickableTask) => {
    setLinkPickerOpen(false)
    await api.post(`/api/tasks/${t.id}/references`, { referencesTaskId: picked.id })
    void reloadRefs()
  }
  const removeReference = async (refId: string) => {
    await api.delete(`/api/task-references/${refId}`)
    void reloadRefs()
  }
  const postComment = async (isBlocked = false, body?: string) => {
    const text = (body ?? comment).trim()
    if (!text) return
    await api.post(`/api/tasks/${t.id}/comments`, { body: text, isBlocked })
    setComment('')
    await reload()
  }
  const reportBlocked = async () => {
    const reason = await promptDialog({ title: 'แจ้งติดขัด', message: 'ติดตรงไหน ให้คนจ่ายงานรู้ทันที', placeholder: 'เช่น รอไฟล์ดีไซน์เพิ่ม', confirmLabel: 'แจ้ง' })
    if (!reason?.trim()) return
    await postComment(true, reason.trim())
  }
  const upload = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    await fetch(`/api/tasks/${t.id}/attachments`, { method: 'POST', body: fd })
  }
  const uploadMany = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) await upload(f)
    await reload()
  }
  const removeAttachment = async (id: string) => { await api.delete(`/api/attachments/${id}`); await reload() }
  const renameAttachment = async (id: string, filename: string) => {
    if (!filename.trim()) return
    await api.patch(`/api/attachments/${id}`, { filename: filename.trim() })
    await reload()
  }
  const addLink = async () => {
    const url = await promptDialog({ title: 'แนบลิงก์', message: 'Google Docs / Figma / Canva / ลิงก์อื่นๆ', placeholder: 'https://...', confirmLabel: 'แนบลิงก์' })
    if (!url?.trim()) return
    try {
      await api.post(`/api/tasks/${t.id}/attachment-links`, { url: url.trim() })
      await reload()
    } catch {
      await alertDialog({ title: 'ลิงก์ไม่ถูกต้อง ลองใหม่อีกครั้ง (ต้องขึ้นต้นด้วย https://)' })
    }
  }
  // Pronista §Back to Basic — สร้างเอกสารจาก Template สำเร็จแล้ว (เอกสารผูกโปรเจกต์ไปแล้วจาก TemplatePickerModal) ผูกเพิ่มกับ task นี้ด้วย
  const onTemplateDocCreated = async (docId: string) => {
    setTemplatePickerOpen(false)
    await api.post(`/api/docs/${docId}/links`, { taskId: t.id })
    await reload()
  }
  // Pronista §Back to Basic — อัปโหลดไฟล์ (Word/PDF) พร้อมระบุประเภทเอกสาร (บังคับ ต่างจากหน้า เอกสาร ที่เลือกได้/ไม่เลือกก็ได้) แล้วผูกกับ task นี้ทันที
  const confirmDocUpload = async () => {
    const file = docUploadPending
    if (!file || !docTypeForUpload) return
    setDocUploadPending(null)
    const docType = docTypeForUpload
    setDocTypeForUpload('')
    const fd = new FormData()
    fd.append('file', file)
    fd.append('title', file.name)
    fd.append('docType', docType)
    const res = await fetch('/api/docs/upload', { method: 'POST', body: fd })
    if (!res.ok) {
      await alertDialog({ title: 'อัปโหลดไม่สำเร็จ — รับเฉพาะ Word (.docx/.doc) และ PDF ขนาดไม่เกิน 15MB' })
      return
    }
    const created = (await res.json()) as { id: string }
    await api.post(`/api/docs/${created.id}/links`, { taskId: t.id })
    await reload()
  }
  // Pronista §Back to Basic — ผูกเอกสารที่มีอยู่แล้วในโปรเจกต์เดียวกัน (ไม่ใช่สร้างใหม่)
  const linkExistingDoc = async (docId: string) => {
    setExistingDocPickerOpen(false)
    setExistingDocQuery('')
    await api.post(`/api/docs/${docId}/links`, { taskId: t.id })
    await reload()
  }
  const addSubtask = async () => {
    if (!newSubtask.trim()) return
    await api.post(`/api/tasks/${t.id}/subtasks`, { title: newSubtask.trim(), code: newSubtaskCode.trim() || undefined })
    setNewSubtask('')
    setNewSubtaskCode('')
    await reload()
  }
  // Pronista §Workspace/Task Jira-alignment (2026-09-04) — toggle สถานะงานย่อยจากติ๊กตรงแถวได้เลย (เดิม checkbox เป็นแค่ span โชว์เฉยๆ ไม่มี handler)
  const toggleSubtaskDone = async (subtaskId: string, currentlyDone: boolean) => {
    await api.patch(`/api/tasks/${subtaskId}`, { status: currentlyDone ? 'non_start' : 'done' })
    await reload()
  }
  const toggleSelectSubtask = (id: string) => {
    setSelectedSubtasks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  // Pronista §Workspace/Task Jira-alignment (2026-09-08) — "เลือกทั้งหมด" งานย่อย mirror pattern เดียวกับ BulkKindActions ใน ProjectDetail.tsx
  const toggleSelectAllSubtasks = () => {
    setSelectedSubtasks((prev) => {
      const allIds = t.subtasks.map((s) => s.id)
      const allSelected = allIds.length > 0 && allIds.every((id) => prev.has(id))
      return allSelected ? new Set() : new Set(allIds)
    })
  }
  const deleteSelectedSubtasks = async () => {
    const ids = [...selectedSubtasks]
    if (ids.length === 0) return
    const yes = await confirmDialog({ title: `ลบงานย่อย ${ids.length} รายการ?`, message: 'กู้คืนไม่ได้', confirmLabel: 'ลบ', danger: true })
    if (!yes) return
    setDeletingSubtasks(true)
    try {
      await Promise.allSettled(ids.map((id) => api.delete(`/api/tasks/${id}`)))
      setSelectedSubtasks(new Set())
      await reload()
    } finally {
      setDeletingSubtasks(false)
    }
  }
  const addChecklistItem = async () => {
    if (!newChecklistText.trim()) return
    await api.post(`/api/tasks/${t.id}/checklist`, { text: newChecklistText.trim() })
    setNewChecklistText('')
    await reload()
  }
  const toggleChecklistItem = async (id: string, done: boolean) => { await api.patch(`/api/checklist/${id}`, { done }); await reload() }
  const removeChecklistItem = async (id: string) => { await api.delete(`/api/checklist/${id}`); await reload() }
  const unlinkDocument = async (linkId: string) => { await api.delete(`/api/docs/links/${linkId}`); await reload() }
  const deleteTask = () => {
    void confirmDialog({ title: 'ลบงานนี้?', message: `"${t.title}" และความเห็น/ไฟล์แนบจะถูกลบ`, confirmLabel: 'ลบ', danger: true }).then((yes) => {
      if (!yes) return
      void api.delete(`/api/tasks/${t.id}`).then(
        () => navigate(-1),
        (e) => {
          void confirmDialog({
            title: 'ลบไม่ได้',
            message: e instanceof ApiError && e.message in DELETE_TASK_ERROR_LABEL ? DELETE_TASK_ERROR_LABEL[e.message as keyof typeof DELETE_TASK_ERROR_LABEL] : 'ลบไม่สำเร็จ ลองใหม่อีกครั้ง',
            confirmLabel: 'เข้าใจแล้ว',
            cancelLabel: 'ปิด',
          })
        },
      )
    })
  }

  const isAssignee = !!user && t.assigneeId === user.id
  // Pronista §Task Workflow fix (2026-08-26) — isAssignee เดิมใช้ซ่อน "ฝั่งผู้จ่ายงาน" ทั้งหมดรวมถึงตอนจ่ายงานให้ตัวเอง (self-assign)
  // ทำให้กรอกเวลาประเมิน/ลำดับความสำคัญ/ประเภทงาน/กำหนดการฯลฯ ไม่ได้เลยระหว่างจ่ายให้ตัวเอง — isAssigneeOnly แยกกรณีนี้ออก: true เฉพาะเป็น assignee "อย่างเดียว" (ไม่มีสิทธิ์ editor/owner โปรเจกต์ด้วย)
  const isAssigneeOnly = isAssignee && t.myRole !== 'owner' && t.myRole !== 'editor'
  // Pronista §Workspace/Task Jira-alignment (2026-09-07) — "รายละเอียดจากผู้จ่ายงาน" ปกติแก้ได้เฉพาะ editor/owner (canEdit && !isAssigneeOnly)
  // ยกเว้นกรณีพิเศษ: ผู้จ่ายงานจริง (assignedBy) กับผู้รับผิดชอบปัจจุบัน เป็นคนคนเดียวกัน (จ่ายงานให้ตัวเอง) — ให้แก้ช่องนี้ได้เองแม้เป็นแค่ assignee ธรรมดา
  const canEditDispatcherNotes = (canEdit && !isAssigneeOnly) || (isAssignee && !!t.assignedBy && t.assignedBy === t.assigneeId)
  // ผู้คีย์งานขึ้นมาเอง (ไม่ว่าจะจ่ายให้ใคร) — ข้อยกเว้นให้ปิดงานได้เองทันทีโดยไม่ต้องผ่านขั้นตอนอนุมัติ
  const isSelfKeyed = !!user && t.createdBy === user.id
  // Pronista §Task Detail fix (2026-08-26) — เปลี่ยนสถานะเองอิสระได้เมื่อ: ไม่ใช่ assignee (ผู้จ่ายงานจริง) หรือเป็นงานที่คีย์เอง หรือยังไม่ได้กด "จ่ายงาน" (ยังไม่เข้า workflow ตรวจงานจริง) — ตรงกับกฎฝั่ง backend (PATCH /tasks/:id) เป๊ะ
  const canEditStatusFreely = canEdit && (!isAssignee || isSelfKeyed || !t.dispatchedAt)
  const done = draftVal('status') === 'done'
  const input = 'text-sm bg-white shadow-xs rounded-lg px-2.5 py-1.5'
  const totalMinutes = (timeRows ?? []).reduce((s, r) => s + r.minutes, 0)

  // Pronista §Task Detail redesign — ฟีดรวม คอมเมนต์+ประวัติกิจกรรม เรียงตามเวลา แทนสองส่วนแยกกันแบบเดิม
  type FeedEntry =
    | { kind: 'comment'; id: string; at: number; body: string; userName: string; userAvatarUrl?: string | null; isBlocked: boolean }
    | { kind: 'activity'; id: string; at: number; actorName: string; actorAvatarUrl?: string | null; action: string; meta: Record<string, unknown> | null }
  const feed: FeedEntry[] = [
    ...t.comments.map((c): FeedEntry => ({ kind: 'comment', id: c.id, at: c.createdAt, body: c.body, userName: c.userName, userAvatarUrl: c.userAvatarUrl, isBlocked: c.isBlocked })),
    ...t.activity.map((a): FeedEntry => ({ kind: 'activity', id: a.id, at: a.at, actorName: a.actorName, actorAvatarUrl: a.actorAvatarUrl, action: a.action, meta: a.meta })),
  ].sort((a, b) => a.at - b.at)
  // Pronista §System Requirements Update — ประวัติการเปลี่ยนแปลง: เฉพาะความเคลื่อนไหวสถานะ/ผู้รับผิดชอบ/ประเภทงาน ไม่รวมคอมเมนต์/แนบไฟล์/เวลา
  const historyFeed = feed.filter((f): f is FeedEntry & { kind: 'activity' } => f.kind === 'activity' && HISTORY_ACTIONS.has(f.action))
  // Pronista §Workspace/Task Jira-alignment (3.3, 2026-09-04) — แท็บ "Comments" แยกเฉพาะคอมเมนต์ ไม่ปนกิจกรรม
  const commentsFeed = feed.filter((f): f is FeedEntry & { kind: 'comment' } => f.kind === 'comment')

  const siblingTotal = t.siblings.length + 1
  const siblingDone = t.siblings.filter((s) => s.status === 'done').length + (done ? 1 : 0)

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-6">
      <button onClick={() => navigate(-1)} className="text-sm text-muted hover:text-soft flex items-center gap-1 mb-4">
        <ChevronLeft className="w-4 h-4" /> กลับ
      </button>

      <div className="bg-white rounded-xl border border-border-subtle shadow-xs overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border-subtle bg-hover/60 text-sm flex-wrap">
          {t.parent && (
            <button onClick={() => navigate(`/tasks/${t.parent!.id}`)} className="text-brand-600 hover:underline flex items-center gap-1">
              ‹ {t.parent.code ? `${t.parent.code} · ` : ''}{t.parent.title}
            </button>
          )}
          <span className="text-muted">{t.projectName ?? 'Backlog'}{t.groupName ? ` · ${t.groupName}` : ''}</span>
          {/* Pronista §Workspace/Task Jira-alignment (2026-09-04) — ย้ายรหัส Task มาอยู่แถวเดียวกับชื่อโปรเจกต์ (เดิมอยู่คนละแถวด้านล่าง) */}
          {t.code && <span className="text-xs font-mono text-muted bg-white border border-border-subtle rounded px-1.5 py-0.5">{t.code}</span>}
          {t.epic && (
            <span className="text-xs font-medium text-teal-700 bg-teal-50 border border-teal-100 rounded-full px-2.5 py-0.5" title={t.epic.code ?? undefined}>
              {t.epic.title}
            </span>
          )}
          {t.parent && (
            <span className="ml-auto text-xs bg-white border border-border-subtle rounded-full px-2.5 py-1 flex items-center gap-2" title="ความคืบหน้างานย่อยพี่น้องใน Task นี้">
              งานย่อยใน Task นี้ {siblingDone}/{siblingTotal}
              <span className="w-12 h-1.5 bg-divider rounded-full overflow-hidden inline-block">
                <span className="block h-full bg-success-500" style={{ width: `${siblingTotal ? (siblingDone / siblingTotal) * 100 : 0}%` }} />
              </span>
            </span>
          )}
        </div>

        <div className="px-5 pt-5 pb-4 border-b border-border-subtle">
          {viewers.length > 0 && (
            <div className="flex items-center justify-end -space-x-1.5" title={`${viewers.length} คนกำลังเปิด Task นี้อยู่: ${viewers.map((v) => v.name).join(', ')}`}>
              {viewers.slice(0, 5).map((v) => (
                <Avatar key={v.userId} name={v.name} avatarUrl={null} className="w-6 h-6 text-[10px] ring-2 ring-white" colorClass={avatarColor(v.name)} />
              ))}
              {viewers.length > 5 && (
                <span className="w-6 h-6 rounded-full bg-divider text-[10px] text-dim flex items-center justify-center ring-2 ring-white">+{viewers.length - 5}</span>
              )}
            </div>
          )}
          {/* Pronista §Workspace/Task Jira-alignment (2026-09-04) — เอา checkbox toggle-done หน้าไตเติลออก (ตามอ้างอิง Jira ไม่มี) — สลับสถานะยังทำได้ผ่าน dropdown สถานะด้านล่างตามปกติ ไม่เสียความสามารถ */}
          <div className="flex items-start gap-2.5 mt-2">
            {canEdit && !isAssigneeOnly ? (
              <textarea
                value={draftVal('title')}
                onChange={(e) => setDraftField('title', e.target.value)}
                rows={2}
                aria-label="ชื่องาน"
                title="คลิกเพื่อแก้ไขชื่องาน"
                className={`flex-1 min-w-0 resize-none text-xl font-semibold bg-hover rounded-lg -mx-1.5 px-1.5 py-0.5 hover:bg-divider focus:bg-white focus:ring-2 focus:ring-brand-200 focus:outline-hidden ${done ? 'text-muted line-through' : 'text-ink'}`}
              />
            ) : (
              <h1 className={`text-xl font-semibold text-wrap ${done ? 'text-muted line-through' : 'text-ink'}`}>{t.title}</h1>
            )}
          </div>
          {t.srsRefCode && t.srsDocId && (
            <a href={`/docs/${t.srsDocId}`} target="_blank" rel="noreferrer" title={t.srsSourceCode ? `อ้างอิงข้อ ${t.srsSourceCode} ในเอกสาร SRS` : 'เปิดเอกสาร SRS ต้นทาง'} className="inline-flex items-center gap-1 text-[11px] font-mono bg-info-50 text-info-700 px-1.5 py-0.5 rounded mt-2 hover:bg-info-100">
              📄 {t.srsRefCode}
            </a>
          )}
        </div>

        {/* Pronista §Workspace/Task Jira-alignment (3.3, 2026-09-04) — ย้ายแท็บ All/Comments/History/Work log ขึ้นมาไว้ใต้หัวเรื่องทันที ตำแหน่ง/สไตล์เดียวกับแท็บ "รายละเอียด/ประวัติการเปลี่ยนแปลง" บน PRD เดิม */}
        <div className="px-5 pt-3 border-b border-border-subtle">
          <div className="flex bg-divider rounded-lg p-0.5 text-xs font-medium w-fit mb-3">
            <button onClick={() => setActivityTab('all')} className={`px-2.5 py-1 rounded-md ${activityTab === 'all' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>All</button>
            <button onClick={() => setActivityTab('comments')} className={`px-2.5 py-1 rounded-md ${activityTab === 'comments' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>Comments</button>
            <button onClick={() => setActivityTab('history')} className={`px-2.5 py-1 rounded-md ${activityTab === 'history' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>History</button>
            <button onClick={() => setActivityTab('worklog')} className={`px-2.5 py-1 rounded-md ${activityTab === 'worklog' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>Work log</button>
          </div>
        </div>

        {/* Pronista §Workspace/Task Jira-alignment (2026-09-07) — กดแท็บไหนก็สลับทั้งหน้าเลยเหมือนพฤติกรรมเดิมบน PRD (ไม่ใช่แค่ส่วนย่อยเหมือนที่ทำไปก่อนหน้า) — All ไปโชว์เนื้อหาปกติทั้งหมดด้านล่างแทน ตรงนี้จัดการเฉพาะ Comments/History/Work log */}
        {activityTab !== 'all' && (
        <div className="p-5 border-b border-border-subtle">
          {activityTab === 'worklog' ? (
            <div className="space-y-2">
              {(timeRows ?? []).length === 0 && <div className="text-sm text-border">ยังไม่มีการลงเวลา</div>}
              {(timeRows ?? []).map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-xs bg-hover rounded-lg px-3 py-2">
                  <span className="font-medium text-body">{r.userName}</span>
                  <span className="text-muted">{r.workDate}</span>
                  <span className="ml-auto font-semibold text-ink tabular-nums">{minutesToHoursLabel(r.minutes)} ชม.</span>
                  {r.note && <span className="text-muted truncate max-w-32" title={r.note}>· {r.note}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {(activityTab === 'comments' ? commentsFeed : historyFeed).length === 0 && (
                <div className="text-sm text-border">ยังไม่มีรายการ</div>
              )}
              {(activityTab === 'comments' ? commentsFeed : historyFeed).map((f) =>
                f.kind === 'comment' ? (
                  <div key={`c-${f.id}`} className="flex gap-2">
                    <Avatar name={f.userName} avatarUrl={f.userAvatarUrl} className="w-7 h-7 text-[10px]" colorClass={avatarColor(f.userName)} />
                    <div className="min-w-0">
                      <div className={`rounded-xl px-3 py-2 text-sm ${f.isBlocked ? 'bg-danger-50 text-danger-800' : 'bg-hover text-soft'}`}>
                        <b className="text-body">{f.userName}</b> · {f.body}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted">{fmtWhen(f.at)}</span>
                        {f.isBlocked && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-danger-700 bg-danger-100 px-1.5 py-0.5 rounded-full">
                            <AlertTriangle className="w-3 h-3" /> ติดขัด
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={`a-${f.id}`} className="flex gap-2 text-xs">
                    <Avatar name={f.actorName} avatarUrl={f.actorAvatarUrl} className="w-5 h-5 text-[9px]" colorClass={avatarColor(f.actorName)} />
                    <div className="flex-1 leading-snug pt-0.5">
                      <b className="text-body">{f.actorName}</b>{' '}<span className="text-dim">{ACTION_LABEL[f.action] ?? f.action}</span>{' '}<span className="text-muted">· {fmtWhen(f.at)}</span>
                      {/* Pronista §System Requirements Update — ประวัติเปลี่ยนสถานะ: โชว์ "สถานะเดิม → สถานะใหม่" จาก audit meta.before/after */}
                      {f.action === 'task.status' && isTaskStatus(f.meta?.before) && isTaskStatus(f.meta?.after) && (
                        <div className="text-[11px] text-muted mt-0.5">{TASK_STATUS_LABEL[f.meta.before.status]} → {TASK_STATUS_LABEL[f.meta.after.status]}</div>
                      )}
                      {/* Pronista §Back to Basic — เลขรหัส regenerate ตอน convert ประเภท: โชว์ประวัติรหัสเดิม→ใหม่ตรงนี้ (audit meta มีอยู่แล้ว แค่ยังไม่เคยแสดงผล) */}
                      {f.action === 'task.convert' && typeof f.meta?.oldCode === 'string' && typeof f.meta?.newCode === 'string' && f.meta.oldCode !== f.meta.newCode && (
                        <div className="text-[11px] font-mono text-muted mt-0.5">{f.meta.oldCode} → {f.meta.newCode}</div>
                      )}
                      {/* Pronista §Workspace/Task Jira-alignment (3.3, 2026-09-04) — แก้ทั่วไปผ่านปุ่ม "บันทึกเพื่ออัปเดตข้อมูล": โชว์รายชื่อฟิลด์ที่เปลี่ยน (best-effort ไม่มีค่าเดิมรายฟิลด์) */}
                      {f.action === 'task.update' && genericChangedFields(f.meta?.after).length > 0 && (
                        <div className="text-[11px] text-muted mt-0.5">แก้ไข: {genericChangedFields(f.meta?.after).join(', ')}</div>
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}

          {activityTab === 'comments' && (
            <div className="flex gap-2 mt-3">
              <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void postComment() }} className="flex-1 min-w-0 text-sm bg-white shadow-xs rounded-lg px-3 py-2" placeholder="เพิ่มความเห็น..." />
              {isAssignee && (
                <button onClick={() => void reportBlocked()} className="bg-danger-50 hover:bg-danger-100 text-danger-700 px-3 rounded-lg text-sm shrink-0 flex items-center gap-1" title="แจ้งติดขัด">
                  <AlertTriangle className="w-4 h-4" /> ติดขัด
                </button>
              )}
              <button onClick={() => void postComment()} className="bg-brand-600 hover:bg-brand-700 text-white px-3 rounded-lg shrink-0" title="ส่ง"><Send className="w-4 h-4" /></button>
            </div>
          )}
        </div>
        )}

        {/* Pronista §Workspace/Task Jira-alignment (2026-09-07) — แท็บ All เท่านั้นที่โชว์หน้าปกติทั้งหมด (Comments/History/Work log สลับทั้งหน้าแทน เหมือนพฤติกรรมเดิมบน PRD) */}
        {activityTab === 'all' && (
        <div className="grid md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="p-5 space-y-6 border-b md:border-b-0 md:border-r border-border-subtle min-w-0">

            <div>
              <div className="text-xs font-medium text-muted mb-1.5">รายละเอียดจากผู้จ่ายงาน</div>
              {canEditDispatcherNotes ? (
                <textarea
                  value={draftVal('description') ?? ''}
                  onChange={(e) => setDraftField('description', e.target.value || null)}
                  placeholder="เพิ่มรายละเอียดงาน..."
                  className="w-full min-h-24 text-sm text-soft bg-hover rounded-lg p-3 focus:outline-hidden focus:ring-2 focus:ring-brand-200"
                />
              ) : (
                <p className="text-sm text-soft whitespace-pre-line">{t.description ?? '—'}</p>
              )}
            </div>

            <div>
              {/* Pronista §Back to Basic (ต่อยอด) — บันทึกของผู้รับงานเอง แก้ได้เฉพาะ assignee ก่อนกด "ส่งงาน" · ผู้จ่ายงานอ่านได้อย่างเดียว แก้ไม่ได้เลย */}
              <div className="text-xs font-medium text-muted mb-1.5">รายละเอียดจากผู้รับงาน</div>
              {isAssignee && t.status !== 'waiting_for_test' && !done ? (
                <textarea
                  value={draftVal('assigneeNotes') ?? ''}
                  onChange={(e) => setDraftField('assigneeNotes', e.target.value || null)}
                  placeholder="พิมพ์บันทึกของตัวเอง เช่น ทำไปถึงไหน ติดขัดอะไร…"
                  className="w-full min-h-24 text-sm text-soft bg-hover rounded-lg p-3 focus:outline-hidden focus:ring-2 focus:ring-brand-200"
                />
              ) : (
                <p className="text-sm text-soft whitespace-pre-line">{t.assigneeNotes ?? '—'}</p>
              )}
            </div>

            <div>
              <div className="text-xs font-medium text-muted mb-2">เกณฑ์ว่าเสร็จ (Acceptance Criteria) <span className="text-border">({t.checklist.filter((i) => i.done).length}/{t.checklist.length})</span></div>
              {t.checklist.length === 0 && <div className="text-sm text-border mb-2">ยังไม่มีเกณฑ์ — เพิ่มให้ชัดว่า "เสร็จ" คือแบบไหน</div>}
              <div className="space-y-1.5 mb-2">
                {t.checklist.map((item) => (
                  <div key={item.id} className="group flex items-center gap-2 text-sm bg-hover rounded-lg px-2.5 py-1.5">
                    <button
                      onClick={() => canEdit && void toggleChecklistItem(item.id, !item.done)}
                      className={`w-4.5 h-4.5 rounded border shrink-0 grid place-items-center ${item.done ? 'border-success-500 bg-success-500 text-white' : 'border-border'}`}
                    >
                      {item.done && <Check className="w-3 h-3" />}
                    </button>
                    <span className={`flex-1 ${item.done ? 'text-muted line-through' : 'text-body'}`}>{item.text}</span>
                    {canEdit && !isAssignee && <button onClick={() => void removeChecklistItem(item.id)} className="opacity-0 group-hover:opacity-100 text-border hover:text-danger-600 shrink-0"><X className="w-3.5 h-3.5" /></button>}
                  </div>
                ))}
              </div>
              {canEdit && !isAssignee && (
                <div className="flex gap-2">
                  <input value={newChecklistText} onChange={(e) => setNewChecklistText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addChecklistItem() }} placeholder="+ เพิ่มเกณฑ์…" className={`${input} flex-1`} />
                  <button onClick={() => void addChecklistItem()} disabled={!newChecklistText.trim()} className="text-sm bg-brand-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-40">เพิ่ม</button>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="text-xs font-medium text-muted">งานย่อย <span className="text-border">({t.subtasks.length})</span></div>
                {/* Pronista §Workspace/Task Jira-alignment (2026-09-08) — เลือกทั้งหมดทีเดียว แทนต้องไล่ติ๊กเองทีละอันเมื่อมีงานย่อยเยอะ */}
                {t.subtasks.length > 0 && (
                  <label className="flex items-center gap-1 text-[11px] text-dim cursor-pointer">
                    <input type="checkbox" checked={t.subtasks.every((s) => selectedSubtasks.has(s.id))} onChange={toggleSelectAllSubtasks} />
                    เลือกทั้งหมด
                  </label>
                )}
                {/* Pronista §Workspace/Task Jira-alignment (2026-09-04) — ไอคอนถังขยะโผล่เมื่อติ๊กเลือกอย่างน้อย 1 รายการเท่านั้น */}
                {selectedSubtasks.size > 0 && (
                  <button
                    onClick={() => void deleteSelectedSubtasks()}
                    disabled={deletingSubtasks}
                    title={`ลบ ${selectedSubtasks.size} รายการที่เลือก`}
                    className="ml-auto text-xs text-danger-600 hover:text-danger-700 flex items-center gap-1 disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> ลบ ({selectedSubtasks.size})
                  </button>
                )}
              </div>
              {t.subtasks.length === 0 && <div className="text-sm text-border mb-2">ยังไม่มีงานย่อย</div>}
              <div className="space-y-1 mb-2">
                {t.subtasks.map((s) => (
                  <div key={s.id} className="w-full flex items-center gap-2 text-left text-sm bg-hover hover:bg-divider rounded-lg px-2.5 py-1.5">
                    <input
                      type="checkbox"
                      checked={selectedSubtasks.has(s.id)}
                      onChange={() => toggleSelectSubtask(s.id)}
                      aria-label={`เลือก ${s.title}`}
                      className="shrink-0"
                    />
                    <button
                      type="button"
                      onClick={() => void toggleSubtaskDone(s.id, s.status === 'done')}
                      title={s.status === 'done' ? 'ยกเลิกเสร็จ' : 'ทำเครื่องหมายว่าเสร็จ'}
                      className={`w-4 h-4 rounded border shrink-0 grid place-items-center ${s.status === 'done' ? 'border-brand-500 bg-brand-500 text-white' : 'border-border hover:border-brand-400'}`}
                    >
                      {s.status === 'done' && <Check className="w-3 h-3" />}
                    </button>
                    <button onClick={() => navigate(`/tasks/${s.id}`)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
                      {s.code && <span className="text-[11px] font-mono text-muted shrink-0">{s.code}</span>}
                      <span className={`flex-1 truncate ${s.status === 'done' ? 'text-muted line-through' : 'text-body'}`}>{s.title}</span>
                    </button>
                    {s.priority !== 'normal' && <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${PRIORITY_CLASS[s.priority]}`}>{PRIORITY_THAI[s.priority]}</span>}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${TASK_STATUS_BADGE[s.status]}`}>{TASK_STATUS_LABEL[s.status]}</span>
                    {s.originCode && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-info-100 text-info-700 shrink-0">{s.originCode}</span>}
                    {s.estimateMinutes != null && <span className="text-[11px] text-muted shrink-0">{minutesToHoursLabel(s.estimateMinutes)} ชม.</span>}
                    {s.assigneeName && <span className="text-[11px] text-muted shrink-0">{s.assigneeName}</span>}
                  </div>
                ))}
              </div>
              {canEdit && !isAssignee && (
                <div className="flex flex-wrap gap-2">
                  <input value={newSubtask} onChange={(e) => setNewSubtask(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addSubtask() }} placeholder="+ เพิ่มงานย่อย…" className={`${input} flex-1`} />
                  <input value={newSubtaskCode} onChange={(e) => setNewSubtaskCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addSubtask() }} placeholder="รหัส (ไม่บังคับ)" title="ตั้งรหัสงานย่อยเอง — เว้นว่างให้ระบบออกเลขอัตโนมัติ" className={`${input} w-full sm:w-32 font-mono`} />
                  <button onClick={() => void addSubtask()} disabled={!newSubtask.trim()} className="text-sm bg-brand-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-40">เพิ่ม</button>
                </div>
              )}
            </div>

            <div>
              <div className="text-xs font-medium text-muted mb-2">ไฟล์แนบ{t.linkedDocuments.length > 0 ? ' / เอกสารที่เชื่อม' : ''}</div>
              {t.attachments.length > 0 && (
                <div className="space-y-1 mb-2">
                  {t.attachments.map((a) => (
                    <div key={a.id} className="group flex items-center gap-2.5 bg-hover rounded-lg px-2.5 py-2">
                      {renamingAttachment?.id === a.id ? (
                        <input
                          autoFocus
                          value={renamingAttachment.draft}
                          onChange={(e) => setRenamingAttachment({ id: a.id, draft: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void renameAttachment(a.id, renamingAttachment.draft).then(() => setRenamingAttachment(null))
                            if (e.key === 'Escape') setRenamingAttachment(null)
                          }}
                          onBlur={() => void renameAttachment(a.id, renamingAttachment.draft).then(() => setRenamingAttachment(null))}
                          className="flex-1 min-w-0 text-sm bg-white border border-brand-400 rounded-lg px-2 py-1 focus:outline-hidden"
                        />
                      ) : a.externalUrl ? (
                        <a href={a.externalUrl} target="_blank" rel="noreferrer" className="flex-1 min-w-0 flex items-center gap-2 text-sm text-body hover:text-brand-700">
                          <Link2 className="w-4 h-4 text-info-500 shrink-0" /> <span className="truncate">{a.filename}</span>
                        </a>
                      ) : a.mime?.startsWith('image/') ? (
                        <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="flex-1 min-w-0 flex items-center gap-2 text-sm text-body hover:text-brand-700">
                          <img src={`/api/attachments/${a.id}`} alt={a.filename} className="w-6 h-6 rounded object-cover shrink-0" /> <span className="truncate">{a.filename}</span>
                        </a>
                      ) : (
                        <a href={`/api/attachments/${a.id}`} className="flex-1 min-w-0 flex items-center gap-2 text-sm text-body hover:text-brand-700">
                          <FileText className="w-4 h-4 text-muted shrink-0" /> <span className="truncate">{a.filename}</span>
                        </a>
                      )}
                      <span className="text-[11px] text-muted shrink-0 w-14 text-right">{a.sizeBytes != null ? fmtAttSize(a.sizeBytes) : ''}</span>
                      {renamingAttachment?.id !== a.id && (
                        <div className="flex items-center justify-end gap-1 shrink-0 w-14 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                          {canEdit && (
                            <>
                              <button onClick={() => setRenamingAttachment({ id: a.id, draft: a.filename })} className="p-1 rounded hover:bg-white text-dim hover:text-brand-700" title="เปลี่ยนชื่อ"><Pencil className="w-3.5 h-3.5" /></button>
                              <button onClick={() => void removeAttachment(a.id)} className="p-1 rounded hover:bg-white text-dim hover:text-danger-600" title="ลบ"><X className="w-3.5 h-3.5" /></button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {canEdit && (
                <div className="relative inline-block">
                  <button onClick={() => setAttachMenuOpen((v) => !v)} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 border-2 border-dashed border-border-subtle hover:border-brand-300 hover:bg-hover rounded-lg px-3 py-1.5">
                    <Plus className="w-3.5 h-3.5" /> เพิ่มไฟล์แนบ
                  </button>
                  {attachMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setAttachMenuOpen(false)} />
                      <div className="absolute left-0 top-full mt-1 w-64 bg-white rounded-lg shadow-lg border border-border-subtle py-1 z-20 text-xs">
                        <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold text-muted uppercase tracking-wide">ไฟล์แนบทั่วไป</div>
                        <button onClick={() => { setAttachMenuOpen(false); fileRef.current?.click() }} className="w-full text-left px-3 py-1.5 text-body hover:bg-hover">📎 อัปโหลดไฟล์แนบ</button>
                        <button onClick={() => { setAttachMenuOpen(false); void addLink() }} className="w-full text-left px-3 py-1.5 text-body hover:bg-hover">🔗 แนบลิงก์ (Google Docs/Figma/Canva)</button>
                        {!isAssignee && (
                          <>
                            <div className="border-t border-border-subtle my-1" />
                            {/* Pronista §Task attachments (2026-09-01) — แยกกลุ่มให้ชัดจากไฟล์แนบทั่วไปด้านบน: 3 ปุ่มนี้สร้าง/ผูก "เอกสาร" จริงในระบบเอกสารบริษัท (มีเลขที่/เวอร์ชัน/ประวัติ ค้นหาเจอในเมนูเอกสาร) ไม่ใช่แค่ไฟล์แนบลอยๆ ของ task นี้ */}
                            <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold text-muted uppercase tracking-wide">เอกสารทางการ (เข้าระบบ "เอกสาร")</div>
                            <button onClick={() => { setAttachMenuOpen(false); setTemplatePickerOpen(true) }} className="w-full text-left px-3 py-1.5 text-body hover:bg-hover">📄 สร้างเอกสารจาก Template</button>
                            <button onClick={() => { setAttachMenuOpen(false); docUploadRef.current?.click() }} className="w-full text-left px-3 py-1.5 text-body hover:bg-hover">⬆️ อัปโหลดเป็นเอกสาร (Word/PDF)</button>
                            <button onClick={() => { setAttachMenuOpen(false); setExistingDocPickerOpen(true) }} className="w-full text-left px-3 py-1.5 text-body hover:bg-hover">🔗 ผูกเอกสารที่มีอยู่แล้ว</button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { const files = e.target.files; if (files && files.length) void uploadMany(files); e.target.value = '' }} />
              <input ref={docUploadRef} type="file" accept=".docx,.doc,.pdf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setDocUploadPending(f); e.target.value = '' }} />
              {t.linkedDocuments.length > 0 && (
                <div className="space-y-1.5 mt-2">
                  {t.linkedDocuments.map((d) => (
                    <div key={d.linkId} className="flex items-center gap-2 bg-hover rounded-lg px-2.5 py-1.5 text-sm">
                      {d.kind === 'link' ? <Link2 className="w-3.5 h-3.5 text-info-500 shrink-0" /> : <FileText className="w-3.5 h-3.5 text-brand-500 shrink-0" />}
                      <a href={d.kind === 'link' && d.externalUrl ? d.externalUrl : `/docs/${d.id}`} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate text-body hover:underline flex items-center gap-1">
                        {d.title} <ExternalLink className="w-3 h-3 text-muted shrink-0" />
                      </a>
                      {canEdit && !isAssignee && <button onClick={() => void unlinkDocument(d.linkId)} title="เลิกผูก" className="text-border hover:text-danger-600 shrink-0"><X className="w-3.5 h-3.5" /></button>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!isAssignee && (t.originDocType || t.parent || (trace && (trace.upstream.length > 0 || trace.downstream.length > 0))) && (
              <div>
                <div className="text-xs font-medium text-muted mb-2 flex items-center gap-1.5"><GitBranch className="w-3.5 h-3.5" /> การอ้างอิงเอกสาร</div>
                <div className="space-y-2">
                  {t.originDocType && (
                    <a href={t.originDocId ? `/docs/${t.originDocId}` : undefined} target="_blank" rel="noreferrer" title={t.originCode ? `แตกจากรหัส ${t.originCode} ในเอกสารต้นทาง` : 'เอกสารต้นทาง'} className="inline-flex items-center gap-1 text-[11px] font-mono bg-info-50 text-info-700 px-1.5 py-0.5 rounded hover:bg-info-100">
                      📄 {t.originDocType} {t.originRefCode}
                    </a>
                  )}
                  {t.parent && (
                    <label className="block">
                      <span className="text-[11px] text-muted mb-1 block">Reference Code</span>
                      {canEdit ? (
                        <input
                          value={draftVal('originCode') ?? ''}
                          onChange={(e) => setDraftField('originCode', e.target.value || null)}
                          placeholder="เช่น MAK002-SOW-006-001"
                          className="w-full text-xs font-mono bg-hover rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-2 focus:ring-brand-200"
                        />
                      ) : (
                        <span className="text-xs font-mono text-body">{t.originCode ?? '—'}</span>
                      )}
                    </label>
                  )}
                  {trace && trace.upstream.length > 0 && (
                    <div>
                      <div className="text-[11px] text-muted mb-1">อ้างอิงถึง (ต้นทาง)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {trace.upstream.map((r) => (
                          <button key={r.id} onClick={() => navigate(`/tasks/${r.id}`)} title={r.title} className="flex items-center gap-1 text-xs bg-hover hover:bg-divider rounded-lg px-2 py-1">
                            {r.originDocType && <span className="text-[10px] font-mono text-muted">{r.originDocType}</span>}
                            <span className="truncate max-w-40">{r.code ?? r.title}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {trace && trace.downstream.length > 0 && (
                    <div>
                      <div className="text-[11px] text-muted mb-1">ถูกอ้างอิงโดย (ปลายทาง)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {trace.downstream.map((r) => (
                          <button key={r.id} onClick={() => navigate(`/tasks/${r.id}`)} title={r.title} className="flex items-center gap-1 text-xs bg-hover hover:bg-divider rounded-lg px-2 py-1">
                            {r.originDocType && <span className="text-[10px] font-mono text-muted">{r.originDocType}</span>}
                            <span className="truncate max-w-40">{r.code ?? r.title}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div>
              <div className="text-xs font-medium text-muted mb-2 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5" /> รายการที่เชื่อมโยง
                {canEdit && !isAssignee && (
                  <button onClick={() => setLinkPickerOpen(true)} className="ml-auto flex items-center gap-1 text-[11px] text-brand-600 hover:underline">
                    <Plus className="w-3 h-3" /> เชื่อมโยงรายการ
                  </button>
                )}
              </div>
              {(!refs || refs.length === 0) ? (
                <div className="text-xs text-muted">ยังไม่มีรายการที่เชื่อมโยง</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {refs.map((r) => (
                    <div key={r.refId} className="flex items-center gap-1 text-xs bg-hover rounded-lg px-2 py-1">
                      {r.direction === 'incoming' && <span className="text-[10px] text-muted" title="ถูกอ้างอิงโดยรายการนี้">←</span>}
                      <button onClick={() => navigate(`/tasks/${r.id}`)} title={r.title} className="truncate max-w-40 hover:underline">
                        {r.code ?? r.title}
                      </button>
                      {r.kind === 'defect' && <span className="text-[9px] text-danger-600">🐛</span>}
                      {r.kind === 'cr' && <span className="text-[9px] text-info-700">CR</span>}
                      {canEdit && !isAssignee && r.direction === 'outgoing' && (
                        <button onClick={() => void removeReference(r.refId)} title="เลิกเชื่อมโยง" className="text-border hover:text-danger-600">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          <div className="p-5 space-y-5 bg-hover/40">
            <div className="space-y-4">
              {/* Pronista §Meta panel redesign — จัดเป็นกริด label/ช่องกรอกคงที่แทน flex justify-between ที่แนวไม่ตรงกัน + เพิ่ม border ให้ทุกช่องกรอกได้ (เดิม bg-white ล้วนกลืนกับพื้นหลัง bg-hover/40 แยกไม่ออกว่ากรอกตรงไหนได้) */}
              <div>
                <div className="text-[11px] font-medium text-muted tracking-wide mb-2">สถานะงาน</div>
                <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2.5 items-center text-sm">
                  <span className="text-dim">สถานะงาน</span>
                  {/* Pronista §Back to Basic (ต่อยอด) — ฝั่ง assignee เปลี่ยนสถานะเองอิสระไม่ได้แล้ว (กัน jump ข้ามขั้น) ต้องผ่านปุ่ม "ส่งงาน" เท่านั้น — ยกเว้นงานคีย์เอง/ยังไม่ได้จ่ายงาน */}
                  {canEditStatusFreely ? (
                    <select value={draftVal('status')} onChange={(e) => setDraftField('status', e.target.value as TaskStatus)} aria-label="สถานะงาน" className={`w-fit px-2 py-1.5 rounded-lg text-xs ${TASK_STATUS_BADGE[draftVal('status')]}`}>
                      {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
                    </select>
                  ) : (
                    <span className={`w-fit px-2 py-1.5 rounded-lg text-xs ${TASK_STATUS_BADGE[t.status]}`}>{TASK_STATUS_LABEL[t.status]}</span>
                  )}

                  <span className="text-dim">ผู้รับผิดชอบ</span>
                  {canEdit && !isAssigneeOnly ? (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <select value={draftVal('assigneeId') ?? ''} onChange={(e) => setDraftField('assigneeId', e.target.value || null)} aria-label="ผู้รับผิดชอบ" className="flex-1 min-w-24 border border-border bg-white text-soft px-2 py-1.5 rounded-lg text-xs focus:outline-hidden focus:border-brand-400">
                        <option value="">— ไม่ระบุ —</option>
                        {assigneeOpts.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                      {/* Pronista §Workspace/Task Jira-alignment (3.1, 2026-09-04) — "Assign to me" แบบ Jira: โผล่เมื่อ draft ยังไม่มีผู้รับผิดชอบ */}
                      {!draftVal('assigneeId') && user && (
                        <button type="button" onClick={assignToMe} className="text-[11px] text-brand-700 hover:text-brand-800 underline decoration-dotted shrink-0">
                          Assign to me
                        </button>
                      )}
                    </div>
                  ) : (
                    t.assigneeName && <span className="w-fit bg-white text-soft px-2 py-1.5 rounded-lg text-xs">{t.assigneeName}</span>
                  )}

                  {/* Pronista §Workspace/Task Jira-alignment (2026-09-07) — "Reporter" แบบ Jira: ต้องมีเสมอ ไม่ซ่อน — ใช้ผู้จ่ายงานจริง (assignedBy) ก่อน ถ้าไม่เคยจ่ายงานอย่างเป็นทางการ (เช่น คีย์ backlog ตรงๆ) fallback เป็นผู้สร้างงานแทน (createdBy) แสดงอย่างเดียว แก้ไม่ได้ตรงนี้ */}
                  {(t.assignedByName ?? t.createdByName) && (
                    <>
                      <span className="text-dim">ผู้จ่ายงาน</span>
                      <span className="w-fit flex items-center gap-1.5 bg-white text-soft px-2 py-1.5 rounded-lg text-xs">
                        <Avatar name={(t.assignedByName ?? t.createdByName)!} avatarUrl={t.assignedByName ? t.assignedByAvatarUrl : t.createdByAvatarUrl} className="w-4 h-4 text-[8px]" colorClass={avatarColor((t.assignedByName ?? t.createdByName)!)} />
                        {t.assignedByName ?? t.createdByName}
                      </span>
                    </>
                  )}

                  {/* Pronista §Workspace/Task Jira-alignment (2026-09-09) — "Sprint" แบบ Jira: โชว์ชื่อ Sprint ที่งานนี้สังกัดอยู่ พร้อมลิงก์กลับไปที่บอร์ด (โปรเจกต์ หรือ Workspace แล้วแต่ Sprint นี้ผูกกับอันไหน) */}
                  <span className="text-dim">Sprint</span>
                  {t.sprint ? (
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          t.sprint!.workspaceId
                            ? `/workspace/${t.sprint!.workspaceId}/sprints/${t.sprint!.id}/board`
                            : `/projects/${t.sprint!.projectId}/sprints/${t.sprint!.id}/board`,
                        )
                      }
                      className="w-fit text-left text-brand-600 hover:underline"
                    >
                      {t.sprint.name ?? 'Sprint'}
                    </button>
                  ) : (
                    <span className="text-muted">—</span>
                  )}

                  {!isAssigneeOnly && (
                    <>
                      <span className="text-dim">ความสำคัญ</span>
                      {canEdit ? (
                        <select value={draftVal('priority')} onChange={(e) => setDraftField('priority', e.target.value as 'low' | 'normal' | 'high')} aria-label="ความสำคัญ" className={`w-fit px-2 py-1.5 rounded-lg text-xs ${PRIORITY_CLASS[draftVal('priority')]}`}>
                          {(['low', 'normal', 'high'] as const).map((p) => <option key={p} value={p}>{PRIORITY_THAI[p]}</option>)}
                        </select>
                      ) : (
                        <span className={`w-fit px-2 py-1.5 rounded-lg text-xs ${PRIORITY_CLASS[t.priority]}`}>{PRIORITY_THAI[t.priority]}</span>
                      )}
                    </>
                  )}
                </div>
              </div>

              {!isAssigneeOnly && (
                <>
                  <div className="border-t border-border-subtle" />
                  <div>
                    <div className="text-[11px] font-medium text-muted tracking-wide mb-2">การจัดหมวด</div>
                    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2.5 items-start text-sm">
                      <span className="text-dim pt-1.5">Labels</span>
                      <div className="flex flex-col items-start gap-1.5">
                        <LabelChips catalog={cfg?.labels} ids={draftVal('labelIds')} />
                        {canEdit && (
                          <div className="relative">
                            <button type="button" onClick={() => setLabelPickerOpen((v) => !v)} className="text-xs text-brand-700 hover:text-brand-800 border border-brand-200 bg-brand-50 hover:bg-brand-100 rounded-lg px-2.5 py-1 flex items-center gap-1">
                              <Plus className="w-3 h-3" /> แท็ก
                            </button>
                            {labelPickerOpen && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setLabelPickerOpen(false)} />
                                <div className="absolute left-0 top-full mt-1 z-50 w-48 bg-white rounded-lg shadow-2xl border border-border-subtle p-2 space-y-1">
                                  {resolveLabels(cfg?.labels).map((l) => {
                                    const active = draftVal('labelIds').includes(l.id)
                                    return (
                                      <button
                                        key={l.id}
                                        type="button"
                                        onClick={() => {
                                          const next = active ? draftVal('labelIds').filter((id) => id !== l.id) : [...draftVal('labelIds'), l.id]
                                          setDraftField('labelIds', next)
                                        }}
                                        className="w-full flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-hover text-left"
                                      >
                                        <span className={`w-3 h-3 rounded-full shrink-0 ${STATUS_SWATCH[l.color] ?? 'bg-slate-400'}`} />
                                        <span className="flex-1 text-xs text-body">{l.name}</span>
                                        {active && <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />}
                                      </button>
                                    )
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      <span className="text-dim pt-1.5">ประเภทงาน</span>
                      {canEdit ? (
                        <div className="flex flex-col gap-1.5">
                          <select
                            value={draftVal('taskType') ?? ''}
                            onChange={(e) => {
                              setDraftField('taskType', e.target.value || null)
                              setDraftField('subTaskType', null)
                            }}
                            aria-label="ประเภทงาน"
                            className="w-full text-xs bg-white border border-border rounded-lg px-2 py-1.5 focus:outline-hidden focus:border-brand-400"
                          >
                            <option value="">— ไม่ระบุ —</option>
                            {resolveTaskTypes(cfg?.taskTypes).map((tt) => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
                          </select>
                          <select
                            value={draftVal('subTaskType') ?? ''}
                            onChange={(e) => setDraftField('subTaskType', e.target.value || null)}
                            disabled={!draftVal('taskType')}
                            aria-label="ตัวเลือกย่อย"
                            className="w-full text-xs bg-white border border-border rounded-lg px-2 py-1.5 disabled:opacity-40 focus:outline-hidden focus:border-brand-400"
                          >
                            <option value="">— ไม่ระบุ —</option>
                            {(resolveTaskTypes(cfg?.taskTypes).find((tt) => tt.id === draftVal('taskType'))?.subTypes ?? []).map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <span className="text-ink font-medium text-xs pt-1.5">
                          {resolveTaskTypes(cfg?.taskTypes).find((tt) => tt.id === t.taskType)?.name ?? '—'}
                          {t.subTaskType && ` / ${resolveTaskTypes(cfg?.taskTypes).find((tt) => tt.id === t.taskType)?.subTypes.find((s) => s.id === t.subTaskType)?.name ?? ''}`}
                        </span>
                      )}
                    </div>
                  </div>
                </>
              )}

              <div className="border-t border-border-subtle" />
              <div>
                <div className="text-[11px] font-medium text-muted tracking-wide mb-2">กำหนดการ</div>
                <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2.5 items-center text-sm">
                  {/* Pronista §Workspace/Task Jira-alignment (2026-09-04) — สลับ "วันที่เริ่ม" ขึ้นก่อน "วันที่คาดว่าน่าจะเสร็จ" (เดิม "กำหนดส่ง" ขึ้นก่อน) + ล็อกไม่ให้วันที่เริ่มเกินวันที่คาดว่าจะเสร็จ */}
                  {canEdit && !isAssigneeOnly && (
                    <>
                      <span className="text-dim">วันที่เริ่ม</span>
                      <DateInputTH
                        value={draftVal('startDate') ?? ''}
                        onChange={setStartDateDraft}
                        className="w-full text-xs bg-white border border-border rounded-lg px-2 py-1.5 focus:outline-hidden focus:border-brand-400"
                      />
                    </>
                  )}

                  <span className="text-dim">วันที่คาดว่าเสร็จ</span>
                  {canEdit && !isAssigneeOnly ? (
                    <DateInputTH
                      value={draftVal('dueDate') ?? ''}
                      onChange={setDueDateDraft}
                      className="w-full text-xs bg-white border border-border rounded-lg px-2 py-1.5 focus:outline-hidden focus:border-brand-400"
                    />
                  ) : (
                    <span className="text-ink font-medium">{t.dueDate ?? '—'}</span>
                  )}

                  {!isAssigneeOnly && canEdit && (
                    <>
                      <span className="text-dim">ประเมิน (ชม.)</span>
                      <input
                        type="number"
                        value={draftVal('estimateMinutes') != null ? draftVal('estimateMinutes')! / 60 : ''}
                        onChange={(e) => setDraftField('estimateMinutes', e.target.value ? Math.round(Number(e.target.value) * 60) : null)}
                        title="แนะนำอัตโนมัติจาก Manhour ของผู้รับผิดชอบตอนเปลี่ยนวันที่ — แก้เลขเองได้เสมอ"
                        className="w-20 text-xs bg-white border border-border rounded-lg px-2 py-1.5 focus:outline-hidden focus:border-brand-400"
                      />
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Pronista §Time tracking fix (2026-09-11) — เดิมซ่อนตัวจับเวลา/manual ทั้งชุดถ้า sprint ไม่ active ทั้งที่ backend ไม่เคยเช็คเงื่อนไขนี้เลย (เช็คแค่ต้องผูกโปรเจกต์) — TimeSection เองจัดการ "ยังไม่ผูกโปรเจกต์" ให้แล้วผ่าน hasProject จึงตัดเงื่อนไข sprintActive ทิ้งให้ตรงกับ backend จริง */}
            <div className="border-t border-border-subtle pt-4">
              <TimeSection taskId={t.id} hasProject={t.projectName !== null} rows={timeRows ?? []} reload={reloadTime} canManage={t.myRole === 'owner' || t.myRole === 'editor'} assigneeId={t.assigneeId} assigneeName={t.assigneeName} />
            </div>

            {!isAssigneeOnly && t.estimateMinutes != null && (
              <div className="border-t border-border-subtle pt-4">
                <div className="text-xs font-medium text-muted mb-2">ประเมิน vs เวลาที่ใช้จริง</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-divider rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${totalMinutes > t.estimateMinutes ? 'bg-danger-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, (totalMinutes / t.estimateMinutes) * 100)}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-ink tabular-nums shrink-0">{minutesToHoursLabel(totalMinutes)} / {minutesToHoursLabel(t.estimateMinutes)} ชม.</span>
                </div>
              </div>
            )}

            {/* Pronista §Workspace/Task Jira-alignment (2026-09-04) — ตัด Auto-save ทั้งหมด ปุ่มเดียวนี้คือทางเดียวที่บันทึกฟิลด์ทั่วไปจริง (แทนที่ "บันทึกฉบับร่าง" เดิม) */}
            {canEdit && (
              <div className="border-t border-border-subtle pt-4">
                <button
                  onClick={() => void saveUpdate()}
                  disabled={!hasDraft || saving}
                  title={hasDraft ? undefined : 'ยังไม่มีอะไรแก้ไข'}
                  className="w-full flex items-center justify-center gap-1.5 text-sm bg-brand-600 hover:bg-brand-700 text-white px-3 py-2 rounded-lg font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <FileText className="w-3.5 h-3.5" /> {saving ? 'กำลังบันทึก…' : 'บันทึกเพื่ออัปเดตข้อมูล'}
                </button>
              </div>
            )}

            {canEdit && (
              <div className="border-t border-border-subtle pt-4 space-y-2">
                {isAssignee ? (
                  // Pronista §Task lifecycle accept step — ยังไม่จ่าย (dispatchedAt ว่าง) → คนที่ถูก assign เอง (self-assign) ก็ต้องกด "จ่ายงาน" ได้เหมือน flow ปกติ (เดิมมีแต่ข้อความเฉยๆ ไม่มีปุ่มเลย ทำให้ self-assign ค้าง ไปต่อไม่ได้ด้วยตัวเอง) · จ่ายแล้วแต่ยังไม่กดรับ (status ยังเป็น non_start) → ปุ่ม "รับงาน" · รับแล้ว → ปุ่ม "ส่งงาน" เดิม
                  !t.dispatchedAt ? (
                    <>
                      <button onClick={() => void dispatch()} disabled={dispatching} className="w-full flex items-center justify-center gap-1.5 text-sm bg-success-600 hover:bg-success-700 text-white px-3 py-2 rounded-lg disabled:opacity-40 font-medium">
                        <CheckCircle2 className="w-4 h-4" /> จ่ายงาน (ให้ตัวเอง)
                      </button>
                      <div className="text-[11px] text-muted text-center">งานนี้ยังไม่ถูกจ่ายอย่างเป็นทางการ — กด "จ่ายงาน" เพื่อเริ่มทำได้เลย</div>
                    </>
                  ) : t.status === 'non_start' ? (
                    <>
                      <button onClick={() => void accept()} className="w-full flex items-center justify-center gap-1.5 text-sm bg-success-600 hover:bg-success-700 text-white px-3 py-2 rounded-lg font-medium">
                        <CheckCircle2 className="w-4 h-4" /> รับงาน
                      </button>
                      {/* Pronista §Assign/Accept audit (2026-09-03) — ก่อนหน้านี้มีแต่ "รับงาน" ทางเดียว ไม่มีทางปฏิเสธอย่างเป็นทางการเลย */}
                      <button onClick={() => void reject()} className="w-full flex items-center justify-center gap-1.5 text-sm border border-border-subtle text-dim hover:bg-hover hover:text-danger-600 px-3 py-2 rounded-lg">
                        <XCircle className="w-4 h-4" /> ปฏิเสธงาน
                      </button>
                    </>
                  ) : done ? null : t.status === 'waiting_for_test' ? (
                    // Pronista §ดึงงานกลับ (2026-08-26) — ส่งไปแล้วแต่ยังไม่ถูกอนุมัติ/ตีกลับ ดึงกลับมาแก้ไขต่อเองได้
                    <>
                      <div className="bg-info-50 text-info-700 text-xs rounded-lg px-3 py-2 mb-1">ส่งงานแล้ว รอผู้จ่ายงานตรวจ</div>
                      <button onClick={() => void patchNow({ status: 'on_processing' })} className="w-full flex items-center justify-center gap-1.5 text-sm border border-border-subtle text-dim hover:bg-hover px-3 py-2 rounded-lg font-medium">
                        <RotateCcw className="w-4 h-4" /> ดึงงานกลับ
                      </button>
                      {isSelfKeyed && (
                        <button onClick={() => void patchNow({ status: 'done' })} className="w-full flex items-center justify-center gap-1.5 text-sm bg-success-600 hover:bg-success-700 text-white px-3 py-2 rounded-lg font-medium">
                          <Check className="w-4 h-4" /> ปิดงานเอง
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button onClick={() => void patchNow({ status: 'waiting_for_test' })} className="w-full flex items-center justify-center gap-1.5 text-sm bg-success-600 hover:bg-success-700 text-white px-3 py-2 rounded-lg font-medium">
                        <CheckCircle2 className="w-4 h-4" /> ส่งงาน
                      </button>
                      {isSelfKeyed && (
                        // Pronista §Kanban drag constraints 3.2 — ผู้คีย์งานเองปิดงานได้ทันทีโดยไม่ต้องผ่านขั้นตอนอนุมัติ
                        <button onClick={() => void patchNow({ status: 'done' })} className="w-full flex items-center justify-center gap-1.5 text-sm border border-success-200 text-success-700 hover:bg-success-50 px-3 py-2 rounded-lg font-medium">
                          <Check className="w-4 h-4" /> ปิดงานเอง
                        </button>
                      )}
                    </>
                  )
                ) : !t.dispatchedAt ? (
                  // Pronista §Back to Basic (ต่อยอด) — เกตจ่ายงาน: ต้องกดก่อนงานถึงจะโผล่ในหน้า "งานของฉัน" ของผู้รับผิดชอบ
                  <>
                    <button onClick={() => void dispatch()} disabled={!t.assigneeId || dispatching} title={!t.assigneeId ? 'เลือกผู้รับผิดชอบก่อน' : undefined} className="w-full flex items-center justify-center gap-1.5 text-sm bg-success-600 hover:bg-success-700 text-white px-3 py-2 rounded-lg disabled:opacity-40 font-medium">
                      <CheckCircle2 className="w-4 h-4" /> จ่ายงาน
                    </button>
                    <button onClick={deleteTask} className="w-full flex items-center justify-center gap-1.5 text-sm text-muted hover:text-danger-600 px-3 py-2 rounded-lg"><Trash2 className="w-3.5 h-3.5" /> ลบงานนี้</button>
                  </>
                ) : t.status === 'non_start' ? (
                  // Pronista §Task lifecycle accept step — จ่ายแล้วแต่ assignee ยังไม่กดรับงาน กด "อนุมัติปิดงาน" ก่อนไม่ได้
                  <>
                    <div className="text-xs text-muted text-center py-2">รอ{t.assigneeName ? ` ${t.assigneeName}` : ''}กดรับงาน</div>
                    <button onClick={deleteTask} className="w-full flex items-center justify-center gap-1.5 text-sm text-muted hover:text-danger-600 px-3 py-2 rounded-lg"><Trash2 className="w-3.5 h-3.5" /> ลบงานนี้</button>
                  </>
                ) : (
                  <>
                    {t.status === 'waiting_for_test' && (
                      <div className="bg-info-50 text-info-700 text-xs rounded-lg px-3 py-2 mb-1">งานนี้ส่งมารอตรวจอยู่ — เช็คแล้วกดอนุมัติได้เลย</div>
                    )}
                    <button onClick={() => void patchNow({ status: 'done' })} disabled={done} className="w-full flex items-center justify-center gap-1.5 text-sm bg-success-600 hover:bg-success-700 text-white px-3 py-2 rounded-lg disabled:opacity-40 font-medium">
                      <CheckCircle2 className="w-4 h-4" /> อนุมัติ ปิดงาน
                    </button>
                    {t.status === 'waiting_for_test' && (
                      <button onClick={() => void patchNow({ status: 'non_start' })} className="w-full flex items-center justify-center gap-1.5 text-sm border border-border-subtle text-dim hover:bg-hover px-3 py-2 rounded-lg">
                        <RotateCcw className="w-4 h-4" /> ตีกลับ ให้แก้ไข
                      </button>
                    )}
                    <button onClick={deleteTask} className="w-full flex items-center justify-center gap-1.5 text-sm text-muted hover:text-danger-600 px-3 py-2 rounded-lg"><Trash2 className="w-3.5 h-3.5" /> ลบงานนี้</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {linkPickerOpen && (
        <TaskPickerModal
          title="เชื่อมโยงกับรายการอื่น"
          tasks={(linkPickerCandidates ?? []).filter((pt) => pt.id !== t.id)}
          excludeIds={(refs ?? []).map((r) => r.id)}
          onPick={(picked) => void addReference(picked)}
          onClose={() => setLinkPickerOpen(false)}
        />
      )}

      {templatePickerOpen && (
        <TemplatePickerModal parentId={null} onClose={() => setTemplatePickerOpen(false)} onCreated={(docId) => void onTemplateDocCreated(docId)} />
      )}

      {docUploadPending && (
        <div className="fixed inset-0 z-50">
          <div onClick={() => { setDocUploadPending(null); setDocTypeForUpload('') }} className="absolute inset-0 bg-ink/30" />
          <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-sm px-4">
            <div className="bg-white rounded-lg shadow-2xl p-5">
              <div className="font-semibold text-ink text-sm mb-1">อัปโหลด — {docUploadPending.name}</div>
              <p className="text-xs text-muted mb-3">เลือกประเภทเอกสาร (บังคับ) เพื่อให้ระบบติดตาม traceability ได้ถูกต้อง</p>
              <select
                value={docTypeForUpload}
                onChange={(e) => setDocTypeForUpload(e.target.value as TaskDocType | '')}
                className="w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400 mb-4"
              >
                <option value="">เลือกประเภท…</option>
                {TASK_DOC_TYPES.map((dt) => <option key={dt} value={dt}>{dt}</option>)}
              </select>
              <div className="flex justify-end gap-2">
                <button onClick={() => { setDocUploadPending(null); setDocTypeForUpload('') }} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
                <button onClick={() => void confirmDocUpload()} disabled={!docTypeForUpload} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">อัปโหลด</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {existingDocPickerOpen && (
        <div className="fixed inset-0 z-50">
          <div onClick={() => setExistingDocPickerOpen(false)} className="absolute inset-0 bg-ink/30" />
          <div className="absolute inset-x-0 top-10 mx-auto w-full max-w-md px-4">
            <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold text-ink text-sm">ผูกเอกสารที่มีอยู่แล้ว</div>
                <button onClick={() => setExistingDocPickerOpen(false)} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
              </div>
              <input
                autoFocus
                value={existingDocQuery}
                onChange={(e) => setExistingDocQuery(e.target.value)}
                placeholder="ค้นหาชื่อเอกสาร..."
                className="w-full text-sm bg-white border border-border rounded-lg px-3 py-2 mb-2 focus:outline-hidden focus:border-brand-400"
              />
              <div className="overflow-y-auto -mx-2 px-2">
                {(() => {
                  const linkedIds = new Set(t.linkedDocuments.map((d) => d.id))
                  const needle = existingDocQuery.trim().toLowerCase()
                  const filtered = (projectDocs ?? [])
                    .filter((d) => !linkedIds.has(d.id))
                    .filter((d) => !needle || d.title.toLowerCase().includes(needle))
                    .slice(0, 50)
                  if (filtered.length === 0) return <div className="text-xs text-muted text-center py-6">ไม่พบเอกสารที่ตรงกับคำค้น</div>
                  return filtered.map((d) => (
                    <button key={d.id} onClick={() => void linkExistingDoc(d.id)} className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-hover flex items-center gap-2">
                      {d.docType && <span className="text-[10px] font-mono bg-info-50 text-info-700 px-1.5 py-0.5 rounded shrink-0">{d.docType}</span>}
                      <span className="text-sm text-body truncate">{d.title}</span>
                    </button>
                  ))
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
