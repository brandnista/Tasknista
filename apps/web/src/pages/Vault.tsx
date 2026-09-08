/**
 * Pronista §Secret Vault (2026-09-03) — คลังเก็บรหัสผ่าน/ข้อมูลลับ owner-only
 * ต่อโปรเจกต์ (มี badge ชื่อโปรเจกต์) หรือส่วนกลางบริษัท (badge "บริษัท") — ต้องปลดล็อคด้วย Master PIN ก่อนเห็น/สร้าง/แก้ไข plaintext
 * PIN นี้แยกจาก login (Google OAuth ล้วน ไม่มี password) — ปลดล็อคแล้วอยู่ได้ 15 นาที (server กำหนด)
 */
import { Check, Copy, Eye, EyeOff, Lock, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useDialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'

interface VaultStatus {
  hasPin: boolean
}
interface VaultAuditRow {
  id: string
  actorId: string
  actorName: string | null
  action: string
  meta: { name?: string } | null
  at: number
}
interface VaultItemRow {
  id: string
  name: string
  username: string | null
  url: string | null
  projectId: string | null
  projectName: string | null
  folderId: string | null
  folderName: string | null
  updatedAt: number
}
interface VaultItemRevealed {
  username: string | null
  password: string | null
  url: string | null
  notes: string | null
}
interface ProjectOpt {
  id: string
  name: string
}
interface FolderOpt {
  id: string
  name: string
}

function isVaultLocked(e: unknown): boolean {
  return e instanceof ApiError && e.message === 'vault_locked'
}

/** ตั้ง PIN ครั้งแรก — ไม่มี currentPin ให้กรอก */
function VaultSetup({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError('')
    if (pin.length < 4) return setError('PIN ต้องมีอย่างน้อย 4 หลัก')
    if (pin !== confirm) return setError('PIN ทั้งสองช่องไม่ตรงกัน')
    setBusy(true)
    try {
      await api.post('/api/vault/pin', { newPin: pin })
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-16 bg-white rounded-lg shadow-xs p-6 text-center">
      <Lock className="w-8 h-8 mx-auto mb-3 text-brand-600" />
      <div className="font-semibold text-ink mb-1">ตั้งค่า Secret Vault</div>
      <p className="text-xs text-muted mb-4">ตั้ง PIN ส่วนตัวไว้ปลดล็อคก่อนเห็น/คัดลอกรหัสผ่านทุกครั้ง — แยกจากรหัส login เดิม</p>
      <div className="space-y-2 text-left">
        <input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} placeholder="ตั้ง PIN (อย่างน้อย 4 หลัก)" className="w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden" />
        <input type="password" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} placeholder="กรอก PIN อีกครั้ง" className="w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden" />
      </div>
      {error && <div className="text-xs text-danger-600 mt-2">{error}</div>}
      <button onClick={() => void submit()} disabled={busy} className="w-full mt-4 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-40 px-4 py-2 rounded-lg">
        {busy ? 'กำลังบันทึก…' : 'ตั้งค่า PIN'}
      </button>
    </div>
  )
}

