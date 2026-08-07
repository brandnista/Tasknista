import { CheckCircle2, ChevronLeft, ChevronRight, FileText, GripVertical, History, LayoutTemplate, Link2, MoreVertical, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import { formatSatang, minutesToHoursLabel, type Label, type PermissionTabKey, type PositionPermissions } from '@seedoffice/core'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Avatar } from '../components/Avatar'
import { BacklogConvertMenu, CONVERT_LABEL } from '../components/BacklogConvertMenu'
import { LabelChips } from '../components/LabelChips'
import { ConvertBacklogModal } from '../components/ConvertBacklogModal'
import { ProjectIcon } from '../components/ProjectIcon'
import { SowUploadBreakoutModal } from '../components/SowUploadBreakoutModal'
import { TaskPickerModal, type PickableTask } from '../components/TaskPickerModal'
import { LinkOrCreateModal } from '../components/LinkOrCreateModal'
import { DocumentHistoryTable } from '../components/DocumentHistoryTable'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtThaiDate, statusChip, type ProjectRow } from '../lib/project-ui'
import { TASK_STATUS_BADGE, TASK_STATUS_LABEL, type TaskStatus } from '../lib/task-status'
import { useLoad } from '../lib/useLoad'

export interface BoardTask {
  id: string
  groupId: string
  sortOrder: number
  title: string
  description: string | null
  priority: 'low' | 'normal' | 'high'
  assigneeId: string | null
  assigneeName: string | null
  assigneeAvatarUrl: string | null
  status: TaskStatus
  estimateMinutes: number | null
  startDate: string | null
  dueDate: string | null
  starredToday: boolean
  // Pronista §SRS import — chip อ้างอิงเอกสาร SRS ต้นทาง (ไม่มีถ้าไม่ได้มาจาก SRS)
  srsRefCode?: string | null
  srsDocId?: string | null
}
export interface BoardGroup {
  id: string
  name: string
  sortOrder: number
  tasks: BoardTask[]
}
// จานสีตกแต่งสำหรับ avatar ทีม (อิสระจาก semantic token — ตั้งใจใช้สีดิบ)
const AVATAR_COLORS = ['bg-brand-100 text-brand-700', 'bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700', 'bg-rose-100 text-rose-700', 'bg-amber-100 text-amber-700', 'bg-teal-100 text-teal-700', 'bg-indigo-100 text-indigo-700', 'bg-pink-100 text-pink-700']
export const avatarColor = (key: string) => AVATAR_COLORS[[...key].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AVATAR_COLORS.length]

interface ProjectBacklogTask {
  id: string
  title: string
  code: string | null
  priority: 'low' | 'normal' | 'high'
  kind: 'task' | 'defect'
  assigneeName: string | null
  // Pronista §SRS import — งานที่แตกมาจากเอกสาร SRS ผ่าน flow เดิม (มี srsDocId แต่ไม่มี originDocType) แยกแถบจาก Backlog ทั่วไป
  srsRefCode?: string | null
  srsDocId?: string | null
  // Pronista §Document Traceability — เวอร์ชัน generic ของ SRS fields ด้านบน ใช้กับทุกประเภทเอกสารที่แตกผ่าน flow ใหม่
  originDocType?: 'MOM' | 'BRD' | 'SOW' | 'SRS' | 'PEP' | 'UIR' | null
  originRefCode?: string | null
  originDocId?: string | null
  // Pronista §SOW Task/Subtask — Subtask ของ SOW โผล่ใน Backlog ด้วย (ต่างจาก subtask ทั่วไปที่ยังซ่อน) เพื่อจัดเป็น tree ใต้ Task พ่อ
  parentId?: string | null
  // Pronista §Epic Layer — Epic ที่ Task/Subtask นี้สังกัด (null = ยังไม่ได้สังกัด Epic ใด)
  epicId?: string | null
  epicTitle?: string | null
  epicCode?: string | null
  // Pronista §Workspace — แท็กสี (อ้าง id ใน company_config.labels)
  labelIds?: string[] | null
}
interface BacklogEpic { id: string; title: string; code: string | null; doneCount: number; totalCount: number }
interface BacklogResponse { tasks: ProjectBacklogTask[]; epics: BacklogEpic[] }

// Pronista §SOW Task/Subtask — เฉพาะ SOW เท่านั้นที่แตกเป็น Task ใหม่ได้แล้ว (MOM/BRD/SRS/PEP/UIR ปิดใช้งาน) — คงรายชื่อทุกประเภทไว้เผื่องานเก่าที่แตกไว้ก่อนหน้ายังค้างอยู่ใน Backlog (ไม่ซ่อนข้อมูลเก่า)
// แท็บที่โชว์จริงมาจากข้อมูล (docTabsPresent ด้านล่าง) จึงเหลือแค่ "ทั่วไป + SOW" โดยธรรมชาติสำหรับโปรเจกต์ใหม่ ไม่ต้องบังคับ hardcode
const BACKLOG_DOC_TABS = ['MOM', 'BRD', 'SOW', 'SRS', 'PEP', 'UIR'] as const
// Pronista §Back to Basic — Tab บนสุดของหน้าโปรเจกต์เหลือแค่ Sprint/เอกสาร/ประวัติเอกสาร ย้าย Epic/Story/Task/Defect/CR มาเป็น sub-tab คงที่ของ Backlog แทน (ต่างจาก tab เอกสารด้านบนที่โชว์เฉพาะเมื่อมีข้อมูล — 5 อันนี้โชว์เสมอ)
// Pronista §Back to Basic (ต่อยอด) — เพิ่ม "summary" ดูภาพรวมโครงสร้าง Epic>Story>Task>Subtask ทั้งโปรเจกต์
const FIXED_BACKLOG_TABS = ['epic', 'story', 'task', 'defect', 'cr', 'summary'] as const
type BacklogTab = 'regular' | (typeof BACKLOG_DOC_TABS)[number] | (typeof FIXED_BACKLOG_TABS)[number]
/** แท็บของงานหนึ่งชิ้น — originDocType (flow ใหม่) มาก่อน, ไม่มีก็ fallback ไป SRS ถ้ามี srsDocId (flow เดิม), ไม่งั้นเป็นงานทั่วไป */
function backlogTabOf(t: ProjectBacklogTask): BacklogTab {
  return t.originDocType ?? (t.srsDocId ? 'SRS' : 'regular')
}

