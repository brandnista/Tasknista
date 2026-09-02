/**
 * Pronista §Domain Detail Page (2026-08-28) — หน้ารายละเอียดโดเมนแบบแยกแท็บ ตาม reference ที่เจ้าของส่งมา
 * ทุกแท็บเป็น "บันทึกข้อมูลไว้ในระบบเราเอง" เท่านั้น — ไม่ได้ยิงไปเปลี่ยนค่าจริงที่ registrar (ตกลงกับเจ้าของแล้ว)
 * Pronista §Menu Restructure (2026-09-02) — ตัดแท็บเหลือ 2 แถบแรก (ข้อมูลโดเมน/Nameservers) ตามสเปก — แท็บอื่นที่เคยมี (Forwarding/DNS/Privacy/Google Workspace/DS) ตัดออกทั้งหมด
 */
import { AlertTriangle, ChevronLeft, Pencil, Server, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useDialog } from '../components/Dialog'
import { PageHeader } from '../components/PageHeader'
import { api, ApiError } from '../lib/api'
import { URGENCY_BORDER_CLASS, dueUrgency } from '../lib/due-urgency'
import { useLoad } from '../lib/useLoad'
import { DomainModal, fmtDate, RenewDomainModal, type DomainRow } from './AdminDomains'

const TABS = [
  ['info', 'ข้อมูลโดเมน'],
  ['ns', 'Nameservers'],
] as const
type TabKey = (typeof TABS)[number][0]

const card = 'bg-white rounded-lg shadow-xs p-5'
const label = 'text-[11px] text-muted block mb-0.5'
const input = 'w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden'
const saveBtn = 'text-sm font-medium text-white px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40'

