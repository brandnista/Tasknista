/**
 * Pronista §Membership — จัดการสมาชิก (ธุรกิจใหม่แยกจากงานโปรเจกต์ลูกค้าเดิม)
 */
import { SquarePen, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { PageHeader } from '../components/PageHeader'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { CLASSIFICATION_TYPE_LABEL, fieldInput, fieldLabel, ModalShell, type ClassificationType } from './UserSettings'

interface Member {
  id: string
  name: string
  classificationType: ClassificationType
  orgSizeTierId: string | null
  businessName: string | null
  phone: string | null
  email: string | null
  membershipMode: 'lifetime' | 'dated'
  startDate: string | null
  endDate: string | null
  status: 'active' | 'disabled'
}
interface OrgSizeTier { id: string; name: string; feeSatang: number; sortOrder: number }

/** เพิ่มสมาชิกใหม่ — ฟิลด์เท่ากับหน้าแก้ไข MemberDetail ทุกฟิลด์ (รวมช่วงวันที่ ถ้าเลือก "มีอายุ" — ใช้ได้ทุกประเภท ไม่ผูกกับ classificationType) */
function AddMemberForm({ tiers, onClose, onCreated }: { tiers: OrgSizeTier[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({
    name: '', classificationType: 'ordinary_individual' as ClassificationType, orgSizeTierId: '',
    businessName: '', phone: '', email: '',
    membershipMode: 'lifetime' as 'lifetime' | 'dated', startDate: '', endDate: '', notifyBeforeDays: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const created = await api.post<{ id: string }>('/api/members', {
        name: form.name,
        classificationType: form.classificationType,
        orgSizeTierId: form.classificationType === 'extraordinary_juristic' ? form.orgSizeTierId || null : null,
        businessName: form.businessName || null,
        phone: form.phone || null,
        email: form.email || null,
        membershipMode: form.membershipMode,
        startDate: form.membershipMode === 'dated' ? form.startDate || null : null,
        endDate: form.membershipMode === 'dated' ? form.endDate || null : null,
        notifyBeforeDays: form.membershipMode === 'dated' && form.notifyBeforeDays ? Number(form.notifyBeforeDays) : null,
      })
      onCreated(created.id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ผิดพลาด')
    } finally {
      setBusy(false)
    }
  }
  return (
    <ModalShell title="เพิ่มสมาชิก" onClose={onClose}>
      <div>
        <label className={fieldLabel}>ประเภท</label>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {(Object.keys(CLASSIFICATION_TYPE_LABEL) as ClassificationType[]).map((t) => (
            <label key={t} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="classificationType" checked={form.classificationType === t} onChange={() => setForm({ ...form, classificationType: t })} />
              {CLASSIFICATION_TYPE_LABEL[t]}
            </label>
          ))}
        </div>
      </div>
      {form.classificationType === 'extraordinary_juristic' && (
        <div>
          <label className={fieldLabel}>ขนาดองค์กร</label>
          <select value={form.orgSizeTierId} onChange={(e) => setForm({ ...form, orgSizeTierId: e.target.value })} className={fieldInput}>
            <option value="">— เลือกขนาดองค์กร —</option>
            {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className={fieldLabel}>ชื่อธุรกิจ</label><input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} className={fieldInput} /></div>
        <div><label className={fieldLabel}>ชื่อผู้ติดต่อ *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={fieldInput} /></div>
        <div><label className={fieldLabel}>อีเมล</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={fieldInput} /></div>
        <div><label className={fieldLabel}>เบอร์มือถือ</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={fieldInput} /></div>
      </div>
      <div>
        <label className={fieldLabel}>อายุสมาชิก</label>
        <div className="flex items-center gap-4 text-sm">
          {(['lifetime', 'dated'] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="membershipMode" checked={form.membershipMode === mode} onChange={() => setForm({ ...form, membershipMode: mode })} />
              {mode === 'lifetime' ? 'ตลอดชีพ (Lifetime)' : 'มีอายุ (กำหนดวันที่)'}
            </label>
          ))}
        </div>
      </div>
      {form.membershipMode === 'dated' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className={fieldLabel}>วันเริ่มต้น</label><input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={fieldInput} /></div>
          <div><label className={fieldLabel}>วันหมดอายุ</label><input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={fieldInput} /></div>
          <div><label className={fieldLabel}>แจ้งเตือนล่วงหน้า (วัน)</label><input type="number" min={0} value={form.notifyBeforeDays} onChange={(e) => setForm({ ...form, notifyBeforeDays: e.target.value })} className={fieldInput} /></div>
        </div>
      )}
      {error && <div className="text-xs text-danger-600">{error}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg border border-border text-body hover:bg-hover">ยกเลิก</button>
        <button onClick={() => void submit()} disabled={!form.name || busy} className="text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg">
          เพิ่มสมาชิก
        </button>
      </div>
    </ModalShell>
  )
}

export function MembersPage() {
  const navigate = useNavigate()
  const { data: list, reload } = useLoad<Member[]>(() => api.get('/api/members'))
  const { data: settings } = useLoad<{ memberOrgSizeTiers: OrgSizeTier[] }>(() => api.get('/api/members/settings'))
  const [adding, setAdding] = useState(false)

  return (
    <>
      <PageHeader
        title="จัดการสมาชิก"
        action={
          <button onClick={() => setAdding((v) => !v)} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-3.5 py-2 rounded-lg">
            <UserPlus className="w-4 h-4" /> เพิ่มสมาชิก
          </button>
        }
      />
      <div className="p-3 sm:p-6 space-y-4">
        {adding && (
          <AddMemberForm
            tiers={settings?.memberOrgSizeTiers ?? []}
            onClose={() => setAdding(false)}
            onCreated={(id) => { setAdding(false); void reload(); navigate(`/members/${id}`) }}
          />
        )}
        <div className="bg-white rounded-lg shadow-xs overflow-hidden">
          {!list ? (
            <div className="p-8 text-center text-sm text-muted">กำลังโหลด…</div>
          ) : list.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted">ยังไม่มีสมาชิก — กด "เพิ่มสมาชิก"</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-hover text-dim text-xs">
                  <tr>
                    <th className="text-left font-medium px-5 py-3">ชื่อ</th>
                    <th className="text-left font-medium px-3 py-3">ประเภท</th>
                    <th className="text-left font-medium px-3 py-3">อายุสมาชิก</th>
                    <th className="text-left font-medium px-3 py-3">สถานะ</th>
                    <th className="text-right font-medium px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {list.map((m) => (
                    <tr key={m.id} className={m.status === 'disabled' ? 'opacity-40' : ''}>
                      <td className="px-5 py-3">
                        <div className="font-medium text-strong">{m.businessName || m.name}</div>
                        {m.businessName && <div className="text-[11px] text-muted">{m.name}</div>}
                      </td>
                      <td className="px-3">
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-info-50 text-info-700 whitespace-nowrap">{CLASSIFICATION_TYPE_LABEL[m.classificationType]}</span>
                      </td>
                      <td className="px-3 text-muted">{m.membershipMode === 'lifetime' ? 'ตลอดชีพ' : `ถึง ${m.endDate ?? '—'}`}</td>
                      <td className="px-3 text-muted">{m.status === 'active' ? 'ใช้งานอยู่' : 'ปิดการใช้งาน'}</td>
                      <td className="text-right px-5">
                        <button onClick={() => navigate(`/members/${m.id}`)} className="inline-flex items-center gap-1 text-[11px] text-brand-700 hover:underline">
                          <SquarePen className="w-3 h-3" /> แก้ไขข้อมูล
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
