import { canJoinMeeting } from '@seedoffice/core'
import { Check, Copy, ExternalLink, Plus, Trash2, Video, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/useLoad'
import { avatarColor } from '../pages/ProjectDetail'
import { Avatar } from './Avatar'
import { DateTimeInputTH } from './DateTimeInputTH'
import { useDialog } from './Dialog'

interface MeetingRow {
  id: string
  title: string
  meetingType: string
  projectId: string | null
  projectName: string | null
  organizerId: string
  startAt: number
  endAt: number
  externalMeetingUrl: string | null
}
interface MeetingActionItem {
  id: string
  text: string
  taskId: string | null
  done: boolean
}
interface MeetingDetail extends MeetingRow {
  agenda: string | null
  notes: string | null
  participants: { userId: string; name: string }[]
  // Pronista §Meeting Attendee Filter (2026-09-02) — ผู้เข้าร่วมที่เป็น "สมาชิก" (memberId ไม่ว่าง) หรือเชิญด้วยอีเมลเอง (memberId ว่าง = คนนอกระบบทั้งหมด)
  externalInvitees: { id: string; memberId: string | null; name: string; email: string | null }[]
  actionItems: MeetingActionItem[]
}
interface ProjectOpt {
  id: string
  name: string
}
// Pronista §Meeting Attendee Filter (2026-09-02) — role + jobTitle/businessName/specialty ใช้ disambiguate ชื่อซ้ำ: "[ชื่อ] - [ตำแหน่ง/สังกัด] ([อีเมล])"
interface UserOpt {
  id: string
  name: string
  role: 'owner' | 'member' | 'vendor' | 'guest'
  email: string
  jobTitle: string | null
  businessName: string | null
  specialty: string | null
}
interface MemberOpt {
  id: string
  name: string
  businessName: string | null
  email: string | null
}

type AttendeeFilter = 'employee' | 'partner' | 'client' | 'member'
const ATTENDEE_FILTER_LABEL: Record<AttendeeFilter, string> = { employee: 'พนักงาน', partner: 'พาร์ทเนอร์', client: 'ลูกค้า', member: 'สมาชิก' }
const attendeeFilterRole: Record<Exclude<AttendeeFilter, 'member'>, UserOpt['role'][]> = {
  employee: ['owner', 'member'],
  partner: ['vendor'],
  client: ['guest'],
}
/** ป้ายแสดงผลกันชื่อซ้ำ: [ชื่อ] - [ตำแหน่ง/สังกัด] ([อีเมล]) — ตำแหน่งดึงตามประเภทผู้ใช้ (SPEC §3.2) */
function userAttendeeLabel(u: UserOpt): string {
  const affiliation =
    u.role === 'owner' || u.role === 'member' ? u.jobTitle || 'พนักงาน' : u.role === 'vendor' ? u.specialty || u.businessName || 'พาร์ทเนอร์' : u.businessName || 'ลูกค้า'
  return `${u.name} - ${affiliation} (${u.email})`
}
function memberAttendeeLabel(m: MemberOpt): string {
  return `${m.name} - ${m.businessName || 'สมาชิก'} (${m.email || '—'})`
}

const MEETING_TYPE_LABEL: Record<string, string> = {
  team: 'Team Meeting',
  project: 'Project Meeting',
  sprint_planning: 'Sprint Planning',
  sprint_review: 'Sprint Review',
  daily_standup: 'Daily Standup',
  client: 'Client Meeting',
  other: 'อื่นๆ',
}

const fmtTimeRange = (startAt: number, endAt: number) =>
  `${new Date(startAt).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })} - ${new Date(endAt).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })}`
const fmtDayHeader = (ms: number) => new Date(ms).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'long' })
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })

