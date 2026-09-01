/**
 * Pronista §My Files (2026-08-28) — "ไฟล์ของฉัน" / "แชร์กับฉัน" ไดรฟ์ส่วนตัว ใต้เมนู "งานของฉัน"
 * แยกขาดจากระบบ "เอกสาร" บริษัทเดิมทั้งหมด (คนละ endpoint คนละกติกาสิทธิ์ — ไม่มี owner-bypass ที่นี่ เป็นพื้นที่ส่วนตัวจริงๆ)
 * component เดียวใช้ทั้ง 2 แท็บผ่าน prop `root` — "own" เริ่มที่ root ของตัวเอง (เข้าโฟลเดอร์ได้ปกติ), "shared" เริ่มที่ลิสต์แบนของที่ถูกแชร์มา (กดเข้าโฟลเดอร์ที่แชร์แล้วสลับไปโหมด browse เหมือนกัน)
 */
import { ChevronLeft, File, FileText, Folder, FolderInput, FolderPlus, Image as ImageIcon, Link2, Pencil, Share2, Trash2, Upload, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useDialog } from './Dialog'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/useLoad'

type Kind = 'file' | 'page' | 'folder' | 'link'
interface FileRow {
  id: string
  ownerId: string
  parentId: string | null
  kind: Kind
  name: string
  mime: string | null
  sizeBytes: number | null
  externalUrl?: string | null
  updatedAt: number
  ownerName?: string | null
  myRole?: 'viewer' | 'editor'
  isOwner: boolean
}
interface FolderMeta { id: string; name: string; parentId: string | null; access: 'owner' | 'editor' | 'viewer' }
interface ListResponse { folder: FolderMeta | null; items: FileRow[] }
interface UserOpt { id: string; name: string }
interface MemberRow { id: string; name: string; role: 'viewer' | 'editor' }

type TypeFilter = 'all' | 'folder' | 'page' | 'link' | 'image' | 'pdf' | 'other'
type DateFilter = 'all' | 'today' | 'week' | 'month'

const fileType = (r: FileRow): TypeFilter => {
  if (r.kind === 'folder') return 'folder'
  if (r.kind === 'page') return 'page'
  if (r.kind === 'link') return 'link'
  if (r.mime === 'application/pdf') return 'pdf'
  if (r.mime?.startsWith('image/')) return 'image'
  return 'other'
}
const TYPE_LABEL: Record<TypeFilter, string> = { all: 'ทุกประเภท', folder: 'โฟลเดอร์', page: 'เอกสาร', link: 'ลิงก์', image: 'รูปภาพ', pdf: 'PDF', other: 'อื่นๆ' }
const iconFor = (r: FileRow) => {
  const t = fileType(r)
  if (t === 'folder') return <Folder className="w-4 h-4 text-brand-500 shrink-0" />
  if (t === 'page') return <FileText className="w-4 h-4 text-info-600 shrink-0" />
  if (t === 'link') return <Link2 className="w-4 h-4 text-info-500 shrink-0" />
  if (t === 'image') return <ImageIcon className="w-4 h-4 text-success-600 shrink-0" />
  return <File className="w-4 h-4 text-muted shrink-0" />
}
const fmtSize = (n: number | null) => {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
const bkkToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)
const dayOf = (ms: number) => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 10)
const withinDateFilter = (updatedAt: number, filter: DateFilter): boolean => {
  if (filter === 'all') return true
  const today = bkkToday()
  const day = dayOf(updatedAt)
  if (filter === 'today') return day === today
  const daysAgo = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000)
  if (filter === 'week') return daysAgo >= 0 && daysAgo <= 6
  return daysAgo >= 0 && daysAgo <= 29
}

function CreateFolderModal({ parentId, onClose, onDone }: { parentId: string | null; onClose: () => void; onDone: () => void }) {
  const { alertDialog } = useDialog()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await api.post('/api/my-files', { kind: 'folder', name: name.trim(), parentId })
      onDone()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'สร้างโฟลเดอร์ไม่สำเร็จ' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-4 space-y-3">
        <div className="font-semibold text-ink text-sm">สร้างโฟลเดอร์</div>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} placeholder="ชื่อโฟลเดอร์" className="w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3.5 py-2 rounded-lg text-soft hover:bg-hover">ยกเลิก</button>
          <button onClick={() => void submit()} disabled={!name.trim() || busy} className="text-sm font-medium text-white px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40">สร้าง</button>
        </div>
      </div>
    </div>
  )
}

