/**
 * Pronista §Secret Vault (2026-09-03) — คลังเก็บรหัสผ่าน/ข้อมูลลับ owner-only
 * ต่อโปรเจกต์ (มี badge ชื่อโปรเจกต์) หรือส่วนกลางบริษัท (badge "บริษัท") — ต้องปลดล็อคด้วย Master PIN ก่อนเห็น/สร้าง/แก้ไข plaintext
 * PIN นี้แยกจาก login (Google OAuth ล้วน ไม่มี password) — ปลดล็อคแล้วอยู่ได้ 15 นาที (server กำหนด)
 */
import { isSensitiveFieldLabel, VAULT_ITEM_TYPES, VAULT_STRUCTURED_FIELDS, VAULT_TYPE_LABEL, VAULT_TYPE_SUGGESTED_FIELDS, type VaultItemType } from '@seedoffice/core'
import {
  Check,
  ClipboardList,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  FolderPlus,
  Globe,
  IdCard,
  KeyRound,
  Landmark,
  Lock,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Server,
  ShoppingCart,
  Smartphone,
  Sparkles,
  StickyNote,
  Trash2,
  Truck,
  Users,
  Warehouse,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useDialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/useLoad'

// Pronista §Secret Vault Type (2026-09-08) — แม็ป VaultItemType → ไอคอนจริง (VAULT_TYPE_ICON ใน core เป็นแค่ชื่อ string ไว้อ้างอิง)
const TYPE_ICON: Record<VaultItemType, typeof Lock> = {
  website: Globe,
  api_credential: KeyRound,
  server: Server,
  payment_gateway: Landmark,
  shipping_aggregator: Truck,
  social_login: Users,
  mobile_login: Smartphone,
  order_management: ClipboardList,
  product_management: Package,
  e_fulfillment: Warehouse,
  ecommerce_platform: ShoppingCart,
  generative_ai: Sparkles,
  payment_card: CreditCard,
  identity: IdCard,
  note: StickyNote,
  other: Lock,
}

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
interface VaultExtraField {
  label: string
  value: string
}
interface VaultItemRow {
  id: string
  name: string
  type: VaultItemType
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
  extraFields: VaultExtraField[]
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

function ItemModal({ item, revealed, projects, folders, token, onClose, onDone, onLocked, onFolderCreated }: {
  item: VaultItemRow | null
  // §Secret Vault Partner Types (2026-09-08) — ค่าที่ reveal มาแล้วจาก DetailModal (มีเฉพาะตอนแก้ไข) ใช้ prefill ฟอร์มแบบ WYSIWYG
  revealed: VaultItemRevealed | null
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
  const [type, setType] = useState<VaultItemType>(item?.type ?? 'website')
  const [projectId, setProjectId] = useState(item?.projectId ?? '')
  const [folderId, setFolderId] = useState(item?.folderId ?? '')
  const [username, setUsername] = useState(item?.username ?? '')
  const [password, setPassword] = useState(revealed?.password ?? '')
  const [url, setUrl] = useState(item?.url ?? '')
  const [notes, setNotes] = useState(revealed?.notes ?? '')
  // §Secret Vault Type (2026-09-08) — ใช้เฉพาะ type ทั่วไป (ไม่มี fixed schema ใน VAULT_STRUCTURED_FIELDS) เพิ่ม/ลบเองได้อิสระ, แก้ไขแล้ว prefill ด้วยค่าจริง (WYSIWYG)
  const [extraFields, setExtraFields] = useState<VaultExtraField[]>(() => (revealed && !VAULT_STRUCTURED_FIELDS[type] ? revealed.extraFields : []))
  // §Secret Vault Partner Types (2026-09-08) — สำหรับ type พาทเนอร์ (fixed field ตาม VAULT_STRUCTURED_FIELDS) เก็บเป็น map ตาม key แทน array เพิ่ม/ลบเอง
  const [structuredValues, setStructuredValues] = useState<Record<string, string>>(() => {
    const defs = VAULT_STRUCTURED_FIELDS[type]
    if (!defs || !revealed) return {}
    const values: Record<string, string> = {}
    for (const d of defs) {
      const wantLabel = d.prefixWithName ? `${item?.name ?? ''} ${d.label}` : d.label
      values[d.key] = revealed.extraFields.find((f) => f.label === wantLabel)?.value ?? ''
    }
    return values
  })
  const [enabled, setEnabled] = useState(() => {
    if (!VAULT_STRUCTURED_FIELDS[type] || !revealed) return true
    const found = revealed.extraFields.find((f) => f.label === `เปิดใช้งาน ${item?.name ?? ''}`)
    return found ? found.value === 'เปิด' : true
  })
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const structuredDefs = VAULT_STRUCTURED_FIELDS[type]

  // เปลี่ยนประเภท = เริ่มชุดฟิลด์ใหม่ทั้งหมดตาม type ใหม่ (ฟิลด์ของ type เดิมไม่เกี่ยวข้องกันแล้ว)
  const changeType = (next: VaultItemType) => {
    setType(next)
    const nextDefs = VAULT_STRUCTURED_FIELDS[next]
    if (nextDefs) {
      setStructuredValues(Object.fromEntries(nextDefs.map((d) => [d.key, ''])))
      setEnabled(true)
      setExtraFields([])
    } else {
      setStructuredValues({})
      setExtraFields(VAULT_TYPE_SUGGESTED_FIELDS[next].map((label) => ({ label, value: '' })))
    }
  }
  const updateField = (i: number, patch: Partial<VaultExtraField>) => setExtraFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  const removeField = (i: number) => setExtraFields((fs) => fs.filter((_, idx) => idx !== i))
  const addField = () => setExtraFields((fs) => [...fs, { label: '', value: '' }])

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
      const displayName = name.trim() || 'รายการนี้'
      const cleanFields = structuredDefs
        ? [
            { label: `เปิดใช้งาน ${displayName}`, value: enabled ? 'เปิด' : 'ปิด' },
            ...structuredDefs.map((d) => ({ label: d.prefixWithName ? `${displayName} ${d.label}` : d.label, value: structuredValues[d.key] ?? '' })),
          ].filter((f) => f.value.trim())
        : extraFields.filter((f) => f.label.trim())
      const payload = {
        name: name.trim(),
        type,
        projectId: projectId || null,
        folderId: folderId || null,
        username: username.trim() || null,
        url: url.trim() || null,
        // §Secret Vault (2026-09-08) — ฟอร์มแก้ไขตอนนี้ prefill ด้วยค่าจริงที่ reveal มาแล้ว (WYSIWYG) เว้นว่าง = ล้างค่านั้นจริงๆ
        // ต่างจากตอนสร้างใหม่ที่เว้นว่าง = ยังไม่ใส่ (ไม่ส่ง key เลยก็ผลเหมือนกัน)
        ...(item ? { password: password || null } : password ? { password } : {}),
        ...(item ? { notes: notes || null } : notes ? { notes } : {}),
        ...(item ? { extraFields: cleanFields } : cleanFields.length > 0 ? { extraFields: cleanFields } : {}),
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
            <label className="text-[11px] text-muted block mb-0.5">ประเภท</label>
            <select value={type} onChange={(e) => changeType(e.target.value as VaultItemType)} className={input}>
              {VAULT_ITEM_TYPES.map((t) => <option key={t} value={t}>{VAULT_TYPE_LABEL[t]}</option>)}
            </select>
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

          {structuredDefs ? (
            // §Secret Vault Partner Types (2026-09-08) — fixed field ตายตัวตามหน้า "จัดการพาทเนอร์ > แก้ไข" ของ allnista แทนที่ username/password/url/notes/ฟิลด์เสริมทั่วไป
            <>
              <div className="flex items-center justify-between bg-hover rounded-lg px-3 py-2.5">
                <span className="text-sm text-body">เปิดใช้งาน {name.trim() || 'รายการนี้'}</span>
                <button
                  type="button"
                  onClick={() => setEnabled((v) => !v)}
                  className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${enabled ? 'bg-danger-600' : 'bg-border'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              {structuredDefs.map((d) => (
                <div key={d.key}>
                  <label className="text-[11px] text-muted block mb-0.5">{d.prefixWithName ? `${name.trim() || 'รายการนี้'} ${d.label}` : d.label}</label>
                  <input
                    value={structuredValues[d.key] ?? ''}
                    onChange={(e) => setStructuredValues((v) => ({ ...v, [d.key]: e.target.value }))}
                    type={isSensitiveFieldLabel(d.label) ? 'password' : 'text'}
                    className={input}
                  />
                </div>
              ))}
            </>
          ) : (
            <>
              <div>
                <label className="text-[11px] text-muted block mb-0.5">Username</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} className={input} />
              </div>
              <div>
                <label className="text-[11px] text-muted block mb-0.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
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
                <label className="text-[11px] text-muted block mb-0.5">Notes</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={input} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[11px] text-muted">ฟิลด์เสริม</label>
                  <button type="button" onClick={addField} className="text-[11px] font-medium text-brand-600 hover:underline">+ เพิ่มฟิลด์</button>
                </div>
                {extraFields.length > 0 && (
                  <div className="space-y-1.5">
                    {extraFields.map((f, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} placeholder="ชื่อฟิลด์" className={`${input} w-2/5`} />
                        <input
                          value={f.value}
                          onChange={(e) => updateField(i, { value: e.target.value })}
                          type={isSensitiveFieldLabel(f.label) ? 'password' : 'text'}
                          placeholder="ค่า"
                          className={`${input} flex-1`}
                        />
                        <button type="button" onClick={() => removeField(i)} className="shrink-0 p-1.5 rounded hover:bg-hover text-dim"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

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
  onEdit: (revealed: VaultItemRevealed) => void
  onDeleted: () => void
  onLocked: () => void
}) {
  const { confirmDialog, alertDialog } = useDialog()
  const [shownFields, setShownFields] = useState<Set<string>>(new Set())
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const toggleShown = (field: string) =>
    setShownFields((s) => {
      const next = new Set(s)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
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
      await api.delete(`/api/vault/items/${item.id}`, { 'x-vault-token': token })
      onDeleted()
    } catch (e) {
      if (isVaultLocked(e)) return onLocked()
      await alertDialog({ title: e instanceof ApiError ? e.message : 'ลบไม่สำเร็จ' })
    }
  }

  const row = (label: string, value: string | null, field: string, mask?: boolean) => {
    const shown = shownFields.has(field)
    return (
      value && (
        <div>
          <label className="text-[11px] text-muted block mb-0.5">{label}</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 text-sm bg-hover rounded-lg px-3 py-2 font-mono truncate">{mask && !shown ? '••••••••' : value}</div>
            {mask && (
              <button onClick={() => toggleShown(field)} className="text-muted hover:text-body shrink-0" title={shown ? 'ซ่อน' : 'แสดง'}>
                {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            )}
            <button onClick={() => void copy(field, value)} className="text-muted hover:text-body shrink-0" title="คัดลอก">
              {copiedField === field ? <Check className="w-4 h-4 text-success-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )
    )
  }

  const TypeIcon = TYPE_ICON[item.type]
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
          <div className="flex items-center gap-2">
            <TypeIcon className="w-4 h-4 text-muted shrink-0" />
            <div>
              <div className="font-semibold text-ink text-sm">{item.name}</div>
              <div className="text-[11px] text-muted">{item.projectName ?? 'บริษัท'}{item.folderName ? ` · ${item.folderName}` : ''}</div>
            </div>
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
              {data.extraFields.map((f, i) => row(f.label, f.value, `extra-${i}`, isSensitiveFieldLabel(f.label)))}
            </>
          )}
        </div>
        <div className="flex justify-between gap-2 px-4 py-3 border-t border-border-subtle shrink-0">
          <button onClick={() => void remove()} className="text-sm text-danger-600 hover:bg-danger-50 px-3 py-2 rounded-lg flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" /> ลบ</button>
          <button onClick={() => data && onEdit(data)} disabled={!data} className="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-40 px-4 py-2 rounded-lg flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" /> แก้ไข</button>
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

interface PinUserOpt {
  id: string
  name: string
  email: string
}

// Pronista §Secret Vault Permission (2026-09-08) — owner-only: reset PIN ให้คนอื่นที่ลืม PIN โดยไม่ต้องรู้ PIN เดิม (ดูรายชื่อจาก endpoint แยกที่ไม่มี vaultPinHash หลุดมา)
function ResetPinModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { confirmDialog } = useDialog()
  const { data: users } = useLoad<PinUserOpt[]>(() => api.get('/api/vault/users'))
  const [userId, setUserId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    const target = (users ?? []).find((u) => u.id === userId)
    if (!target) return setError('เลือกคนที่จะรีเซ็ต PIN ก่อน')
    if (!(await confirmDialog({ title: `รีเซ็ต PIN ของ "${target.name}"?`, message: 'PIN เดิมของเขาจะใช้ไม่ได้ทันที ต้องตั้ง PIN ใหม่เองตอนเข้าเมนูครั้งถัดไป', confirmLabel: 'รีเซ็ต PIN' }))) return
    setBusy(true)
    setError('')
    try {
      await api.post('/api/vault/pin/reset', { userId: target.id })
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'รีเซ็ตไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
          <span className="font-semibold text-ink text-sm">รีเซ็ต PIN ให้คนอื่น</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-hover text-dim"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted">ใช้เมื่อมีคนลืม PIN ของตัวเอง — เลือกคนที่จะรีเซ็ต แล้วเขาจะตั้ง PIN ใหม่เองได้ตอนเข้าเมนู Secret Vault ครั้งถัดไป</p>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden">
            <option value="">— เลือกคน —</option>
            {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
          </select>
          {error && <div className="text-xs text-danger-600">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle shrink-0">
          <button onClick={onClose} className="text-sm px-3.5 py-2 rounded-lg text-soft hover:bg-hover">ยกเลิก</button>
          <button onClick={() => void submit()} disabled={!userId || busy} className="text-sm font-medium text-white px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40">
            รีเซ็ต PIN
          </button>
        </div>
      </div>
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
  const [modal, setModal] = useState<{ item: VaultItemRow; revealed: VaultItemRevealed } | 'new' | null>(null)
  const [detail, setDetail] = useState<VaultItemRow | null>(null)
  const [tab, setTab] = useState<'items' | 'audit'>('items')
  const [resetPinOpen, setResetPinOpen] = useState(false)
  const { confirmDialog, promptDialog } = useDialog()
  const { user } = useAuth()
  const toast = useToast()

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

  // §Secret Vault Folder (2026-09-08) — เดิมสร้าง Folder ได้แค่ตอนอยู่ในฟอร์ม "เพิ่มรายการ" เท่านั้น (หาไม่เจอถ้าไม่ได้กำลังสร้างรายการ) เพิ่มทางลัดตรงนี้ให้กดสร้างได้เลยจากหน้ารายการ
  const createFolderStandalone = async () => {
    const name = await promptDialog({ title: 'สร้าง Folder ใหม่', placeholder: 'เช่น เว็บ Seller ร้าน X', confirmLabel: 'สร้าง' })
    if (!name?.trim()) return
    const created = await api.post<FolderOpt>('/api/vault/folders', { name: name.trim() })
    void reloadFolders()
    setFolderFilter(created.id)
  }

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
            {user?.role === 'owner' && (
              <button onClick={() => setResetPinOpen(true)} className="text-sm text-dim hover:bg-hover px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" /> รีเซ็ต PIN ให้คนอื่น
              </button>
            )}
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
              <button
                type="button"
                onClick={() => void createFolderStandalone()}
                title="สร้าง Folder ใหม่"
                className="text-sm text-dim hover:bg-hover shrink-0 rounded-lg p-2 flex items-center gap-1.5"
              >
                <FolderPlus className="w-4 h-4" />
              </button>
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
                {filtered.map((it) => {
                  const TypeIcon = TYPE_ICON[it.type]
                  return (
                  <div key={it.id} onClick={() => setDetail(it)} className="bg-white rounded-lg shadow-xs p-5 cursor-pointer hover:shadow-sm transition">
                    <div className="flex items-center gap-1.5">
                      <TypeIcon className="w-3.5 h-3.5 text-muted shrink-0" />
                      <div className="font-medium text-ink text-sm truncate">{it.name}</div>
                    </div>
                    {it.username && <div className="text-xs text-muted truncate mt-0.5">{it.username}</div>}
                    <div className="mt-3 flex flex-wrap gap-1">
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-hover text-dim">{it.projectName ?? 'บริษัท'}</span>
                      {it.folderName && <span className="text-[11px] px-1.5 py-0.5 rounded bg-info-50 text-info-700">{it.folderName}</span>}
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {modal && (
        <ItemModal
          item={modal === 'new' ? null : modal.item}
          revealed={modal === 'new' ? null : modal.revealed}
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
          onEdit={(revealed) => { setModal({ item: detail, revealed }); setDetail(null) }}
          onDeleted={() => { setDetail(null); void reload() }}
          onLocked={() => { setDetail(null); onLocked() }}
        />
      )}
      {resetPinOpen && (
        <ResetPinModal
          onClose={() => setResetPinOpen(false)}
          onDone={() => { setResetPinOpen(false); toast('รีเซ็ต PIN แล้ว') }}
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