// Pronista §Meeting Schedule Tab (2026-08-27) — ปุ่ม "เข้าร่วมประชุม" ต้องเปิด/ปิดเองตามเวลาจริงโดยไม่ต้องรีเฟรชหน้า (ดู canJoinMeeting)
function useNowTick(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function toLocalInputValue(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Pronista §Team Meeting (2026-08-26) — แท็บ "ประชุม" ใน หน้าทีม: นัดประชุม + Notes + Action Items → Task
 * Pronista §Google Meet Integration (2026-08-28) — ไม่แปะลิงก์เอง = สร้างนัดหมายจริงบน Google Calendar พร้อมลิงก์ Google Meet อัตโนมัติ (ต้องเชื่อมต่อ Google Calendar ไว้ก่อนที่ ตั้งค่า — ถ้ายังไม่เชื่อม/ยัง scope เก่าอยู่ จะ error ชัดเจนตอนกดนัดประชุม) */
export function MeetingsTab({ projectIdFilter, initialMeetingId }: { projectIdFilter?: string; initialMeetingId?: string } = {}) {
  const [scope, setScope] = useState<'upcoming' | 'all'>('upcoming')
  const { data, reload } = useLoad<MeetingRow[]>(() => api.get(`/api/meetings?scope=${scope}`), [scope])
  const meetings = (data ?? []).filter((m) => !projectIdFilter || m.projectId === projectIdFilter)
  const [createOpen, setCreateOpen] = useState(false)
  // Pronista §Team Meeting (2026-08-27) — มาจากแจ้งเตือน meeting_scheduled (ดู Team.tsx) เปิด detail ตรงประชุมนั้นทันที
  const [detailId, setDetailId] = useState<string | null>(initialMeetingId ?? null)
  const now = useNowTick()

  const groups = new Map<string, MeetingRow[]>()
  for (const m of meetings) {
    const key = dayKey(m.startAt)
    groups.set(key, [...(groups.get(key) ?? []), m])
  }

  return (
    // Pronista §Meeting Schedule Tab (2026-08-27) — ใช้ร่วม 2 บริบท: Team.tsx (flex column สูงเต็มจอ, h-full ใช้ได้ปกติ) กับ MyTasks.tsx (หน้า scroll ปกติ ไม่มี ancestor สูงกำหนดไว้ — min-h กันยุบเหลือ 0)
    <div className="h-full min-h-[60vh] overflow-y-auto p-3 sm:p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex bg-divider p-0.5 rounded-lg text-xs font-medium">
          <button onClick={() => setScope('upcoming')} className={`px-2.5 py-1 rounded-md ${scope === 'upcoming' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>ที่จะถึง</button>
          <button onClick={() => setScope('all')} className={`px-2.5 py-1 rounded-md ${scope === 'all' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>ทั้งหมด</button>
        </div>
        <button onClick={() => setCreateOpen(true)} className="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> นัดประชุม
        </button>
      </div>
      {meetings.length === 0 && <div className="text-center text-sm text-muted py-10">ยังไม่มีการประชุม{scope === 'upcoming' ? 'ที่จะถึง' : ''}</div>}
      {[...groups.entries()].map(([key, rows]) => (
        <div key={key} className="mb-4">
          <div className="text-xs font-medium text-muted mb-1.5">{fmtDayHeader(rows[0]!.startAt)}</div>
          <div className="space-y-2">
            {rows.map((m) => (
              <div key={m.id} className="bg-white rounded-lg shadow-xs hover:shadow-sm flex items-start gap-3 p-3">
                <button onClick={() => setDetailId(m.id)} className="min-w-0 flex-1 text-left flex items-start gap-3">
                  <div className="text-xs text-dim tabular-nums shrink-0 pt-0.5">{fmtTimeRange(m.startAt, m.endAt)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-body font-medium truncate">{m.title}</div>
                    <div className="text-[11px] text-muted flex items-center gap-1.5 flex-wrap mt-0.5">
                      <span>{MEETING_TYPE_LABEL[m.meetingType] ?? m.meetingType}</span>
                      {m.projectName && <span>· {m.projectName}</span>}
                    </div>
                  </div>
                </button>
                {/* Pronista §Meeting Schedule Tab (2026-08-27) — กดเข้าร่วมได้เฉพาะช่วงก่อนเริ่ม 5 นาที ถึงเวลาสิ้นสุดนัดหมาย นอกช่วงนี้ซ่อนปุ่มไปเลย */}
                {m.externalMeetingUrl && canJoinMeeting(new Date(m.startAt).getTime(), new Date(m.endAt).getTime(), now) && (
                  <a
                    href={m.externalMeetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-white bg-success-600 hover:bg-success-700 px-2.5 py-1.5 rounded-lg"
                  >
                    <Video className="w-3.5 h-3.5" /> เข้าร่วมประชุม
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {createOpen && (
        <CreateMeetingModal
          defaultProjectId={projectIdFilter}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            setCreateOpen(false)
            // Pronista §Meeting link copy (2026-09-01) — เปิด detail ให้ทันทีหลังนัดสำเร็จ จะได้เห็น+คัดลอกลิงก์ประชุมไปให้ลูกค้า/คนนอกได้เลยไม่ต้องไปหาในลิสต์
            setDetailId(id)
            void reload()
          }}
        />
      )}
      {detailId && <MeetingDetailModal meetingId={detailId} onClose={() => setDetailId(null)} onChanged={reload} />}
    </div>
  )
}

function CreateMeetingModal({ defaultProjectId, onClose, onCreated }: { defaultProjectId?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { alertDialog } = useDialog()
  const { data: projects } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const { data: users } = useLoad<UserOpt[]>(() => api.get('/api/users'))
  const { data: members } = useLoad<MemberOpt[]>(() => api.get('/api/members'))
  const [title, setTitle] = useState('')
  const [meetingType, setMeetingType] = useState('team')
  const [projectId, setProjectId] = useState(defaultProjectId ?? '')
  const now = new Date(Date.now() + 60 * 60_000)
  now.setMinutes(0, 0, 0)
  const [startAt, setStartAt] = useState(toLocalInputValue(now.getTime()))
  const [endAt, setEndAt] = useState(toLocalInputValue(now.getTime() + 60 * 60_000))
  const [externalMeetingUrl, setExternalMeetingUrl] = useState('')
  const [agenda, setAgenda] = useState('')
  const [participantIds, setParticipantIds] = useState<Set<string>>(new Set())
  // Pronista §Meeting Attendee Filter (2026-09-02) — เชิญ "สมาชิก" (members table) แยกจาก participantIds
  const [externalInviteeIds, setExternalInviteeIds] = useState<Set<string>>(new Set())
  // Pronista §Meeting Attendee Filter (2026-09-02) — เชิญด้วยอีเมลเอง (คนนอกระบบทั้งหมด ไม่มีแม้แต่ใน members)
  const [manualInvitees, setManualInvitees] = useState<{ name: string; email: string }[]>([])
  const [manualName, setManualName] = useState('')
  const [manualEmail, setManualEmail] = useState('')
  const [attendeeFilter, setAttendeeFilter] = useState<AttendeeFilter>('employee')
  const [busy, setBusy] = useState(false)

  const toggleParticipant = (id: string) => setParticipantIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleExternalInvitee = (id: string) => setExternalInviteeIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const addManualInvitee = () => {
    const name = manualName.trim()
    const email = manualEmail.trim()
    if (!name || !email) return
    setManualInvitees((prev) => [...prev, { name, email }])
    setManualName('')
    setManualEmail('')
  }
  const removeManualInvitee = (idx: number) => setManualInvitees((prev) => prev.filter((_, i) => i !== idx))

  const create = async () => {
    if (!title.trim()) return
    setBusy(true)
    try {
      const created = await api.post<{ id: string }>('/api/meetings', {
        title: title.trim(),
        meetingType,
        projectId: projectId || null,
        startAt: new Date(startAt).getTime(),
        endAt: new Date(endAt).getTime(),
        externalMeetingUrl: externalMeetingUrl.trim() || null,
        agenda: agenda.trim() || null,
        participantIds: [...participantIds],
        externalInviteeMemberIds: [...externalInviteeIds],
        externalInviteeEmails: manualInvitees,
      })
      onCreated(created.id)
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'นัดประชุมไม่สำเร็จ' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
          <span className="font-semibold text-ink text-sm">นัดประชุม</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-hover text-dim"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label className="text-[11px] text-muted block mb-0.5">หัวข้อ</label>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted block mb-0.5">ประเภท</label>
              <select value={meetingType} onChange={(e) => setMeetingType(e.target.value)} className="w-full text-sm bg-hover rounded-lg px-2 py-2 focus:outline-hidden">
                {Object.entries(MEETING_TYPE_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted block mb-0.5">โปรเจกต์ (ถ้ามี)</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full text-sm bg-hover rounded-lg px-2 py-2 focus:outline-hidden">
                <option value="">— ไม่ระบุ —</option>
                {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted block mb-0.5">เริ่ม</label>
              <DateTimeInputTH value={startAt} onChange={setStartAt} className="w-full text-sm bg-hover rounded-lg px-2 py-2 focus:outline-hidden" />
            </div>
            <div>
              <label className="text-[11px] text-muted block mb-0.5">ถึง</label>
              <DateTimeInputTH value={endAt} onChange={setEndAt} className="w-full text-sm bg-hover rounded-lg px-2 py-2 focus:outline-hidden" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-0.5">ลิงก์ประชุม (Google Meet/Zoom ฯลฯ)</label>
            <input value={externalMeetingUrl} onChange={(e) => setExternalMeetingUrl(e.target.value)} placeholder="เว้นว่างไว้ = ระบบสร้างนัดหมาย + ลิงก์ Google Meet ให้อัตโนมัติ" className="w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden" />
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-0.5">Agenda</label>
            <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={2} className="w-full text-sm bg-hover rounded-lg px-3 py-2 resize-none focus:outline-hidden" />
          </div>
          <div>
            <label className="text-[11px] text-muted flex items-center justify-between mb-1">
              <span>ผู้เข้าร่วม</span>
              {participantIds.size + externalInviteeIds.size + manualInvitees.length > 0 && (
                <span className="text-brand-600 font-medium">เลือกแล้ว {participantIds.size + externalInviteeIds.size + manualInvitees.length}</span>
              )}
            </label>
            {/* Pronista §Meeting Attendee Filter (2026-09-02) — ตัวกรอง 4 ประเภทผู้ใช้งาน (พนักงาน/พาร์ทเนอร์/ลูกค้า/สมาชิก) — สมาชิกไม่มี login คนละ list/state กับ 3 ประเภทแรก */}
            <div className="flex bg-divider p-0.5 rounded-lg text-[11px] font-medium mb-1.5 w-fit">
              {(Object.keys(ATTENDEE_FILTER_LABEL) as AttendeeFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setAttendeeFilter(f)}
                  className={`px-2.5 py-1 rounded-md ${attendeeFilter === f ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}
                >
                  {ATTENDEE_FILTER_LABEL[f]}
                </button>
              ))}
            </div>
            <div className="max-h-32 overflow-y-auto space-y-0.5 border border-border-subtle rounded-lg p-1.5">
              {attendeeFilter === 'member'
                ? (members ?? []).map((m) => (
                    <label key={m.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-hover cursor-pointer">
                      <input type="checkbox" checked={externalInviteeIds.has(m.id)} onChange={() => toggleExternalInvitee(m.id)} />
                      <span className="text-xs text-body">{memberAttendeeLabel(m)}</span>
                    </label>
                  ))
                : (users ?? []).filter((u) => attendeeFilterRole[attendeeFilter].includes(u.role)).map((u) => (
                    <label key={u.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-hover cursor-pointer">
                      <input type="checkbox" checked={participantIds.has(u.id)} onChange={() => toggleParticipant(u.id)} />
                      <span className="text-xs text-body">{userAttendeeLabel(u)}</span>
                    </label>
                  ))}
            </div>
            {/* Pronista §Meeting Attendee Filter (2026-09-02) — เชิญด้วยอีเมลเอง สำหรับคนภายนอกที่ไม่มีอยู่ในระบบเลย (ไม่ใช่แม้แต่ "สมาชิก") */}
            <div className="mt-2">
              <label className="text-[11px] text-muted block mb-1">เชิญด้วยอีเมล (คนภายนอก)</label>
              <div className="flex gap-1.5">
                <input
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="ชื่อ"
                  className="w-1/3 text-xs bg-hover rounded-lg px-2 py-1.5 focus:outline-hidden"
                />
                <input
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManualInvitee() } }}
                  placeholder="อีเมล"
                  type="email"
                  className="flex-1 text-xs bg-hover rounded-lg px-2 py-1.5 focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={addManualInvitee}
                  disabled={!manualName.trim() || !manualEmail.trim()}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-border-subtle hover:bg-hover disabled:opacity-40 shrink-0"
                >
                  เพิ่ม
                </button>
              </div>
              {manualInvitees.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {manualInvitees.map((inv, i) => (
                    <span key={i} className="inline-flex items-center gap-1 bg-brand-50 text-brand-700 text-[11px] rounded-full pl-2 pr-1 py-0.5">
                      {inv.name} ({inv.email})
                      <button type="button" onClick={() => removeManualInvitee(i)} className="hover:text-brand-900"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle shrink-0">
          <button onClick={onClose} className="text-sm px-3.5 py-2 rounded-lg text-soft hover:bg-hover">ยกเลิก</button>
          <button onClick={() => void create()} disabled={!title.trim() || busy} className="text-sm font-medium text-white px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40">นัดประชุม</button>
        </div>
      </div>
    </div>
  )
}

export function MeetingDetailModal({ meetingId, onClose, onChanged }: { meetingId: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth()
  const { confirmDialog } = useDialog()
  const { data: meeting, reload } = useLoad<MeetingDetail>(() => api.get(`/api/meetings/${meetingId}`), [meetingId])
  const [notesDraft, setNotesDraft] = useState<string | null>(null)
  const [newItemText, setNewItemText] = useState('')
  const [convertItem, setConvertItem] = useState<MeetingActionItem | null>(null)
  const isOrganizerOrOwner = !!meeting && !!user && (user.role === 'owner' || meeting.organizerId === user.id)
  const now = useNowTick()
  // Pronista §Meeting link copy (2026-09-01) — เดิมลิงก์โผล่แค่ในช่วงกดเข้าร่วมได้ (5 นาทีก่อนเริ่ม-จบ) คัดลอกไปให้ลูกค้า/คนนอกล่วงหน้าไม่ได้เลย
  const [linkCopied, setLinkCopied] = useState(false)
  const copyLink = async () => {
    if (!meeting?.externalMeetingUrl) return
    await navigator.clipboard.writeText(meeting.externalMeetingUrl)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 1500)
  }

  const saveNotes = async () => {
    if (notesDraft === null || notesDraft === (meeting?.notes ?? '')) { setNotesDraft(null); return }
    await api.patch(`/api/meetings/${meetingId}`, { notes: notesDraft })
    setNotesDraft(null)
    await reload()
  }
  const addItem = async () => {
    if (!newItemText.trim()) return
    await api.post(`/api/meetings/${meetingId}/action-items`, { text: newItemText.trim() })
    setNewItemText('')
    await reload()
  }
  const toggleItem = async (item: MeetingActionItem) => {
    await api.patch(`/api/meetings/${meetingId}/action-items/${item.id}`, { done: !item.done })
    await reload()
  }
  const removeMeeting = async () => {
    if (!(await confirmDialog({ title: 'ลบการนัดประชุมนี้?', message: `${meeting?.title ?? ''} — ผู้เข้าร่วมจะไม่เห็นประชุมนี้อีก ยกเลิกไม่ได้`, danger: true, confirmLabel: 'ลบ' }))) return
    await api.delete(`/api/meetings/${meetingId}`)
    onChanged()
    onClose()
  }

  if (!meeting) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between px-4 py-3 border-b border-border-subtle shrink-0">
          <div className="min-w-0">
            <div className="font-semibold text-ink text-sm">{meeting.title}</div>
            <div className="text-[11px] text-muted mt-0.5">
              {fmtDayHeader(meeting.startAt)} · {fmtTimeRange(meeting.startAt, meeting.endAt)}
              {meeting.projectName && ` · ${meeting.projectName}`}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* Pronista §Team Meeting (2026-08-27) — ย้ายปุ่มลบขึ้นมาไว้ที่หัวการ์ดให้เห็นชัด (เดิมเป็นลิงก์เล็กๆ ล่างสุด หาไม่ค่อยเจอ) — ลบได้เฉพาะผู้จัดประชุมหรือ owner */}
            {isOrganizerOrOwner && (
              <button onClick={() => void removeMeeting()} title="ลบการนัดประชุมนี้" className="p-1.5 rounded hover:bg-danger-50 text-dim hover:text-danger-600">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded hover:bg-hover text-dim"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto">
          {meeting.externalMeetingUrl && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Pronista §Meeting Schedule Tab (2026-08-27) — กดเข้าร่วมได้เฉพาะช่วงก่อนเริ่ม 5 นาที ถึงเวลาสิ้นสุดนัดหมาย (เหมือนปุ่มในรายการ) */}
              {canJoinMeeting(new Date(meeting.startAt).getTime(), new Date(meeting.endAt).getTime(), now) && (
                <a href={meeting.externalMeetingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-white bg-success-600 hover:bg-success-700 px-3 py-2 rounded-lg font-medium">
                  <ExternalLink className="w-4 h-4" /> เข้าร่วมประชุม
                </a>
              )}
              {/* Pronista §Meeting link copy (2026-09-01) — คัดลอกลิงก์ได้ตลอดเวลา ไม่ต้องรอถึงช่วงเข้าร่วม เอาไปแปะให้ลูกค้า/คนนอกล่วงหน้าได้ */}
              <button onClick={() => void copyLink()} className="inline-flex items-center gap-1.5 text-sm text-body border border-border-subtle hover:bg-hover px-3 py-2 rounded-lg font-medium">
                {linkCopied ? (
                  <><Check className="w-4 h-4 text-success-600" /> คัดลอกแล้ว</>
                ) : (
                  <><Copy className="w-4 h-4" /> คัดลอกลิงก์ประชุม</>
                )}
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {meeting.participants.map((p) => (
              <span key={p.userId} className="inline-flex items-center gap-1 bg-hover rounded-full pl-0.5 pr-2 py-0.5">
                <Avatar name={p.name} className="w-4 h-4 text-[8px]" colorClass={avatarColor(p.name)} />
                <span className="text-[11px] text-body">{p.name}</span>
              </span>
            ))}
            {/* Pronista §Meeting Attendee Filter (2026-09-02) — ผู้เข้าร่วมที่เป็นคนนอกระบบ — "สมาชิก" (มี memberId) หรือ "ภายนอก" (เชิญด้วยอีเมลเอง ไม่มีแม้แต่ใน members) */}
            {meeting.externalInvitees.map((inv) => (
              <span key={inv.id} className="inline-flex items-center gap-1 bg-brand-50 rounded-full pl-0.5 pr-2 py-0.5">
                <Avatar name={inv.name} className="w-4 h-4 text-[8px]" colorClass={avatarColor(inv.name)} />
                <span className="text-[11px] text-brand-700">{inv.name} · {inv.memberId ? 'สมาชิก' : 'ภายนอก'}</span>
              </span>
            ))}
          </div>
          {meeting.agenda && (
            <div>
              <div className="text-[11px] font-medium text-muted mb-1">Agenda</div>
              <p className="text-sm text-body whitespace-pre-line">{meeting.agenda}</p>
            </div>
          )}
          <div>
            <div className="text-[11px] font-medium text-muted mb-1">บันทึกการประชุม</div>
            <textarea
              value={notesDraft ?? meeting.notes ?? ''}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={() => void saveNotes()}
              placeholder="พิมพ์สรุป/บันทึกการประชุม..."
              rows={4}
              className="w-full text-sm bg-hover rounded-lg p-2.5 resize-none focus:outline-hidden"
            />
          </div>
          <div>
            <div className="text-[11px] font-medium text-muted mb-1">Action Items</div>
            <div className="space-y-1">
              {meeting.actionItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2">
                  <button onClick={() => void toggleItem(item)} className={`w-4 h-4 rounded border shrink-0 grid place-items-center ${item.done ? 'bg-brand-500 border-brand-500 text-white' : 'border-border'}`}>
                    {item.done && <Check className="w-3 h-3" />}
                  </button>
                  <span className={`text-sm flex-1 ${item.done ? 'text-muted line-through' : 'text-body'}`}>{item.text}</span>
                  {item.taskId ? (
                    <span className="text-[10px] text-success-700 bg-success-50 px-1.5 py-0.5 rounded shrink-0">สร้าง Task แล้ว</span>
                  ) : (
                    <button onClick={() => setConvertItem(item)} className="text-[11px] text-brand-700 hover:underline shrink-0">สร้าง Task</button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void addItem() }}
                placeholder="+ เพิ่ม action item..."
                className="flex-1 text-sm bg-hover rounded-lg px-2.5 py-1.5 focus:outline-hidden"
              />
              <button onClick={() => void addItem()} disabled={!newItemText.trim()} className="text-sm bg-brand-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-40">เพิ่ม</button>
            </div>
          </div>
        </div>
      </div>
      {convertItem && (
        <ConvertActionItemModal
          meetingId={meetingId}
          item={convertItem}
          defaultProjectId={meeting.projectId}
          onClose={() => setConvertItem(null)}
          onCreated={async () => {
            setConvertItem(null)
            await reload()
          }}
        />
      )}
    </div>
  )
}

function ConvertActionItemModal({ meetingId, item, defaultProjectId, onClose, onCreated }: { meetingId: string; item: MeetingActionItem; defaultProjectId: string | null; onClose: () => void; onCreated: () => void }) {
  const { alertDialog } = useDialog()
  const { data: projects } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const [projectId, setProjectId] = useState(defaultProjectId ?? '')
  const [busy, setBusy] = useState(false)
  const create = async () => {
    if (!projectId) return
    setBusy(true)
    try {
      await api.post(`/api/meetings/${meetingId}/action-items/${item.id}/create-task`, { projectId })
      onCreated()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'สร้าง Task ไม่สำเร็จ' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-4 space-y-3">
        <div className="font-semibold text-ink text-sm">สร้าง Task จาก: {item.text}</div>
        <div>
          <label className="text-[11px] text-muted block mb-0.5">โปรเจกต์ปลายทาง</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden">
            <option value="">— เลือกโปรเจกต์ —</option>
            {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-sm px-3.5 py-2 rounded-lg text-soft hover:bg-hover">ยกเลิก</button>
          <button onClick={() => void create()} disabled={!projectId || busy} className="text-sm font-medium text-white px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40">สร้าง Task</button>
        </div>
      </div>
    </div>
  )
}