/** งานแถวหนึ่งใน Backlog ของโปรเจกต์ — ลากไปวางใน Sprint (มุมมอง Sprint) ได้เลย */
function BacklogTaskRow({ t, onOpenTask, draggable, onDragStart, onDragEnd, dragging, selected, onToggleSelect, onConvertDirect, onConvertPick, labelCatalog }: {
  t: ProjectBacklogTask
  onOpenTask: (id: string) => void
  labelCatalog?: Label[]
  draggable?: boolean
  onDragStart?: (e: DragEvent) => void
  onDragEnd?: () => void
  dragging?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  // Pronista §Project Refactor — เมนู "จัดการ": Epic/Story/CR ทำทันที · Task/Subtask ต้องเลือก parent ก่อน (เปิด picker ที่ parent component)
  // Pronista §Back to Basic (ต่อยอด) — Defect ย้ายมาทำทันทีเหมือนกัน (ผูกกับ Epic/Story/Task แบบอ้างอิงทีหลังผ่านปุ่ม 🔗 ไม่ใช่เลือก parent ตอนแปลง)
  onConvertDirect?: (to: 'epic' | 'story' | 'cr' | 'defect') => void
  onConvertPick?: (to: 'task' | 'subtask') => void
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`flex items-center gap-3 py-2.5 ${draggable ? 'cursor-grab' : ''} ${dragging ? 'opacity-50' : ''}`}
    >
      {onToggleSelect && (
        <input type="checkbox" checked={!!selected} onChange={onToggleSelect} className="shrink-0 cursor-pointer" />
      )}
      {draggable && <GripVertical className="w-3.5 h-3.5 text-border shrink-0" />}
      <span className="w-1.5 h-1.5 rounded-full bg-border shrink-0" />
      {t.code && <span className="text-[11px] font-mono text-muted shrink-0">{t.code}</span>}
      {t.originRefCode && t.originDocId ? (
        <a
          href={`/docs/${t.originDocId}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`เปิดเอกสาร ${t.originDocType} ต้นทาง`}
          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-info-100 text-info-700 hover:bg-info-200 shrink-0"
        >
          📄 {t.originRefCode}
        </a>
      ) : t.srsRefCode && t.srsDocId ? (
        <a
          href={`/api/docs/${t.srsDocId}/raw`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="เปิดเอกสาร SRS ต้นทาง"
          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-info-100 text-info-700 hover:bg-info-200 shrink-0"
        >
          📄 {t.srsRefCode}
        </a>
      ) : null}
      <button onClick={() => onOpenTask(t.id)} className="flex-1 text-sm text-body truncate text-left hover:underline">{t.title}</button>
      {t.kind === 'defect' && <span className="text-[10px] bg-danger-50 text-danger-600 px-1.5 py-0.5 rounded">🐛 Defect</span>}
      {t.priority === 'high' && <span className="text-[10px] text-danger-600 bg-danger-50 px-1.5 py-0.5 rounded">สูง</span>}
      <LabelChips catalog={labelCatalog} ids={t.labelIds} />
      {t.assigneeName && <span className="text-[11px] text-muted">{t.assigneeName}</span>}
      <BacklogConvertMenu onConvertDirect={onConvertDirect} onConvertPick={onConvertPick} />
    </div>
  )
}

const BACKLOG_TAB_LABEL: Record<BacklogTab, string> = {
  regular: 'ทั่วไป', MOM: 'MOM', BRD: 'BRD', SOW: 'SOW', SRS: 'SRS', PEP: 'PEP', UIR: 'UIR',
  epic: 'EPIC', story: 'Story', task: 'Task', defect: 'Defect', cr: 'CR', summary: '🌳 ภาพรวมโครงสร้าง',
}

/** Pronista §5 (2026-07-03) — Backlog ของโปรเจกต์: แยกจาก Company Backlog · เฉพาะ editor/owner ของโปรเจกต์นี้พิมพ์/แก้ไขได้
 * Pronista §Document Traceability (2026-07-10) — แท็บตามประเภทเอกสารต้นทาง (ทั่วไป/MOM/BRD/SOW/SRS/PROP) แทนที่ 2 แถบเดิม (ทั่วไป/จาก SRS)
 * แสดงเฉพาะแท็บที่มีงานจริง (เหมือนพฤติกรรมเดิมที่ซ่อนแถบ SRS ถ้ายังไม่มีงานจาก SRS) + เลือกหลายรายการลบทีเดียวได้ · ลากแถวไปวางใน Sprint (มุมมอง Sprint) ได้ */
// Pronista §Position-based permission — map แท็บย่อยใน Backlog → key ใน myPermissions.tabs (ควบคุมการมองเห็น)
const BACKLOG_TAB_TO_PERMISSION_KEY: Record<(typeof FIXED_BACKLOG_TABS)[number], PermissionTabKey> = {
  epic: 'backlogEpic',
  story: 'backlogStory',
  task: 'backlogTask',
  defect: 'backlogDefect',
  cr: 'backlogCr',
  summary: 'backlogSummary',
}

function ProjectBacklogSection({ projectId, canEdit: canEditProp, permissions, onOpenTask, refreshKey, revealTab, readOnly }: {
  projectId: string
  canEdit: boolean
  permissions?: PositionPermissions
  onOpenTask: (id: string) => void
  refreshKey: number
  // Pronista §Sprint & Board fix — เพิ่ม nonce ทุกครั้งเพื่อบังคับสลับแท็บได้แม้เป็นแท็บเดิมซ้ำ (เช่นเอาออกจาก Sprint 2 ครั้งติดจากแท็บเดียวกัน)
  revealTab?: { tab: BacklogTab; nonce: number } | null
  // Pronista §Workspace — แท็บ Sprint เดิมในโปรเจกต์เหลือแค่ดู จัดการเต็มรูปแบบย้ายไปที่ Workspace แล้ว (ไม่กระทบ canEdit จริงของผู้ใช้ที่ส่งมา ใช้แค่ปิด mutation ในมุมมองนี้)
  readOnly?: boolean
}) {
  // Pronista §Workspace — shadow canEdit เดิมด้วยค่าที่ถูก readOnly บังคับปิดด้วย ทำให้ทุกจุดที่เช็ค canEdit อยู่แล้วในฟังก์ชันนี้ (รวมถึงที่ส่งต่อลง sub-tab) กลายเป็น read-only อัตโนมัติโดยไม่ต้องไล่แก้ทีละจุด
  const canEdit = canEditProp && !readOnly
  const { data, reload } = useLoad<BacklogResponse>(() => api.get(`/api/projects/${projectId}/backlog`), [projectId, refreshKey])
  // Pronista §Workspace — แคตตาล็อกแท็กสี ใช้ render chip บนแถว Backlog
  const { data: cfg } = useLoad<{ labels: Label[] }>(() => api.get('/api/config'))
  const [title, setTitle] = useState('')
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  // Pronista §Backlog cross-project convert — เมนู "จัดการ": ย้ายเป็น Epic/Story/Task/Subtask/Defect/CR (เลือกโปรเจกต์ปลายทางได้ทุกประเภทผ่าน ConvertBacklogModal เดียวกัน)
  const [convertModal, setConvertModal] = useState<{ taskId: string; to: 'epic' | 'story' | 'task' | 'subtask' | 'defect' | 'cr' } | null>(null)
  const rowManageProps = (taskId: string) =>
    canEdit
      ? {
          onConvertDirect: (to: 'epic' | 'story' | 'cr' | 'defect') => setConvertModal({ taskId, to }),
          onConvertPick: (to: 'task' | 'subtask') => setConvertModal({ taskId, to }),
        }
      : {}
  const [tab, setTab] = useState<BacklogTab>('regular')
  // Pronista §Back to Basic (ต่อยอด) — Epic/Story ซ่อนเป็นค่าเริ่มต้น (เก็บที่ localStorage ต่อเครื่อง)
  const [showEpicStory, setShowEpicStory] = useState(() => localStorage.getItem('tasknista_show_epic_story') === '1')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Pronista §Epic Layer — Epic ที่พับเก็บอยู่ (ค่าเริ่มต้น = กางทั้งหมด, กดครั้งแรกถึงจะพับ)
  const [closedEpics, setClosedEpics] = useState<Set<string>>(new Set())
  const toggleEpicOpen = (epicId: string) =>
    setClosedEpics((s) => {
      const next = new Set(s)
      if (next.has(epicId)) next.delete(epicId)
      else next.add(epicId)
      return next
    })
  // Pronista §Sprint hierarchy — งานย่อยขั้นที่ 3 (ลูกของ Task ที่เพิ่มเองในหน้ารายละเอียด) กางดูได้ในแท็บ SOW เช่นกัน
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const toggleTaskExpand = (id: string) =>
    setExpandedTasks((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  useEffect(() => {
    if (revealTab) setTab(revealTab.tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealTab?.nonce])
  const [deleting, setDeleting] = useState(false)
  const list = data?.tasks ?? []
  const epicsList = data?.epics ?? []
  const byTab = useMemo(() => {
    const m = new Map<BacklogTab, ProjectBacklogTask[]>()
    for (const t of list) {
      const k = backlogTabOf(t)
      m.set(k, [...(m.get(k) ?? []), t])
    }
    return m
  }, [list])
  const regularList = byTab.get('regular') ?? []
  const docTabsPresent = BACKLOG_DOC_TABS.filter((k) => (byTab.get(k) ?? []).length > 0)
  const activeList = tab === 'regular' ? regularList : (byTab.get(tab) ?? [])

  const add = async () => {
    if (!title.trim()) return
    // Pronista §Back to Basic (ต่อยอด) — งานที่คีย์จากแท็บ "ทั่วไป" ตรงๆ ต้องเป็น kind='backlog' แยกขาดจาก Story/Task/Defect/CR (กันปนกันในแท็บนี้)
    await api.post(`/api/projects/${projectId}/backlog`, { title: title.trim(), kind: 'backlog' })
    setTitle('')
    void reload()
  }
  // Pronista §Back to Basic (ต่อยอด) — สร้าง Task เพิ่มเองตรงในแท็บเอกสาร (เช่น SOW) นอกเหนือจากที่แตกมาจากการอัปโหลดเอกสารเท่านั้น
  const [docTabTitle, setDocTabTitle] = useState('')
  // Pronista §Workspace — early-return ต้องมาหลัง hook ตัวสุดท้าย (docTabTitle) เสมอ กัน "Rendered more hooks" ตอน canEdit สลับ false/true ข้าม render (เช่น list ว่างตอนกำลังโหลด data แล้วไม่ว่างหลังโหลดเสร็จ)
  if (list.length === 0 && !canEdit) return null
  const addDocTabTask = async (docTab: (typeof BACKLOG_DOC_TABS)[number]) => {
    if (!docTabTitle.trim()) return
    await api.post(`/api/projects/${projectId}/backlog`, { title: docTabTitle.trim(), originDocType: docTab })
    setDocTabTitle('')
    void reload()
  }
  const switchTab = (v: BacklogTab) => { setTab(v); setSelected(new Set()) }
  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSelectAll = () => {
    setSelected((s) => {
      const allIds = activeList.map((t) => t.id)
      const allSelected = allIds.length > 0 && allIds.every((id) => s.has(id))
      return allSelected ? new Set() : new Set(allIds)
    })
  }
  const deleteSelected = async () => {
    if (selected.size === 0) return
    if (!confirm(`ลบ ${selected.size} รายการที่เลือก? กู้คืนไม่ได้`)) return
    setDeleting(true)
    try {
      const ids = [...selected]
      const results = await Promise.allSettled(ids.map((id) => api.delete(`/api/tasks/${id}`)))
      const failed = results.filter((r) => r.status === 'rejected').length
      setSelected(new Set())
      void reload()
      if (failed > 0) alert(`ลบสำเร็จ ${ids.length - failed} รายการ, ไม่สำเร็จ ${failed} รายการ (อาจถูกล็อกอยู่)`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="bg-info-50 border border-info-100 rounded-lg shadow-xs p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-semibold text-ink text-sm">📥 Backlog ของโปรเจกต์</span>
        <span className="text-[11px] text-muted">ยังไม่ขึ้นกระดาน · เฉพาะสมาชิกโปรเจกต์นี้แก้ไขได้</span>
        <span className="ml-auto text-[11px] bg-info-100 text-info-700 px-2 py-0.5 rounded-full">{list.length} งาน</span>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex bg-white/60 rounded-lg p-0.5 text-xs font-medium w-fit flex-wrap">
          {(['regular', ...docTabsPresent] as BacklogTab[]).map((v) => (
            <button key={v} onClick={() => switchTab(v)} className={`px-2.5 py-1 rounded-md ${tab === v ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>
              {BACKLOG_TAB_LABEL[v]} ({(v === 'regular' ? regularList : (byTab.get(v) ?? [])).length})
            </button>
          ))}
          {FIXED_BACKLOG_TABS
            .filter((v) => showEpicStory || (v !== 'epic' && v !== 'story'))
            .filter((v) => permissions?.tabs[BACKLOG_TAB_TO_PERMISSION_KEY[v]] ?? true)
            .map((v) => (
            <button key={v} onClick={() => switchTab(v)} className={`px-2.5 py-1 rounded-md ${tab === v ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>
              {BACKLOG_TAB_LABEL[v]}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            const next = !showEpicStory
            setShowEpicStory(next)
            localStorage.setItem('tasknista_show_epic_story', next ? '1' : '0')
            if (!next && (tab === 'epic' || tab === 'story')) switchTab('task')
          }}
          className="text-[11px] text-muted hover:text-brand-600 underline decoration-dotted"
        >
          {showEpicStory ? 'ซ่อน Epic/Story' : 'แสดง Epic/Story'}
        </button>
      </div>

      {(FIXED_BACKLOG_TABS as readonly BacklogTab[]).includes(tab) ? (
        <>
          {tab === 'epic' && <ProjectEpicTab projectId={projectId} canEdit={canEdit} />}
          {tab === 'story' && <ProjectHierarchyTab projectId={projectId} level="story" canEdit={canEdit} onOpenTask={onOpenTask} />}
          {tab === 'task' && (
            <ProjectHierarchyTab
              projectId={projectId}
              level="task"
              canEdit={canEdit}
              // Pronista §Position-based permission — ตัวอย่าง granular action แรก: ปุ่มสร้าง Task เช็ค actions.task.create ของตำแหน่งโดยเฉพาะ (ละเอียดกว่า canEdit เดิม)
              canCreate={canEdit && (permissions?.actions.task.create ?? true)}
              onOpenTask={onOpenTask}
            />
          )}
          {tab === 'cr' && <ProjectHierarchyTab projectId={projectId} level="cr" canEdit={canEdit} onOpenTask={onOpenTask} />}
          {tab === 'defect' && <ProjectDefectSection projectId={projectId} canEdit={canEdit} onOpenTask={onOpenTask} />}
          {tab === 'summary' && <ProjectSummaryTab projectId={projectId} onOpenTask={onOpenTask} />}
        </>
      ) : (
      <>
      {tab === 'regular' && canEdit && (
        <div className="flex gap-2 mb-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add() }} placeholder="พิมพ์ชื่องานแล้วกด Enter หรือ +TASK…" className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400" />
          <button onClick={() => void add()} disabled={!title.trim()} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40 whitespace-nowrap font-medium">+ TASK</button>
        </div>
      )}

      {canEdit && activeList.length > 0 && (
        <div className="flex items-center gap-3 mb-2 text-xs">
          <label className="flex items-center gap-1.5 text-dim cursor-pointer">
            <input type="checkbox" checked={activeList.every((t) => selected.has(t.id))} onChange={toggleSelectAll} />
            เลือกทั้งหมด
          </label>
          {selected.size > 0 && (
            <button
              onClick={() => void deleteSelected()}
              disabled={deleting}
              className="ml-auto text-danger-600 border border-danger-200 bg-danger-50 hover:bg-danger-100 rounded-lg px-2.5 py-1 disabled:opacity-40"
            >
              {deleting ? 'กำลังลบ…' : `ลบที่เลือก (${selected.size})`}
            </button>
          )}
        </div>
      )}

      {tab === 'SOW' && canEdit && (
        <div className="flex gap-2 mb-3">
          <input
            value={docTabTitle}
            onChange={(e) => setDocTabTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addDocTabTask('SOW') }}
            placeholder="พิมพ์ชื่อ Task แล้วกด Enter เพื่อเพิ่มในแท็บ SOW"
            className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400"
          />
          <button onClick={() => void addDocTabTask('SOW')} disabled={!docTabTitle.trim()} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40 whitespace-nowrap font-medium">+ Task</button>
        </div>
      )}

      {activeList.length === 0 ? (
        <div className="text-center text-xs text-muted py-3">
          {tab === 'regular' ? 'ยังไม่มีงานใน Backlog ของโปรเจกต์นี้' : `ยังไม่มีงานจากเอกสาร ${BACKLOG_TAB_LABEL[tab]}`}
        </div>
      ) : tab === 'SOW' ? (
        // Pronista §SOW Task/Subtask — แท็บ SOW แสดงเป็น tree: Task พ่อ (ลากทั้งก้อน = ดึง subtask ทั้งหมดเข้า Sprint แทน) + Subtask ลูกย่อหน้าใต้ (ลากทีละตัวได้เหมือนเดิม)
        // Pronista §Epic Layer — Task พ่อที่มี epicId ถูกครอบด้วย accordion Epic อีกชั้น (1 เอกสาร SOW ที่อัปโหลด = 1 Epic) พร้อมแถบ % ความคืบหน้ารวม
        (() => {
          const parents = activeList.filter((t) => !t.parentId)
          const parentsByEpic = new Map<string, ProjectBacklogTask[]>()
          const parentsWithoutEpic: ProjectBacklogTask[] = []
          for (const p of parents) {
            if (p.epicId) parentsByEpic.set(p.epicId, [...(parentsByEpic.get(p.epicId) ?? []), p])
            else parentsWithoutEpic.push(p)
          }
          const epicsHere = epicsList.filter((e) => parentsByEpic.has(e.id))
          const renderParentBlock = (parent: ProjectBacklogTask) => {
            const children = activeList.filter((t) => t.parentId === parent.id)
            return (
              <div key={parent.id}>
                <BacklogTaskRow
                  t={parent}
                  onOpenTask={onOpenTask}
                  labelCatalog={cfg?.labels}
                  draggable={canEdit && children.length > 0}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', parent.id); setDragTaskId(parent.id) }}
                  onDragEnd={() => setDragTaskId(null)}
                  dragging={dragTaskId === parent.id}
                  selected={selected.has(parent.id)}
                  onToggleSelect={canEdit ? () => toggleSelect(parent.id) : undefined}
                  {...rowManageProps(parent.id)}
                />
                <div className="pl-6 border-l-2 border-border-subtle ml-1.5">
                  {children.map((child) => {
                    // Pronista §Sprint hierarchy — งานย่อยขั้นที่ 3 (เพิ่มเองในหน้ารายละเอียดของ Task นี้) กางดูได้
                    const grandkids = activeList.filter((t) => t.parentId === child.id)
                    const isExpanded = expandedTasks.has(child.id)
                    return (
                      <div key={child.id}>
                        <div className="flex items-center gap-1">
                          {grandkids.length > 0 && (
                            <button onClick={() => toggleTaskExpand(child.id)} className="shrink-0 text-muted hover:text-body">
                              <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                          )}
                          <div className="flex-1 min-w-0">
                            <BacklogTaskRow
                              t={child}
                              onOpenTask={onOpenTask}
                              labelCatalog={cfg?.labels}
                              draggable={canEdit}
                              onDragStart={(e) => { e.dataTransfer.setData('text/plain', child.id); setDragTaskId(child.id) }}
                              onDragEnd={() => setDragTaskId(null)}
                              dragging={dragTaskId === child.id}
                              selected={selected.has(child.id)}
                              onToggleSelect={canEdit ? () => toggleSelect(child.id) : undefined}
                              {...rowManageProps(child.id)}
                            />
                          </div>
                        </div>
                        {isExpanded && grandkids.length > 0 && (
                          <div className="pl-6 border-l-2 border-border-subtle ml-1.5">
                            {grandkids.map((gk) => (
                              <BacklogTaskRow
                                key={gk.id}
                                t={gk}
                                onOpenTask={onOpenTask}
                                labelCatalog={cfg?.labels}
                                draggable={canEdit}
                                onDragStart={(e) => { e.dataTransfer.setData('text/plain', gk.id); setDragTaskId(gk.id) }}
                                onDragEnd={() => setDragTaskId(null)}
                                dragging={dragTaskId === gk.id}
                                selected={selected.has(gk.id)}
                                onToggleSelect={canEdit ? () => toggleSelect(gk.id) : undefined}
                                {...rowManageProps(gk.id)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          }
          return (
            <div className="space-y-2">
              {epicsHere.map((epic) => {
                const isOpen = !closedEpics.has(epic.id)
                const pct = epic.totalCount > 0 ? Math.round((epic.doneCount / epic.totalCount) * 100) : 0
                return (
                  <div key={epic.id} className="border border-teal-200 rounded-lg overflow-hidden bg-white">
                    <button onClick={() => toggleEpicOpen(epic.id)} className="w-full flex items-center gap-2 px-3 py-2 bg-teal-50 text-left">
                      <ChevronRight className={`w-3.5 h-3.5 text-teal-600 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      <span className="text-xs font-semibold text-teal-700 truncate">Epic · {epic.title}</span>
                      {epic.code && <span className="text-[10px] text-teal-600 shrink-0">{epic.code}</span>}
                      <div className="ml-auto flex items-center gap-2 w-36 shrink-0">
                        <div className="flex-1 h-1.5 rounded-full bg-teal-100 overflow-hidden">
                          <div className="h-full bg-teal-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] font-semibold text-teal-700 tabular-nums">{epic.doneCount}/{epic.totalCount}</span>
                      </div>
                    </button>
                    {isOpen && <div className="divide-y divide-divider px-3">{parentsByEpic.get(epic.id)!.map(renderParentBlock)}</div>}
                  </div>
                )
              })}
              {parentsWithoutEpic.length > 0 && <div className="divide-y divide-divider">{parentsWithoutEpic.map(renderParentBlock)}</div>}
            </div>
          )
        })()
      ) : (
        <div className="divide-y divide-divider">
          {activeList.map((t) => (
            <BacklogTaskRow
              key={t.id}
              t={t}
              onOpenTask={onOpenTask}
              labelCatalog={cfg?.labels}
              draggable={canEdit}
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); setDragTaskId(t.id) }}
              onDragEnd={() => setDragTaskId(null)}
              dragging={dragTaskId === t.id}
              selected={selected.has(t.id)}
              onToggleSelect={canEdit ? () => toggleSelect(t.id) : undefined}
              {...rowManageProps(t.id)}
            />
          ))}
        </div>
      )}
      </>
      )}
      {convertModal && (
        <ConvertBacklogModal
          taskId={convertModal.taskId}
          to={convertModal.to}
          title={CONVERT_LABEL[convertModal.to]}
          currentProjectId={projectId}
          onClose={() => setConvertModal(null)}
          onConverted={() => { setConvertModal(null); void reload() }}
        />
      )}
    </div>
  )
}

