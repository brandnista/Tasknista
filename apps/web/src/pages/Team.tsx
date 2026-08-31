import { Calendar, Hash, MessagesSquare, Paperclip, Plus, Send, Trash2, X } from 'lucide-react'
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
}
interface UserOpt {
  id: string
  name: string
}

const fmtTime = (ms: number) => new Date(ms).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

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

  const projectChannels = channels.filter((c) => c.kind === 'project')
  const otherChannels = channels.filter((c) => c.kind !== 'project')
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
    <div className="h-full flex">
      <div className="w-full sm:w-64 shrink-0 border-r border-border-subtle bg-white flex flex-col overflow-y-auto" style={{ display: selected ? undefined : 'flex' }}>
        <div className="flex items-center justify-between px-3 py-3 border-b border-border-subtle">
          <span className="font-semibold text-ink text-sm">Chat</span>
          <button onClick={() => setNewDmOpen(true)} title="เริ่มข้อความใหม่" className="p-1.5 rounded-lg hover:bg-hover text-dim">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto ${selected ? 'hidden sm:block' : ''}`}>
          {projectChannels.length > 0 && (
            <div className="px-3 pt-3 pb-1 text-[11px] font-medium text-muted tracking-wide">ห้องสนทนาโปรเจกต์</div>
          )}
          {projectChannels.map((ch) => (
            <ChannelRow key={ch.id} ch={ch} active={ch.id === selectedId} onClick={() => setSelectedId(ch.id)} />
          ))}
          {otherChannels.length > 0 && <div className="px-3 pt-3 pb-1 text-[11px] font-medium text-muted tracking-wide">ข้อความส่วนตัว/กลุ่ม</div>}
          {otherChannels.map((ch) => (
            <ChannelRow key={ch.id} ch={ch} active={ch.id === selectedId} onClick={() => setSelectedId(ch.id)} onDelete={() => void deleteChannel(ch)} />
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
  )
}

function ChannelRow({ ch, active, onClick, onDelete }: { ch: ChatChannel; active: boolean; onClick: () => void; onDelete?: () => void }) {
  const label = ch.kind === 'project' ? ch.projectName : ch.displayName ?? 'ไม่มีชื่อ'
  return (
    <div className={`group flex items-start hover:bg-hover ${active ? 'bg-hover' : ''}`}>
      <button onClick={onClick} className="flex-1 min-w-0 text-left px-3 py-2.5 flex items-start gap-2">
        {ch.kind === 'project' ? (
          <Hash className="w-4 h-4 text-muted mt-0.5 shrink-0" />
        ) : (
          <Avatar name={label ?? '?'} className="w-6 h-6 text-[10px] mt-0.5" colorClass={avatarColor(label ?? '?')} />
        )}
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
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => { setMessages(data ?? []) }, [data])
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])
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
          const msg = JSON.parse(String(e.data)) as { type?: string; message?: ChatMessage; messageId?: string }
          if (msg.type === 'chat_message' && msg.message) {
            setMessages((prev) => (prev.some((m) => m.id === msg.message!.id) ? prev : [...prev, msg.message!]))
            if (msg.message.senderId !== meId) onSent()
          } else if (msg.type === 'chat_message_edited' && msg.message) {
            setMessages((prev) => prev.map((m) => (m.id === msg.message!.id ? msg.message! : m)))
          } else if (msg.type === 'chat_message_deleted' && msg.messageId) {
            setMessages((prev) => prev.filter((m) => m.id !== msg.messageId))
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
    try {
      await api.post(`/api/chat/channels/${channel.id}/messages`, { body })
      onSent()
    } finally {
      setSending(false)
    }
  }

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
        {channel.kind === 'project' ? <Hash className="w-4 h-4 text-muted" /> : <Avatar name={label ?? '?'} className="w-6 h-6 text-[10px]" colorClass={avatarColor(label ?? '?')} />}
        <span className="font-semibold text-ink text-sm">{label}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((m) => (
          <MessageRow key={m.id} m={m} mine={m.senderId === meId} onDeleted={() => setMessages((prev) => prev.filter((x) => x.id !== m.id))} onConvert={() => setConvertFor(m)} />
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-border-subtle p-3 flex items-end gap-2">
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
        <button onClick={() => fileRef.current?.click()} className="p-2 rounded-lg hover:bg-hover text-dim shrink-0" title="แนบไฟล์"><Paperclip className="w-4 h-4" /></button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          placeholder="พิมพ์ข้อความ..."
          rows={1}
          className="flex-1 text-sm bg-hover rounded-lg px-3 py-2 resize-none focus:outline-hidden"
        />
        <button onClick={() => void send()} disabled={!text.trim() || sending} className="p-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40 shrink-0"><Send className="w-4 h-4" /></button>
      </div>
      {convertFor && <ConvertToTaskModal message={convertFor} onClose={() => setConvertFor(null)} />}
    </div>
  )
}

function MessageRow({ m, mine, onDeleted, onConvert }: { m: ChatMessage; mine: boolean; onDeleted: () => void; onConvert: () => void }) {
  const { confirmDialog } = useDialog()
  const [menuOpen, setMenuOpen] = useState(false)
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
        <div className={`text-sm whitespace-pre-line break-words rounded-2xl px-3 py-2 mt-0.5 ${mine ? 'bg-brand-600 text-white rounded-tr-sm' : 'bg-hover text-body rounded-tl-sm'}`}>{m.body}</div>
        {m.attachments.map((a) => (
          <a key={a.id} href={a.r2Key ? `/api/chat/attachments/${a.id}` : (a.externalUrl ?? undefined)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-mono bg-info-50 text-info-700 px-1.5 py-0.5 rounded mt-1 hover:bg-info-100">
            <Paperclip className="w-3 h-3" /> {a.filename}
          </a>
        ))}
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
