import { Calendar, MessageCircle, MessagesSquare, Paperclip, Plus, Search, Send, Trash2, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Avatar } from '../components/Avatar'
import { useDialog } from '../components/Dialog'
import { MeetingsTab } from '../components/MeetingsTab'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useNotifications } from '../lib/notifications-context'
import { useLoad } from '../lib/useLoad'
import { avatarColor } from './ProjectDetail'

interface ChatChannel {
  id: string
  kind: 'project' | 'dm' | 'group'
  projectId: string | null
  projectName: string | null
  name: string | null
  displayName: string | null
  lastMessageAt: number | null
  lastMessagePreview: string | null
  unreadCount: number
}
interface ChatAttachment {
  id: string
  r2Key: string | null
  externalUrl: string | null
  filename: string
  mime: string | null
}
interface ChatMessage {
  id: string
  channelId: string
  senderId: string
  senderName: string
  body: string
  createdAt: number
  editedAt: number | null
  attachments: ChatAttachment[]
  mentionedUserIds?: string[] | null
}
// Pronista §Chat @mention + read receipt (2026-09-16) — สมาชิกห้อง ใช้ทั้งทำ @mention picker และคำนวณ read receipt (lastReadAt ต่อคน)
interface ChannelMember {
  id: string
  name: string
  avatarUrl: string | null
  lastReadAt: number | string | null
}
// ตัดคำที่ไม่ใช่ตัวอักษร/ตัวเลข กันจับคำผิด (เช่น "@แพร" ไปแมตช์ในคำว่า "@แพรว")
const MENTION_BOUNDARY = /[\p{L}\p{N}_]/u
/** สแกน body หาว่ามีคน mention ใครบ้างจริงๆ (จับ "@ชื่อ" เทียบกับสมาชิกห้อง) — ใช้ตอนส่งข้อความ ไม่พึ่ง state สะสมที่อาจเพี้ยนถ้าผู้ใช้แก้ข้อความหลังเลือกจาก dropdown แล้ว */
function detectMentions(text: string, members: { id: string; name: string }[]): string[] {
  const found = new Set<string>()
  for (const m of [...members].sort((a, b) => b.name.length - a.name.length)) {
    const token = `@${m.name}`
    let idx = text.indexOf(token)
    while (idx !== -1) {
      const nextChar = text[idx + token.length]
      if (!nextChar || !MENTION_BOUNDARY.test(nextChar)) { found.add(m.id); break }
      idx = text.indexOf(token, idx + 1)
    }
  }
  return [...found]
}
/** เรนเดอร์ body พร้อมไฮไลต์ "@ชื่อ" ของคนที่ถูก mention จริง (เทียบชื่อปัจจุบันจาก members — ถ้าเปลี่ยนชื่อทีหลัง ไฮไลต์อาจไม่ตรงเป๊ะ ยอมรับได้สำหรับ v1) */
function renderMessageBody(body: string, mentionedUserIds: string[] | null | undefined, members: { id: string; name: string }[]) {
  if (!mentionedUserIds?.length) return body
  const names = members.filter((m) => mentionedUserIds.includes(m.id)).map((m) => m.name).sort((a, b) => b.length - a.length)
  if (!names.length) return body
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`@(?:${escaped.join('|')})(?![\\p{L}\\p{N}_])`, 'gu')
  const parts: (string | { key: number; text: string })[] = []
  let lastIndex = 0
  let key = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body))) {
    if (match.index > lastIndex) parts.push(body.slice(lastIndex, match.index))
    parts.push({ key: key++, text: match[0] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex))
  return parts.map((p) => (typeof p === 'string' ? p : <span key={p.key} className="font-semibold text-brand-700 bg-brand-50/70 rounded px-0.5">{p.text}</span>))
}
interface UserOpt {
  id: string
  name: string
}
// Pronista §Team Directory (2026-09-16) — รายชื่อพนักงาน/พาร์ทเนอร์ ดึงจาก /api/users ตัวเดียวกับ NewDmModal แค่ใช้ฟิลด์เพิ่ม (role/phone/ตำแหน่ง) มาจัดกลุ่ม+แสดงผล
interface DirectoryUser {
  id: string
  name: string
  role: 'owner' | 'member' | 'vendor' | 'guest'
  avatarUrl: string | null
  phone: string | null
  jobTitle: string | null
  businessName: string | null
  specialty: string | null
}

const fmtTime = (ms: number) => new Date(ms).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

// Pronista §Team Chat composer (2026-09-16) — กล่องพิมพ์เดิม rows={1} ตายตัว พอพิมพ์หลายบรรทัดแล้วมองไม่เห็นข้อความตัวเองครบ (ต้อง scroll ในกล่องเล็กๆ) ปรับให้สูงขึ้นตามเนื้อหาที่พิมพ์จริง (เหมือน WhatsApp/Slack) จนถึงเพดานหนึ่งแล้วค่อย scroll
const COMPOSER_MAX_HEIGHT = 160
function autoResizeComposer(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
}

