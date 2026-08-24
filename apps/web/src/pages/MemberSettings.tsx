/**
 * Pronista §Membership — ตั้งค่าค่าธรรมเนียมตามประเภท + ราคาตามขนาดองค์กร (Submenu ใน "จัดการสมาชิก")
 * pattern เดียวกับ CostRoleSettings — บันทึกทั้งลิสต์ทีเดียว (PUT)
 */
import { Check, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { CLASSIFICATION_TYPE_LABEL, type ClassificationType } from './UserSettings'

interface Fee { classificationType: ClassificationType; feeSatang: number; sortOrder: number }
interface Tier { id: string; name: string; feeSatang: number; sortOrder: number }
interface Settings { membershipFees: Fee[]; memberOrgSizeTiers: Tier[] }

export function MemberSettingsPage() {
  const { data, reload } = useLoad<Settings>(() => api.get('/api/members/settings'))
  const [fees, setFees] = useState<Fee[] | null>(null)
  const [tiers, setTiers] = useState<Tier[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) {
      setFees(data.membershipFees)
      setTiers(data.memberOrgSizeTiers)
    }
  }, [data])

  if (!fees || !tiers) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>

  const setFeeAmount = (i: number, baht: string) => {
    const satang = baht.trim() ? Math.round(Number(baht) * 100) : 0
    setFees(fees.map((f, idx) => (idx === i ? { ...f, feeSatang: satang } : f)))
    setSaved(false)
  }
  const setTierName = (i: number, name: string) => { setTiers(tiers.map((t, idx) => (idx === i ? { ...t, name } : t))); setSaved(false) }
  const setTierFee = (i: number, baht: string) => {
    const satang = baht.trim() ? Math.round(Number(baht) * 100) : 0
    setTiers(tiers.map((t, idx) => (idx === i ? { ...t, feeSatang: satang } : t)))
    setSaved(false)
  }
  const moveTier = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= tiers.length) return
    const copy = [...tiers]
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
    setTiers(copy)
    setSaved(false)
  }
  const removeTier = (i: number) => { setTiers(tiers.filter((_, idx) => idx !== i)); setSaved(false) }
  const addTier = () => { setTiers([...tiers, { id: crypto.randomUUID(), name: '', feeSatang: 0, sortOrder: tiers.length }]); setSaved(false) }

  const save = async () => {
    if (tiers.some((t) => !t.name.trim())) {
      setError('ต้องตั้งชื่อขนาดองค์กรให้ครบทุกแถวก่อนบันทึก')
      return
    }
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await api.put('/api/members/settings', {
        membershipFees: fees.map((f, i) => ({ ...f, sortOrder: i })),
        memberOrgSizeTiers: tiers.map((t, i) => ({ ...t, sortOrder: i })),
      })
      setSaved(true)
      await reload()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="ตั้งค่าสมาชิก" />
      <div className="p-3 sm:p-6 max-w-2xl space-y-4">
        <div className="bg-white rounded-lg shadow-xs overflow-hidden">
          <div className="p-5 border-b border-border-subtle">
            <div className="font-semibold text-ink">ค่าธรรมเนียมตามประเภท</div>
            <div className="text-xs text-muted mt-0.5">ใช้เป็นยอดแนะนำตอนสร้างคำสั่งซื้อของสมาชิกแต่ละประเภท</div>
          </div>
          <div className="p-5 space-y-2">
            {fees.map((f, i) => (
              <div key={f.classificationType} className="flex items-center gap-3">
                <div className="flex-1 text-sm text-body">{CLASSIFICATION_TYPE_LABEL[f.classificationType]}</div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    min={0}
                    value={f.feeSatang / 100}
                    onChange={(e) => setFeeAmount(i, e.target.value)}
                    className="w-28 text-sm bg-white border border-border rounded-lg px-2.5 py-1.5 text-right tabular-nums focus:outline-hidden focus:border-brand-400"
                  />
                  <span className="text-xs text-muted">บาท</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-xs overflow-hidden">
          <div className="p-5 border-b border-border-subtle">
            <div className="font-semibold text-ink">ราคาตามขนาดองค์กร</div>
            <div className="text-xs text-muted mt-0.5">ใช้เฉพาะสมาชิกประเภทวิสามัญนิติบุคคล</div>
          </div>
          <div className="p-5 space-y-2">
            {tiers.length === 0 && <div className="text-sm text-muted py-4 text-center">ยังไม่มีระดับขนาดองค์กร — กด "เพิ่มระดับ"</div>}
            {tiers.map((t, i) => (
              <div key={t.id} className="flex items-center gap-2 border border-border-subtle rounded-lg p-2.5">
                <div className="flex flex-col">
                  <button type="button" onClick={() => moveTier(i, -1)} disabled={i === 0} className="text-muted hover:text-body disabled:opacity-30">
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => moveTier(i, 1)} disabled={i === tiers.length - 1} className="text-muted hover:text-body disabled:opacity-30">
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input
                  placeholder="ชื่อระดับ เช่น เล็ก / กลาง / ใหญ่"
                  value={t.name}
                  onChange={(e) => setTierName(i, e.target.value)}
                  className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-1.5 focus:outline-hidden focus:border-brand-400"
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    min={0}
                    value={t.feeSatang / 100}
                    onChange={(e) => setTierFee(i, e.target.value)}
                    className="w-24 text-sm bg-white border border-border rounded-lg px-2.5 py-1.5 text-right tabular-nums focus:outline-hidden focus:border-brand-400"
                  />
                  <span className="text-xs text-muted">บาท</span>
                </div>
                <button type="button" onClick={() => removeTier(i)} title="ลบระดับ" className="text-muted hover:text-danger-600">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={addTier} className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800 pt-1">
              <Plus className="w-4 h-4" /> เพิ่มระดับ
            </button>
          </div>
        </div>

        {error && <div className="text-sm text-danger-600">{error}</div>}
        <div className="flex items-center gap-3">
          <button onClick={() => void save()} disabled={saving} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
          {saved && (
            <span className="text-xs text-success-600 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> บันทึกแล้ว
            </span>
          )}
        </div>
      </div>
    </>
  )
}
