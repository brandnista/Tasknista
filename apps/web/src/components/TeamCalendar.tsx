import { Calendar, ChevronLeft, ChevronRight, Plus, Users, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { DateInputTH } from './DateInputTH'
import { useDialog } from './Dialog'

interface CalEvent {
  id: string
  title: string
  startDate: string
  endDate?: string | null
  type: 'holiday' | 'leave' | 'meeting' | 'deadline' | 'other' | 'payroll'
  userId?: string | null
  userName?: string | null
  projectId?: string | null
  projectName?: string | null
  attendees?: { id: string; name: string }[]
  /** ประชุมจากเมนู "ทีม" — อ่านอย่างเดียว คลิกแล้วพาไปหน้าทีมแทนที่จะลบ */
  readOnly?: boolean
  // Pronista §Calendar/Workload (2026-09-18) — event จาก Google Calendar มีเวลาจริง + แหล่งที่มา
  startAt?: number | null
  endAt?: number | null
  source?: 'local' | 'gcal'
}
interface UserOpt {
  id: string
  name: string
}
interface ProjectOpt {
  id: string
  name: string
}
const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

const TYPE_CLS: Record<CalEvent['type'], string> = {
  holiday: 'bg-success-100 text-success-700',
  leave: 'bg-orange-100 text-orange-700',
  meeting: 'bg-divider text-soft',
  deadline: 'bg-danger-100 text-danger-600',
  other: 'bg-info-100 text-info-700',
  payroll: 'bg-brand-100 text-brand-700',
}
const TYPE_LABEL: Record<string, string> = {
  holiday: 'วันหยุด', leave: 'วันลา', meeting: 'ประชุม', deadline: 'กำหนดส่ง', other: 'อื่นๆ',
}
// Pronista §Leave Request (2026-09-22) — ตัด "วันลา" ออกจากตัวเลือกใน "เพิ่มกิจกรรม" (ต้องยื่นผ่านเมนู "ขอลา" เท่านั้น) — TYPE_LABEL เดิมยังต้องใช้แสดงป้าย/สีของ event ลาที่อนุมัติแล้ว
const ADD_EVENT_TYPE_OPTIONS = Object.entries(TYPE_LABEL).filter(([k]) => k !== 'leave')
// มือถือ (Month view) แสดงจุดสีแทนข้อความยาว กันตัดคำจนอ่านไม่รู้เรื่อง — คลิกวันที่เพื่อดูรายละเอียดแทน
const TYPE_DOT: Record<CalEvent['type'], string> = {
  holiday: 'bg-success-500',
  leave: 'bg-orange-500',
  meeting: 'bg-soft',
  deadline: 'bg-danger-500',
  other: 'bg-info-500',
  payroll: 'bg-brand-500',
}

// Pronista §Calendar/Workload (2026-09-18) — สีประจำตัวแต่ละคน (คงที่ตาม userId — hash → index) ใช้กับจุด/แถบข้างชื่อในตัวกรองรายคน
const PERSON_DOT_COLORS = ['bg-brand-500', 'bg-info-500', 'bg-success-500', 'bg-warning-500', 'bg-danger-500', 'bg-orange-500', 'bg-purple-500', 'bg-pink-500']
function personColor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return PERSON_DOT_COLORS[h % PERSON_DOT_COLORS.length]!
}
const fmtHM = (ms: number) => new Date(ms).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })

const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const DOWF = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์']
const THM = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const THMF = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
const iso = (d: Date) => d.toISOString().slice(0, 10)
const bkkNow = () => new Date(Date.now() + 7 * 3_600_000)
const todayISO = () => iso(bkkNow())
const be = (y: number) => y + 543

