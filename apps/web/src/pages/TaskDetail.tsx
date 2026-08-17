import { formatHMS, minutesToHoursLabel, resolveLabels, type Label } from '@seedoffice/core'
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
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Avatar } from '../components/Avatar'
import { DateInputTH } from '../components/DateInputTH'
import { useDialog } from '../components/Dialog'
import { LabelChips } from '../components/LabelChips'
import { STATUS_SWATCH } from '../lib/project-ui'
import { TaskPickerModal, type PickableTask } from '../components/TaskPickerModal'
import { TemplatePickerModal } from '../components/doc-templates/TemplatePickerModal'

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
function TimeSection({ taskId, hasProject, rows, reload }: { taskId: string; hasProject: boolean; rows: TimeRow[]; reload: () => Promise<unknown> }) {
  const { user } = useAuth()
  const timer = useTimer()
  const { confirmDialog } = useDialog()
  const [manualOpen, setManualOpen] = useState(false)
  const [mForm, setMForm] = useState({ date: bkkToday(), hours: '', note: '' })
  const [mError, setMError] = useState('')
  const [editRow, setEditRow] = useState<TimeRow | null>(null)

  const isRunningHere = timer.active?.taskId === taskId
  const taskSeconds = rows.filter((r) => r.userId === user?.id && r.workDate === bkkToday()).reduce((s, r) => s + r.minutes * 60, 0)

  const addManual = async () => {
    try {
      setMError('')
      const minutes = Math.round(Number(mForm.hours) * 60)
      await api.post(`/api/tasks/${taskId}/time`, { workDate: mForm.date, minutes, note: mForm.note || undefined })
      setManualOpen(false)
      setMForm({ date: bkkToday(), hours: '', note: '' })
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
  assigneeId: string | null
  assigneeName: string | null
  // Pronista §Back to Basic (ต่อยอด) — เกตจ่ายงาน: null = ยังไม่จ่าย (ยังไม่โผล่ในหน้า "งานของฉัน" ของ assignee)
  dispatchedAt: number | null
  createdBy: string
  myRole: 'owner' | 'editor' | 'viewer'
  sprintActive: boolean
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
const DEFECT_STATUS_ORDER = ['reported', 'fixing', 'waiting_verify', 'closed'] as const
const DEFECT_STATUS_LABEL = { reported: 'รอเริ่ม', fixing: 'กำลังแก้', waiting_verify: 'รอ Verify', closed: 'ปิด' } as const
const DEFECT_STATUS_CLASS = { reported: 'bg-divider text-dim', fixing: 'bg-warning-50 text-warning-700', waiting_verify: 'bg-info-50 text-info-700', closed: 'bg-success-50 text-success-700' } as const
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
  'time_entry.create': 'ลงเวลา',
  'time_entry.update': 'แก้เวลา',
  'time_entry.delete': 'ลบเวลา',
}
// Pronista §System Requirements Update — แท็บ "ประวัติการเปลี่ยนแปลง" แยกจากฟีดคอมเมนต์ — เฉพาะ action ที่เป็นความเคลื่อนไหวของสถานะ/ผู้รับผิดชอบงาน (ไม่รวมคอมเมนต์/แนบไฟล์/เวลา)
const HISTORY_ACTIONS = new Set(['task.create', 'task.status', 'task.assign', 'task.dispatch', 'task.accept', 'task.done', 'task.convert'])
function isTaskStatus(v: unknown): v is { status: TaskStatus } {
  return !!v && typeof v === 'object' && typeof (v as { status?: unknown }).status === 'string' && (v as { status: string }).status in TASK_STATUS_LABEL
}
const DELETE_TASK_ERROR_LABEL = {
  has_time_entries: 'ลบไม่ได้ เพราะมีการลงเวลาในงานนี้แล้ว (ข้อมูลการเงิน) — ย้ายเวลาไปงานอื่นก่อน หรือเก็บงานนี้ไว้เฉยๆ',
  has_subtasks: 'ลบไม่ได้ เพราะยังมีงานย่อยอยู่ — ลบหรือย้ายงานย่อยออกก่อน',
} as const
const fmtWhen = (ms: number) => new Date(ms).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Pronista §Task Detail redesign — หน้าเต็มหน้าแทน TaskDrawer เดิม (Drawer แคบไป ยัดทุกอย่างไว้ไม่มีที่หายใจ)
 * แบ่ง 2 คอลัมน์ + จัดลำดับ/เน้นเนื้อหาต่างกันอัตโนมัติตาม "ใครเปิดดู": assignee ของงานนี้ (t.assigneeId === user.id) vs คนอื่นที่แก้ไขได้ (ถือเป็นฝั่งคนจ่ายงาน)
 * ไม่แตะระบบสิทธิ์เดิม (canEdit = owner/editor ของโปรเจกต์) — แค่จัดการมองเห็น/ปุ่มลัดให้คนที่มีสิทธิ์แก้ไขอยู่แล้ว */
export function TaskDetailPage() {
  const { id: taskId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { confirmDialog, promptDialog } = useDialog()
  const { data: t, reload } = useLoad<Detail>(() => api.get(`/api/tasks/${taskId}/detail`), [taskId])
  // Pronista §Task Detail permission fix — คนที่ถูก assign งานนี้ แก้ไข "งานของตัวเอง" ได้เสมอ แม้ project role เป็นแค่ viewer/ไม่ได้เป็นสมาชิกโปรเจกต์เลย
  const canEdit = user?.role !== 'vendor' && user?.role !== 'guest' && (t?.myRole === 'owner' || t?.myRole === 'editor' || t?.assigneeId === user?.id)
  const { data: userOpts } = useLoad<UserOpt[]>(() => api.get('/api/users'))
  // Pronista §Workspace — แคตตาล็อกแท็กสี ใช้แสดง+เลือกในแถบข้าง
  const { data: cfg } = useLoad<{ labels: Label[] }>(() => api.get('/api/config'))
  const [labelPickerOpen, setLabelPickerOpen] = useState(false)
  // Pronista §System Requirements Update — สลับฟีด "ความเคลื่อนไหวทั้งหมด" (คอมเมนต์+ประวัติ) กับ "ประวัติการเปลี่ยนแปลง" (เฉพาะสถานะ/ผู้รับผิดชอบ ไม่มีคอมเมนต์)
  const [feedTab, setFeedTab] = useState<'all' | 'history'>('all')
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
  const [descDraft, setDescDraft] = useState<string | null>(null)
  const [assigneeNotesDraft, setAssigneeNotesDraft] = useState<string | null>(null)
  const [refCodeDraft, setRefCodeDraft] = useState<string | null>(null)
  const [newSubtask, setNewSubtask] = useState('')
  const [newSubtaskCode, setNewSubtaskCode] = useState('')
  const [newChecklistText, setNewChecklistText] = useState('')
  const [renamingAttachment, setRenamingAttachment] = useState<{ id: string; draft: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Pronista §Back to Basic — สร้าง/อัปโหลดเอกสารมีประเภท (MOM/BRD/SOW/SRS/PEP/UIR/CR) หรือผูกเอกสารที่มีอยู่แล้ว ตรงจากหน้านี้เลย
  const [docMenuOpen, setDocMenuOpen] = useState(false)
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

  if (!t) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>

  const patch = async (data: Record<string, unknown>) => {
    await api.patch(`/api/tasks/${t.id}`, data)
    await reload()
  }
  // Pronista §Back to Basic (ต่อยอด) — เกตจ่ายงาน: กดแล้วงานถึงจะโผล่ในหน้า "งานของฉัน" ของ assignee
  const dispatch = async () => {
    await api.post(`/api/tasks/${t.id}/dispatch`, {})
    await reload()
  }
  // Pronista §Task lifecycle accept step — assignee กดรับงานเอง ถึงจะเปลี่ยนเป็นกำลังทำ
  const accept = async () => {
    await api.post(`/api/tasks/${t.id}/accept`, {})
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
      alert('ลิงก์ไม่ถูกต้อง ลองใหม่อีกครั้ง (ต้องขึ้นต้นด้วย https://)')
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
      alert('อัปโหลดไม่สำเร็จ — รับเฉพาะ Word (.docx/.doc) และ PDF ขนาดไม่เกิน 15MB')
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
  const done = t.status === 'done'
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
          {t.code && <span className="text-xs font-mono text-muted bg-hover border border-border-subtle rounded px-1.5 py-0.5">{t.code}</span>}
          <div className="flex items-start gap-2.5 mt-2">
            <button
              onClick={() => canEdit && !isAssignee && void patch({ status: done ? 'non_start' : 'done' })}
              title={canEdit && !isAssignee ? (done ? 'ยกเลิกเสร็จ' : 'ทำเครื่องหมายว่าเสร็จ') : 'ต้องมีสิทธิ์แก้ไข (ผู้จ่ายงาน) ในโปรเจกต์นี้'}
              className={`shrink-0 mt-0.5 w-7 h-7 rounded-lg border-2 grid place-items-center transition ${done ? 'border-brand-500 bg-brand-500 text-white' : 'border-border hover:border-brand-400'} ${canEdit && !isAssignee ? '' : 'opacity-60 cursor-default'}`}
            >
              {done && <Check className="w-4 h-4" />}
            </button>
            <h1 className={`text-xl font-semibold text-wrap ${done ? 'text-muted line-through' : 'text-ink'}`}>{t.title}</h1>
          </div>
          {t.srsRefCode && t.srsDocId && (
            <a href={`/docs/${t.srsDocId}`} target="_blank" rel="noreferrer" title={t.srsSourceCode ? `อ้างอิงข้อ ${t.srsSourceCode} ในเอกสาร SRS` : 'เปิดเอกสาร SRS ต้นทาง'} className="inline-flex items-center gap-1 text-[11px] font-mono bg-info-50 text-info-700 px-1.5 py-0.5 rounded mt-2 hover:bg-info-100">
              📄 {t.srsRefCode}
            </a>
          )}
        </div>

        {/* Pronista §System Requirements Update — ย้ายแท็บ "ประวัติการเปลี่ยนแปลง" ขึ้นมาไว้ใต้หัวเรื่องเลย ไม่ต้องเลื่อนลงไปหาในฟีดด้านล่าง */}
        <div className="px-5 pt-3 border-b border-border-subtle">
          <div className="flex bg-divider rounded-lg p-0.5 text-xs font-medium w-fit mb-3">
            <button onClick={() => setFeedTab('all')} className={`px-2.5 py-1 rounded-md ${feedTab === 'all' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>รายละเอียด</button>
            <button onClick={() => setFeedTab('history')} className={`px-2.5 py-1 rounded-md ${feedTab === 'history' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>ประวัติการเปลี่ยนแปลง</button>
          </div>
        </div>

        {feedTab === 'history' ? (
          <div className="p-5 space-y-3">
            {historyFeed.length === 0 && <div className="text-sm text-border">ยังไม่มีประวัติการเปลี่ยนแปลง</div>}
            {historyFeed.map((f) => (
              <div key={`h-${f.id}`} className="flex gap-2 text-xs">
                <Avatar name={f.actorName} avatarUrl={f.actorAvatarUrl} className="w-5 h-5 text-[9px]" colorClass={avatarColor(f.actorName)} />
                <div className="flex-1 leading-snug pt-0.5">
                  <b className="text-body">{f.actorName}</b>{' '}<span className="text-dim">{ACTION_LABEL[f.action] ?? f.action}</span>{' '}<span className="text-muted">· {fmtWhen(f.at)}</span>
                  {f.action === 'task.status' && isTaskStatus(f.meta?.before) && isTaskStatus(f.meta?.after) && (
                    <div className="text-[11px] text-muted mt-0.5">{TASK_STATUS_LABEL[f.meta.before.status]} → {TASK_STATUS_LABEL[f.meta.after.status]}</div>
                  )}
                  {f.action === 'task.convert' && typeof f.meta?.oldCode === 'string' && typeof f.meta?.newCode === 'string' && f.meta.oldCode !== f.meta.newCode && (
                    <div className="text-[11px] font-mono text-muted mt-0.5">{f.meta.oldCode} → {f.meta.newCode}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
        <div className="grid md:grid-cols-[1fr_300px]">
          <div className="p-5 space-y-6 border-b md:border-b-0 md:border-r border-border-subtle min-w-0">

            <div>
              <div className="text-xs font-medium text-muted mb-1.5">รายละเอียดจากผู้จ่ายงาน</div>
              {canEdit && !isAssignee ? (
                <textarea
                  value={descDraft ?? t.description ?? ''}
                  onChange={(e) => setDescDraft(e.target.value)}
                  onBlur={() => { if (descDraft !== null && descDraft !== (t.description ?? '')) void patch({ description: descDraft || null }) }}
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
                  value={assigneeNotesDraft ?? t.assigneeNotes ?? ''}
                  onChange={(e) => setAssigneeNotesDraft(e.target.value)}
                  onBlur={() => { if (assigneeNotesDraft !== null && assigneeNotesDraft !== (t.assigneeNotes ?? '')) void patch({ assigneeNotes: assigneeNotesDraft || null }) }}
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
              <div className="text-xs font-medium text-muted mb-2">งานย่อย <span className="text-border">({t.subtasks.length})</span></div>
              {t.subtasks.length === 0 && <div className="text-sm text-border mb-2">ยังไม่มีงานย่อย</div>}
              <div className="space-y-1 mb-2">
                {t.subtasks.map((s) => (
                  <button key={s.id} onClick={() => navigate(`/tasks/${s.id}`)} className="w-full flex items-center gap-2 text-left text-sm bg-hover hover:bg-divider rounded-lg px-2.5 py-1.5">
                    <span className={`w-4 h-4 rounded border shrink-0 grid place-items-center ${s.status === 'done' ? 'border-brand-500 bg-brand-500 text-white' : 'border-border'}`}>
                      {s.status === 'done' && <Check className="w-3 h-3" />}
                    </span>
                    {s.code && <span className="text-[11px] font-mono text-muted shrink-0">{s.code}</span>}
                    <span className={`flex-1 truncate ${s.status === 'done' ? 'text-muted line-through' : 'text-body'}`}>{s.title}</span>
                    {s.originCode && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-info-100 text-info-700 shrink-0">{s.originCode}</span>}
                    {s.estimateMinutes != null && <span className="text-[11px] text-muted shrink-0">{minutesToHoursLabel(s.estimateMinutes)} ชม.</span>}
                    {s.assigneeName && <span className="text-[11px] text-muted shrink-0">{s.assigneeName}</span>}
                  </button>
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
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {t.attachments.map((a) => (
                  <div key={a.id} className="group relative aspect-square rounded-lg bg-divider overflow-hidden">
                    {renamingAttachment?.id === a.id ? (
                      <div className="w-full h-full grid place-items-center p-2">
                        <input
                          autoFocus
                          value={renamingAttachment.draft}
                          onChange={(e) => setRenamingAttachment({ id: a.id, draft: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void renameAttachment(a.id, renamingAttachment.draft).then(() => setRenamingAttachment(null))
                            if (e.key === 'Escape') setRenamingAttachment(null)
                          }}
                          onBlur={() => void renameAttachment(a.id, renamingAttachment.draft).then(() => setRenamingAttachment(null))}
                          className="w-full text-[11px] text-center bg-white border border-brand-400 rounded px-1 py-1 focus:outline-hidden"
                        />
                      </div>
                    ) : a.externalUrl ? (
                      <a href={a.externalUrl} target="_blank" rel="noreferrer" className="w-full h-full grid place-items-center text-muted p-2 text-center">
                        <span><Link2 className="w-5 h-5 mx-auto mb-1" /><span className="text-[10px] break-all line-clamp-2">{a.filename}</span></span>
                      </a>
                    ) : a.mime?.startsWith('image/') ? (
                      <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer"><img src={`/api/attachments/${a.id}`} alt={a.filename} className="w-full h-full object-cover" /></a>
                    ) : (
                      <a href={`/api/attachments/${a.id}`} className="w-full h-full grid place-items-center text-muted p-2 text-center">
                        <span><FileText className="w-5 h-5 mx-auto mb-1" /><span className="text-[10px] break-all line-clamp-2">{a.filename}</span></span>
                      </a>
                    )}
                    {canEdit && renamingAttachment?.id !== a.id && (
                      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100">
                        <button onClick={() => setRenamingAttachment({ id: a.id, draft: a.filename })} className="w-5 h-5 grid place-items-center rounded bg-ink/60 text-white" title="เปลี่ยนชื่อ"><Pencil className="w-3 h-3" /></button>
                        <button onClick={() => void removeAttachment(a.id)} className="w-5 h-5 grid place-items-center rounded bg-ink/60 text-white" title="ลบ"><X className="w-3 h-3" /></button>
                      </div>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <button onClick={() => fileRef.current?.click()} className="aspect-square rounded-lg border-2 border-dashed border-border-subtle grid place-items-center text-muted hover:border-brand-300 hover:text-brand-600" title="แนบไฟล์"><Plus className="w-5 h-5" /></button>
                )}
                {canEdit && (
                  <button onClick={() => void addLink()} className="aspect-square rounded-lg border-2 border-dashed border-border-subtle grid place-items-center text-muted hover:border-brand-300 hover:text-brand-600" title="แนบลิงก์ (Google Docs/Figma/Canva)"><Link2 className="w-5 h-5" /></button>
                )}
                {canEdit && !isAssignee && (
                  <div className="relative aspect-square">
                    <button onClick={() => setDocMenuOpen((v) => !v)} className="w-full h-full rounded-lg border-2 border-dashed border-border-subtle grid place-items-center text-muted hover:border-brand-300 hover:text-brand-600" title="สร้าง/ผูกเอกสาร MOM/BRD/SOW/SRS/PEP/UIR/CR">
                      <FileText className="w-5 h-5" />
                    </button>
                    {docMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setDocMenuOpen(false)} />
                        <div className="absolute left-0 top-full mt-1 w-52 bg-white rounded-lg shadow-lg border border-border-subtle py-1 z-20 text-xs">
                          <button onClick={() => { setDocMenuOpen(false); setTemplatePickerOpen(true) }} className="w-full text-left px-3 py-1.5 text-body hover:bg-hover">📄 สร้างจาก Template</button>
                          <button onClick={() => { setDocMenuOpen(false); docUploadRef.current?.click() }} className="w-full text-left px-3 py-1.5 text-body hover:bg-hover">⬆️ อัปโหลดไฟล์</button>
                          <button onClick={() => { setDocMenuOpen(false); setExistingDocPickerOpen(true) }} className="w-full text-left px-3 py-1.5 text-body hover:bg-hover">🔗 ผูกเอกสารที่มีอยู่แล้ว</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
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
                          value={refCodeDraft ?? t.originCode ?? ''}
                          onChange={(e) => setRefCodeDraft(e.target.value)}
                          onBlur={() => { if (refCodeDraft !== null && refCodeDraft !== (t.originCode ?? '')) void patch({ originCode: refCodeDraft || null }) }}
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

            <div>
              <div className="text-xs font-medium text-muted mb-2">ความเคลื่อนไหว</div>
              <div className="space-y-3">
                {feed.length === 0 && <div className="text-sm text-border">ยังไม่มีความเคลื่อนไหว</div>}
                {feed.map((f) =>
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
                      </div>
                    </div>
                  ),
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void postComment() }} className="flex-1 text-sm bg-white shadow-xs rounded-lg px-3 py-2" placeholder="เพิ่มความเห็น..." />
                {isAssignee && (
                  <button onClick={() => void reportBlocked()} className="bg-danger-50 hover:bg-danger-100 text-danger-700 px-3 rounded-lg text-sm shrink-0 flex items-center gap-1" title="แจ้งติดขัด">
                    <AlertTriangle className="w-4 h-4" /> ติดขัด
                  </button>
                )}
                <button onClick={() => void postComment()} className="bg-brand-600 hover:bg-brand-700 text-white px-3 rounded-lg shrink-0" title="ส่ง"><Send className="w-4 h-4" /></button>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-5 bg-hover/40">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">สถานะ</span>
                {/* Pronista §Back to Basic (ต่อยอด) — ฝั่ง assignee เปลี่ยนสถานะเองอิสระไม่ได้แล้ว (กัน jump ข้ามขั้น) ต้องผ่านปุ่ม "ส่งงาน" เท่านั้น */}
                {canEdit && !isAssignee ? (
                  <select value={t.status} onChange={(e) => void patch({ status: e.target.value as TaskStatus })} aria-label="สถานะ" className={`px-2 py-1 rounded-lg text-xs ${TASK_STATUS_BADGE[t.status]}`}>
                    {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
                  </select>
                ) : (
                  <span className={`px-2 py-1 rounded-lg text-xs ${TASK_STATUS_BADGE[t.status]}`}>{TASK_STATUS_LABEL[t.status]}</span>
                )}
              </div>
              {t.kind === 'defect' && t.defectStatus && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Defect</span>
                  {canEdit && !isAssignee ? (
                    <select value={t.defectStatus} onChange={(e) => void patch({ defectStatus: e.target.value })} aria-label="สถานะ Defect" className={`px-2 py-1 rounded-lg text-xs ${DEFECT_STATUS_CLASS[t.defectStatus]}`}>
                      {DEFECT_STATUS_ORDER.map((s) => <option key={s} value={s}>{DEFECT_STATUS_LABEL[s]}</option>)}
                    </select>
                  ) : (
                    <span className={`px-2 py-1 rounded-lg text-xs ${DEFECT_STATUS_CLASS[t.defectStatus]}`}>{DEFECT_STATUS_LABEL[t.defectStatus]}</span>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">ผู้รับผิดชอบ</span>
                {canEdit && !isAssignee ? (
                  <select value={t.assigneeId ?? ''} onChange={(e) => void patch({ assigneeId: e.target.value || null })} aria-label="ผู้รับผิดชอบ" className="bg-white text-soft px-2 py-1 rounded-lg text-xs">
                    <option value="">— ไม่ระบุ —</option>
                    {(userOpts ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                ) : (
                  t.assigneeName && <span className="bg-white text-soft px-2 py-1 rounded-lg text-xs">{t.assigneeName}</span>
                )}
              </div>
              {!isAssignee && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">ความสำคัญ</span>
                  {canEdit ? (
                    <select value={t.priority} onChange={(e) => void patch({ priority: e.target.value })} aria-label="ความสำคัญ" className={`px-2 py-1 rounded-lg text-xs ${PRIORITY_CLASS[t.priority]}`}>
                      {(['low', 'normal', 'high'] as const).map((p) => <option key={p} value={p}>{PRIORITY_THAI[p]}</option>)}
                    </select>
                  ) : (
                    <span className={`px-2 py-1 rounded-lg text-xs ${PRIORITY_CLASS[t.priority]}`}>{PRIORITY_THAI[t.priority]}</span>
                  )}
                </div>
              )}
              {!isAssignee && (
                <div className="flex items-start justify-between text-sm gap-2">
                  <span className="text-muted shrink-0 pt-1">Labels</span>
                  <div className="flex-1 flex flex-col items-end gap-1.5">
                    <LabelChips catalog={cfg?.labels} ids={t.labelIds} />
                    {canEdit && (
                      <div className="relative">
                        <button type="button" onClick={() => setLabelPickerOpen((v) => !v)} className="text-xs text-brand-700 hover:text-brand-800 flex items-center gap-1">
                          <Plus className="w-3 h-3" /> แท็ก
                        </button>
                        {labelPickerOpen && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setLabelPickerOpen(false)} />
                            <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-white rounded-lg shadow-2xl border border-border-subtle p-2 space-y-1">
                              {resolveLabels(cfg?.labels).map((l) => {
                                const active = (t.labelIds ?? []).includes(l.id)
                                return (
                                  <button
                                    key={l.id}
                                    type="button"
                                    onClick={() => {
                                      const next = active ? (t.labelIds ?? []).filter((id) => id !== l.id) : [...(t.labelIds ?? []), l.id]
                                      void patch({ labelIds: next })
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
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">กำหนดส่ง</span>
                {canEdit && !isAssignee ? (
                  <DateInputTH value={t.dueDate ?? ''} onChange={(v) => void patch({ dueDate: v || null })} className="text-xs bg-white shadow-xs rounded-lg px-2 py-1" />
                ) : (
                  <span className="text-ink font-medium">{t.dueDate ?? '—'}</span>
                )}
              </div>
              {canEdit && !isAssignee && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">เริ่ม</span>
                  <DateInputTH value={t.startDate ?? ''} onChange={(v) => void patch({ startDate: v || null })} className="text-xs bg-white shadow-xs rounded-lg px-2 py-1" />
                </div>
              )}
              {!isAssignee && canEdit && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">ประเมิน (ชม.)</span>
                  <input type="number" defaultValue={t.estimateMinutes != null ? t.estimateMinutes / 60 : ''} onBlur={(e) => void patch({ estimateMinutes: e.target.value ? Math.round(Number(e.target.value) * 60) : null })} className="w-16 text-xs bg-white shadow-xs rounded-lg px-2 py-1" />
                </div>
              )}
            </div>

            {t.sprintActive ? (
              <div className="border-t border-border-subtle pt-4">
                <TimeSection taskId={t.id} hasProject={t.projectName !== null} rows={timeRows ?? []} reload={reloadTime} />
              </div>
            ) : (
              <div className="text-[11px] text-muted border-t border-border-subtle pt-4">ลงเวลาได้เมื่องานอยู่ใน Sprint ที่กด "เริ่ม Sprint" แล้วเท่านั้น</div>
            )}

            {!isAssignee && t.estimateMinutes != null && (
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

            {canEdit && (
              <div className="border-t border-border-subtle pt-4 space-y-2">
                {isAssignee ? (
                  // Pronista §Task lifecycle accept step — ยังไม่จ่าย (dispatchedAt ว่าง) → คนที่ถูก assign เอง (self-assign) ก็ต้องกด "จ่ายงาน" ได้เหมือน flow ปกติ (เดิมมีแต่ข้อความเฉยๆ ไม่มีปุ่มเลย ทำให้ self-assign ค้าง ไปต่อไม่ได้ด้วยตัวเอง) · จ่ายแล้วแต่ยังไม่กดรับ (status ยังเป็น non_start) → ปุ่ม "รับงาน" · รับแล้ว → ปุ่ม "ส่งงาน" เดิม
                  !t.dispatchedAt ? (
                    <>
                      <button onClick={() => void dispatch()} className="w-full flex items-center justify-center gap-1.5 text-sm bg-success-600 hover:bg-success-700 text-white px-3 py-2 rounded-lg font-medium">
                        <CheckCircle2 className="w-4 h-4" /> จ่ายงาน (ให้ตัวเอง)
                      </button>
                      <div className="text-[11px] text-muted text-center">งานนี้ยังไม่ถูกจ่ายอย่างเป็นทางการ — กด "จ่ายงาน" เพื่อเริ่มทำได้เลย</div>
                    </>
                  ) : t.status === 'non_start' ? (
                    <button onClick={() => void accept()} className="w-full flex items-center justify-center gap-1.5 text-sm bg-success-600 hover:bg-success-700 text-white px-3 py-2 rounded-lg font-medium">
                      <CheckCircle2 className="w-4 h-4" /> รับงาน
                    </button>
                  ) : (
                    <button onClick={() => void patch({ status: 'waiting_for_test' })} disabled={t.status === 'waiting_for_test' || done} className="w-full flex items-center justify-center gap-1.5 text-sm bg-success-600 hover:bg-success-700 text-white px-3 py-2 rounded-lg disabled:opacity-40 font-medium">
                      <CheckCircle2 className="w-4 h-4" /> ส่งงาน
                    </button>
                  )
                ) : !t.dispatchedAt ? (
                  // Pronista §Back to Basic (ต่อยอด) — เกตจ่ายงาน: ต้องกดก่อนงานถึงจะโผล่ในหน้า "งานของฉัน" ของผู้รับผิดชอบ
                  <>
                    <button onClick={() => void dispatch()} disabled={!t.assigneeId} title={!t.assigneeId ? 'เลือกผู้รับผิดชอบก่อน' : undefined} className="w-full flex items-center justify-center gap-1.5 text-sm bg-success-600 hover:bg-success-700 text-white px-3 py-2 rounded-lg disabled:opacity-40 font-medium">
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
                    <button onClick={() => void patch({ status: 'done' })} disabled={done} className="w-full flex items-center justify-center gap-1.5 text-sm bg-success-600 hover:bg-success-700 text-white px-3 py-2 rounded-lg disabled:opacity-40 font-medium">
                      <CheckCircle2 className="w-4 h-4" /> อนุมัติ ปิดงาน
                    </button>
                    {t.status === 'waiting_for_test' && (
                      <button onClick={() => void patch({ status: 'non_start' })} className="w-full flex items-center justify-center gap-1.5 text-sm border border-border-subtle text-dim hover:bg-hover px-3 py-2 rounded-lg">
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