interface BoardColumn { id: string; name: string; color: string; sortOrder: number }
interface BoardPreset { id: string; name: string; columns: BoardColumn[] }
interface SprintRow {
  id: string
  projectId: string
  name: string | null
  startDate: string
  endDate: string
  boardPresetId: string | null
  goal: string | null
  status: 'planned' | 'active' | 'completed'
  startedAt: number | null
  completedAt: number | null
  doneCount: number | null
  notDoneCount: number | null
  createdAt: number
}
const sprintLabel = (s: SprintRow) => s.name || `${fmtThaiDate(s.startDate)} – ${fmtThaiDate(s.endDate)}`

// Pronista §Sprint & Board แก้ไข flow — เลือกระยะเวลา Sprint แล้วคำนวณวันจบให้อัตโนมัติ (ยังแก้วันจบเองทีหลังได้ตามปกติ)
const SPRINT_DURATION_OPTIONS = [
  { value: '1w', label: '1 สัปดาห์', days: 7 },
  { value: '2w', label: '2 สัปดาห์', days: 14 },
  { value: '3w', label: '3 สัปดาห์', days: 21 },
  { value: '4w', label: '4 สัปดาห์', days: 28 },
  { value: 'custom', label: 'กำหนดเอง', days: null },
] as const
type SprintDuration = (typeof SPRINT_DURATION_OPTIONS)[number]['value']
// คำนวณ "วัน" ล้วนๆ จาก date string (ไม่สนใจ timezone จริง) — ถ้าใช้ offset +07:00 แล้วอ่านกลับด้วย getUTCDate จะเลื่อนวันผิดเพราะข้าม UTC midnight
const addDaysToDate = (dateStr: string, days: number) => {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Pronista §Project Refactor — กลับลำดับสร้าง Sprint: กด "+ Sprint" สร้าง container ว่างทันที (ดู createInstantSprint ใน SprintSection)
 * ฟอร์มชื่อ/วันที่/ระยะเวลา/เป้าหมาย (เดิมอยู่ใน CreateSprintModal ตอนสร้าง) ย้ายมารวมกับการเลือก Preset ตรงนี้แทน — กรอกตอนกด "เริ่ม Sprint" ซึ่งเป็นจังหวะที่รู้ขอบเขตงานจริงแล้ว */
export function SprintStartModal({ sprintId, defaultStartDate, defaultEndDate, onClose, onStarted }: {
  sprintId: string
  defaultStartDate: string
  defaultEndDate: string
  onClose: () => void
  onStarted: () => void
}) {
  const { data: cfg } = useLoad<{ boardPresets: BoardPreset[] }>(() => api.get('/api/config'), [])
  const [boardPresetId, setBoardPresetId] = useState('')
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState(defaultStartDate)
  const [duration, setDuration] = useState<SprintDuration>('2w')
  const [endDate, setEndDate] = useState(defaultEndDate)
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const presets = cfg?.boardPresets ?? []
  const effectivePreset = boardPresetId || presets[0]?.id || ''

  const changeDuration = (value: SprintDuration) => {
    setDuration(value)
    const opt = SPRINT_DURATION_OPTIONS.find((o) => o.value === value)
    if (opt?.days) setEndDate(addDaysToDate(startDate, opt.days))
  }
  const changeStartDate = (value: string) => {
    setStartDate(value)
    const opt = SPRINT_DURATION_OPTIONS.find((o) => o.value === duration)
    if (opt?.days) setEndDate(addDaysToDate(value, opt.days))
  }

  const start = async () => {
    if (!effectivePreset) return
    setBusy(true)
    setError('')
    try {
      await api.post(`/api/sprints/${sprintId}/start`, {
        boardPresetId: effectivePreset,
        name: name.trim() || undefined,
        startDate,
        endDate,
        goal: goal.trim() || undefined,
      })
      onStarted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เริ่ม Sprint ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
  const label = 'text-xs font-medium text-muted mb-1 block'

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-14 mx-auto w-full max-w-sm px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-ink text-sm">เริ่ม Sprint</div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <div className="space-y-3">
            <div>
              <label className={label}>ชื่อ Sprint (ไม่ใส่ก็ได้)</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น Sprint 1" className={input} />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={label}>วันเริ่ม</label>
                <input type="date" value={startDate} onChange={(e) => changeStartDate(e.target.value)} className={input} />
              </div>
              <div className="flex-1">
                <label className={label}>ระยะเวลา Sprint</label>
                <select value={duration} onChange={(e) => changeDuration(e.target.value as SprintDuration)} className={input}>
                  {SPRINT_DURATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={label}>วันจบ</label>
              <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setDuration('custom') }} className={input} />
            </div>
            <div>
              <label className={label}>เป้าหมาย Sprint (ไม่ใส่ก็ได้)</label>
              <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder="เช่น ปิดฟีเจอร์ Dine-in ให้ครบ QA" className={input} />
            </div>
            <div>
              <label className={label}>Preset สถานะบอร์ด</label>
              <select value={effectivePreset} onChange={(e) => setBoardPresetId(e.target.value)} className={input}>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="text-[11px] text-muted mt-1">แก้ไข preset (เพิ่ม/ลบ/เรียงคอลัมน์) ได้ที่หน้าตั้งค่า</div>
            </div>
            {error && <div className="text-xs text-danger-600">{error}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
              <button onClick={() => void start()} disabled={busy || !effectivePreset} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">{busy ? 'กำลังเริ่ม…' : 'เริ่ม Sprint'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface SprintItemData {
  sprint: SprintRow
  preset: BoardPreset | null
  tasks: ProjectBacklogTask[]
  // Pronista §Sprint hierarchy — งานย่อยขั้นที่ 3 (ลูกของ Task ที่อยู่ใน Sprint นี้) ไม่ได้เข้า Sprint เอง แต่โชว์บริบทได้ (กดขยายดู)
  subtasks: ProjectBacklogTask[]
  parents: { id: string; code: string | null; title: string }[]
  epics: { id: string; title: string; code: string | null }[]
}
interface CurrentSprintData {
  // Pronista §Back to Basic — ทุก sprint ที่ยังไม่ completed (active มาก่อนเสมอ ที่เหลือเรียง createdAt) พร้อม tasks/subtasks/parents/epics ของตัวเองครบทุกอัน — แก้บั๊กเดิมที่ queued sprint ลากงานเข้าไม่ได้เพราะไม่มี tasks ของตัวเอง
  sprints?: SprintItemData[]
}

/** Pronista §Sprint & Board — Default view ตอนเข้าโปรเจกต์: จัดการ Backlog เข้า Sprint + ดูประวัติ/report ย้อนหลัง
 * §Sprint & Board แก้ไข flow — ลาก task มาจาก ProjectBacklogSection (Backlog เดียวของโปรเจกต์) วางที่นี่แทนปุ่ม +Sprint เดิม
 * เลือก Preset ตอนกด "เริ่ม Sprint" แทนตอนสร้าง (SprintStartModal) · เพิ่ม/ปิด sprint กระทบ Backlog ของโปรเจกต์ → เรียก onBacklogChanged ให้ ProjectBacklogSection รีโหลดด้วย */
function SprintSection({ projectId, canEdit: canEditProp, onBacklogChanged, readOnly }: {
  projectId: string
  canEdit: boolean
  onBacklogChanged: (revealTab?: BacklogTab) => void
  // Pronista §Workspace — แท็บ Sprint เดิมในโปรเจกต์เหลือแค่ดู จัดการเต็มรูปแบบย้ายไปที่ Workspace แล้ว
  readOnly?: boolean
}) {
  // Pronista §Workspace — shadow canEdit เดิมด้วยค่าที่ถูก readOnly บังคับปิดด้วย (ดูคอมเมนต์เดียวกันใน ProjectBacklogSection)
  const canEdit = canEditProp && !readOnly
  const navigate = useNavigate()
  const { data, reload } = useLoad<CurrentSprintData>(() => api.get(`/api/projects/${projectId}/sprints/current`), [projectId])
  const { data: history, reload: reloadHistory } = useLoad<SprintRow[]>(() => api.get(`/api/projects/${projectId}/sprints`), [projectId])
  const [instantCreating, setInstantCreating] = useState(false)
  // Pronista §Sprint queueing — ใช้ตัวเดียวเปิด SprintStartModal ได้ทั้ง sprint ปัจจุบันและ sprint ที่รอคิว (เก็บวันที่ placeholder ของ sprint นั้นไว้ทำ default ในฟอร์ม)
  const [starting, setStarting] = useState<{ id: string; startDate: string; endDate: string } | null>(null)
  // Pronista §Back to Basic — เก็บ id ของ sprint การ์ดที่กำลังลากผ่านอยู่ (แทน boolean เดียว) เพราะตอนนี้มีหลายการ์ด drop ได้พร้อมกัน
  const [dropHoverId, setDropHoverId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Pronista §Sprint hierarchy — Epic ที่พับเก็บ + Task ที่กางดู Subtask ขั้นที่ 3 อยู่
  const [closedEpics, setClosedEpics] = useState<Set<string>>(new Set())
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const toggleEpicOpen = (id: string) => setClosedEpics((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleTaskExpand = (id: string) => setExpandedTasks((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const reloadAll = () => { void reload(); void reloadHistory() }
  const sprintItems = data?.sprints ?? []

  const addToSprint = async (sprintId: string, taskId: string) => {
    await api.post(`/api/sprints/${sprintId}/tasks`, { taskId })
    reloadAll()
    onBacklogChanged()
  }
  const removeFromSprint = async (sprintId: string, taskId: string) => {
    // Pronista §Sprint & Board fix — งานที่มาจากเอกสาร (SOW/UIR/ฯลฯ) กลับเข้าแท็บเอกสารนั้น ไม่ใช่แท็บ "ทั่วไป" ที่เปิดค้างอยู่ — ต้องบอก ProjectBacklogSection ให้สลับแท็บไปเปิดให้ ไม่งั้นดูเหมือนงานหายไปเลย (เจอจริงจากการทดสอบ)
    const removed = await api.delete<{ originDocType: ProjectBacklogTask['originDocType']; srsDocId: string | null }>(`/api/sprints/${sprintId}/tasks/${taskId}`)
    reloadAll()
    onBacklogChanged(removed.originDocType ?? (removed.srsDocId ? 'SRS' : 'regular'))
  }
  // Pronista §Project Refactor — กด "+ Sprint" สร้าง container ว่างทันที ไม่ต้องกรอกฟอร์มก่อน (ฟอร์มย้ายไปตอน "เริ่ม Sprint" แทน)
  const createInstantSprint = async () => {
    setInstantCreating(true)
    try {
      await api.post(`/api/projects/${projectId}/sprints`)
      reloadAll()
    } finally {
      setInstantCreating(false)
    }
  }
  const completeSprint = async (sprintId: string) => {
    if (!confirm('ปิด Sprint นี้เลยไหม? งานที่ยังไม่ Done จะเด้งกลับ Backlog')) return
    setBusy(true)
    try {
      await api.post(`/api/sprints/${sprintId}/complete`)
      reloadAll()
      onBacklogChanged()
    } finally {
      setBusy(false)
    }
  }

  // Pronista §Back to Basic — การ์ด Sprint หนึ่งใบ (ใช้ซ้ำทั้ง active และ planned ทุกอัน ไม่แยก "current vs queued" อีกต่อไป — แก้บั๊กเดิมที่ลากงานเข้า queued sprint ไม่ได้เพราะไม่เคยมี dropzone/tasks ของตัวเอง)
  const renderSprintCard = (item: SprintItemData) => {
    const { sprint } = item
    const sprintTasks = item.tasks
    const grandchildren = item.subtasks
    const parentsMap = new Map(item.parents.map((p) => [p.id, p]))
    const childrenOf = (taskId: string) => grandchildren.filter((g) => g.parentId === taskId)
    const isDropHovering = dropHoverId === sprint.id

    const byStory = new Map<string, ProjectBacklogTask[]>()
    const looseTasks: ProjectBacklogTask[] = []
    for (const t of sprintTasks) {
      if (t.parentId) byStory.set(t.parentId, [...(byStory.get(t.parentId) ?? []), t])
      else looseTasks.push(t)
    }
    const byEpic = new Map<string, string[]>()
    const storiesWithoutEpic: string[] = []
    for (const storyId of byStory.keys()) {
      const epicId = byStory.get(storyId)![0]!.epicId
      if (epicId) byEpic.set(epicId, [...(byEpic.get(epicId) ?? []), storyId])
      else storiesWithoutEpic.push(storyId)
    }
    const epicsHere = item.epics.filter((e) => byEpic.has(e.id))

    const renderSprintTaskRow = (t: ProjectBacklogTask) => {
      const kids = childrenOf(t.id)
      const isExpanded = expandedTasks.has(t.id)
      return (
        <div key={t.id}>
          <div className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-2 text-sm border border-border-subtle">
            {kids.length > 0 && (
              <button onClick={() => toggleTaskExpand(t.id)} className="shrink-0 text-muted hover:text-body">
                <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              </button>
            )}
            {t.code && <span className="text-[11px] font-mono text-muted shrink-0">{t.code}</span>}
            <span className="flex-1 truncate">{t.title}</span>
            {kids.length > 0 && <span className="text-[10px] text-muted shrink-0">{kids.length} งานย่อย</span>}
            {canEdit && (
              <button onClick={() => void removeFromSprint(sprint.id, t.id)} className="text-muted hover:text-danger-600 shrink-0"><X className="w-3.5 h-3.5" /></button>
            )}
          </div>
          {isExpanded && kids.length > 0 && (
            <div className="pl-6 border-l-2 border-border-subtle ml-2 mt-1 mb-1 space-y-1">
              {kids.map((k) => (
                <div key={k.id} className="flex items-center gap-2 text-xs text-body py-1">
                  {k.code && <span className="font-mono text-muted">{k.code}</span>}
                  <span className="flex-1 truncate">{k.title}</span>
                  {k.assigneeName && <span className="text-[10px] text-muted shrink-0">{k.assigneeName}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }

    const renderStoryBlock = (storyId: string) => {
      const story = parentsMap.get(storyId)
      return (
        <div key={storyId} className="py-1.5">
          <div className="flex items-center gap-2 text-xs font-medium text-body">
            {story?.code && <span className="font-mono text-muted">{story.code}</span>}
            <span className="truncate">{story?.title ?? 'Story'}</span>
          </div>
          <div className="pl-4 border-l-2 border-border-subtle ml-1 mt-1 space-y-1">
            {byStory.get(storyId)!.map(renderSprintTaskRow)}
          </div>
        </div>
      )
    }

    return (
      <div key={sprint.id} className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="font-semibold text-ink">{sprintLabel(sprint)}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${sprint.status === 'active' ? 'bg-success-50 text-success-700' : 'bg-warning-50 text-warning-700'}`}>
            {sprint.status === 'active' ? 'กำลังทำ' : 'วางแผน'}
          </span>
          <span className="text-xs text-muted">{fmtThaiDate(sprint.startDate)} – {fmtThaiDate(sprint.endDate, true)}</span>
          {sprint.goal && <span className="text-xs text-body basis-full sm:basis-auto">🎯 {sprint.goal}</span>}
          <div className="ml-auto flex items-center gap-2">
            {sprint.status === 'active' && (
              <Link to={`/projects/${projectId}/sprints/${sprint.id}/board`} className="text-sm border border-border-subtle rounded-lg px-3 py-1.5 text-dim hover:bg-hover">ไปที่ Board →</Link>
            )}
            {canEdit && sprint.status === 'planned' && (
              <button onClick={() => setStarting({ id: sprint.id, startDate: sprint.startDate, endDate: sprint.endDate })} disabled={busy} className="inline-flex items-center gap-1.5 text-sm bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 disabled:opacity-40 font-medium">
                <Play className="w-4 h-4" /> เริ่ม Sprint
              </button>
            )}
            {canEdit && (
              <button onClick={() => void completeSprint(sprint.id)} disabled={busy} className="inline-flex items-center gap-1.5 text-sm border border-border-subtle rounded-lg px-3 py-1.5 text-dim hover:bg-hover disabled:opacity-40">
                <CheckCircle2 className="w-4 h-4" /> ปิด Sprint
              </button>
            )}
          </div>
        </div>

        {sprint.status === 'planned' && (
          <div className="text-[11px] text-muted mb-2">ลากงานจาก 📥 Backlog ของโปรเจกต์ ด้านบนมาวางด้านล่างนี้เพื่อจัดเข้า Sprint นี้ — เพิ่ม/เอาออกได้จนกว่าจะกด "เริ่ม Sprint"</div>
        )}
        <div
          onDragOver={canEdit && sprint.status === 'planned' ? (e: DragEvent) => { e.preventDefault(); setDropHoverId(sprint.id) } : undefined}
          onDragLeave={() => setDropHoverId(null)}
          onDrop={canEdit && sprint.status === 'planned' ? (e: DragEvent) => { e.preventDefault(); setDropHoverId(null); const id = e.dataTransfer.getData('text/plain'); if (id) void addToSprint(sprint.id, id) } : undefined}
          className={`bg-hover rounded-lg p-3 min-h-32 border-2 border-dashed ${isDropHovering ? 'border-brand-400 bg-brand-50' : 'border-transparent'}`}
        >
          <div className="text-xs font-semibold text-body mb-2">🏃 ใน Sprint นี้ ({sprintTasks.length})</div>
          {sprintTasks.length === 0 ? (
            <div className="text-center text-xs text-muted py-4">ยังไม่มีงานใน Sprint — ลาก Backlog มาใส่</div>
          ) : (
            <div className="space-y-2">
              {epicsHere.map((epic) => {
                const isOpen = !closedEpics.has(epic.id)
                return (
                  <div key={epic.id} className="border border-teal-200 rounded-lg overflow-hidden bg-white">
                    <button onClick={() => toggleEpicOpen(epic.id)} className="w-full flex items-center gap-2 px-3 py-2 bg-teal-50 text-left">
                      <ChevronRight className={`w-3.5 h-3.5 text-teal-600 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      <span className="text-xs font-semibold text-teal-700 truncate">Epic · {epic.title}</span>
                      {epic.code && <span className="text-[10px] text-teal-600 shrink-0">{epic.code}</span>}
                    </button>
                    {isOpen && <div className="divide-y divide-divider px-3">{byEpic.get(epic.id)!.map(renderStoryBlock)}</div>}
                  </div>
                )
              })}
              {storiesWithoutEpic.length > 0 && (
                <div className="bg-white rounded-lg border border-border-subtle divide-y divide-divider px-3">
                  {storiesWithoutEpic.map(renderStoryBlock)}
                </div>
              )}
              {looseTasks.length > 0 && <div className="space-y-1.5">{looseTasks.map(renderSprintTaskRow)}</div>}
            </div>
          )}
        </div>
      </div>
    )
  }

  const pastSprints = (history ?? []).filter((s) => s.status === 'completed')

  return (
    <div className="space-y-4 mb-4">
      {sprintItems.length === 0 ? (
        <div className="bg-white rounded-lg shadow-xs p-6 text-center">
          <div className="text-sm text-muted mb-3">โปรเจกต์นี้ยังไม่มี Sprint ที่เปิดอยู่</div>
          {canEdit && (
            <button onClick={() => void createInstantSprint()} disabled={instantCreating} className="inline-flex items-center gap-1.5 text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40 font-medium">
              <Plus className="w-4 h-4" /> {instantCreating ? 'กำลังสร้าง…' : 'สร้าง Sprint'}
            </button>
          )}
        </div>
      ) : (
        <>
          {sprintItems.map(renderSprintCard)}
          {/* Pronista §Sprint queueing — สร้าง Sprint เพิ่มได้เรื่อยๆ ไม่ต้องรอ sprint ไหนปิดก่อน (เข้าคิวเป็น 'planned' — การ์ดเดียวกับที่มีอยู่แล้วทุกใบด้านบน) */}
          {canEdit && (
            <button onClick={() => void createInstantSprint()} disabled={instantCreating} className="inline-flex items-center gap-1.5 text-sm border border-border-subtle bg-white rounded-lg px-3 py-2 text-dim hover:bg-hover disabled:opacity-40 shadow-xs">
              <Plus className="w-4 h-4" /> {instantCreating ? 'กำลังสร้าง…' : 'Sprint'}
            </button>
          )}
        </>
      )}

      {pastSprints.length > 0 && (
        <div className="bg-white rounded-lg shadow-xs p-4">
          <div className="flex items-center gap-2 mb-3">
            <History className="w-4 h-4 text-muted" />
            <span className="text-sm font-semibold text-ink">ประวัติ Sprint</span>
          </div>
          <div className="divide-y divide-divider">
            {pastSprints.map((s) => (
              <Link
                key={s.id}
                to={`/projects/${projectId}/sprints/${s.id}/snapshot`}
                className="flex items-center gap-3 py-2.5 text-sm hover:bg-hover -mx-1 px-1 rounded"
                title="ดู Detail Board ย้อนหลัง"
              >
                <span className="flex-1 truncate text-body">{sprintLabel(s)}</span>
                <span className="text-[11px] text-muted">{fmtThaiDate(s.startDate)} – {fmtThaiDate(s.endDate, true)}</span>
                <span className="text-[11px] bg-success-50 text-success-700 px-2 py-0.5 rounded-full">{s.doneCount ?? 0} เสร็จ</span>
                <span className="text-[11px] bg-divider text-dim px-2 py-0.5 rounded-full">{s.notDoneCount ?? 0} ไม่เสร็จ</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {starting && (
        <SprintStartModal
          sprintId={starting.id}
          defaultStartDate={starting.startDate}
          defaultEndDate={starting.endDate}
          onClose={() => setStarting(null)}
          onStarted={() => {
            const startedId = starting.id
            setStarting(null)
            reloadAll()
            navigate(`/projects/${projectId}/sprints/${startedId}/board`)
          }}
        />
      )}
    </div>
  )
}

interface ProjectDoc {
  id: string
  title: string
  kind: 'page' | 'link' | 'file' | 'template' | 'folder'
  templateDocNumber: string | null
  srsDocNumber: string | null
  docType: 'MOM' | 'BRD' | 'SOW' | 'SRS' | 'PEP' | 'UIR' | 'CR' | 'API' | null
}

const PROJECT_DOC_TABS = ['MOM', 'BRD', 'SOW', 'SRS', 'PEP', 'UIR'] as const
type ProjectDocTab = 'all' | (typeof PROJECT_DOC_TABS)[number]
const PROJECT_DOC_TAB_LABEL: Record<ProjectDocTab, string> = { all: 'ทั้งหมด', MOM: 'MOM', BRD: 'BRD', SOW: 'SOW', SRS: 'SRS', PEP: 'PEP', UIR: 'UIR' }

/** Pronista §merge — Tab "เอกสาร" แทน Kanban/ตารางเดิม: เอกสารทั้งหมดที่ผูกไว้กับโปรเจกต์นี้ (ตรงๆ หรือผ่าน task/sub-task) กดแล้วพาไปเปิดที่เมนู "เอกสาร"
 * Pronista §Document Management MVP — เพิ่ม sub-tabs ตามประเภทเอกสาร (เหมือน Backlog) เหนือรายการ แสดงเฉพาะแท็บที่มีเอกสารจริง */
function ProjectDocsSection({ projectId }: { projectId: string }) {
  const { data: docList } = useLoad<ProjectDoc[]>(() => api.get(`/api/projects/${projectId}/docs`), [projectId])
  const [tab, setTab] = useState<ProjectDocTab>('all')
  const docTabsPresent = useMemo(
    () => PROJECT_DOC_TABS.filter((t) => (docList ?? []).some((d) => d.docType === t)),
    [docList],
  )
  const shownDocs = useMemo(
    () => (tab === 'all' ? (docList ?? []) : (docList ?? []).filter((d) => d.docType === tab)),
    [docList, tab],
  )
  return (
    <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
      <div className="text-sm font-semibold text-strong mb-3">เอกสารที่ผูกกับโปรเจกต์นี้ ({(docList ?? []).length})</div>
      {docTabsPresent.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3 pb-3 border-b border-divider">
          {(['all', ...docTabsPresent] as ProjectDocTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs font-medium px-2.5 py-1 rounded-full border ${tab === t ? 'bg-brand-600 border-brand-600 text-white' : 'border-border-subtle text-dim hover:bg-hover'}`}
            >
              {PROJECT_DOC_TAB_LABEL[t]}
            </button>
          ))}
        </div>
      )}
      {docList && docList.length === 0 && (
        <div className="text-sm text-muted py-6 text-center">
          ยังไม่มีเอกสารผูกไว้ — ไปที่เมนู "เอกสาร" แล้วผูกเอกสารกับโปรเจกต์นี้ หรือกับ Task/Sub-task ในโปรเจกต์นี้ได้เลย
        </div>
      )}
      {docList && docList.length > 0 && shownDocs.length === 0 && (
        <div className="text-sm text-muted py-6 text-center">ไม่มีเอกสารในแท็บนี้</div>
      )}
      <div className="space-y-1.5">
        {shownDocs.map((d) => (
          <Link
            key={d.id}
            to={`/docs/${d.id}`}
            className="flex items-center gap-2.5 text-sm px-3 py-2.5 rounded-lg border border-border-subtle hover:bg-hover"
          >
            {d.kind === 'template' ? <LayoutTemplate className="w-4 h-4 text-brand-500 shrink-0" /> : d.kind === 'link' ? <Link2 className="w-4 h-4 text-info-500 shrink-0" /> : <FileText className="w-4 h-4 text-brand-500 shrink-0" />}
            <span className="font-mono text-xs text-muted shrink-0">{d.templateDocNumber ?? d.srsDocNumber ?? ''}</span>
            <span className="flex-1 min-w-0 truncate">{d.title}</span>
            {d.docType && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-brand-50 text-brand-700">{d.docType}</span>}
          </Link>
        ))}
      </div>
    </div>
  )
}

interface EstimateRow {
  taskId: string
  taskCode: string | null
  title: string
  assigneeId: string
  assigneeName: string
  jobTitle: string | null
  costPerDaySatang: number | null
  costPerHourSatang: number | null
  estimateMinutes: number
  bufferPercent: number
  bufferMinutes: number
  totalMinutes: number
  netCostSatang: number | null
  workMinutesPerDay: number
  estimateDays: number
  marginSatang: number | null
  quotationSatang: number | null
}
interface EstimateResponse {
  rows: EstimateRow[]
  totals: { netCostSatang: number; marginSatang: number; quotationSatang: number }
  project: { estimateNetWorkingDays: number | null; quotedSatang: number | null }
  suggestedNetWorkingDays: number | null
  estimateProjectCostPerDaySatang: number | null
}

interface AdminUserLite {
  id: string
  jobTitle: string | null
}

/** Pronista §Project Estimate — เห็นเฉพาะ owner (gate ที่ ProjectDetailPage ก่อนเรนเดอร์แล้ว, endpoint เองก็ ownerOnly ซ้ำที่ server) */
function ProjectEstimateSection({ projectId }: { projectId: string }) {
  const { data, reload } = useLoad<EstimateResponse>(() => api.get(`/api/projects/${projectId}/estimate`), [projectId])
  // Pronista §Project Estimate — ดึงรายชื่อตำแหน่งที่มีอยู่แล้วในทีมมาทำ dropdown เลือกซ้ำ (แทนพิมพ์เอง)
  const { data: allUsers } = useLoad<AdminUserLite[]>(() => api.get('/api/admin/users'))
  const [customRoleFor, setCustomRoleFor] = useState<string | null>(null)
  const money = (satang: number | null) => (satang != null ? formatSatang(satang) : '—')
  const hours = (minutes: number) => minutesToHoursLabel(minutes)
  const roleOptions = useMemo(
    () => [...new Set((allUsers ?? []).map((u) => u.jobTitle).filter((j): j is string => !!j))].sort((a, b) => a.localeCompare(b)),
    [allUsers],
  )

  const saveNetWorkingDays = async (v: string) => {
    const n = v.trim() ? Math.round(Number(v)) : null
    await api.patch(`/api/projects/${projectId}`, { estimateNetWorkingDays: n })
    await reload()
  }
  // Pronista §Project Estimate — PM กรอก Estimate W/H + Buffer % ตรงจากตารางนี้เลย ไม่ต้องเปิด Task/ไปหน้าตั้งค่า
  const saveEstimateHours = async (taskId: string, v: string) => {
    await api.patch(`/api/tasks/${taskId}`, { estimateMinutes: v.trim() ? Math.round(Number(v) * 60) : null })
    await reload()
  }
  const saveBufferPercent = async (taskId: string, v: string) => {
    await api.patch(`/api/tasks/${taskId}`, { costBufferPercent: v.trim() ? Math.round(Number(v)) : null })
    await reload()
  }
  // Pronista §Project Estimate — Role/Cost-Day ผูกกับ "คน" (users.jobTitle/costPerDaySatang) ไม่ใช่ต่อ task — แก้ที่นี่ = แก้ทุกแถวของคนนั้นพร้อมกัน (เหมือนแก้ที่หน้าตั้งค่า)
  const saveJobTitle = async (assigneeId: string, jobTitle: string | null) => {
    await api.patch(`/api/admin/users/${assigneeId}`, { jobTitle })
    await reload()
  }
  const saveCostPerDay = async (assigneeId: string, v: string) => {
    await api.patch(`/api/admin/users/${assigneeId}`, { costPerDaySatang: v.trim() ? Math.round(Number(v) * 100) : null })
    await reload()
  }
  const inputCell = 'w-20 text-right text-sm bg-white border border-border rounded-lg px-2 py-1 tabular-nums focus:outline-hidden focus:border-brand-400'

  if (!data) return <div className="text-sm text-muted py-6 text-center">กำลังโหลด…</div>

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5 overflow-x-auto">
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-semibold text-strong">ต้นทุนต่อ Task ({data.rows.length})</div>
          <div className="flex items-center gap-3 text-[11px] text-muted">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-xs bg-white border border-border inline-block" /> PM กรอกที่นี่</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-xs bg-hover inline-block" /> ระบบคำนวณอัตโนมัติ</span>
          </div>
        </div>
        {data.rows.length === 0 ? (
          <div className="text-sm text-muted py-6 text-center">
            ยังไม่มี Task ที่มีทั้งผู้รับผิดชอบและชั่วโมงประเมิน — กรอกในหน้า Task ก่อน (แถวจะขึ้นที่นี่อัตโนมัติ)
          </div>
        ) : (
          <table className="w-full text-sm min-w-[1200px]">
            <thead className="bg-hover text-dim text-xs">
              <tr>
                <th className="text-left font-medium px-3 py-2">Team Member</th>
                <th className="text-left font-medium px-3 py-2">Role</th>
                <th className="text-right font-medium px-3 py-2">Cost/Day</th>
                <th className="text-right font-medium px-3 py-2">Cost/Hour</th>
                <th className="text-right font-medium px-3 py-2">Estimate W/H</th>
                <th className="text-right font-medium px-3 py-2">Buffer %</th>
                <th className="text-right font-medium px-3 py-2">Buffer W/H</th>
                <th className="text-right font-medium px-3 py-2">Total W/H</th>
                <th className="text-right font-medium px-3 py-2">Net Cost (Hour)</th>
                <th className="text-right font-medium px-3 py-2">Work Hour/Day</th>
                <th className="text-right font-medium px-3 py-2">Estimate Day</th>
                <th className="text-right font-medium px-3 py-2">Margin</th>
                <th className="text-right font-medium px-3 py-2">Quotation Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {data.rows.map((r) => (
                <tr key={r.taskId}>
                  <td className="px-3 py-2 whitespace-nowrap">{r.assigneeName}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {customRoleFor === r.taskId ? (
                      <input
                        type="text"
                        autoFocus
                        defaultValue={r.jobTitle ?? ''}
                        placeholder="พิมพ์ตำแหน่งใหม่"
                        onBlur={(e) => {
                          setCustomRoleFor(null)
                          void saveJobTitle(r.assigneeId, e.target.value.trim() || null)
                        }}
                        className="w-36 text-sm bg-white border border-border rounded-lg px-2 py-1 focus:outline-hidden focus:border-brand-400"
                      />
                    ) : (
                      <select
                        value={r.jobTitle && roleOptions.includes(r.jobTitle) ? r.jobTitle : ''}
                        onChange={(e) => {
                          if (e.target.value === '__custom__') setCustomRoleFor(r.taskId)
                          else void saveJobTitle(r.assigneeId, e.target.value || null)
                        }}
                        className="w-36 text-sm bg-white border border-border rounded-lg px-2 py-1 focus:outline-hidden focus:border-brand-400"
                      >
                        <option value="">— ยังไม่ระบุ —</option>
                        {r.jobTitle && !roleOptions.includes(r.jobTitle) && <option value={r.jobTitle}>{r.jobTitle}</option>}
                        {roleOptions.map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                        <option value="__custom__">+ พิมพ์ตำแหน่งใหม่</option>
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      defaultValue={r.costPerDaySatang != null ? r.costPerDaySatang / 100 : ''}
                      placeholder="—"
                      onBlur={(e) => void saveCostPerDay(r.assigneeId, e.target.value)}
                      className={inputCell}
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{money(r.costPerHourSatang)}</td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      defaultValue={r.estimateMinutes / 60}
                      onBlur={(e) => void saveEstimateHours(r.taskId, e.target.value)}
                      className={inputCell}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={r.bufferPercent}
                      onBlur={(e) => void saveBufferPercent(r.taskId, e.target.value)}
                      className={inputCell}
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{hours(r.bufferMinutes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{hours(r.totalMinutes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">
                    {r.netCostSatang != null ? money(r.netCostSatang) : <span className="text-warning-600 text-xs">ยังไม่ตั้งต้นทุน</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{hours(r.workMinutesPerDay)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{r.estimateDays.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">{money(r.marginSatang)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{money(r.quotationSatang)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border-subtle font-semibold">
                <td className="px-3 py-2" colSpan={8}>รวม</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatSatang(data.totals.netCostSatang)}</td>
                <td />
                <td />
                <td className="px-3 py-2 text-right tabular-nums">{formatSatang(data.totals.marginSatang)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatSatang(data.totals.quotationSatang)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        {data.rows.some((r) => r.netCostSatang == null) && (
          <p className="text-xs text-warning-600 mt-2">
            แถวที่ "ยังไม่ตั้งต้นทุน" ไม่ถูกรวมในยอดด้านบน — ไปตั้งต้นทุน/วันของคนนั้นที่หน้า{' '}
            <Link to="/admin" className="underline">ตั้งค่า</Link>
          </p>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5 grid sm:grid-cols-3 gap-4">
        <label className="text-xs text-muted">
          Net Working Days
          <input
            type="number"
            min={1}
            defaultValue={data.project.estimateNetWorkingDays ?? data.suggestedNetWorkingDays ?? ''}
            placeholder={data.suggestedNetWorkingDays != null ? String(data.suggestedNetWorkingDays) : ''}
            onBlur={(e) => void saveNetWorkingDays(e.target.value)}
            className="w-full text-sm bg-white border border-border rounded-lg px-3 py-2 mt-1 tabular-nums"
          />
          {data.suggestedNetWorkingDays != null && (
            <span className="text-[11px] text-muted">แนะนำ {data.suggestedNetWorkingDays} วัน (จาก Task ที่ใช้เวลานานสุด)</span>
          )}
        </label>
        <div className="text-xs text-muted">
          Net Quotation Cost
          <div className="text-lg font-semibold text-ink tabular-nums mt-1">{money(data.project.quotedSatang)}</div>
          <Link to={`/projects/${projectId}/edit`} className="text-[11px] text-brand-600 hover:underline">แก้ที่หน้าแก้ไขโปรเจกต์</Link>
        </div>
        <div className="text-xs text-muted">
          Estimate Project Cost/Day
          <div className="text-lg font-semibold text-ink tabular-nums mt-1">{money(data.estimateProjectCostPerDaySatang)}</div>
        </div>
      </div>
    </div>
  )
}

interface ProjectAllTask {
  id: string
  code: string | null
  title: string
  kind: 'task' | 'defect' | 'cr' | 'backlog'
  parentId: string | null
  parentTitle: string | null
  epicId: string | null
  // Pronista §Back to Basic (ต่อยอด) — คีย์ Task ลอยได้โดยไม่ต้องมี Story แม่ (แยกจาก Story ที่ parentId=null เหมือนกันแต่ flag นี้เป็น false)
  isStandaloneTask?: boolean
  status: TaskStatus
  defectStatus: 'reported' | 'fixing' | 'waiting_verify' | 'closed' | null
  assigneeName: string | null
}
const DEFECT_STATUS_LABEL = { reported: 'รอเริ่ม', fixing: 'กำลังแก้', waiting_verify: 'รอ Verify', closed: 'ปิด' } as const
const DEFECT_STATUS_CLASS = { reported: 'bg-divider text-dim', fixing: 'bg-warning-50 text-warning-700', waiting_verify: 'bg-info-50 text-info-700', closed: 'bg-success-50 text-success-700' } as const

/** Pronista §Project Refactor — แท็บ "Defect" รวม Defect ทั้งหมดของโปรเจกต์ (รวมที่แปลงมาจาก Backlog ผ่านเมนู "จัดการ")
 * Pronista §Back to Basic — ปุ่ม "🔗 เชื่อมโยง" ต่อแถว: ผูก Defect กับ Epic/Story/Task ใดก็ได้แบบอ้างอิง (task_references) ไม่ใช่ลูก-แม่ */
function ProjectDefectSection({ projectId, canEdit, onOpenTask }: { projectId: string; canEdit: boolean; onOpenTask: (id: string) => void }) {
  const { data, reload } = useLoad<ProjectAllTask[]>(() => api.get(`/api/projects/${projectId}/tasks/all`), [projectId])
  const defects = (data ?? []).filter((t) => t.kind === 'defect')
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const linkCandidates: PickableTask[] = useMemo(
    () => (data ?? []).filter((t) => t.id !== linkingId).map((t) => ({ id: t.id, code: t.code, title: t.title, parentId: t.parentId })),
    [data, linkingId],
  )
  const addReference = async (referencesTaskId: string) => {
    if (!linkingId) return
    await api.post(`/api/tasks/${linkingId}/references`, { referencesTaskId })
    setLinkingId(null)
  }
  // Pronista §Back to Basic (ต่อยอด) — คีย์ log Defect ตรงในแท็บนี้ได้เลย (เดิมมีแค่ปุ่มผูกงานที่มีอยู่แล้ว)
  const [title, setTitle] = useState('')
  const createDefect = async () => {
    if (!title.trim()) return
    const created = await api.post<{ id: string }>(`/api/projects/${projectId}/backlog`, { title: title.trim() })
    await api.post(`/api/tasks/${created.id}/convert`, { to: 'defect' })
    setTitle('')
    void reload()
  }
  return (
    <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-semibold text-ink text-sm">🐛 Defect ของโปรเจกต์</span>
        <span className="ml-auto text-[11px] bg-danger-50 text-danger-600 px-2 py-0.5 rounded-full">{defects.length} รายการ</span>
      </div>
      {canEdit && (
        <div className="flex gap-2 mb-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createDefect() }}
            placeholder="ชื่อ Defect ใหม่…"
            className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400"
          />
          <button onClick={() => void createDefect()} disabled={!title.trim()} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40 whitespace-nowrap font-medium">
            + สร้าง Defect
          </button>
        </div>
      )}
      {defects.length === 0 ? (
        <div className="text-center text-xs text-muted py-6">ยังไม่มี Defect ในโปรเจกต์นี้</div>
      ) : (
        <div className="divide-y divide-divider">
          {defects.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              {t.code && <span className="text-[11px] font-mono text-muted shrink-0">{t.code}</span>}
              <button onClick={() => onOpenTask(t.id)} className="flex-1 text-sm text-body truncate text-left hover:underline">{t.title}</button>
              {t.parentTitle && <span className="text-[11px] text-muted truncate max-w-40" title={`อยู่ใน: ${t.parentTitle}`}>↳ {t.parentTitle}</span>}
              {t.assigneeName && <span className="text-[11px] text-muted shrink-0">{t.assigneeName}</span>}
              {t.defectStatus && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${DEFECT_STATUS_CLASS[t.defectStatus]}`}>{DEFECT_STATUS_LABEL[t.defectStatus]}</span>
              )}
              {canEdit && (
                <button onClick={() => setLinkingId(t.id)} title="เชื่อมโยงกับ Story/Task/Defect/CR อื่น" className="text-muted hover:text-brand-600 shrink-0 text-xs">
                  🔗
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {linkingId && (
        <TaskPickerModal title="เชื่อมโยงกับ Story/Task/Defect/CR อื่น" tasks={linkCandidates} onPick={(item) => void addReference(item.id)} onClose={() => setLinkingId(null)} />
      )}
    </div>
  )
}

/** Pronista §Back to Basic (ต่อยอด) — แท็บ "ภาพรวมโครงสร้าง": Epic > Story > Task > Subtask ทั้งโปรเจกต์ (ไม่ใช่แค่ SOW) มุมมองดูอย่างเดียว ไม่มี checkbox/drag */
function ProjectSummaryTab({ projectId, onOpenTask }: { projectId: string; onOpenTask: (id: string) => void }) {
  const { data: epicsList } = useLoad<ProjectEpic[]>(() => api.get(`/api/projects/${projectId}/epics`), [projectId])
  const { data } = useLoad<ProjectAllTask[]>(() => api.get(`/api/projects/${projectId}/tasks/all`), [projectId])
  const all = (data ?? []).filter((t) => t.kind === 'task')
  const stories = all.filter((t) => t.parentId === null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const byEpic = new Map<string, ProjectAllTask[]>()
  const storiesWithoutEpic: ProjectAllTask[] = []
  for (const s of stories) {
    if (s.epicId) byEpic.set(s.epicId, [...(byEpic.get(s.epicId) ?? []), s])
    else storiesWithoutEpic.push(s)
  }

  const renderTaskRow = (t: ProjectAllTask) => {
    const grandkids = all.filter((gk) => gk.parentId === t.id)
    const isOpen = expanded.has(t.id)
    return (
      <div key={t.id}>
        <div className="flex items-center gap-2 text-xs text-body py-1">
          {grandkids.length > 0 ? (
            <button onClick={() => toggleExpand(t.id)} className="shrink-0 text-muted hover:text-body">
              <ChevronRight className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            </button>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          {t.code && <span className="font-mono text-muted shrink-0">{t.code}</span>}
          <button onClick={() => onOpenTask(t.id)} className="flex-1 truncate text-left hover:underline">{t.title}</button>
          {t.assigneeName && <span className="text-[11px] text-muted shrink-0">{t.assigneeName}</span>}
          <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${TASK_STATUS_BADGE[t.status]}`}>{TASK_STATUS_LABEL[t.status]}</span>
        </div>
        {isOpen && grandkids.length > 0 && (
          <div className="pl-6 border-l-2 border-border-subtle ml-2 space-y-0.5 mb-1">
            {grandkids.map((gk) => (
              <div key={gk.id} className="flex items-center gap-2 text-xs text-body py-0.5">
                {gk.code && <span className="font-mono text-muted shrink-0">{gk.code}</span>}
                <button onClick={() => onOpenTask(gk.id)} className="flex-1 truncate text-left hover:underline">{gk.title}</button>
                {gk.assigneeName && <span className="text-[11px] text-muted shrink-0">{gk.assigneeName}</span>}
                <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${TASK_STATUS_BADGE[gk.status]}`}>{TASK_STATUS_LABEL[gk.status]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderStoryBlock = (story: ProjectAllTask) => {
    const children = all.filter((t) => t.parentId === story.id)
    return (
      <div key={story.id} className="py-1.5">
        <div className="flex items-center gap-2 text-xs font-medium text-body">
          {story.code && <span className="font-mono text-muted shrink-0">{story.code}</span>}
          <button onClick={() => onOpenTask(story.id)} className="flex-1 truncate text-left hover:underline">{story.title}</button>
          {story.assigneeName && <span className="text-[11px] text-muted shrink-0">{story.assigneeName}</span>}
          <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${TASK_STATUS_BADGE[story.status]}`}>{TASK_STATUS_LABEL[story.status]}</span>
        </div>
        {children.length > 0 && (
          <div className="pl-4 border-l-2 border-border-subtle ml-1 mt-1">{children.map(renderTaskRow)}</div>
        )}
      </div>
    )
  }

  const epicsHere = (epicsList ?? []).filter((e) => byEpic.has(e.id))

  return (
    <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
      <div className="mb-3 font-semibold text-ink text-sm">🌳 ภาพรวมโครงสร้าง Epic → Story → Task → Subtask</div>
      {stories.length === 0 ? (
        <div className="text-center text-xs text-muted py-6">ยังไม่มี Story ในโปรเจกต์นี้</div>
      ) : (
        <div className="space-y-2">
          {epicsHere.map((epic) => {
            const pct = epic.totalCount > 0 ? Math.round((epic.doneCount / epic.totalCount) * 100) : 0
            return (
              <div key={epic.id} className="border border-teal-200 rounded-lg overflow-hidden bg-white">
                <div className="w-full flex items-center gap-2 px-3 py-2 bg-teal-50">
                  <span className="text-xs font-semibold text-teal-700 truncate">Epic · {epic.title}</span>
                  {epic.code && <span className="text-[10px] text-teal-600 shrink-0">{epic.code}</span>}
                  <div className="ml-auto flex items-center gap-2 w-36 shrink-0">
                    <div className="flex-1 h-1.5 rounded-full bg-teal-100 overflow-hidden">
                      <div className="h-full bg-teal-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] font-semibold text-teal-700 tabular-nums">{epic.doneCount}/{epic.totalCount}</span>
                  </div>
                </div>
                <div className="divide-y divide-divider px-3">{byEpic.get(epic.id)!.map(renderStoryBlock)}</div>
              </div>
            )
          })}
          {storiesWithoutEpic.length > 0 && (
            <div className="border border-border-subtle rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-hover text-xs font-semibold text-dim">ยังไม่ผูก Epic</div>
              <div className="divide-y divide-divider px-3">{storiesWithoutEpic.map(renderStoryBlock)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface ProjectEpic { id: string; title: string; code: string | null; doneCount: number; totalCount: number }

/** Pronista §Project Refactor — แท็บ "EPIC": list Epic ทั้งหมดของโปรเจกต์ + สร้างใหม่ตรงๆ ได้ (ต่างจาก "ย้ายเป็น Epic" ใน Backlog ที่ยกระดับจาก task ที่มีอยู่)
 * Pronista §Back to Basic — เพิ่มเมนู "..." ต่อแถว: "เชื่อมกับ Story" เปิด LinkOrCreateModal (สร้าง Story ใหม่ หรือเลือก Story ที่มีอยู่มาผูก epicId) */
function ProjectEpicTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { data, reload } = useLoad<ProjectEpic[]>(() => api.get(`/api/projects/${projectId}/epics`), [projectId])
  const [title, setTitle] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [linkingEpic, setLinkingEpic] = useState<ProjectEpic | null>(null)
  const { data: allTasks } = useLoad<ProjectAllTask[]>(
    () => (linkingEpic ? api.get(`/api/projects/${projectId}/tasks/all`) : Promise.resolve([])),
    [projectId, linkingEpic !== null],
  )
  const storyCandidates: PickableTask[] = useMemo(
    () => (allTasks ?? []).filter((t) => t.kind === 'task' && t.parentId === null).map((t) => ({ id: t.id, code: t.code, title: t.title, parentId: t.parentId })),
    [allTasks],
  )
  const epicsList = data ?? []
  const add = async () => {
    if (!title.trim()) return
    await api.post(`/api/projects/${projectId}/epics`, { title: title.trim() })
    setTitle('')
    void reload()
  }
  const createStoryUnder = async (storyTitle: string) => {
    if (!linkingEpic) return
    const created = await api.post<{ id: string }>(`/api/projects/${projectId}/backlog`, { title: storyTitle })
    await api.post(`/api/tasks/${created.id}/convert`, { to: 'story' })
    await api.patch(`/api/tasks/${created.id}`, { epicId: linkingEpic.id })
    setLinkingEpic(null)
    void reload()
  }
  const attachExistingStory = async (item: PickableTask) => {
    if (!linkingEpic) return
    await api.patch(`/api/tasks/${item.id}`, { epicId: linkingEpic.id })
    setLinkingEpic(null)
    void reload()
  }
  return (
    <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-semibold text-ink text-sm">📦 EPIC ({epicsList.length})</span>
      </div>
      {canEdit && (
        <div className="flex gap-2 mb-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add() }} placeholder="ชื่อ Epic ใหม่…" className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400" />
          <button onClick={() => void add()} disabled={!title.trim()} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40 whitespace-nowrap font-medium">+ สร้าง Epic</button>
        </div>
      )}
      {epicsList.length === 0 ? (
        <div className="text-center text-xs text-muted py-6">ยังไม่มี Epic ในโปรเจกต์นี้</div>
      ) : (
        <div className="divide-y divide-divider">
          {epicsList.map((e) => {
            const pct = e.totalCount > 0 ? Math.round((e.doneCount / e.totalCount) * 100) : 0
            return (
              <div key={e.id} className="flex items-center gap-3 py-2.5">
                {e.code && <span className="text-[11px] font-mono text-muted shrink-0">{e.code}</span>}
                <span className="flex-1 text-sm text-body truncate">{e.title}</span>
                <div className="flex items-center gap-2 w-36 shrink-0">
                  <div className="flex-1 h-1.5 rounded-full bg-teal-100 overflow-hidden">
                    <div className="h-full bg-teal-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] font-semibold text-teal-700 tabular-nums">{e.doneCount}/{e.totalCount}</span>
                </div>
                {canEdit && (
                  <div className="relative shrink-0">
                    <button onClick={() => setMenuFor((v) => (v === e.id ? null : e.id))} title="จัดการ" className="text-muted hover:text-body p-0.5 rounded hover:bg-hover">
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                    {menuFor === e.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                        <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-border-subtle py-1 z-20 text-xs">
                          <button
                            onClick={() => { setMenuFor(null); setLinkingEpic(e) }}
                            className="w-full text-left px-3 py-1.5 text-body hover:bg-hover"
                          >
                            🔗 เชื่อมกับ Story
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {linkingEpic && (
        <LinkOrCreateModal
          title={`เชื่อมกับ Story — ${linkingEpic.title}`}
          createPlaceholder="ชื่อ Story ใหม่…"
          pickLabel="หรือเลือก Story ที่มีอยู่แล้ว"
          pickItems={storyCandidates}
          onCreateNew={(t) => void createStoryUnder(t)}
          onPickExisting={(item) => void attachExistingStory(item)}
          onClose={() => setLinkingEpic(null)}
        />
      )}
    </div>
  )
}

const HIERARCHY_TAB_META = {
  story: { title: '📗 Story', empty: 'ยังไม่มี Story ในโปรเจกต์นี้', createLabel: '+ สร้าง Story', placeholder: 'ชื่อ Story ใหม่…' },
  task: { title: '📄 Task', empty: 'ยังไม่มี Task ในโปรเจกต์นี้', createLabel: '+ สร้าง Task', placeholder: 'ชื่อ Task ใหม่…' },
  cr: { title: '🔄 CR (Change Request)', empty: 'ยังไม่มี CR ในโปรเจกต์นี้', createLabel: '+ สร้าง CR', placeholder: 'ชื่อ CR ใหม่…' },
} as const

/** Pronista §Project Refactor — แท็บ Story/Task/CR ใช้ view เดียวกัน กรองจาก /tasks/all ตามตำแหน่งใน hierarchy · "Task" ต้องเลือก Story แม่ก่อนสร้าง */
function ProjectHierarchyTab({ projectId, level, canEdit, canCreate, onOpenTask }: {
  projectId: string
  level: 'story' | 'task' | 'cr'
  canEdit: boolean
  // Pronista §Position-based permission — สิทธิ์สร้างละเอียดกว่า canEdit (ใช้เฉพาะ level='task' ตอนนี้ — story/cr ยังใช้ canEdit เดิม)
  canCreate?: boolean
  onOpenTask: (id: string) => void
}) {
  const { data, reload } = useLoad<ProjectAllTask[]>(() => api.get(`/api/projects/${projectId}/tasks/all`), [projectId])
  const all = data ?? []
  const items =
    level === 'cr'
      ? all.filter((t) => t.kind === 'cr')
      : level === 'story'
        // Pronista §Back to Basic (ต่อยอด) — Story ตัวจริง = parentId ว่าง "และ" ไม่ใช่ Task ลอย (isStandaloneTask)
        ? all.filter((t) => t.kind === 'task' && t.parentId === null && !t.isStandaloneTask)
        // Task = มีพ่อ (2nd level ปกติ) หรือ Task ลอยที่คีย์ตรงจากแท็บนี้ (isStandaloneTask)
        : all.filter((t) => t.kind === 'task' && (t.parentId !== null || t.isStandaloneTask))
  const storyOptions: PickableTask[] = useMemo(
    () => all.filter((t) => t.kind === 'task' && t.parentId === null && !t.isStandaloneTask).map((t) => ({ id: t.id, code: t.code, title: t.title, parentId: t.parentId })),
    [all],
  )
  const [title, setTitle] = useState('')
  const meta = HIERARCHY_TAB_META[level]

  // Pronista §Back to Basic — เมนู "..." เฉพาะแท็บ Story: "เชื่อมกับ Epic" / "เชื่อมกับ Task" (สร้างใหม่ หรือเลือกที่มีอยู่)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [linkMode, setLinkMode] = useState<{ storyId: string; kind: 'epic' | 'task' } | null>(null)
  const { data: epicsForLink } = useLoad<ProjectEpic[]>(
    () => (linkMode?.kind === 'epic' ? api.get(`/api/projects/${projectId}/epics`) : Promise.resolve([])),
    [projectId, linkMode?.kind === 'epic'],
  )
  const epicPickItems: PickableTask[] = useMemo(
    () => (epicsForLink ?? []).map((e) => ({ id: e.id, code: e.code, title: e.title, parentId: null })),
    [epicsForLink],
  )
  const taskPickItems: PickableTask[] = useMemo(
    () => all.filter((t) => t.kind === 'task' && t.id !== linkMode?.storyId).map((t) => ({ id: t.id, code: t.code, title: t.title, parentId: t.parentId })),
    [all, linkMode],
  )
  // Pronista §Back to Basic — แท็บ CR: ปุ่ม "🔗" ผูกกับ Epic/Story/Task แบบอ้างอิง (task_references)
  const [linkingRefId, setLinkingRefId] = useState<string | null>(null)
  const refCandidates: PickableTask[] = useMemo(
    () => all.filter((t) => t.id !== linkingRefId).map((t) => ({ id: t.id, code: t.code, title: t.title, parentId: t.parentId })),
    [all, linkingRefId],
  )
  const addRef = async (referencesTaskId: string) => {
    if (!linkingRefId) return
    await api.post(`/api/tasks/${linkingRefId}/references`, { referencesTaskId })
    setLinkingRefId(null)
  }

  const createDirect = async () => {
    if (!title.trim()) return
    const created = await api.post<{ id: string }>(`/api/projects/${projectId}/backlog`, { title: title.trim() })
    if (level === 'cr') await api.post(`/api/tasks/${created.id}/convert`, { to: 'cr' })
    setTitle('')
    void reload()
  }
  // Pronista §Back to Basic (ต่อยอด, v3) — แท็บ Task: คีย์ลอยตรงๆ เสมอ (isStandaloneTask) ขึ้นแท็บ Task ทันที — เชื่อมกับ Epic/Story ทีหลังผ่านเมนู "จัดการ" เท่านั้น (ตัด dropdown เลือก Story ตอนสร้างออก กันสับสนว่าต้องเลือกก่อนสร้าง)
  const createUnderStory = async () => {
    if (!title.trim()) return
    await api.post(`/api/projects/${projectId}/backlog`, { title: title.trim(), kind: 'task', standalone: true })
    setTitle('')
    void reload()
  }
  const linkStoryToEpic = async (epicId: string) => {
    if (!linkMode) return
    await api.patch(`/api/tasks/${linkMode.storyId}`, { epicId })
    setLinkMode(null)
    void reload()
  }
  const createEpicForStory = async (epicTitle: string) => {
    if (!linkMode) return
    const created = await api.post<{ id: string }>(`/api/projects/${projectId}/epics`, { title: epicTitle })
    await api.patch(`/api/tasks/${linkMode.storyId}`, { epicId: created.id })
    setLinkMode(null)
    void reload()
  }
  const attachChildTask = async (taskId: string) => {
    if (!linkMode) return
    await api.post(`/api/tasks/${taskId}/convert`, { to: 'task', targetParentId: linkMode.storyId })
    setLinkMode(null)
    void reload()
  }
  const createChildTask = async (taskTitle: string) => {
    if (!linkMode) return
    const created = await api.post<{ id: string }>(`/api/projects/${projectId}/backlog`, { title: taskTitle })
    await api.post(`/api/tasks/${created.id}/convert`, { to: 'task', targetParentId: linkMode.storyId })
    setLinkMode(null)
    void reload()
  }
  // Pronista §Back to Basic (ต่อยอด) — แท็บ Task: เมนู "..." ต่อแถว "เชื่อมกับ Story" (สำหรับงานที่คีย์ลอยๆ ไว้ก่อน หรือย้ายไป Story อื่น)
  const [linkTaskId, setLinkTaskId] = useState<string | null>(null)
  const linkTaskToStory = async (storyId: string) => {
    if (!linkTaskId) return
    await api.post(`/api/tasks/${linkTaskId}/convert`, { to: 'task', targetParentId: storyId })
    setLinkTaskId(null)
    void reload()
  }
  const createStoryForTask = async (storyTitle: string) => {
    if (!linkTaskId) return
    const created = await api.post<{ id: string }>(`/api/projects/${projectId}/backlog`, { title: storyTitle })
    await api.post(`/api/tasks/${linkTaskId}/convert`, { to: 'task', targetParentId: created.id })
    setLinkTaskId(null)
    void reload()
  }

  return (
    <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-semibold text-ink text-sm">{meta.title} ({items.length})</span>
      </div>
      {(canCreate ?? canEdit) && (
        <div className="mb-3">
          <div className="flex gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void (level === 'task' ? createUnderStory() : createDirect()) }}
              placeholder={meta.placeholder}
              className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400"
            />
            <button
              onClick={() => void (level === 'task' ? createUnderStory() : createDirect())}
              disabled={!title.trim()}
              className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40 whitespace-nowrap font-medium"
            >
              {meta.createLabel}
            </button>
          </div>
          {level === 'task' && <div className="text-[11px] text-muted mt-1">คีย์แล้วเชื่อมกับ Epic/Story ได้ทีหลังผ่านเมนู "จัดการ" ต่อแถว</div>}
        </div>
      )}
      {items.length === 0 ? (
        <div className="text-center text-xs text-muted py-6">{meta.empty}</div>
      ) : (
        <div className="divide-y divide-divider">
          {items.map((t) => (
            <div
              key={t.id}
              // Pronista §Sprint drag-and-drop fix — แท็บ Task (ProjectHierarchyTab) เดิมลากเข้า Sprint ไม่ได้เลย เพราะแถวไม่มี draggable/onDragStart แบบที่ BacklogTaskRow มี
              // (dropzone ของ Sprint อ่านจาก e.dataTransfer ตรงๆ ไม่ผูกกับ component ไหน — แค่เติม draggable ตรงนี้ก็ทำงานร่วมกับ dropzone เดิมได้ทันที)
              draggable={level === 'task' && canEdit}
              onDragStart={level === 'task' && canEdit ? (e) => e.dataTransfer.setData('text/plain', t.id) : undefined}
              className={`flex items-center gap-3 py-2.5 ${level === 'task' && canEdit ? 'cursor-grab' : ''}`}
            >
              {level === 'task' && canEdit && <GripVertical className="w-3.5 h-3.5 text-border shrink-0" />}
              {t.code && <span className="text-[11px] font-mono text-muted shrink-0">{t.code}</span>}
              <button onClick={() => onOpenTask(t.id)} className="flex-1 text-sm text-body truncate text-left hover:underline">{t.title}</button>
              {t.parentTitle && level === 'task' && <span className="text-[11px] text-muted truncate max-w-40" title={`อยู่ใน: ${t.parentTitle}`}>↳ {t.parentTitle}</span>}
              {t.assigneeName && <span className="text-[11px] text-muted shrink-0">{t.assigneeName}</span>}
              <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${TASK_STATUS_BADGE[t.status]}`}>{TASK_STATUS_LABEL[t.status]}</span>
              {level === 'story' && canEdit && (
                <div className="relative shrink-0">
                  <button onClick={() => setMenuFor((v) => (v === t.id ? null : t.id))} title="จัดการ" className="text-muted hover:text-body p-0.5 rounded hover:bg-hover">
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                  {menuFor === t.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                      <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-border-subtle py-1 z-20 text-xs">
                        <button onClick={() => { setMenuFor(null); setLinkMode({ storyId: t.id, kind: 'epic' }) }} className="w-full text-left px-3 py-1.5 text-body hover:bg-hover">
                          🔗 เชื่อมกับ Epic
                        </button>
                        <button onClick={() => { setMenuFor(null); setLinkMode({ storyId: t.id, kind: 'task' }) }} className="w-full text-left px-3 py-1.5 text-body hover:bg-hover">
                          🔗 เชื่อมกับ Task
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {level === 'cr' && canEdit && (
                <button onClick={() => setLinkingRefId(t.id)} title="เชื่อมโยงกับ Story/Task/Defect/CR อื่น" className="text-muted hover:text-brand-600 shrink-0 text-xs">
                  🔗
                </button>
              )}
              {level === 'task' && canEdit && (
                <div className="relative shrink-0">
                  <button onClick={() => setMenuFor((v) => (v === t.id ? null : t.id))} title="จัดการ" className="text-muted hover:text-body p-0.5 rounded hover:bg-hover">
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                  {menuFor === t.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                      <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-border-subtle py-1 z-20 text-xs">
                        <button onClick={() => { setMenuFor(null); setLinkTaskId(t.id) }} className="w-full text-left px-3 py-1.5 text-body hover:bg-hover">
                          🔗 เชื่อมกับ Story
                        </button>
                        <button onClick={() => { setMenuFor(null); setLinkMode({ storyId: t.id, kind: 'epic' }) }} className="w-full text-left px-3 py-1.5 text-body hover:bg-hover">
                          🔗 เชื่อมกับ Epic
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {linkingRefId && (
        <TaskPickerModal title="เชื่อมโยงกับ Story/Task/Defect/CR อื่น" tasks={refCandidates} onPick={(item) => void addRef(item.id)} onClose={() => setLinkingRefId(null)} />
      )}
      {linkMode?.kind === 'epic' && (
        <LinkOrCreateModal
          title="เชื่อมกับ Epic"
          createPlaceholder="ชื่อ Epic ใหม่…"
          pickLabel="หรือเลือก Epic ที่มีอยู่แล้ว"
          pickItems={epicPickItems}
          onCreateNew={(t) => void createEpicForStory(t)}
          onPickExisting={(item) => void linkStoryToEpic(item.id)}
          onClose={() => setLinkMode(null)}
        />
      )}
      {linkMode?.kind === 'task' && (
        <LinkOrCreateModal
          title="เชื่อมกับ Task"
          createPlaceholder="ชื่อ Task ใหม่…"
          pickLabel="หรือเลือก Task ที่มีอยู่แล้ว"
          pickItems={taskPickItems}
          onCreateNew={(t) => void createChildTask(t)}
          onPickExisting={(item) => void attachChildTask(item.id)}
          onClose={() => setLinkMode(null)}
        />
      )}
      {linkTaskId && (
        <LinkOrCreateModal
          title="เชื่อมกับ Story"
          createPlaceholder="ชื่อ Story ใหม่…"
          pickLabel="หรือเลือก Story ที่มีอยู่แล้ว"
          pickItems={storyOptions}
          onCreateNew={(t) => void createStoryForTask(t)}
          onPickExisting={(item) => void linkTaskToStory(item.id)}
          onClose={() => setLinkTaskId(null)}
        />
      )}
    </div>
  )
}

/** Pronista §Project Refactor — แท็บ "API Document" เดิมเป็น richtext ก้อนเดียว เปลี่ยนเป็นอัปโหลดไฟล์ (docType='API') โชว์เป็นลิสต์แบบเดียวกับแท็บ "เอกสาร" */
function ApiDocumentSection({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { data: docList, reload } = useLoad<ProjectDoc[]>(() => api.get(`/api/projects/${projectId}/docs`), [projectId])
  const apiDocs = (docList ?? []).filter((d) => d.docType === 'API')
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('title', file.name)
      form.append('docType', 'API')
      const res = await fetch('/api/docs/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error('upload_failed')
      const doc = (await res.json()) as { id: string }
      await api.post(`/api/docs/${doc.id}/links`, { projectId })
      void reload()
    } catch {
      alert('อัปโหลดไม่สำเร็จ — รับเฉพาะ Word (.docx/.doc) และ PDF')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-semibold text-ink text-sm">API Document ({apiDocs.length})</span>
        <span className="text-[11px] text-muted">Developer API docs/technical specs ของโปรเจกต์นี้</span>
        {canEdit && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="ml-auto flex items-center gap-1.5 text-xs bg-brand-600 text-white rounded-lg px-3 py-1.5 hover:bg-brand-700 disabled:opacity-40 whitespace-nowrap"
          >
            <FileText className="w-3.5 h-3.5" /> {uploading ? 'กำลังอัปโหลด…' : 'อัปโหลดไฟล์'}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".docx,.doc,.pdf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }}
        />
      </div>
      {apiDocs.length === 0 ? (
        <div className="text-sm text-muted py-6 text-center">ยังไม่มี API Document — กด "อัปโหลดไฟล์" เพื่อเพิ่ม (Word/PDF)</div>
      ) : (
        <div className="space-y-1.5">
          {apiDocs.map((d) => (
            <Link
              key={d.id}
              to={`/docs/${d.id}`}
              className="flex items-center gap-2.5 text-sm px-3 py-2.5 rounded-lg border border-border-subtle hover:bg-hover"
            >
              <FileText className="w-4 h-4 text-brand-500 shrink-0" />
              <span className="flex-1 min-w-0 truncate">{d.title}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { data: project } = useLoad<ProjectRow>(() => api.get(`/api/projects/${id}`), [id])
  // Pronista §permission (Jira-style project role) — editor ของ "โปรเจกต์นี้" เท่านั้นที่แก้ได้ (ไม่ใช่ owner ระบบทั้งบริษัทเท่านั้นอีกต่อไป)
  const canEditProject = project?.myRole === 'owner' || project?.myRole === 'editor'
  const canEdit = user?.role !== 'vendor' && user?.role !== 'guest' && canEditProject
  const { data: board, reload } = useLoad<{ groups: BoardGroup[] }>(() => api.get(`/api/projects/${id}/board`), [id])
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const openTask = (taskId: string) => navigate(`/tasks/${taskId}`)
  // Pronista §Task Detail redesign — ลิงก์เก่าแบบ /projects/:id?task=:taskId (ยิงมาจากหลายที่: Dashboard, TeamBox, การ์ดแจ้งเตือน ฯลฯ) redirect ไปหน้าใหม่แทนเปิด Drawer เดิม — ไม่ต้องแก้จุดสร้างลิงก์เดิมที่อื่นเลย
  useEffect(() => {
    const taskId = searchParams.get('task')
    if (taskId) navigate(`/tasks/${taskId}`, { replace: true })
  }, [searchParams, navigate])
  // Pronista §Sprint & Board — default view ตอนเข้าโปรเจกต์ = Sprint · Kanban/ตาราง เดิมถูกถอดออก แทนที่ด้วย Tab เอกสาร (เอกสารที่ผูกไว้กับโปรเจกต์นี้)
  // Pronista §Project Estimate — Tab เห็นเฉพาะ owner (ต้นทุนทีมทั้งหมด ไม่ใช่แค่งบรวม)
  // Pronista §External Document Version Logging — เพิ่มแท็บ External Design Assets (log เวอร์ชันเอกสารภายนอก เช่น Canva)
  // Pronista §Document Management MVP — เชื่อมสองทางกับหน้า "ประวัติเอกสาร": ลิงก์มาพร้อม ?tab=assets ให้เด้งไปแท็บนี้ตรงๆ
  const [view, setView] = useState<'sprint' | 'docs' | 'assets' | 'apidoc' | 'defect' | 'epic' | 'story' | 'task' | 'cr' | 'estimate'>(
    searchParams.get('tab') === 'assets' ? 'assets' : 'sprint',
  )
  // Pronista §Back to Basic — Tab บนสุดเหลือแค่ Sprint/เอกสาร/ประวัติเอกสาร — Epic/Story/Task/Defect/CR ย้ายไปเป็น sub-tab ใน Backlog (ดู ProjectBacklogSection) · API Document/Project Estimate ถอดออกจากแถบ (ยังไม่อยู่ใน Phase นี้ — component/route เดิมยังอยู่ ไม่ได้ลบ)
  // Pronista §Position-based permission — กรองด้วย myPermissions.tabs (key ตรงกับ view value เป๊ะ: sprint/docs/assets) — ?? true = fail-open ระหว่างยังโหลดข้อมูลไม่เสร็จ ไม่ใช่ fail-closed
  const tabs: [typeof view, string][] = (
    [
      ['sprint', 'Sprint'],
      ['docs', 'เอกสาร'],
      ['assets', 'ประวัติเอกสาร'],
    ] as [typeof view, string][]
  ).filter(([v]) => project?.myPermissions?.tabs[v as PermissionTabKey] ?? true)
  // Pronista §Position-based permission — กัน deep-link ผ่าน ?tab= เข้าแท็บที่ถูกซ่อนไว้ (สลับไปแท็บแรกที่มองเห็นได้แทน)
  useEffect(() => {
    if (tabs.length > 0 && !tabs.some(([v]) => v === view)) setView(tabs[0]![0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.myPermissions])

  const groups = useMemo(() => board?.groups ?? [], [board])
  const allTasks = useMemo(() => groups.flatMap((g) => g.tasks), [groups])
  const doneCount = allTasks.filter((t) => t.status === 'done').length
  const progressPct = allTasks.length > 0 ? Math.round((doneCount / allTasks.length) * 100) : 0
  // Pronista §SOW Task/Subtask — อัปโหลดไฟล์ Word ของ SOW แตกเป็น Task/Subtask ลง Backlog (เฉพาะ SOW เท่านั้นที่แตกเป็น Task ได้แล้ว)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [backlogRefreshKey, setBacklogRefreshKey] = useState(0)
  // Pronista §Sprint & Board fix — สัญญาณให้ ProjectBacklogSection สลับไปแท็บที่งานที่เพิ่งเอาออกจาก Sprint กลับมาอยู่ (ไม่งั้นดูเหมือนงานหายเพราะแท็บที่เปิดค้างไม่ตรง)
  const [revealSignal, setRevealSignal] = useState<{ tab: BacklogTab; nonce: number } | null>(null)

  if (!project) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>

  return (
    <div className="p-3 sm:p-6">
      <Link to="/projects" className="text-sm text-muted hover:text-soft flex items-center gap-1 mb-4">
        <ChevronLeft className="w-4 h-4" /> โปรเจกต์ทั้งหมด
      </Link>
      {/* การ์ดหัวโปรเจกต์ — ชื่อ/สถานะ/คำโปรย + ระยะเวลา/สมาชิก/ความคืบหน้า (แทนที่แถบงวดงาน/การชำระเงินเดิม — แอปนี้ไม่มีเรื่องเงิน) */}
      <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5 mb-4">
        <div className="flex flex-wrap items-start gap-3">
          <h2 className="text-xl font-bold text-ink flex items-center gap-2">
            <ProjectIcon id={project.id} logo={project.logo} size={24} /> {project.name}
          </h2>
          <span className={`text-xs px-2 py-0.5 rounded-full ${statusChip(project.statusColor)}`}>{project.statusName}</span>
          {canEditProject && (
            <div className="ml-auto flex items-center gap-3">
              <button
                onClick={() => setUploadOpen(true)}
                title="อัปโหลดเอกสาร SOW มาแตกเป็น Task/Subtask"
                className="flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 text-dim border-border-subtle hover:bg-hover"
              >
                <FileText className="w-3.5 h-3.5" /> อัปโหลดเอกสาร SOW
              </button>
              <Link
                to={`/projects/${project.id}/edit`}
                title="แก้ไขโปรเจกต์"
                className="flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 text-dim border-border-subtle hover:bg-hover"
              >
                <Pencil className="w-3.5 h-3.5" /> แก้ไข
              </Link>
              {/* Pronista §Project Refactor — ลบโปรเจกต์เฉพาะ Admin (owner) เท่านั้น */}
              {user?.role === 'owner' && (
                <button
                  onClick={async () => {
                    if (!confirm(`ลบโปรเจกต์ "${project.name}"? กู้คืนเองไม่ได้ผ่านหน้านี้`)) return
                    await api.delete(`/api/projects/${project.id}`)
                    navigate('/projects')
                  }}
                  title="ลบโปรเจกต์"
                  className="flex items-center gap-1.5 text-xs border rounded-lg px-2.5 py-1.5 text-danger-600 border-danger-200 hover:bg-danger-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> ลบโปรเจกต์
                </button>
              )}
            </div>
          )}
        </div>
        {project.description && <p className="text-sm text-muted mt-1.5">{project.description}</p>}
        {project.url && (
          <a href={project.url} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline mt-1 inline-block break-all">{project.url}</a>
        )}
        {project.tags && project.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {project.tags.map((t) => <span key={t} className="text-[11px] bg-divider text-dim px-2 py-0.5 rounded-full">{t}</span>)}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-10 gap-y-3 mt-4 pt-4 border-t border-divider">
          <div>
            <div className="text-[11px] text-muted mb-1">ระยะเวลา</div>
            <div className="text-sm text-body">
              {project.startDate && project.dueDate ? `${fmtThaiDate(project.startDate)} – ${fmtThaiDate(project.dueDate, true)}` : 'ยังไม่กำหนดช่วงเวลา'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted mb-1">สมาชิก ({project.members?.length ?? 0})</div>
            <div className="flex -space-x-2">
              {(project.members ?? []).map((m) => (
                <Avatar key={m.id} name={m.name} avatarUrl={m.avatarUrl} className="w-6 h-6 text-[10px] ring-2 ring-white" colorClass={avatarColor(m.name)} />
              ))}
              {(project.members ?? []).length === 0 && <span className="text-sm text-border">ยังไม่มีสมาชิก</span>}
            </div>
          </div>
          <div className="flex-1 min-w-40">
            <div className="text-[11px] text-muted mb-1">ความคืบหน้า</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-divider rounded-full overflow-hidden">
                <div className="h-full bg-brand-500" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-xs font-medium text-body shrink-0">{progressPct}%</span>
            </div>
            <div className="text-[11px] text-muted mt-1">{doneCount}/{allTasks.length} งานเสร็จ</div>
          </div>
        </div>
      </div>

      {/* Pronista §merge — สลับมุมมอง Sprint (default) / เอกสาร (เอกสารที่ผูกไว้กับโปรเจกต์นี้ — แทน Kanban/ตารางเดิม) */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex bg-divider rounded-lg p-0.5 text-sm font-medium w-fit">
          {tabs.map(([v, lbl]) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-md ${view === v ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>{lbl}</button>
          ))}
        </div>
      </div>

      {view === 'sprint' && id && (
        <>
          {/* Pronista §Workspace — จัดการ Sprint/Backlog เต็มรูปแบบย้ายไปที่เมนู Workspace แล้ว แท็บนี้เหลือแค่ดูของโปรเจกต์นี้ */}
          <div className="bg-info-50 text-info-700 text-sm rounded-lg px-4 py-2.5 mb-4 flex items-center gap-2 flex-wrap">
            <span>จัดการ Sprint และ Backlog แบบเต็มรูปแบบได้ที่</span>
            <Link to={`/workspace?project=${id}`} className="font-medium underline hover:no-underline">Workspace</Link>
          </div>
          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <ProjectBacklogSection
              projectId={id}
              canEdit={canEdit}
              permissions={project.myPermissions}
              onOpenTask={openTask}
              refreshKey={backlogRefreshKey}
              revealTab={revealSignal}
              readOnly
            />
            <SprintSection
              projectId={id}
              canEdit={canEdit}
              onBacklogChanged={(revealTab) => {
                setBacklogRefreshKey((k) => k + 1)
                if (revealTab) setRevealSignal((s) => ({ tab: revealTab, nonce: (s?.nonce ?? 0) + 1 }))
              }}
              readOnly
            />
          </div>
        </>
      )}

      {view === 'docs' && id && <ProjectDocsSection projectId={id} />}

      {view === 'assets' && id && <DocumentHistoryTable projectId={id} projectName={project.name} canEdit={canEdit} />}

      {/* Pronista §Back to Basic — API Document/Project Estimate ถอดออกจาก Tab บนสุด (ยังไม่อยู่ใน Phase นี้) เก็บ component+route ไว้เผื่อกลับมาใช้ ไม่มีปุ่มเข้าถึงแล้วเท่านั้น */}
      {view === 'apidoc' && id && <ApiDocumentSection key={project.id} projectId={id} canEdit={canEdit} />}

      {view === 'estimate' && id && user?.role === 'owner' && <ProjectEstimateSection projectId={id} />}

      {uploadOpen && id && (
        <SowUploadBreakoutModal
          lockedProject={{ id: project.id, code: project.code, name: project.name }}
          onClose={() => setUploadOpen(false)}
          onCreated={() => { setUploadOpen(false); void reload(); setBacklogRefreshKey((k) => k + 1) }}
        />
      )}
    </div>
  )
}