export function ShareModal({ file, onClose }: { file: { id: string; name: string; ownerId: string }; onClose: () => void }) {
  const { alertDialog } = useDialog()
  const { data: members, reload } = useLoad<MemberRow[]>(() => api.get(`/api/my-files/${file.id}/members`), [file.id])
  const { data: users } = useLoad<UserOpt[]>(() => api.get('/api/users'))
  const [pickUserId, setPickUserId] = useState('')
  const [pickRole, setPickRole] = useState<'viewer' | 'editor'>('viewer')
  const memberIds = new Set((members ?? []).map((m) => m.id))
  const options = (users ?? []).filter((u) => !memberIds.has(u.id) && u.id !== file.ownerId)

  const add = async () => {
    if (!pickUserId) return
    try {
      await api.post(`/api/my-files/${file.id}/members`, { userId: pickUserId, role: pickRole })
      setPickUserId('')
      await reload()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'แชร์ไม่สำเร็จ' })
    }
  }
  const remove = async (userId: string) => {
    await api.delete(`/api/my-files/${file.id}/members/${userId}`)
    await reload()
  }
  const changeRole = async (userId: string, role: 'viewer' | 'editor') => {
    await api.post(`/api/my-files/${file.id}/members`, { userId, role })
    await reload()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-ink text-sm">แชร์ "{file.name}"</div>
          <button onClick={onClose} className="p-1 rounded hover:bg-hover text-dim"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex gap-2">
          <select value={pickUserId} onChange={(e) => setPickUserId(e.target.value)} className="flex-1 text-sm bg-hover rounded-lg px-2 py-2 focus:outline-hidden">
            <option value="">— เลือกคน —</option>
            {options.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={pickRole} onChange={(e) => setPickRole(e.target.value as 'viewer' | 'editor')} className="text-sm bg-hover rounded-lg px-2 py-2 focus:outline-hidden">
            <option value="viewer">ดูอย่างเดียว</option>
            <option value="editor">แก้ไขได้</option>
          </select>
          <button onClick={() => void add()} disabled={!pickUserId} className="text-sm text-white bg-brand-600 hover:bg-brand-700 px-3 py-2 rounded-lg disabled:opacity-40">เพิ่ม</button>
        </div>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {(members ?? []).length === 0 && <div className="text-xs text-muted text-center py-4">ยังไม่ได้แชร์ให้ใคร</div>}
          {(members ?? []).map((m) => (
            <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-hover">
              <span className="text-sm text-body flex-1 truncate">{m.name}</span>
              <select value={m.role} onChange={(e) => void changeRole(m.id, e.target.value as 'viewer' | 'editor')} className="text-xs bg-hover rounded-lg px-1.5 py-1 focus:outline-hidden">
                <option value="viewer">ดูอย่างเดียว</option>
                <option value="editor">แก้ไขได้</option>
              </select>
              <button onClick={() => void remove(m.id)} className="text-border hover:text-danger-600"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface DocNodeOpt { id: string; title: string; parentId: string | null; kind: string }

// Pronista §My Files → เอกสาร (2026-08-31) — คัดลอกไฟล์/เอกสารเดี่ยวจาก "ไฟล์ของฉัน" เข้าเมนู "เอกสาร" บริษัท (เลือกโฟลเดอร์ปลายทางได้)
function ShareToDocsModal({ file, onClose }: { file: FileRow; onClose: () => void }) {
  const { alertDialog } = useDialog()
  const { data: docNodes } = useLoad<DocNodeOpt[]>(() => api.get('/api/docs'))
  const [parentId, setParentId] = useState('')
  const [busy, setBusy] = useState(false)

  const folders = useMemo(() => {
    const all = (docNodes ?? []).filter((d) => d.kind === 'folder')
    const byId = new Map(all.map((f) => [f.id, f]))
    const depthOf = (f: DocNodeOpt): number => {
      let depth = 0
      let cur = f.parentId
      while (cur) {
        depth++
        cur = byId.get(cur)?.parentId ?? null
      }
      return depth
    }
    return all.map((f) => ({ ...f, depth: depthOf(f) })).sort((a, b) => a.title.localeCompare(b.title))
  }, [docNodes])

  const submit = async () => {
    setBusy(true)
    try {
      const doc = await api.post<{ id: string }>(`/api/my-files/${file.id}/share-to-docs`, { parentId: parentId || null })
      onClose()
      window.open(`/docs/${doc.id}`, '_blank', 'noopener')
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'แชร์ไปเอกสารไม่สำเร็จ' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-ink text-sm">แชร์ "{file.name}" ไปเอกสาร</div>
          <button onClick={onClose} className="p-1 rounded hover:bg-hover text-dim"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-muted">
          คัดลอกเข้าเมนู "เอกสาร" — ใครก็ตามที่มีสิทธิ์เข้าเมนูเอกสารจะเห็นไฟล์นี้ทั้งหมด · ต้นฉบับใน "ไฟล์ของฉัน" ยังอยู่เหมือนเดิม (คัดลอก ไม่ใช่ย้าย)
        </p>
        <div>
          <label className="text-[11px] text-muted block mb-0.5">โฟลเดอร์ปลายทางในเอกสาร</label>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden">
            <option value="">— หน้าแรกของเอกสาร (root) —</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{'　'.repeat(f.depth)}{f.title}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="text-sm px-3.5 py-2 rounded-lg text-soft hover:bg-hover">ยกเลิก</button>
          <button onClick={() => void submit()} disabled={busy} className="text-sm font-medium text-white px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40">
            {busy ? 'กำลังแชร์...' : 'แชร์ไปเอกสาร'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function MyFilesTab({ root }: { root: 'own' | 'shared' }) {
  const { confirmDialog, alertDialog, promptDialog } = useDialog()
  const { user } = useAuth()
  // เมนู "เอกสาร" เป็น teamOnly — vendor/guest กด "แชร์ไปเอกสาร" ไปก็เจอ 403 ที่ server อยู่ดี ซ่อนปุ่มไปเลยดีกว่า
  const canShareToDocs = user?.role === 'owner' || user?.role === 'member'
  const [folderId, setFolderId] = useState<string | null>(null) // null ที่ root === "own" (root ของตัวเอง) — ที่ root === "shared" หมายถึงลิสต์แชร์แบบแบน
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [shareModal, setShareModal] = useState<FileRow | null>(null)
  const [shareToDocsModal, setShareToDocsModal] = useState<FileRow | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const browsingShared = root === 'shared' && folderId === null
  const { data: listData, reload: reloadList } = useLoad<ListResponse>(
    () => api.get(`/api/my-files${folderId ? `?parentId=${folderId}` : ''}`),
    [folderId],
  )
  const { data: sharedFlat, reload: reloadShared } = useLoad<FileRow[]>(() => api.get('/api/my-files/shared'), [])
  const reload = () => { void reloadList(); void reloadShared() }

  const rawItems: FileRow[] = browsingShared ? (sharedFlat ?? []) : (listData?.items ?? [])
  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rawItems
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .filter((r) => typeFilter === 'all' || fileType(r) === typeFilter)
      .filter((r) => withinDateFilter(r.updatedAt, dateFilter))
      .filter((r) => ownerFilter === 'all' || r.ownerName === ownerFilter)
      .sort((a, b) => (fileType(a) === 'folder' && fileType(b) !== 'folder' ? -1 : fileType(b) === 'folder' && fileType(a) !== 'folder' ? 1 : a.name.localeCompare(b.name)))
  }, [rawItems, search, typeFilter, dateFilter, ownerFilter])
  const owners = useMemo(() => [...new Set(rawItems.map((r) => r.ownerName).filter((n): n is string => !!n))], [rawItems])

  const canCreateHere = browsingShared ? false : !listData?.folder || listData.folder.access !== 'viewer'

  // เอกสาร (kind='page') เปิดเป็นแท็บใหม่เสมอ — เหมือนแพตเทิร์น "หน้าใหม่" ในเมนูเอกสาร (Docs.tsx)
  const openPage = (id: string) => window.open(`/my-tasks/files/${id}`, '_blank', 'noopener')

  const openItem = (r: FileRow) => {
    if (r.kind === 'folder') { setFolderId(r.id); return }
    if (r.kind === 'page') { openPage(r.id); return }
    if (r.kind === 'link') { if (r.externalUrl) window.open(r.externalUrl, '_blank', 'noopener'); return }
    window.open(`/api/my-files/${r.id}/download`, '_blank')
  }

  // เพิ่มลิงก์ Google Docs/Drive — mirror addLink ใน Docs.tsx (เมนู "เอกสาร" บริษัท)
  const addLink = async () => {
    const title = await promptDialog({ title: 'ลิงก์ Google Docs / Drive', placeholder: 'ชื่อไฟล์…', confirmLabel: 'ถัดไป' })
    if (!title?.trim()) return
    const url = await promptDialog({ title: 'วางลิงก์', placeholder: 'https://docs.google.com/...', confirmLabel: 'เพิ่ม' })
    if (!url?.trim()) return
    try {
      await api.post('/api/my-files', { kind: 'link', name: title.trim(), externalUrl: url.trim(), parentId: folderId })
      reload()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'เพิ่มลิงก์ไม่สำเร็จ' })
    }
  }

  // Pronista §My Files multi-upload (2026-08-28) — เลือกได้ทีละหลายไฟล์ ยิงทีละไฟล์ต่อ request (backend รับทีละไฟล์อยู่แล้ว) ไฟล์ไหนพังไม่บล็อกไฟล์ที่เหลือ
  const uploadFiles = async (fileList: globalThis.FileList) => {
    setUploading(true)
    const failed: string[] = []
    try {
      for (const file of Array.from(fileList)) {
        try {
          const form = new FormData()
          form.set('file', file)
          if (folderId) form.set('parentId', folderId)
          await api.post('/api/my-files/upload', form)
        } catch {
          failed.push(file.name)
        }
      }
      reload()
      if (failed.length > 0) await alertDialog({ title: `อัปโหลดไม่สำเร็จ ${failed.length} ไฟล์: ${failed.join(', ')}` })
    } finally {
      setUploading(false)
    }
  }

  const removeItem = async (r: FileRow) => {
    const ok = await confirmDialog({ title: `ลบ "${r.name}"?`, message: r.kind === 'folder' ? 'ลบทั้งโฟลเดอร์รวมของข้างในทั้งหมด' : undefined, confirmLabel: 'ลบ', danger: true })
    if (!ok) return
    await api.delete(`/api/my-files/${r.id}`)
    reload()
  }

  // ลากไฟล์/เอกสารวางบนโฟลเดอร์ = ย้ายเข้าไป (Pronista §My Files drag-drop, 2026-09-01)
  const moveItem = async (id: string, parentId: string) => {
    if (id === parentId) return
    try {
      await api.post(`/api/my-files/${id}/move`, { parentId })
      reload()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'ย้ายไฟล์ไม่สำเร็จ' })
    }
  }

  const currentFolderName = listData?.folder?.name

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {folderId && (
          <button onClick={() => setFolderId(listData?.folder?.parentId ?? null)} className="inline-flex items-center gap-1 text-sm text-body hover:text-brand-700 shrink-0">
            <ChevronLeft className="w-4 h-4" /> {browsingShared ? '' : root === 'own' && !listData?.folder?.parentId ? 'ไฟล์ของฉัน' : 'กลับ'}
          </button>
        )}
        {currentFolderName && <span className="text-sm font-medium text-ink truncate">/ {currentFolderName}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อ..." className="text-sm bg-hover rounded-lg px-3 py-1.5 w-36 focus:outline-hidden" />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)} className="text-xs bg-hover rounded-lg px-2 py-1.5 focus:outline-hidden">
            {(Object.keys(TYPE_LABEL) as TypeFilter[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)} className="text-xs bg-hover rounded-lg px-2 py-1.5 focus:outline-hidden">
            <option value="all">แก้ไขเมื่อ: ทั้งหมด</option>
            <option value="today">วันนี้</option>
            <option value="week">สัปดาห์นี้</option>
            <option value="month">เดือนนี้</option>
          </select>
          {root === 'shared' && owners.length > 0 && (
            <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="text-xs bg-hover rounded-lg px-2 py-1.5 focus:outline-hidden">
              <option value="all">เจ้าของ: ทั้งหมด</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
        </div>
      </div>

      {canCreateHere && (
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> {uploading ? 'กำลังอัปโหลด...' : 'อัปโหลดไฟล์'}
            <input type="file" multiple className="hidden" disabled={uploading} onChange={(e) => { const files = e.target.files; if (files && files.length > 0) void uploadFiles(files); e.target.value = '' }} />
          </label>
          <button onClick={() => setCreateFolderOpen(true)} className="inline-flex items-center gap-1.5 text-sm text-body border border-border-subtle hover:bg-hover px-3 py-1.5 rounded-lg">
            <FolderPlus className="w-3.5 h-3.5" /> สร้างโฟลเดอร์
          </button>
          <button
            onClick={() => void api.post<FileRow>('/api/my-files', { kind: 'page', name: 'เอกสารใหม่', parentId: folderId, contentMarkdown: '' }).then((r) => { reload(); openPage(r.id) })}
            className="inline-flex items-center gap-1.5 text-sm text-body border border-border-subtle hover:bg-hover px-3 py-1.5 rounded-lg"
          >
            <FileText className="w-3.5 h-3.5" /> สร้างเอกสาร
          </button>
          <button onClick={() => void addLink()} className="inline-flex items-center gap-1.5 text-sm text-body border border-border-subtle hover:bg-hover px-3 py-1.5 rounded-lg">
            <Link2 className="w-3.5 h-3.5" /> เพิ่มลิงก์
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="bg-white rounded-lg shadow-xs text-center text-sm text-muted py-14">
          {root === 'shared' ? 'ยังไม่มีใครแชร์ไฟล์มาให้' : 'ยังไม่มีไฟล์ — อัปโหลดหรือสร้างเอกสารได้เลย'}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-xs divide-y divide-divider">
          {items.map((r) => {
            const canManage = !browsingShared && (r.myRole === 'editor' || r.myRole === undefined) && (listData?.folder ? listData.folder.access !== 'viewer' : true)
            const isDropTarget = r.kind === 'folder' && dragOverId === r.id
            return (
              <div
                key={r.id}
                draggable={canManage}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.id) }}
                onDragOver={(e) => { if (r.kind !== 'folder' || !canManage) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverId(r.id) }}
                onDragLeave={() => setDragOverId((cur) => (cur === r.id ? null : cur))}
                onDrop={(e) => {
                  if (r.kind !== 'folder' || !canManage) return
                  e.preventDefault()
                  setDragOverId(null)
                  const draggedId = e.dataTransfer.getData('text/plain')
                  if (draggedId) void moveItem(draggedId, r.id)
                }}
                className={`flex items-center gap-2.5 px-4 py-2.5 group ${isDropTarget ? 'bg-brand-100 ring-2 ring-inset ring-brand-300' : 'hover:bg-hover'}`}
              >
                <button onClick={() => openItem(r)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
                  {iconFor(r)}
                  <span className="text-sm text-body truncate">{r.name}</span>
                </button>
                {/* Pronista §My Files column alignment fix (2026-09-01) — คอลัมน์ท้ายแถวทุกอันต้อง "กว้างคงที่ + render เสมอ" ไม่ใช่แค่ conditional ทั้งก้อน (เดิม owner render เฉพาะมี ownerName, ปุ่มจัดการ 2-4 ปุ่มไม่เท่ากันแต่ละแถว ไม่ได้ห่อความกว้างคงที่ — ทำให้ปุ่มไฟล์ชื่อ flex-1 กินพื้นที่ไม่เท่ากันต่อแถว คอลัมน์ owner/ขนาด/วันที่ ข้างหลังเลยเบี้ยว) */}
                <span className="text-[11px] text-muted shrink-0 hidden sm:inline w-16 truncate text-right">{r.ownerName ?? ''}</span>
                <span className="text-[11px] text-muted shrink-0 hidden sm:inline w-14 text-right">{r.kind === 'file' ? fmtSize(r.sizeBytes) : ''}</span>
                <span className="text-[11px] text-muted shrink-0 hidden md:inline w-20 text-right">{new Date(r.updatedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</span>
                <div className="flex items-center justify-end gap-1 shrink-0 w-28 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                  {r.kind === 'page' && canManage && <button onClick={() => openPage(r.id)} title="แก้ไข" className="p-1 rounded hover:bg-white text-dim hover:text-brand-700"><Pencil className="w-3.5 h-3.5" /></button>}
                  {/* Pronista §My Files bug fix (2026-08-28) — เดิมเช็ค myRole === undefined ซึ่งเป็น undefined เสมอตอนไล่เข้าโฟลเดอร์ (endpoint parentId= ไม่ส่ง myRole มา) ทำให้ปุ่มแชร์โผล่ให้คนที่ไม่ใช่เจ้าของไฟล์นั้นจริงๆ (กดแล้วเจอ 403 เงียบๆ) — เปลี่ยนไปเช็ค isOwner ตรงๆ ที่ backend คำนวณมาให้ */}
                  {r.isOwner && <button onClick={() => setShareModal(r)} title="แชร์" className="p-1 rounded hover:bg-white text-dim hover:text-brand-700"><Share2 className="w-3.5 h-3.5" /></button>}
                  {r.isOwner && r.kind !== 'folder' && canShareToDocs && (
                    <button onClick={() => setShareToDocsModal(r)} title="แชร์ไปเอกสาร" className="p-1 rounded hover:bg-white text-dim hover:text-brand-700"><FolderInput className="w-3.5 h-3.5" /></button>
                  )}
                  {canManage && <button onClick={() => void removeItem(r)} title="ลบ" className="p-1 rounded hover:bg-danger-50 text-dim hover:text-danger-600"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {createFolderOpen && <CreateFolderModal parentId={folderId} onClose={() => setCreateFolderOpen(false)} onDone={() => { setCreateFolderOpen(false); reload() }} />}
      {shareModal && <ShareModal file={shareModal} onClose={() => setShareModal(null)} />}
      {shareToDocsModal && <ShareToDocsModal file={shareToDocsModal} onClose={() => setShareToDocsModal(null)} />}
    </div>
  )
}
