/**
 * Pronista §Domain Management (2026-08-27) — "จัดการโดเมน" เมนูย่อยของ ตั้งค่า (owner-only เหมือน "ตำแหน่งและสิทธิ์"/"กำหนดต้นทุน" — ข้อมูลโครงสร้างพื้นฐานบริษัท ไม่ใช่ทำเนียบบุคคลที่แบ่งเพดานตามหมวดได้)
 * ทะเบียนโดเมน + วันหมดอายุ — แจ้งเตือนอัตโนมัติ 30/15/7/1 วันก่อนหมดอายุ ทำใน apps/api/src/scheduled.ts:notifyDomainExpiry
 * Pronista §Domain Detail Page (2026-08-28) — จัดหน้าใหม่ตามแบบ reference (list ค้นหา/pagination/toggle + หน้า detail แยกแท็บ Nameservers ฯลฯ)
 * แถวนี้เหลือแค่ ข้อมูลย่อ + toggle แจ้งเตือน + ไปหน้ารายละเอียด/ต่ออายุ — แก้ไข/ลบย้ายไปอยู่ในหน้ารายละเอียดแทน
 */
import { AlertTriangle, Globe, Plus, RefreshCw, Search, Settings, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../components/PageHeader'
import { DateInputTH } from '../components/DateInputTH'
import { useDialog } from '../components/Dialog'
import { api, ApiError } from '../lib/api'
import { URGENCY_BORDER_CLASS, dueUrgency } from '../lib/due-urgency'
import { useLoad } from '../lib/useLoad'

export interface DomainRow {
  id: string
  name: string
  registeredDate: string | null
  expiryDate: string
  provider: string | null
  responsibleUserId: string | null
  responsibleName: string | null
  projectId: string | null
  projectName: string | null
  notifyEnabled: boolean
  nameservers: string[] | null
  forwardingUrl: string | null
  forwardingType: string | null
  dnsRecords: { id: string; type: string; host: string; value: string; ttl: number }[] | null
  privacyProtectionEnabled: boolean
  googleWorkspaceVerified: boolean
  googleWorkspaceNotes: string | null
  dsRecords: { id: string; keyTag: string; algorithm: string; digestType: string; digest: string }[] | null
}
interface UserOpt { id: string; name: string }
interface ProjectOpt { id: string; name: string }

export const fmtDate = (iso: string) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
const PAGE_SIZE = 10

export function DomainModal({ domain, onClose, onDone }: { domain: DomainRow | null; onClose: () => void; onDone: () => void }) {
  const { alertDialog } = useDialog()
  const { data: users } = useLoad<UserOpt[]>(() => api.get('/api/users'))
  const { data: projects } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const [name, setName] = useState(domain?.name ?? '')
  const [registeredDate, setRegisteredDate] = useState(domain?.registeredDate ?? '')
  const [expiryDate, setExpiryDate] = useState(domain?.expiryDate ?? '')
  const [provider, setProvider] = useState(domain?.provider ?? '')
  const [responsibleUserId, setResponsibleUserId] = useState(domain?.responsibleUserId ?? '')
  const [projectId, setProjectId] = useState(domain?.projectId ?? '')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim() || !expiryDate) return
    setBusy(true)
    try {
      const payload = {
        name: name.trim(),
        registeredDate: registeredDate || null,
        expiryDate,
        provider: provider.trim() || null,
        responsibleUserId: responsibleUserId || null,
        projectId: projectId || null,
      }
      if (domain) await api.patch(`/api/admin/domains/${domain.id}`, payload)
      else await api.post('/api/admin/domains', payload)
      onDone()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ' })
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden'
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
          <span className="font-semibold text-ink text-sm">{domain ? 'แก้ไขโดเมน' : 'เพิ่มโดเมน'}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-hover text-dim"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label className="text-[11px] text-muted block mb-0.5">ชื่อโดเมน</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น pronista.com" className={input} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted block mb-0.5">วันที่จดทะเบียน (ไม่บังคับ)</label>
              <DateInputTH value={registeredDate} onChange={setRegisteredDate} className={input} />
            </div>
            <div>
              <label className="text-[11px] text-muted block mb-0.5">วันหมดอายุ</label>
              <DateInputTH value={expiryDate} onChange={setExpiryDate} className={input} />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-0.5">Registrar</label>
            <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="เช่น ResellerClub, THNIC" className={input} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted block mb-0.5">ผู้รับผิดชอบ</label>
              <select value={responsibleUserId} onChange={(e) => setResponsibleUserId(e.target.value)} className={input}>
                <option value="">— ไม่ระบุ —</option>
                {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted block mb-0.5">โปรเจกต์ที่เกี่ยวข้อง</label>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={input}>
                <option value="">— ไม่ระบุ —</option>
                {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle shrink-0">
          <button onClick={onClose} className="text-sm px-3.5 py-2 rounded-lg text-soft hover:bg-hover">ยกเลิก</button>
          <button onClick={() => void submit()} disabled={!name.trim() || !expiryDate || busy} className="text-sm font-medium text-white px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40">
            {domain ? 'บันทึก' : 'เพิ่มโดเมน'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** สั่งต่ออายุ — ไม่ได้ยิงไปซื้อ/ต่อจริงที่ registrar (ตกลงกับเจ้าของว่าโครงหน้านี้บันทึกข้อมูลเราเองเท่านั้น) แค่ปรับวันหมดอายุใหม่หลังต่อจริงแล้ว */
export function RenewDomainModal({ domain, onClose, onDone }: { domain: DomainRow; onClose: () => void; onDone: () => void }) {
  const { alertDialog } = useDialog()
  const [expiryDate, setExpiryDate] = useState(domain.expiryDate)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!expiryDate) return
    setBusy(true)
    try {
      await api.patch(`/api/admin/domains/${domain.id}`, { expiryDate })
      onDone()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <span className="font-semibold text-ink text-sm">ต่ออายุ {domain.name}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-hover text-dim"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-2">
          <p className="text-xs text-muted">ต่ออายุกับ registrar เรียบร้อยแล้ว → อัปเดตวันหมดอายุใหม่ที่นี่ (ระบบจะเริ่มนับรอบแจ้งเตือนใหม่ให้อัตโนมัติ)</p>
          <label className="text-[11px] text-muted block mb-0.5">วันหมดอายุใหม่</label>
          <DateInputTH autoFocus value={expiryDate} onChange={setExpiryDate} className="w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden" />
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle">
          <button onClick={onClose} className="text-sm px-3.5 py-2 rounded-lg text-soft hover:bg-hover">ยกเลิก</button>
          <button onClick={() => void submit()} disabled={!expiryDate || busy} className="text-sm font-medium text-white px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40">บันทึก</button>
        </div>
      </div>
    </div>
  )
}

function NotifyToggle({ domain, onChanged }: { domain: DomainRow; onChanged: () => void }) {
  const [saving, setSaving] = useState(false)
  const toggle = async () => {
    setSaving(true)
    try {
      await api.patch(`/api/admin/domains/${domain.id}`, { notifyEnabled: !domain.notifyEnabled })
      onChanged()
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={domain.notifyEnabled}
        onClick={() => void toggle()}
        disabled={saving}
        className={`relative w-[38px] h-[22px] rounded-full shrink-0 transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:outline-offset-2 ${domain.notifyEnabled ? 'bg-brand-600' : 'bg-border'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow-xs transition-transform ${domain.notifyEnabled ? 'translate-x-4' : ''}`} />
      </button>
      <span className={`text-xs font-medium ${domain.notifyEnabled ? 'text-brand-700' : 'text-dim'}`}>{domain.notifyEnabled ? 'On' : 'Off'}</span>
    </div>
  )
}

export function AdminDomainsPage() {
  const { data, reload } = useLoad<DomainRow[]>(() => api.get('/api/admin/domains'))
  const [modalDomain, setModalDomain] = useState<DomainRow | null | 'new'>(null)
  const [renewDomain, setRenewDomain] = useState<DomainRow | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const domainsList = data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? domainsList.filter((d) => d.name.toLowerCase().includes(q)) : domainsList
  }, [domainsList, search])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages)
  const pageItems = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)

  return (
    <>
      <PageHeader
        title="จัดการโดเมน"
        action={
          <button onClick={() => setModalDomain('new')} className="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> เพิ่มโดเมน
          </button>
        }
      />
      <div className="p-3 sm:p-6">
        {!data ? (
          <div className="text-center text-sm text-muted py-10">กำลังโหลด…</div>
        ) : domainsList.length === 0 ? (
          <div className="bg-white rounded-lg shadow-xs text-center text-sm text-muted py-14">
            <Globe className="w-8 h-8 mx-auto mb-2 text-border" />
            ยังไม่มีโดเมนในระบบ — กด "เพิ่มโดเมน" เพื่อเริ่มติดตามวันหมดอายุ
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-xs overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-divider">
              <div className="relative w-full max-w-xs">
                <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  placeholder="Search..."
                  className="w-full text-sm bg-hover rounded-lg pl-8 pr-3 py-1.5 focus:outline-hidden"
                />
              </div>
              <span className="text-xs text-muted shrink-0">{filtered.length} โดเมน</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-muted border-b border-divider">
                    <th className="px-4 py-2.5 font-medium">Domain Name</th>
                    <th className="px-4 py-2.5 font-medium">Registrar</th>
                    <th className="px-4 py-2.5 font-medium">วันหมดอายุ</th>
                    <th className="px-4 py-2.5 font-medium">แจ้งเตือนหมดอายุ</th>
                    <th className="px-4 py-2.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {pageItems.map((d) => {
                    const urgency = dueUrgency(d.expiryDate, false, 30)
                    return (
                      <tr key={d.id} className={URGENCY_BORDER_CLASS[urgency]}>
                        <td className="px-4 py-2.5 font-medium text-body">{d.name}</td>
                        <td className="px-4 py-2.5 text-muted">{d.provider ?? '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1 ${urgency === 'overdue' ? 'text-danger-600 font-medium' : urgency === 'soon' ? 'text-warning-700' : 'text-body'}`}>
                            {urgency === 'overdue' && <AlertTriangle className="w-3.5 h-3.5" />}
                            {fmtDate(d.expiryDate)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5"><NotifyToggle domain={d} onChanged={reload} /></td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-4 justify-end whitespace-nowrap">
                            <Link to={`/admin/domains/${d.id}`} title="ตั้งค่า" className="flex items-center gap-1 text-[12px] text-dim hover:text-brand-700">
                              <Settings className="w-3.5 h-3.5 shrink-0" /> ตั้งค่า
                            </Link>
                            <button onClick={() => setRenewDomain(d)} title="ต่ออายุ" className="flex items-center gap-1 text-[12px] text-brand-600 hover:text-brand-700 font-medium">
                              <RefreshCw className="w-3.5 h-3.5 shrink-0" /> ต่ออายุ
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t border-divider text-xs text-muted">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageSafe <= 1} className="disabled:opacity-30 hover:text-body">« Previous</button>
              <span>หน้า {pageSafe} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageSafe >= totalPages} className="disabled:opacity-30 hover:text-body">Next »</button>
            </div>
          </div>
        )}
      </div>

      {modalDomain && (
        <DomainModal
          domain={modalDomain === 'new' ? null : modalDomain}
          onClose={() => setModalDomain(null)}
          onDone={() => { setModalDomain(null); void reload() }}
        />
      )}
      {renewDomain && (
        <RenewDomainModal domain={renewDomain} onClose={() => setRenewDomain(null)} onDone={() => { setRenewDomain(null); void reload() }} />
      )}
    </>
  )
}