function AddEventModal({ defaultDate, onClose, onDone }: { defaultDate: string; onClose: () => void; onDone: () => void }) {
  const { data: userOpts } = useLoad<UserOpt[]>(() => api.get('/api/users'))
  const { data: projectOpts } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const [form, setForm] = useState({ title: '', type: 'meeting', start: defaultDate, end: '', userId: '', projectId: '' })
  // Pronista §1 (2026-07-03) — ผู้เข้าร่วมประชุม (assign หลายคน) + ผูกโปรเจกต์ · เฉพาะ type==='meeting'
  const [attendeeIds, setAttendeeIds] = useState<string[]>([])
  const input = 'w-full text-sm bg-white shadow-xs rounded-lg px-3 py-2'
  const submit = async () => {
    await api.post('/api/calendar', {
      title: form.title.trim(),
      type: form.type,
      startDate: form.start,
      ...(form.end && form.end > form.start ? { endDate: form.end } : {}),
      ...(form.type === 'meeting' ? { attendeeIds, ...(form.projectId ? { projectId: form.projectId } : {}) } : {}),
    })
    onDone()
  }
  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30 so-fade-in" />
      <div className="absolute inset-0 grid place-items-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 so-pop-in max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-ink">เพิ่มกิจกรรม</div>
            <button onClick={onClose} className="text-muted hover:text-soft"><X className="w-5 h-5" /></button>
          </div>
          <div className="space-y-2">
            <input autoFocus placeholder="ชื่อ เช่น ประชุมทีม 10:00" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={input} />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={input} aria-label="ประเภท">
              {ADD_EVENT_TYPE_OPTIONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted">เริ่ม<DateInputTH value={form.start} onChange={(v) => setForm({ ...form, start: v })} className={input} /></label>
              <label className="text-[11px] text-muted">ถึง (ถ้าหลายวัน)<DateInputTH value={form.end} onChange={(v) => setForm({ ...form, end: v })} className={input} /></label>
            </div>
            {form.type === 'meeting' && (
              <>
                <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className={input} aria-label="โปรเจกต์">
                  <option value="">— ไม่ผูกโปรเจกต์ —</option>
                  {(projectOpts ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div>
                  <div className="text-[11px] text-muted mb-1">ผู้เข้าร่วมประชุม</div>
                  <div className="border border-border-subtle rounded-lg max-h-36 overflow-y-auto divide-y divide-divider">
                    {(userOpts ?? []).map((u) => (
                      <label key={u.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm cursor-pointer hover:bg-hover">
                        <input type="checkbox" checked={attendeeIds.includes(u.id)} onChange={() => setAttendeeIds(toggle(attendeeIds, u.id))} />
                        <span className="text-body">{u.name}</span>
                      </label>
                    ))}
                  </div>
                  {attendeeIds.length > 0 && <div className="text-[11px] text-brand-700 mt-1">เลือก {attendeeIds.length} คน</div>}
                </div>
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
            <button onClick={() => void submit().then(onDone)} disabled={!form.title.trim()} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">เพิ่ม</button>
          </div>
        </div>
      </div>
    </div>
  )
}

const SOURCE_LABEL: Record<string, string> = { local: 'สร้างในระบบ', gcal: 'Google Calendar' }

/** Pronista §Calendar/Workload (2026-09-18) — คลิก event แล้วเห็นรายละเอียดก่อน (คน/แหล่งที่มา/เวลา/ประเภท) แทนที่จะลบทันทีแบบเดิม (เสี่ยงมือลั่น) ลบจริงเป็นปุ่มแยกในนี้ */
function EventDetailModal({ e, onClose, onDeleted }: { e: CalEvent; onClose: () => void; onDeleted: () => void }) {
  const { confirmDialog } = useDialog()
  const navigate = useNavigate()
  const del = async () => {
    const yes = await confirmDialog({ title: 'ลบกิจกรรมนี้?', message: e.title, confirmLabel: 'ลบ', danger: true })
    if (!yes) return
    await api.delete(`/api/calendar/${e.id}`)
    onDeleted()
  }
  const timeRange = e.startAt && e.endAt ? `${fmtHM(e.startAt)}–${fmtHM(e.endAt)}` : null
  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30 so-fade-in" />
      <div className="absolute inset-0 grid place-items-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 so-pop-in">
          <div className="flex items-start justify-between mb-3 gap-2">
            <div className="font-semibold text-ink">{e.title}</div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <div className="space-y-1.5 text-sm text-body">
            <div>ประเภท: {TYPE_LABEL[e.type] ?? e.type}</div>
            {e.userName && <div>ผู้รับผิดชอบ: {e.userName}</div>}
            {timeRange && <div>เวลา: {timeRange}</div>}
            {!timeRange && <div>วันที่: {e.startDate}{e.endDate ? ` – ${e.endDate}` : ''}</div>}
            {e.source && <div>แหล่งที่มา: {SOURCE_LABEL[e.source]}</div>}
            {e.readOnly && <div>แหล่งที่มา: นัดจากเมนู "ทีม"</div>}
            {e.projectName && <div>โปรเจกต์: {e.projectName}</div>}
            {e.attendees && e.attendees.length > 0 && <div>ผู้เข้าร่วม: {e.attendees.map((a) => a.name).join(', ')}</div>}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            {e.readOnly ? (
              <button onClick={() => { onClose(); navigate('/team') }} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700">ไปที่หน้าทีม</button>
            ) : e.type === 'payroll' ? (
              <span className="text-xs text-muted">อัตโนมัติจากรอบเงินเดือน — แก้ไขที่หน้าตั้งค่า</span>
            ) : (
              <button onClick={() => void del()} className="text-sm bg-danger-50 text-danger-600 px-4 py-2 rounded-lg hover:bg-danger-100">ลบกิจกรรมนี้</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function TeamCalendar() {
  // มือถือ (< 640px) เริ่มที่ Week view — Month view 7 คอลัมน์แคบเกินอ่านบนจอเล็ก
  const [view, setView] = useState<'day' | 'week' | 'month'>(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 'week' : 'month'))
  const [ref, setRef] = useState(() => bkkNow())
  const [adding, setAdding] = useState(false)
  const [detailEvent, setDetailEvent] = useState<CalEvent | null>(null)
  // Pronista §Calendar/Workload (2026-09-18) — ตัวกรองรายคน (เลือกดูปฏิทินของพนักงานคนไหนก็ได้) — ว่าง = เห็นทุกคน
  const [personFilterOpen, setPersonFilterOpen] = useState(false)
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const { data: userOpts } = useLoad<UserOpt[]>(() => api.get('/api/users'))

  // โหลดครอบทั้งช่วงที่มองเห็น (เดือน ±7 วัน)
  const range = useMemo(() => {
    const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1))
    start.setUTCDate(start.getUTCDate() - 7)
    const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 7))
    return { from: iso(start), to: iso(end) }
  }, [ref])
  const userIdsParam = selectedUserIds.length > 0 ? `&userIds=${selectedUserIds.join(',')}` : ''
  const { data, reload } = useLoad<{ events: CalEvent[] }>(
    () => api.get(`/api/calendar?from=${range.from}&to=${range.to}${userIdsParam}`),
    [range.from, range.to, userIdsParam],
  )

  const eventsOn = (date: string) =>
    (data?.events ?? []).filter((e) => e.startDate <= date && (e.endDate ?? e.startDate) >= date)

  const nav = (dir: -1 | 1) => {
    const d = new Date(ref)
    if (view === 'month') d.setUTCMonth(d.getUTCMonth() + dir)
    else d.setUTCDate(d.getUTCDate() + dir * (view === 'week' ? 7 : 1))
    setRef(d)
  }

  // Pronista §1 (2026-07-03) — meeting: ผู้เข้าร่วม + โปรเจกต์ ให้เห็นในทูลทิป (ใครถูก assign ก็เห็นชื่อตัวเองในนี้)
  // Pronista §Calendar/Workload (2026-09-18) — คลิกดูรายละเอียดก่อนเสมอ (ไม่ลบทันที) เปลี่ยนคำใบ้ทูลทิปตาม
  const eventTooltip = (e: CalEvent) => {
    const timeRange = e.startAt && e.endAt ? `${fmtHM(e.startAt)}–${fmtHM(e.endAt)}\n` : ''
    if (e.type === 'payroll') return `${e.title} (อัตโนมัติจากรอบเงินเดือน)`
    if (e.type === 'meeting') {
      const who = e.attendees && e.attendees.length > 0 ? `ผู้เข้าร่วม: ${e.attendees.map((a) => a.name).join(', ')}` : 'ยังไม่มีผู้เข้าร่วม'
      const proj = e.projectName ? ` · โปรเจกต์: ${e.projectName}` : ''
      return `${timeRange}${e.title}${proj}\n${who}\nคลิกเพื่อดูรายละเอียด`
    }
    return `${timeRange}${e.title} — คลิกเพื่อดูรายละเอียด`
  }

  const EventChip = ({ e, size }: { e: CalEvent; size: 'sm' | 'md' }) => (
    <div
      onClick={(ev) => { ev.stopPropagation(); setDetailEvent(e) }}
      title={eventTooltip(e)}
      className={`truncate rounded px-1 mt-0.5 flex items-center gap-1 ${TYPE_CLS[e.type]} ${size === 'sm' ? 'text-[10px]' : 'text-[11px] px-1.5 py-0.5'} ${e.type === 'payroll' ? '' : 'cursor-pointer hover:opacity-75'}`}
    >
      {e.userId && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${personColor(e.userId)}`} />}
      <span className="truncate">
        {e.startAt && <span className="opacity-70">{fmtHM(e.startAt)} </span>}
        {e.type === 'leave' && e.userName ? `${e.userName}ลา` : e.title}
        {e.type === 'meeting' && e.attendees && e.attendees.length > 0 && size === 'md' && (
          <span className="opacity-70"> · {e.attendees.map((a) => a.name).join(', ')}</span>
        )}
      </span>
    </div>
  )

  const label =
    view === 'month'
      ? `${THMF[ref.getUTCMonth()]} ${be(ref.getUTCFullYear())}`
      : view === 'day'
        ? `${DOWF[ref.getUTCDay()]} ${ref.getUTCDate()} ${THM[ref.getUTCMonth()]} ${be(ref.getUTCFullYear())}`
        : (() => {
            const s = new Date(ref)
            s.setUTCDate(ref.getUTCDate() - ref.getUTCDay())
            const e = new Date(s)
            e.setUTCDate(s.getUTCDate() + 6)
            return `${s.getUTCDate()} ${THM[s.getUTCMonth()]} – ${e.getUTCDate()} ${THM[e.getUTCMonth()]} ${be(e.getUTCFullYear())}`
          })()

  return (
    <div className="mt-5 bg-white rounded-lg shadow-xs p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-2">
        <div className="flex items-center flex-wrap gap-2">
          <Calendar className="w-4 h-4 text-brand-600 shrink-0" />
          <span className="font-semibold text-ink">ปฏิทินทีมงาน</span>
          <div className="flex items-center gap-0.5 ml-1">
            <button onClick={() => nav(-1)} className="w-11 h-11 sm:w-7 sm:h-7 grid place-items-center rounded-lg text-muted hover:bg-divider" aria-label="ก่อนหน้า"><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={() => setRef(bkkNow())} className="text-xs text-dim hover:bg-divider px-2 min-h-[44px] sm:min-h-0 sm:py-1 rounded-lg">วันนี้</button>
            <button onClick={() => nav(1)} className="w-11 h-11 sm:w-7 sm:h-7 grid place-items-center rounded-lg text-muted hover:bg-divider" aria-label="ถัดไป"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <span className="text-sm text-muted">{label}</span>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-2">
          {/* Pronista §Calendar/Workload (2026-09-18) — ตัวกรองรายคน */}
          <div className="relative">
            <button
              onClick={() => setPersonFilterOpen((v) => !v)}
              className={`text-xs font-medium border rounded-lg px-2.5 min-h-[44px] sm:min-h-0 sm:py-1.5 flex items-center gap-1.5 ${selectedUserIds.length > 0 ? 'border-brand-400 text-brand-700 bg-brand-50' : 'border-border text-dim hover:bg-hover'}`}
            >
              <Users className="w-3.5 h-3.5" /> {selectedUserIds.length > 0 ? `${selectedUserIds.length} คน` : 'ทุกคน'}
            </button>
            {personFilterOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setPersonFilterOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-lg shadow-lg border border-border-subtle z-20 max-h-64 overflow-y-auto">
                  {selectedUserIds.length > 0 && (
                    <button onClick={() => setSelectedUserIds([])} className="w-full text-left text-xs text-brand-700 px-3 py-2 hover:bg-hover border-b border-divider">ล้างตัวกรอง (ดูทุกคน)</button>
                  )}
                  {(userOpts ?? []).map((u) => (
                    <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-hover">
                      <input type="checkbox" checked={selectedUserIds.includes(u.id)} onChange={() => setSelectedUserIds(toggle(selectedUserIds, u.id))} />
                      <span className={`w-2 h-2 rounded-full shrink-0 ${personColor(u.id)}`} />
                      <span className="text-body truncate">{u.name}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="flex bg-divider rounded-lg p-0.5 text-xs font-medium">
            {(['day', 'week', 'month'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`px-2.5 py-2 sm:py-1 rounded-md capitalize ${view === v ? 'bg-white shadow-xs text-brand-700' : 'text-dim'}`}>
                {v === 'day' ? 'Day' : v === 'week' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
          <button onClick={() => setAdding(true)} className="text-xs bg-brand-600 text-white rounded-lg px-2.5 min-h-[44px] sm:min-h-0 sm:py-1.5 hover:bg-brand-700 flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> เพิ่ม
          </button>
        </div>
      </div>

      {view === 'month' && (
        <>
          <div className="grid grid-cols-7 text-[11px] text-muted mb-1">{DOW.map((d) => <div key={d} className="px-2 py-1">{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-px bg-border-subtle rounded-lg overflow-hidden">
            {Array.from({ length: 42 }, (_, i) => {
              const first = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1))
              const start = new Date(first)
              start.setUTCDate(1 - first.getUTCDay() + i)
              const dIso = iso(start)
              const inMonth = start.getUTCMonth() === ref.getUTCMonth()
              const isToday = dIso === todayISO()
              const dayEvents = eventsOn(dIso)
              return (
                <div
                  key={i}
                  onClick={() => { setView('day'); setRef(start) }}
                  className={`${inMonth ? 'bg-white' : 'bg-hover/60'} min-h-[58px] p-1 cursor-pointer hover:bg-hover/80`}
                >
                  {isToday ? (
                    <span className="bg-danger-500 text-white w-5 h-5 grid place-items-center rounded-full text-[11px]">{start.getUTCDate()}</span>
                  ) : (
                    <span className={`${inMonth ? 'text-dim' : 'text-border'} text-[11px] px-1`}>{start.getUTCDate()}</span>
                  )}
                  {/* จอกว้าง (sm+) เห็นชื่อกิจกรรมเต็ม · มือถือเห็นจุดสีแทน กันข้อความถูกตัดจนอ่านไม่รู้เรื่อง แตะวันที่เพื่อดูรายละเอียด */}
                  <div className="hidden sm:block">
                    {dayEvents.map((e) => <EventChip key={`${e.id}-${dIso}`} e={e} size="sm" />)}
                  </div>
                  <div className="flex flex-wrap gap-0.5 mt-1 px-1 sm:hidden">
                    {dayEvents.slice(0, 4).map((e) => <span key={`${e.id}-${dIso}`} title={eventTooltip(e)} className={`w-1.5 h-1.5 rounded-full ${TYPE_DOT[e.type]}`} />)}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {view === 'week' && (
        <div className="grid grid-cols-7 gap-px bg-border-subtle rounded-lg overflow-hidden">
          {Array.from({ length: 7 }, (_, i) => {
            const start = new Date(ref)
            start.setUTCDate(ref.getUTCDate() - ref.getUTCDay() + i)
            const dIso = iso(start)
            const isToday = dIso === todayISO()
            return (
              <div key={i} className="bg-white min-h-[150px] p-1.5">
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-[10px] text-muted">{DOW[i]}</span>
                  {isToday ? (
                    <span className="bg-danger-500 text-white w-5 h-5 grid place-items-center rounded-full text-[11px]">{start.getUTCDate()}</span>
                  ) : (
                    <span className="text-soft text-sm">{start.getUTCDate()}</span>
                  )}
                </div>
                {eventsOn(dIso).map((e) => <EventChip key={`${e.id}-${dIso}`} e={e} size="md" />)}
              </div>
            )
          })}
        </div>
      )}

      {view === 'day' && (
        <div className="border border-border-subtle rounded-lg p-3">
          <div className="text-sm font-semibold text-body mb-2">{DOWF[ref.getUTCDay()]} {ref.getUTCDate()} {THMF[ref.getUTCMonth()]}</div>
          {eventsOn(iso(ref)).length === 0 ? (
            <div className="text-sm text-muted py-8 text-center">ไม่มีกิจกรรม</div>
          ) : (
            eventsOn(iso(ref)).map((e) => (
              <div key={e.id} onClick={() => setDetailEvent(e)} className={`rounded-lg px-3 py-2 mb-1.5 text-sm ${TYPE_CLS[e.type]} ${e.type === 'payroll' ? '' : 'cursor-pointer hover:opacity-75'}`}>
                <div className="flex items-center gap-1.5">
                  {e.userId && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${personColor(e.userId)}`} />}
                  {e.startAt && e.endAt && <span className="opacity-70">{fmtHM(e.startAt)}–{fmtHM(e.endAt)}</span>}
                  <span>{e.type === 'leave' && e.userName ? `${e.userName}ลา — ` : ''}{e.title}</span>
                </div>
                {e.type === 'meeting' && (e.projectName || (e.attendees && e.attendees.length > 0)) && (
                  <div className="text-[11px] opacity-70 mt-0.5">
                    {e.projectName && <>โปรเจกต์: {e.projectName}</>}
                    {e.projectName && e.attendees && e.attendees.length > 0 && ' · '}
                    {e.attendees && e.attendees.length > 0 && <>ผู้เข้าร่วม: {e.attendees.map((a) => a.name).join(', ')}</>}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      <p className="text-[11px] text-muted mt-2">วันลา/ประชุม/วันหยุด + ตัดรอบ/จ่ายเงินเดือน (อัตโนมัติจาก config) · คลิกกิจกรรมเพื่อดูรายละเอียด · subscribe เป็น ICS ได้ที่ ตั้งค่า</p>
      {adding && <AddEventModal defaultDate={view === 'month' ? todayISO() : iso(ref)} onClose={() => setAdding(false)} onDone={() => { setAdding(false); void reload() }} />}
      {detailEvent && (
        <EventDetailModal e={detailEvent} onClose={() => setDetailEvent(null)} onDeleted={() => { setDetailEvent(null); void reload() }} />
      )}
    </div>
  )
}