/** Pronista §Team Chat (2026-08-26) — เมนู "ทีม" คุยงานข้ามโปรเจกต์/DM + นัดประชุมในระบบ ไม่ต้องออกไปแอปอื่น
 * โครงหน้าเลียนแบบ MyTasks.tsx (แท็บ), WebSocket ต่อห้องเลียนแบบ Inbox.tsx (reconnect 5s, ping/pong) */
export function TeamPage() {
  const [params] = useSearchParams()
  // Pronista §Team Meeting (2026-08-27) — เข้าตรงแท็บ/ประชุมได้ผ่าน ?tab=meetings&meeting=<id> (เดิมแจ้งเตือนลิงก์มาที่นี่ ตอนนี้ย้ายไป /my-tasks/meetings แล้ว — ที่นี่ยังกดเข้าเองได้ปกติ)
  const [tab, setTab] = useState<'chat' | 'meetings'>(params.get('tab') === 'meetings' ? 'meetings' : 'chat')
  const initialMeetingId = params.get('meeting') ?? undefined
  return (
    <div className="h-[calc(100dvh-4rem)] flex flex-col">
      <div className="flex bg-divider p-0.5 gap-0.5 m-2 rounded-lg text-xs font-medium w-fit shrink-0">
        <button onClick={() => setTab('chat')} className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 ${tab === 'chat' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>
          <MessagesSquare className="w-3.5 h-3.5" /> Chat
        </button>
        <button onClick={() => setTab('meetings')} className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 ${tab === 'meetings' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>
          <Calendar className="w-3.5 h-3.5" /> ประชุม
        </button>
      </div>
      <div className="flex-1 min-h-0">{tab === 'chat' ? <ChatTab initialChannelId={params.get('channel') ?? undefined} /> : <MeetingsTab initialMeetingId={initialMeetingId} />}</div>
    </div>
  )
}

function ChatTab({ initialChannelId }: { initialChannelId?: string } = {}) {
  const { user } = useAuth()
  const { confirmDialog } = useDialog()
  const { data, reload } = useLoad<ChatChannel[]>(() => api.get('/api/chat/channels'))
  const channels = useMemo(() => (data ?? []).sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)), [data])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newDmOpen, setNewDmOpen] = useState(false)
  // Pronista §Team Directory (2026-09-16) — สลับระหว่างลิสต์ห้องสนทนาเดิม กับรายชื่อพนักงาน/พาร์ทเนอร์ใหม่ (แท็บ "แชท" เดิมไม่แตะเลย)
  const [subTab, setSubTab] = useState<'messages' | 'directory'>('messages')
  // เปิดแชทจากรายชื่อ — เรียก POST /chat/channels แบบเดิมทุกอย่าง (idempotent อยู่แล้ว มีห้องเดิมก็คืนห้องเดิม) แล้วสลับกลับมาแท็บ "แชท" พร้อมเลือกห้องนั้นให้เลย
  const startDmFromDirectory = async (userId: string) => {
    const ch = await api.post<{ id: string }>('/api/chat/channels', { kind: 'dm', userId })
    setSubTab('messages')
    await reload()
    setSelectedId(ch.id)
  }
  // Pronista §Team Chat mobile — auto-เลือกห้องแรกแค่ตอนโหลดครั้งแรกเท่านั้น (เช็ค data !== null กันไม่ให้ทับค่า null ที่ผู้ใช้กด "‹" ย้อนกลับมาเองบนมือถือ)
  // Pronista §Team Chat (2026-08-27) — มาจากแจ้งเตือน chat_mention/chat_message (ดู Team.tsx ?channel=) เลือกห้องนั้นแทนห้องแรกถ้ามี
  const autoSelectedRef = useRef(false)
  useEffect(() => {
    if (!autoSelectedRef.current && data && channels.length > 0) {
      autoSelectedRef.current = true
      const initial = initialChannelId && channels.some((c) => c.id === initialChannelId) ? initialChannelId : channels[0]!.id
      setSelectedId(initial)
    }
  }, [data, channels, initialChannelId])

  const selected = channels.find((c) => c.id === selectedId) ?? null

  // Pronista §Team Chat (2026-08-27) — ลบห้อง dm/group ได้ (ห้อง project ผูก 1:1 กับโปรเจกต์ ลบผ่านนี้ไม่ได้)
  const deleteChannel = async (ch: ChatChannel) => {
    const yes = await confirmDialog({ title: 'ลบห้องสนทนานี้?', message: `${ch.displayName ?? 'ห้องนี้'} — ข้อความและไฟล์แนบทั้งหมดจะหายถาวร`, danger: true, confirmLabel: 'ลบ' })
    if (!yes) return
    await api.delete(`/api/chat/channels/${ch.id}`)
    if (selectedId === ch.id) setSelectedId(null)
    await reload()
  }

  return (
    <div className="h-full flex flex-col">
      {/* Pronista §Team Directory (2026-09-16) — สลับ "แชท" (ของเดิม) / "รายชื่อ" (ใหม่) — บาร์นี้อยู่คงที่ไม่ว่าจะสลับไปฝั่งไหน */}
      <div className="flex bg-divider p-0.5 gap-0.5 m-2 rounded-lg text-xs font-medium w-fit shrink-0">
        <button onClick={() => setSubTab('directory')} className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 ${subTab === 'directory' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>
          <Users className="w-3.5 h-3.5" /> รายชื่อ
        </button>
        <button onClick={() => setSubTab('messages')} className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 ${subTab === 'messages' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>
          <MessagesSquare className="w-3.5 h-3.5" /> แชท
        </button>
      </div>

      {subTab === 'directory' ? (
        <div className="flex-1 min-h-0 flex">
          <DirectoryPanel onStartChat={(userId) => void startDmFromDirectory(userId)} />
        </div>
      ) : (
      <div className="flex-1 min-h-0 flex">
      {/* Pronista §Team Chat mobile fix (2026-09-03) — เดิม style={{display: selected ? undefined : 'flex'}} ไม่เคยซ่อน panel นี้จริง (undefined = fallback ไปใช้ className flex เดิมอยู่ดี) ทำให้แผงห้องสนทนา + แผงข้อความโชว์ซ้อนกันพร้อมกันบนมือถือ ล้นจอ */}
      <div className={`w-full sm:w-64 shrink-0 border-r border-border-subtle bg-white flex-col overflow-y-auto ${selected ? 'hidden sm:flex' : 'flex'}`}>
        <div className="flex items-center justify-between px-3 py-3 border-b border-border-subtle">
          <span className="font-semibold text-ink text-sm">Chat</span>
          <button onClick={() => setNewDmOpen(true)} title="เริ่มข้อความใหม่" className="p-1.5 rounded-lg hover:bg-hover text-dim">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Pronista §Team Chat unify list (2026-09-14) — เลิกแยกโซน "ห้องสนทนาโปรเจกต์" ด้วยไอคอน # ออกจากกัน รวมเป็นลิสต์เดียวหน้าตาเหมือน DM/กลุ่มทั้งหมด เรียงตามข้อความล่าสุดปนกันไปเลย (ห้องโปรเจกต์ยังสร้างอัตโนมัติ/สมาชิกตามโปรเจกต์เหมือนเดิมทุกอย่าง แค่เปลี่ยนหน้าตา) */}
          {channels.map((ch) => (
            <ChannelRow key={ch.id} ch={ch} active={ch.id === selectedId} onClick={() => setSelectedId(ch.id)} onDelete={ch.kind === 'project' ? undefined : () => void deleteChannel(ch)} />
          ))}
          {channels.length === 0 && <div className="text-center text-sm text-muted py-8 px-3">ยังไม่มีห้องสนทนา — โปรเจกต์ที่คุณอยู่จะมีห้องแชทให้อัตโนมัติ</div>}
        </div>
      </div>
      <div className={`flex-1 min-w-0 ${selected ? '' : 'hidden sm:block'}`}>
        {selected ? (
          <ChatPanel key={selected.id} channel={selected} meId={user?.id ?? ''} onBack={() => setSelectedId(null)} onSent={reload} />
        ) : (
          <div className="h-full grid place-items-center text-sm text-muted">เลือกห้องสนทนาทางซ้าย</div>
        )}
      </div>
      {newDmOpen && <NewDmModal onClose={() => setNewDmOpen(false)} onCreated={(id) => { setNewDmOpen(false); void reload(); setSelectedId(id) }} />}
      </div>
      )}
    </div>
  )
}

/** Pronista §Team Directory (2026-09-16) — รายชื่อพนักงาน+พาร์ทเนอร์เรียงเป็นแถว จัดกลุ่มตามประเภท กดไอคอนแชทท้ายแถวเริ่มแชทได้ทันที ไม่ต้องกดเข้าแถวก่อน
 * (เดิมกดทั้งแถวเปิดเมนู ActionMenu ให้เลือก "แชท"/"โทร" — พอตัด "โทร" ออกเหลือแค่ "แชท" ทางเดียว เมนูคั่นกลางเลยเกินจำเป็น เปลี่ยนเป็นไอคอนกดตรงแทน)
 * ไม่แตะฟีเจอร์เดิม (ลิสต์ห้องสนทนา/สร้างกลุ่ม) เลย — เป็นแค่ทางเข้าเพิ่มสำหรับเริ่มแชท 1:1 เร็วขึ้น ใช้ endpoint เดิมทุกอย่าง (POST /chat/channels kind:'dm' — idempotent มีห้องเดิมอยู่แล้วก็เปิดห้องเดิม) */
function DirectoryPanel({ onStartChat }: { onStartChat: (userId: string) => void }) {
  const { data } = useLoad<DirectoryUser[]>(() => api.get('/api/users'))
  const [search, setSearch] = useState('')

  const q = search.trim().toLowerCase()
  const matches = (u: DirectoryUser) => !q || u.name.toLowerCase().includes(q)
  const staff = (data ?? []).filter((u) => u.role === 'member' && matches(u)).sort((a, b) => a.name.localeCompare(b.name, 'th'))
  const partners = (data ?? []).filter((u) => u.role === 'vendor' && matches(u)).sort((a, b) => a.name.localeCompare(b.name, 'th'))

  const Row = ({ u }: { u: DirectoryUser }) => (
    <div className="group w-full flex items-center gap-3 px-3 py-2 hover:bg-hover rounded-lg">
      <Avatar name={u.name} avatarUrl={u.avatarUrl} className="w-8 h-8 text-xs shrink-0" colorClass={avatarColor(u.name)} />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-body truncate">{u.name}</div>
        <div className="text-[11px] text-muted truncate">{u.jobTitle ?? u.specialty ?? u.businessName ?? (u.role === 'vendor' ? 'พาร์ทเนอร์' : 'พนักงาน')}</div>
      </div>
      <button onClick={() => onStartChat(u.id)} title={`แชทกับ ${u.name}`} className="shrink-0 p-1.5 rounded-lg text-dim hover:text-brand-700 hover:bg-brand-50 opacity-70 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <MessageCircle className="w-4 h-4" />
      </button>
    </div>
  )

  return (
    // Pronista §Team Directory (2026-09-16) — เดิม max-w-xl mx-auto ทำให้ลอยกลางจอ มีช่องว่างซ้าย-ขวาเยอะ ไม่เข้าพวกกับเลย์เอาต์แท็บ "แชท" ที่ชิดขอบซ้ายเป็นคอลัมน์คงที่ — ปรับให้เป็นคอลัมน์ชิดซ้ายแบบเดียวกัน
    <div className="h-full w-full sm:w-64 shrink-0 border-r border-border-subtle bg-white overflow-y-auto p-3">
      <div className="relative mb-3">
        <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อ..." className="w-full text-sm bg-hover rounded-lg pl-8 pr-3 py-2 focus:outline-hidden" />
      </div>

      <div className="text-[11px] font-medium text-muted uppercase tracking-wide px-1 mb-1">พนักงาน · {staff.length}</div>
      <div className="space-y-0.5 mb-4">
        {staff.map((u) => <Row key={u.id} u={u} />)}
        {staff.length === 0 && <div className="text-center text-xs text-muted py-4">ไม่พบพนักงาน</div>}
      </div>

      <div className="text-[11px] font-medium text-muted uppercase tracking-wide px-1 mb-1">พาร์ทเนอร์ · {partners.length}</div>
      <div className="space-y-0.5">
        {partners.map((u) => <Row key={u.id} u={u} />)}
        {partners.length === 0 && <div className="text-center text-xs text-muted py-4">ไม่พบพาร์ทเนอร์</div>}
      </div>
    </div>
  )
}

function ChannelRow({ ch, active, onClick, onDelete }: { ch: ChatChannel; active: boolean; onClick: () => void; onDelete?: () => void }) {
  const label = ch.kind === 'project' ? ch.projectName : ch.displayName ?? 'ไม่มีชื่อ'
  return (
    <div className={`group flex items-start hover:bg-hover ${active ? 'bg-hover' : ''}`}>
      <button onClick={onClick} className="flex-1 min-w-0 text-left px-3 py-2.5 flex items-start gap-2">
        <Avatar name={label ?? '?'} className="w-6 h-6 text-[10px] mt-0.5" colorClass={avatarColor(label ?? '?')} />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-body truncate">{label}</div>
          {ch.lastMessagePreview && <div className="text-[11px] text-muted truncate">{ch.lastMessagePreview}</div>}
        </div>
        {ch.unreadCount > 0 && (
          <span className="text-[10px] bg-danger-500 text-white rounded-full min-w-4 h-4 px-1 grid place-items-center leading-none mt-0.5 shrink-0">
            {ch.unreadCount > 9 ? '9+' : ch.unreadCount}
          </span>
        )}
      </button>
      {onDelete && (
        <button onClick={(e) => { e.stopPropagation(); onDelete() }} title="ลบห้องสนทนา" className="p-1.5 mr-1.5 mt-2 rounded hover:bg-danger-50 text-dim hover:text-danger-600 opacity-0 group-hover:opacity-100 shrink-0">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

function NewDmModal({ onClose, onCreated }: { onClose: () => void; onCreated: (channelId: string) => void }) {
  const { data: users } = useLoad<UserOpt[]>(() => api.get('/api/users'))
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [groupName, setGroupName] = useState('')
  const [busy, setBusy] = useState(false)
  const filtered = (users ?? []).filter((u) => u.name.toLowerCase().includes(search.toLowerCase()))
  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  const canStart = selected.length === 1 || (selected.length > 1 && groupName.trim().length > 0)

  const start = async () => {
    if (!canStart || busy) return
    setBusy(true)
    try {
      const ch =
        selected.length === 1
          ? await api.post<{ id: string }>('/api/chat/channels', { kind: 'dm', userId: selected[0] })
          : await api.post<{ id: string }>('/api/chat/channels', { kind: 'group', name: groupName.trim(), memberIds: selected })
      onCreated(ch.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-sm max-h-[75vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <span className="font-semibold text-ink text-sm">เริ่มข้อความใหม่ — เลือกได้หลายคนเพื่อสร้างกลุ่ม</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-hover text-dim shrink-0"><X className="w-4 h-4" /></button>
        </div>
        <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อ..." className="mx-4 mt-3 mb-2 text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden" />
        <div className="flex-1 overflow-y-auto pb-2">
          {filtered.map((u) => (
            <label key={u.id} className="w-full text-left px-4 py-2 flex items-center gap-2 hover:bg-hover cursor-pointer">
              <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} className="shrink-0" />
              <Avatar name={u.name} className="w-7 h-7 text-xs" colorClass={avatarColor(u.name)} />
              <span className="text-sm text-body">{u.name}</span>
            </label>
          ))}
        </div>
        {selected.length > 1 && (
          <div className="px-4 pb-3">
            <input autoFocus value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="ตั้งชื่อกลุ่ม..." className="w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden" />
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle">
          <span className="text-xs text-muted">{selected.length > 0 ? `เลือก ${selected.length} คน` : 'เลือกอย่างน้อย 1 คน'}</span>
          <button onClick={() => void start()} disabled={!canStart || busy} className="text-sm font-medium text-white px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40">
            {selected.length > 1 ? 'สร้างกลุ่ม' : 'เริ่มแชท'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ChatPanel({ channel, meId, onBack, onSent }: { channel: ChatChannel; meId: string; onBack: () => void; onSent: () => void }) {
  const { alertDialog } = useDialog()
  const { markChannelRead } = useNotifications()
  const { data } = useLoad<ChatMessage[]>(() => api.get(`/api/chat/channels/${channel.id}/messages`), [channel.id])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [convertFor, setConvertFor] = useState<ChatMessage | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  // Pronista §Chat @mention + read receipt (2026-09-16) — สมาชิกห้องนี้ ใช้ทำ @mention picker (เฉพาะห้อง >2 คน) + คำนวณ read receipt (avatar ใต้ข้อความล่าสุดที่แต่ละคนอ่านถึง แบบ LINE/Messenger)
  const { data: membersData } = useLoad<ChannelMember[]>(() => api.get(`/api/chat/channels/${channel.id}/members`), [channel.id])
  const [members, setMembers] = useState<ChannelMember[]>([])
  useEffect(() => setMembers(membersData ?? []), [membersData])
  const canMention = members.length > 2
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  // Pronista §Team Chat history fix (2026-09-11) — เดิมโหลดแค่ 50 ข้อความล่าสุดตายตัว ไม่มีทางเห็นข้อความเก่ากว่านั้นเลย ทั้งที่ backend รองรับ ?before= อยู่แล้ว (GET /chat/channels/:id/messages) แค่ frontend ไม่เคยเรียกใช้
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  // ตอน prepend ข้อความเก่าเข้าด้านบน ต้องไม่ auto-scroll ลงล่างเหมือนข้อความใหม่ปกติ — ใช้ ref กันแทน state เพราะไม่ต้อง re-render
  const isPrependingRef = useRef(false)
  // §Team Chat history fix — loadingMore (state) เปลี่ยนไม่ทันทีทันใด (batched) ถ้า onScroll ยิงรัวๆ ก่อน re-render จะหลุดผ่าน guard ได้หลายรอบพร้อมกัน ยิง fetch ซ้ำ/ข้อความเก่าโผล่ซ้ำ — ใช้ ref เช็คแบบ synchronous แทน
  const loadingMoreRef = useRef(false)

  useEffect(() => { setMessages(data ?? []); setHasMore((data?.length ?? 0) >= 50) }, [data])
  useEffect(() => {
    if (isPrependingRef.current) { isPrependingRef.current = false; return }
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const loadOlder = async () => {
    if (loadingMoreRef.current || !hasMore || messages.length === 0) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    const container = scrollRef.current
    const prevScrollHeight = container?.scrollHeight ?? 0
    try {
      // createdAt ที่ frontend ได้จริงคือ ISO string จาก Date.toJSON() (ชนิดที่ประกาศไว้ว่า number ไม่ตรงกับ runtime จริง) — ต้องแปลงผ่าน Date ก่อนส่งเป็น epoch ms ให้ backend Number(before) parse ได้ถูก ไม่งั้นได้ NaN เงียบๆ
      const oldestCreatedAt = new Date(messages[0]!.createdAt).getTime()
      const older = await api.get<ChatMessage[]>(`/api/chat/channels/${channel.id}/messages?before=${oldestCreatedAt}`)
      if (older.length > 0) {
        isPrependingRef.current = true
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id))
          return [...older.filter((m) => !existingIds.has(m.id)), ...prev]
        })
        // รักษาตำแหน่ง scroll เดิมไว้ (ไม่งั้นพอความสูงเปลี่ยนจากข้อความเก่าที่เพิ่มเข้ามาด้านบน จอจะกระโดด)
        requestAnimationFrame(() => {
          if (container) container.scrollTop = container.scrollHeight - prevScrollHeight
        })
      }
      setHasMore(older.length >= 50)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }
  const onScroll = () => {
    if (scrollRef.current && scrollRef.current.scrollTop < 80) void loadOlder()
  }
  // Pronista §Notification overhaul (2026-08-27) — เปิดห้องนี้แล้ว mark แจ้งเตือนแชทของห้องนี้อ่านทันที กัน badge เมนู "ทีม" ค้าง
  // Pronista §Team Chat unread badge (2026-08-28) — mark อ่านเสร็จแล้ว reload รายการห้อง กัน badge จำนวนไม่อ่านที่แถวห้องนี้ค้าง
  useEffect(() => { void markChannelRead(channel.id).then(onSent) }, [channel.id, markChannelRead, onSent])

  // Pronista §Team Chat realtime — ต่อ BoardPresenceHub (reuse) ราย channel รับ event ข้อความใหม่/แก้/ลบสด ไม่ต้อง reload ทั้งลิสต์
  useEffect(() => {
    let stopped = false
    let retry: number | null = null
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/api/chat/channels/${channel.id}/ws`)
      wsRef.current = ws
      ws.onmessage = (e) => {
        if (e.data === 'pong') return
        try {
          const msg = JSON.parse(String(e.data)) as { type?: string; message?: ChatMessage; messageId?: string; userId?: string; lastReadAt?: number }
          if (msg.type === 'chat_message' && msg.message) {
            setMessages((prev) => (prev.some((m) => m.id === msg.message!.id) ? prev : [...prev, msg.message!]))
            if (msg.message.senderId !== meId) onSent()
          } else if (msg.type === 'chat_message_edited' && msg.message) {
            setMessages((prev) => prev.map((m) => (m.id === msg.message!.id ? msg.message! : m)))
          } else if (msg.type === 'chat_message_deleted' && msg.messageId) {
            setMessages((prev) => prev.filter((m) => m.id !== msg.messageId))
          } else if (msg.type === 'chat_read' && msg.userId && typeof msg.lastReadAt === 'number') {
            // Pronista §Chat read receipt (2026-09-16) — คนอื่นในห้องเปิดอ่านสดๆ อัปเดต lastReadAt ของเขาไว้ให้ avatar ผู้อ่านขยับตาม
            setMembers((prev) => prev.map((mb) => (mb.id === msg.userId ? { ...mb, lastReadAt: msg.lastReadAt! } : mb)))
          }
        } catch {
          // ข้อความนอกรูปแบบ — เมิน
        }
      }
      ws.onclose = () => {
        if (!stopped) retry = window.setTimeout(connect, 5000)
      }
    }
    connect()
    const ping = window.setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send('ping')
    }, 30_000)
    return () => {
      stopped = true
      if (retry) window.clearTimeout(retry)
      window.clearInterval(ping)
      wsRef.current?.close()
    }
  }, [channel.id, meId, onSent])

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setText('')
    setMentionOpen(false)
    try {
      const mentionedUserIds = canMention ? detectMentions(body, members) : []
      await api.post(`/api/chat/channels/${channel.id}/messages`, { body, mentionedUserIds })
      onSent()
    } finally {
      setSending(false)
    }
  }

  // Pronista §Chat @mention (2026-09-16) — เฉพาะห้อง >2 คน: พิมพ์ "@" แล้วเลือกคนจากสมาชิกห้องได้ ไม่ไล่ตำแหน่ง caret เป๊ะๆ (โผล่เหนือช่องพิมพ์เสมอ ง่ายกว่า+พอสำหรับเคสใช้งานจริง)
  const mentionMatches = canMention
    ? members.filter((mb) => mb.id !== meId && mb.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    : []
  useEffect(() => autoResizeComposer(textareaRef.current), [text])
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setText(value)
    if (!canMention) return
    const cursor = e.target.selectionStart ?? value.length
    const match = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, cursor))
    if (match) {
      setMentionQuery(match[1] ?? '')
      setMentionOpen(true)
      setMentionIndex(0)
    } else {
      setMentionOpen(false)
    }
  }
  const pickMention = (member: ChannelMember) => {
    const el = textareaRef.current
    const cursor = el?.selectionStart ?? text.length
    const before = text.slice(0, cursor).replace(/@([^\s@]*)$/, `@${member.name} `)
    const after = text.slice(cursor)
    const newText = before + after
    setText(newText)
    setMentionOpen(false)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(before.length, before.length)
    })
  }
  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && mentionMatches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((i) => (i + 1) % mentionMatches.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionMatches[mentionIndex]!); return }
      if (e.key === 'Escape') { setMentionOpen(false); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
  }

  // Pronista §Chat read receipt (2026-09-16) — หาข้อความล่าสุด (ใครส่งก็ได้) ที่แต่ละคน "อ่านถึงตรงนั้นแล้ว" แสดง avatar ใต้ข้อความนั้นข้อความเดียว (ไม่ใช่ทุกข้อความ — ตัดชิ้นตาม LINE/Messenger)
  const readAvatarsByMessageId = useMemo(() => {
    const map = new Map<string, ChannelMember[]>()
    for (const member of members) {
      if (member.id === meId || !member.lastReadAt) continue
      const readAt = new Date(member.lastReadAt).getTime()
      let latest: ChatMessage | null = null
      for (const m of messages) {
        const t = new Date(m.createdAt).getTime()
        if (t <= readAt && (!latest || t > new Date(latest.createdAt).getTime())) latest = m
      }
      if (latest && latest.senderId !== member.id) map.set(latest.id, [...(map.get(latest.id) ?? []), member])
    }
    return map
  }, [messages, members, meId])

  const upload = async (file: File) => {
    // ต้องมีข้อความก่อนถึงจะแนบไฟล์ได้ (ไฟล์แนบผูกกับ message) — ส่งชื่อไฟล์เป็นข้อความให้อัตโนมัติถ้ายังไม่มี
    const created = await api.post<ChatMessage>(`/api/chat/channels/${channel.id}/messages`, { body: `แนบไฟล์: ${file.name}` })
    onSent()
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`/api/chat/messages/${created.id}/attachments`, { method: 'POST', body: fd })
    if (!res.ok) await alertDialog({ title: 'แนบไฟล์ไม่สำเร็จ — รับไฟล์ขนาดไม่เกิน 15MB' })
  }

  const label = channel.kind === 'project' ? channel.projectName : channel.displayName ?? 'ไม่มีชื่อ'

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle bg-hover/60">
        <button onClick={onBack} className="sm:hidden text-sm text-muted">‹</button>
        <Avatar name={label ?? '?'} className="w-6 h-6 text-[10px]" colorClass={avatarColor(label ?? '?')} />
        <span className="font-semibold text-ink text-sm">{label}</span>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loadingMore && <div className="text-center text-xs text-muted py-1">กำลังโหลดข้อความเก่า…</div>}
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            m={m}
            mine={m.senderId === meId}
            members={members}
            readBy={readAvatarsByMessageId.get(m.id) ?? []}
            onDeleted={() => setMessages((prev) => prev.filter((x) => x.id !== m.id))}
            onConvert={() => setConvertFor(m)}
          />
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="relative border-t border-border-subtle p-3 flex items-end gap-2">
        {mentionOpen && mentionMatches.length > 0 && (
          <div className="absolute bottom-full left-3 mb-1 w-56 max-h-48 overflow-y-auto bg-white rounded-lg shadow-2xl border border-border-subtle p-1 z-10">
            {mentionMatches.map((mb, i) => (
              <button
                key={mb.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pickMention(mb) }}
                className={`w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded ${i === mentionIndex ? 'bg-brand-50 text-brand-700' : 'hover:bg-hover text-body'}`}
              >
                <Avatar name={mb.name} avatarUrl={mb.avatarUrl} className="w-5 h-5 text-[9px] shrink-0" colorClass={avatarColor(mb.name)} />
                {mb.name}
              </button>
            ))}
          </div>
        )}
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
        <button onClick={() => fileRef.current?.click()} className="p-2 rounded-lg hover:bg-hover text-dim shrink-0" title="แนบไฟล์"><Paperclip className="w-4 h-4" /></button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleComposerKeyDown}
          placeholder={canMention ? 'พิมพ์ข้อความ... (พิมพ์ @ เพื่อกล่าวถึงใครในกลุ่ม)' : 'พิมพ์ข้อความ...'}
          rows={1}
          style={{ maxHeight: COMPOSER_MAX_HEIGHT }}
          className="flex-1 text-sm bg-hover rounded-lg px-3 py-2 resize-none overflow-y-auto focus:outline-hidden"
        />
        <button onClick={() => void send()} disabled={!text.trim() || sending} className="p-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40 shrink-0"><Send className="w-4 h-4" /></button>
      </div>
      {convertFor && <ConvertToTaskModal message={convertFor} onClose={() => setConvertFor(null)} />}
    </div>
  )
}

function MessageRow({
  m, mine, members, readBy, onDeleted, onConvert,
}: {
  m: ChatMessage
  mine: boolean
  members: { id: string; name: string; avatarUrl: string | null }[]
  readBy: { id: string; name: string; avatarUrl: string | null }[]
  onDeleted: () => void
  onConvert: () => void
}) {
  const { confirmDialog } = useDialog()
  const [menuOpen, setMenuOpen] = useState(false)
  // Pronista §Chat inline media (2026-09-16) — รูป/คลิปที่แนบมา โชว์ตรงในแชทเลยแบบ LINE/Messenger ไม่ต้องกดออกไปดูอีกที
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const remove = async () => {
    setMenuOpen(false)
    if (!(await confirmDialog({ title: 'ลบข้อความนี้?', danger: true }))) return
    await api.delete(`/api/chat/messages/${m.id}`)
    onDeleted()
  }
  return (
    <div className={`flex items-start gap-2 group ${mine ? 'flex-row-reverse justify-start' : ''}`}>
      {!mine && <Avatar name={m.senderName} className="w-7 h-7 text-xs mt-0.5 shrink-0" colorClass={avatarColor(m.senderName)} />}
      <div className={`min-w-0 max-w-[75%] flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
        <div className={`flex items-baseline gap-1.5 ${mine ? 'flex-row-reverse' : ''}`}>
          {!mine && <span className="text-sm font-medium text-ink">{m.senderName}</span>}
          <span className="text-[11px] text-muted">{fmtTime(m.createdAt)}{m.editedAt ? ' (แก้ไขแล้ว)' : ''}</span>
        </div>
        <div className={`text-sm whitespace-pre-line break-words rounded-2xl px-3 py-2 mt-0.5 ${mine ? 'bg-brand-600 text-white rounded-tr-sm' : 'bg-hover text-body rounded-tl-sm'}`}>
          {renderMessageBody(m.body, m.mentionedUserIds, members)}
        </div>
        {m.attachments.map((a) => {
          const src = a.r2Key ? `/api/chat/attachments/${a.id}` : a.externalUrl
          if (src && a.mime?.startsWith('image/')) {
            return (
              <button key={a.id} type="button" onClick={() => setLightboxUrl(src)} className="block mt-1 max-w-[240px]">
                <img src={src} alt={a.filename} className="max-w-full max-h-60 rounded-lg object-cover cursor-zoom-in" />
              </button>
            )
          }
          if (src && a.mime?.startsWith('video/')) {
            return <video key={a.id} src={src} controls className="mt-1 max-w-[280px] max-h-60 rounded-lg" />
          }
          return (
            <a key={a.id} href={src ?? undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-mono bg-info-50 text-info-700 px-1.5 py-0.5 rounded mt-1 hover:bg-info-100">
              <Paperclip className="w-3 h-3" /> {a.filename}
            </a>
          )
        })}
        {lightboxUrl && (
          <div className="fixed inset-0 z-50 bg-ink/80 grid place-items-center p-4" onClick={() => setLightboxUrl(null)}>
            <img src={lightboxUrl} alt="" className="max-w-full max-h-full rounded-lg" onClick={(e) => e.stopPropagation()} />
            <button onClick={() => setLightboxUrl(null)} aria-label="ปิด" className="absolute top-4 right-4 text-white bg-black/40 hover:bg-black/60 rounded-full p-2">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        {/* Pronista §Chat read receipt (2026-09-16) — ไอคอนผู้อ่านเล็กๆ ใต้ข้อความล่าสุดที่แต่ละคนอ่านถึง (แบบ LINE/Messenger) */}
        {readBy.length > 0 && (
          <div className="flex items-center -space-x-1 mt-0.5">
            {readBy.map((r) => (
              <span key={r.id} title={`${r.name} อ่านแล้ว`}>
                <Avatar name={r.name} avatarUrl={r.avatarUrl} className="w-3.5 h-3.5 text-[7px] ring-1 ring-white" colorClass={avatarColor(r.name)} />
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="relative shrink-0 opacity-0 group-hover:opacity-100 self-center">
        <button onClick={() => setMenuOpen((v) => !v)} className="text-xs text-dim px-1.5 py-0.5 rounded hover:bg-hover">⋮</button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className={`absolute top-full mt-1 z-50 w-40 bg-white rounded-lg shadow-2xl border border-border-subtle p-1 ${mine ? 'left-0' : 'right-0'}`}>
              <button onClick={() => { setMenuOpen(false); onConvert() }} className="w-full text-left text-xs px-2.5 py-1.5 rounded hover:bg-hover text-body">สร้าง Task</button>
              {mine && <button onClick={() => void remove()} className="w-full text-left text-xs px-2.5 py-1.5 rounded hover:bg-hover text-danger-600">ลบข้อความ</button>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ConvertToTaskModal({ message, onClose }: { message: ChatMessage; onClose: () => void }) {
  const { alertDialog } = useDialog()
  const { data: projects } = useLoad<{ id: string; name: string }[]>(() => api.get('/api/projects'))
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState(message.body.slice(0, 200))
  const [busy, setBusy] = useState(false)
  const create = async () => {
    if (!projectId) return
    setBusy(true)
    try {
      await api.post(`/api/chat/messages/${message.id}/convert-to-task`, { projectId, title })
      onClose()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'สร้าง Task ไม่สำเร็จ' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-4 space-y-3">
        <div className="font-semibold text-ink text-sm">สร้าง Task จากข้อความนี้</div>
        <div>
          <label className="text-[11px] text-muted block mb-0.5">ชื่องาน</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden" />
        </div>
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