function InfoTab({ domain, onEdit, onChanged }: { domain: DomainRow; onEdit: () => void; onChanged: () => void }) {
  const urgency = dueUrgency(domain.expiryDate, false, 30)
  const isExpired = urgency === 'overdue'
  const [saving, setSaving] = useState(false)

  const toggleNotify = async () => {
    setSaving(true)
    try {
      await api.patch(`/api/admin/domains/${domain.id}`, { notifyEnabled: !domain.notifyEnabled })
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  const row = (l: string, v: React.ReactNode) => (
    <div className="flex items-center justify-between py-2.5 border-b border-divider last:border-0">
      <span className="text-sm text-muted">{l}</span>
      <span className="text-sm font-medium text-body text-right">{v}</span>
    </div>
  )

  return (
    <div className={card}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-ink text-sm">ข้อมูลโดเมน : {domain.name}</span>
        <button onClick={onEdit} className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium">
          <Pencil className="w-3.5 h-3.5" /> แก้ไข
        </button>
      </div>
      {row('Status', (
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${isExpired ? 'bg-danger-50 text-danger-700' : 'bg-success-50 text-success-700'}`}>
          {isExpired && <AlertTriangle className="w-3 h-3" />} {isExpired ? 'หมดอายุแล้ว' : 'Active'}
        </span>
      ))}
      {row('วันที่จดทะเบียน', domain.registeredDate ? fmtDate(domain.registeredDate) : '—')}
      {row('วันหมดอายุ', <span className={isExpired ? 'text-danger-600' : ''}>{fmtDate(domain.expiryDate)}</span>)}
      {row('แจ้งเตือนหมดอายุ', (
        <button
          type="button"
          role="switch"
          aria-checked={domain.notifyEnabled}
          onClick={() => void toggleNotify()}
          disabled={saving}
          className={`relative w-[38px] h-[22px] rounded-full shrink-0 transition-colors disabled:opacity-60 ${domain.notifyEnabled ? 'bg-brand-600' : 'bg-border'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow-xs transition-transform ${domain.notifyEnabled ? 'translate-x-4' : ''}`} />
        </button>
      ))}
      {row('Registrar', domain.provider ?? '—')}
      {row('ผู้รับผิดชอบ', domain.responsibleName ?? '—')}
      {row('โปรเจกต์ที่เกี่ยวข้อง', domain.projectName ?? '—')}
      <div className={URGENCY_BORDER_CLASS[urgency] === URGENCY_BORDER_CLASS.overdue ? 'text-[11px] text-danger-600 pt-2' : 'hidden'}>
        โดเมนนี้หมดอายุแล้ว — ต่ออายุกับ registrar แล้วกด "สั่งต่ออายุ" มุมขวาบนเพื่ออัปเดตวันที่
      </div>
    </div>
  )
}

function NameserversTab({ domain, onChanged }: { domain: DomainRow; onChanged: () => void }) {
  const { alertDialog } = useDialog()
  const [values, setValues] = useState<string[]>(() => {
    const ns = domain.nameservers ?? []
    return Array.from({ length: 6 }, (_, i) => ns[i] ?? '')
  })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const cleaned = values.map((v) => v.trim()).filter(Boolean)
      await api.patch(`/api/admin/domains/${domain.id}`, { nameservers: cleaned.length > 0 ? cleaned : null })
      onChanged()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={card}>
      <div className="flex items-center gap-2 mb-4">
        <Server className="w-4 h-4 text-muted" />
        <span className="font-semibold text-ink text-sm">Nameserver</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {values.map((v, i) => (
          <div key={i}>
            <label className={label}>NS{i + 1}{i >= 2 ? ' (ไม่บังคับ)' : ''}</label>
            <input value={v} onChange={(e) => setValues((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))} placeholder={i < 2 ? 'เช่น jim.ns.cloudflare.com' : ''} className={input} />
          </div>
        ))}
      </div>
      <div className="flex justify-end mt-4">
        <button onClick={() => void save()} disabled={busy} className={saveBtn}>บันทึก</button>
      </div>
    </div>
  )
}

export function DomainDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { confirmDialog } = useDialog()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: domain, reload } = useLoad<DomainRow>(() => api.get(`/api/admin/domains/${id}`), [id])
  const [editOpen, setEditOpen] = useState(false)
  const [renewOpen, setRenewOpen] = useState(false)

  const tabParam = searchParams.get('tab')
  const tab: TabKey = TABS.some(([k]) => k === tabParam) ? (tabParam as TabKey) : 'info'
  const setTab = (t: TabKey) => setSearchParams(t === 'info' ? {} : { tab: t }, { replace: true })

  const remove = async () => {
    if (!domain) return
    if (!(await confirmDialog({ title: `ลบโดเมน "${domain.name}"?`, message: 'จะไม่แจ้งเตือนวันหมดอายุของโดเมนนี้อีก', confirmLabel: 'ลบ', danger: true }))) return
    await api.delete(`/api/admin/domains/${domain.id}`)
    navigate('/admin/domains')
  }

  if (!domain) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>

  return (
    <>
      <PageHeader
        title={domain.name}
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => setRenewOpen(true)} className="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg">สั่งต่ออายุ</button>
            <button onClick={() => void remove()} title="ลบโดเมน" className="p-1.5 rounded-lg hover:bg-danger-50 text-dim hover:text-danger-600"><Trash2 className="w-4 h-4" /></button>
          </div>
        }
      />
      <div className="p-4 sm:p-6">
        <Link to="/admin/domains" className="text-sm text-muted hover:text-soft flex items-center gap-1 mb-4">
          <ChevronLeft className="w-4 h-4" /> โดเมนทั้งหมด
        </Link>

        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap border-b border-divider mb-4 overflow-x-auto">
          {TABS.map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`text-sm font-medium pb-2.5 border-b-2 whitespace-nowrap ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-dim hover:text-body'}`}
            >
              {l}
            </button>
          ))}
        </div>

        {tab === 'info' && <InfoTab domain={domain} onEdit={() => setEditOpen(true)} onChanged={reload} />}
        {tab === 'ns' && <NameserversTab domain={domain} onChanged={reload} />}
      </div>

      {editOpen && <DomainModal domain={domain} onClose={() => setEditOpen(false)} onDone={() => { setEditOpen(false); void reload() }} />}
      {renewOpen && <RenewDomainModal domain={domain} onClose={() => setRenewOpen(false)} onDone={() => { setRenewOpen(false); void reload() }} />}
    </>
  )
}
