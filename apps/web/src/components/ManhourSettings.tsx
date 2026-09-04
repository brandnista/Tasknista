/**
 * Pronista §System Enhancements — Manhour/วัน แยกตามประเภทผู้ใช้งาน (staff/outsource/customer)
 * โครง/รูปแบบเดียวกับ PermissionCeilingSettings.tsx (โหลด+แก้ในตัว+PUT ทั้งก้อนทีเดียว) — ค่านี้ยังไม่มีจุดไหน consume (รอฟีเจอร์ Workload)
 */
import { PERMISSION_CATEGORY_LABEL, type ManhourUserType } from '@seedoffice/core'
import { Check, Clock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { useToast } from './Toast'

const CATEGORIES: ManhourUserType[] = ['staff', 'outsource', 'customer']

export function ManhourSettings() {
  const toast = useToast()
  const { data, reload } = useLoad<{ manhourMinutesPerDay: Record<ManhourUserType, number> }>(() => api.get('/api/admin/manhour'))
  const [minutes, setMinutes] = useState<Record<ManhourUserType, number> | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) setMinutes(data.manhourMinutesPerDay)
  }, [data])

  if (!minutes) return null

  const setHours = (cat: ManhourUserType, hours: string) => {
    const h = Number(hours)
    if (!Number.isFinite(h)) return
    setMinutes({ ...minutes, [cat]: Math.round(h * 60) })
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await api.put('/api/admin/manhour', { manhourMinutesPerDay: minutes })
      setSaved(true)
      toast('บันทึกสำเร็จ')
      await reload()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-xs overflow-hidden">
      <div className="p-5 border-b border-border-subtle flex items-center gap-2 flex-wrap">
        <Clock className="w-4 h-4 text-muted" />
        <div className="font-semibold text-ink">Manhour ต่อวัน ตามประเภทผู้ใช้งาน</div>
        <span className="text-xs text-muted">ยังไม่มีฟีเจอร์ใช้ค่านี้โดยตรง (เตรียมไว้สำหรับภาพรวม Workload) — ค่าเริ่มต้นอิงจาก "เพดานชั่วโมงทำงาน/วัน" ด้านบน</span>
      </div>
      <div className="p-5 space-y-3">
        {CATEGORIES.map((cat) => (
          <div key={cat} className="flex items-center gap-3">
            <span className="text-sm text-body w-28 shrink-0">{PERMISSION_CATEGORY_LABEL[cat]}</span>
            <input
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={minutes[cat] / 60}
              onChange={(e) => setHours(cat, e.target.value)}
              className="w-24 text-sm bg-white border border-border rounded-lg px-2.5 py-1.5 text-right tabular-nums focus:outline-hidden focus:border-brand-400"
            />
            <span className="text-xs text-muted">ชม./วัน</span>
          </div>
        ))}

        {error && <div className="text-xs text-danger-600">{error}</div>}

        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => void save()} disabled={saving} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
            {saving ? 'กำลังบันทึก…' : 'บันทึก Manhour'}
          </button>
          {saved && <span className="text-xs text-success-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> บันทึกแล้ว</span>}
        </div>
      </div>
    </div>
  )
}