function VaultUnlockForm({ onDone }: { onDone: (token: string) => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError('')
    setBusy(true)
    try {
      const res = await api.post<{ ok: true; token: string }>('/api/vault/unlock', { pin })
      onDone(res.token)
    } catch {
      setError('PIN ไม่ถูกต้อง')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-16 bg-white rounded-lg shadow-xs p-6 text-center">
      <Lock className="w-8 h-8 mx-auto mb-3 text-muted" />
      <div className="font-semibold text-ink mb-1">Secret Vault ล็อคอยู่</div>
      <p className="text-xs text-muted mb-4">ใส่ PIN เพื่อปลดล็อค — ต้องใส่ใหม่ทุกครั้งที่เข้าเมนูนี้</p>
      <input
        type="password"
        inputMode="numeric"
        autoFocus
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        placeholder="PIN"
        className="w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden text-center"
      />
      {error && <div className="text-xs text-danger-600 mt-2">{error}</div>}
      <button onClick={() => void submit()} disabled={busy || !pin} className="w-full mt-4 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-40 px-4 py-2 rounded-lg">
        {busy ? 'กำลังตรวจสอบ…' : 'ปลดล็อค'}
      </button>
    </div>
  )
}

function ItemModal({ item, projects, folders, token, onClose, onDone, onLocked, onFolderCreated }: {
  item: VaultItemRow | null
  projects: ProjectOpt[]
  folders: FolderOpt[]
  token: string
  onClose: () => void
  onDone: () => void
  onLocked: () => void
  onFolderCreated: (folder: FolderOpt) => void
}) {
  const toast = useToast()
  const { promptDialog } = useDialog()
  const [name, setName] = useState(item?.name ?? '')
  const [projectId, setProjectId] = useState(item?.projectId ?? '')
  const [folderId, setFolderId] = useState(item?.folderId ?? '')
  const [username, setUsername] = useState(item?.username ?? '')
  const [password, setPassword] = useState('')
  const [url, setUrl] = useState(item?.url ?? '')
  const [notes, setNotes] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const createFolder = async () => {
    const name2 = await promptDialog({ title: 'สร้าง Folder ใหม่', placeholder: 'เช่น เว็บ Seller ร้าน X', confirmLabel: 'สร้าง' })
    if (!name2?.trim()) return
    const created = await api.post<FolderOpt>('/api/vault/folders', { name: name2.trim() })
    onFolderCreated(created)
    setFolderId(created.id)
  }

  const submit = async () => {
    setError('')
    if (!name.trim()) return setError('ใส่ชื่อรายการ')
    setBusy(true)
    try {
      const payload = {
        name: name.trim(),
        projectId: projectId || null,
        folderId: folderId || null,
        username: username.trim() || null,
        url: url.trim() || null,
        ...(password ? { password } : {}),
        ...(notes ? { notes } : {}),
      }
      const headers = { 'x-vault-token': token }
      if (item) await api.patch(`/api/vault/items/${item.id}`, payload, headers)
      else await api.post('/api/vault/items', payload, headers)
      toast('บันทึกสำเร็จ')
      onDone()
    } catch (e) {
      if (isVaultLocked(e)) return onLocked()
      setError(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden'
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
          <span className="font-semibold text-ink text-sm">{item ? 'แก้ไขรายการ' : 'เพิ่มรายการ'}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-hover text-dim"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label className="text-[11px] text-muted block mb-0.5">ชื่อรายการ</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น cPanel — ร้านค้าออนไลน์ Bloom" className={input} />
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-0.5">โปรเจกต์</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={input}>
              <option value="">— บริษัท (ไม่ผูกโปรเจกต์) —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-0.5">Folder (แยกอิสระจากโปรเจกต์)</label>
            <div className="flex items-center gap-2">
              <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={input}>
                <option value="">— ไม่มี Folder —</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <button type="button" onClick={() => void createFolder()} className="shrink-0 text-xs font-medium text-brand-600 hover:underline whitespace-nowrap">+ Folder</button>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-0.5">Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className={input} />
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-0.5">Password{item && ' (เว้นว่าง = ไม่เปลี่ยน)'}</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={item ? '••••••••' : ''}
                className={`${input} pr-9`}
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-body">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-0.5">URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className={input} />
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-0.5">Notes{item && ' (เว้นว่าง = ไม่เปลี่ยน)'}</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder={item ? '(เว้นว่างไว้ = ไม่เปลี่ยนบันทึกเดิม)' : ''} className={input} />
          </div>
          {error && <div className="text-xs text-danger-600">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle shrink-0">
          <button onClick={onClose} className="text-sm px-3.5 py-2 rounded-lg text-soft hover:bg-hover">ยกเลิก</button>
          <button onClick={() => void submit()} disabled={!name.trim() || busy} className="text-sm font-medium text-white px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40">
            {item ? 'บันทึก' : 'เพิ่มรายการ'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DetailModal({ item, token, onClose, onEdit, onDeleted, onLocked }: {
  item: VaultItemRow
  token: string
  onClose: () => void
  onEdit: () => void
  onDeleted: () => void
  onLocked: () => void
}) {
  const { confirmDialog, alertDialog } = useDialog()
  const [showPassword, setShowPassword] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const { data, error } = useLoad<VaultItemRevealed>(() => api.get(`/api/vault/items/${item.id}/reveal`, { 'x-vault-token': token }), [item.id])

  if (error && isVaultLocked(error)) {
    onLocked()
    return null
  }

  const copy = async (field: string, value: string) => {
    await navigator.clipboard.writeText(value)
    setCopiedField(field)
    setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 1500)
  }

  const remove = async () => {
    if (!(await confirmDialog({ title: `ลบ "${item.name}"?`, message: 'ลบแล้วกู้คืนเองไม่ได้ (soft-delete — owner ยังตาม audit log ได้)', danger: true, confirmLabel: 'ลบ' }))) return
    try {
      await api.delete(`/api/vault/items/${item.id}`)
      onDeleted()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'ลบไม่สำเร็จ' })
    }
  }

  const row = (label: string, value: string | null, field: string, mask?: boolean) =>
    value && (
      <div>
        <label className="text-[11px] text-muted block mb-0.5">{label}</label>
        <div className="flex items-center gap-2">
          <div className="flex-1 text-sm bg-hover rounded-lg px-3 py-2 font-mono truncate">{mask && !showPassword ? '••••••••' : value}</div>
          {mask && (
            <button onClick={() => setShowPassword((v) => !v)} className="text-muted hover:text-body shrink-0" title={showPassword ? 'ซ่อน' : 'แสดง'}>
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
          <button onClick={() => void copy(field, value)} className="text-muted hover:text-body shrink-0" title="คัดลอก">
            {copiedField === field ? <Check className="w-4 h-4 text-success-600" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>
    )

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
          <div>
            <div className="font-semibold text-ink text-sm">{item.name}</div>
            <div className="text-[11px] text-muted">{item.projectName ?? 'บริษัท'}{item.folderName ? ` · ${item.folderName}` : ''}</div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-hover text-dim"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          {!data ? (
            <div className="text-center text-sm text-muted py-6">กำลังโหลด…</div>
          ) : (
            <>
              {row('Username', data.username, 'username')}
              {row('Password', data.password, 'password', true)}
              {item.url && (
                <div>
                  <label className="text-[11px] text-muted block mb-0.5">URL</label>
                  <a href={item.url} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline break-all">{item.url}</a>
                </div>
              )}
              {data.notes && (
                <div>
                  <label className="text-[11px] text-muted block mb-0.5">Notes</label>
                  <div className="text-sm bg-hover rounded-lg px-3 py-2 whitespace-pre-wrap">{data.notes}</div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex justify-between gap-2 px-4 py-3 border-t border-border-subtle shrink-0">
          <button onClick={() => void remove()} className="text-sm text-danger-600 hover:bg-danger-50 px-3 py-2 rounded-lg flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" /> ลบ</button>
          <button onClick={onEdit} className="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-4 py-2 rounded-lg flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" /> แก้ไข</button>
        </div>
      </div>
    </div>
  )
}

function VaultAuditLog() {
  const { data } = useLoad<VaultAuditRow[]>(() => api.get('/api/vault/audit'))
  const rows = data ?? []
  const actionLabel = (action: string) => {
    if (action === 'vault.unlock') return 'ปลดล็อค Vault'
    if (action === 'vault.lock') return 'ล็อค Vault'
    if (action === 'vault_pin.set') return 'ตั้ง/เปลี่ยน PIN'
    if (action === 'vault_pin.reset') return 'รีเซ็ต PIN ให้คนอื่น'
    if (action === 'secret_vault_item.reveal') return 'เปิดดูรายการ'
    if (action === 'secret_vault_item.create') return 'สร้างรายการ'
    if (action === 'secret_vault_item.update') return 'แก้ไขรายการ'
    if (action === 'secret_vault_item.delete') return 'ลบรายการ'
    if (action === 'secret_vault_folder.create') return 'สร้าง Folder'
    if (action === 'secret_vault_folder.rename') return 'เปลี่ยนชื่อ Folder'
    if (action === 'secret_vault_folder.delete') return 'ลบ Folder'
    return action
  }
  return (
    <div className="bg-white rounded-lg shadow-xs overflow-hidden">
      {rows.length === 0 ? (
        <div className="text-center text-sm text-muted py-10">ยังไม่มีประวัติการเข้าใช้งาน</div>
      ) : (
        <div className="divide-y divide-divider">
          {rows.map((r) => (
            <div key={r.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
              <span className="text-muted shrink-0 tabular-nums text-[11px]">{new Date(r.at).toLocaleString('th-TH')}</span>
              <span className="font-medium text-body shrink-0">{r.actorName ?? '—'}</span>
              <span className="text-dim">{actionLabel(r.action)}</span>
              {r.meta?.name && <span className="text-muted truncate">"{r.meta.name}"</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function VaultMain({ token, onLocked }: { token: string; onLocked: () => void }) {
  const { data, reload } = useLoad<VaultItemRow[]>(() => api.get('/api/vault/items'))
  const { data: projects } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const { data: folders, reload: reloadFolders } = useLoad<FolderOpt[]>(() => api.get('/api/vault/folders'))
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState<'all' | 'company' | string>('all')
  const [folderFilter, setFolderFilter] = useState<'all' | 'none' | string>('all')
  const [modal, setModal] = useState<VaultItemRow | 'new' | null>(null)
  const [detail, setDetail] = useState<VaultItemRow | null>(null)
  const [tab, setTab] = useState<'items' | 'audit'>('items')
  const { confirmDialog } = useDialog()

  const items = data ?? []
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((it) => {
      if (projectFilter === 'company' && it.projectId) return false
      if (projectFilter !== 'all' && projectFilter !== 'company' && it.projectId !== projectFilter) return false
      if (folderFilter === 'none' && it.folderId) return false
      if (folderFilter !== 'all' && folderFilter !== 'none' && it.folderId !== folderFilter) return false
      if (q && !it.name.toLowerCase().includes(q) && !(it.username ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [items, search, projectFilter, folderFilter])

  const deleteFolder = async (folder: FolderOpt) => {
    if (!(await confirmDialog({ title: `ลบ Folder "${folder.name}"?`, message: 'รายการข้างในไม่หาย แค่เอาออกจาก Folder นี้', confirmLabel: 'ลบ Folder', danger: true }))) return
    await api.delete(`/api/vault/folders/${folder.id}`)
    setFolderFilter('all')
    void reloadFolders()
    void reload()
  }

  const lock = async () => {
    await api.post('/api/vault/lock', {}, { 'x-vault-token': token })
    onLocked()
  }

  return (
    <>
      <PageHeader
        title="Secret Vault"
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => void lock()} className="text-sm text-dim hover:bg-hover px-3 py-1.5 rounded-lg flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> ล็อค</button>
            <button onClick={() => setModal('new')} className="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> เพิ่มรายการ
            </button>
          </div>
        }
      />
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-1 mb-4 border-b border-border-subtle">
          <button onClick={() => setTab('items')} className={`text-sm font-medium px-3 py-2 border-b-2 -mb-px ${tab === 'items' ? 'border-brand-600 text-brand-700' : 'border-transparent text-dim'}`}>รายการ</button>
          <button onClick={() => setTab('audit')} className={`text-sm font-medium px-3 py-2 border-b-2 -mb-px ${tab === 'audit' ? 'border-brand-600 text-brand-700' : 'border-transparent text-dim'}`}>ประวัติการเข้าใช้งาน</button>
        </div>

        {tab === 'audit' ? (
          <VaultAuditLog />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อรายการ/username..." className="w-full text-sm bg-white shadow-xs rounded-lg pl-8 pr-3 py-2 focus:outline-hidden" />
              </div>
              <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="text-sm bg-white shadow-xs rounded-lg px-3 py-2 focus:outline-hidden">
                <option value="all">ทุกโปรเจกต์</option>
                <option value="company">บริษัท (ไม่ผูกโปรเจกต์)</option>
                {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)} className="text-sm bg-white shadow-xs rounded-lg px-3 py-2 focus:outline-hidden">
                <option value="all">ทุก Folder</option>
                <option value="none">ไม่มี Folder</option>
                {(folders ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              {folderFilter !== 'all' && folderFilter !== 'none' && (
                <button
                  onClick={() => void deleteFolder((folders ?? []).find((f) => f.id === folderFilter)!)}
                  className="text-xs text-danger-600 hover:underline shrink-0"
                >
                  ลบ Folder นี้
                </button>
              )}
              <span className="text-xs text-muted">{filtered.length} รายการ</span>
            </div>

            {!data ? (
              <div className="text-center text-sm text-muted py-10">กำลังโหลด…</div>
            ) : filtered.length === 0 ? (
              <div className="bg-white rounded-lg shadow-xs text-center text-sm text-muted py-14">
                <Lock className="w-8 h-8 mx-auto mb-2 text-border" />
                {items.length === 0 ? 'ยังไม่มีรายการใน Vault — กด "เพิ่มรายการ" เพื่อเริ่มเก็บ' : 'ไม่มีรายการตรงตัวกรองที่เลือก'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((it) => (
                  <div key={it.id} onClick={() => setDetail(it)} className="bg-white rounded-lg shadow-xs p-5 cursor-pointer hover:shadow-sm transition">
                    <div className="font-medium text-ink text-sm truncate">{it.name}</div>
                    {it.username && <div className="text-xs text-muted truncate mt-0.5">{it.username}</div>}
                    <div className="mt-3 flex flex-wrap gap-1">
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-hover text-dim">{it.projectName ?? 'บริษัท'}</span>
                      {it.folderName && <span className="text-[11px] px-1.5 py-0.5 rounded bg-info-50 text-info-700">{it.folderName}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {modal && (
        <ItemModal
          item={modal === 'new' ? null : modal}
          projects={projects ?? []}
          folders={folders ?? []}
          token={token}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); void reload() }}
          onLocked={() => { setModal(null); onLocked() }}
          onFolderCreated={() => void reloadFolders()}
        />
      )}
      {detail && (
        <DetailModal
          item={detail}
          token={token}
          onClose={() => setDetail(null)}
          onEdit={() => { setModal(detail); setDetail(null) }}
          onDeleted={() => { setDetail(null); void reload() }}
          onLocked={() => { setDetail(null); onLocked() }}
        />
      )}
    </>
  )
}

// Pronista §Secret Vault Permission (2026-09-08) — token เก็บเป็น React state ล้วนๆ (ไม่มี cookie แล้ว) ทุกครั้งที่ mount หน้านี้ใหม่ต้องใส่ PIN ใหม่เสมอ
export function VaultPage() {
  const { data: status, reload } = useLoad<VaultStatus>(() => api.get('/api/vault/status'))
  const [token, setToken] = useState<string | null>(null)

  if (!status) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>
  if (!status.hasPin) return <VaultSetup onDone={() => void reload()} />
  if (!token) return <VaultUnlockForm onDone={(t) => setToken(t)} />
  return <VaultMain token={token} onLocked={() => setToken(null)} />
}
