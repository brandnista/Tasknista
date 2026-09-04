/**
 * Pronista §System Enhancements — Manhour/วัน แยกตามประเภทผู้ใช้งาน (staff/outsource/customer)
 * §Workload (2026-09-04) — แยกรายวันในสัปดาห์ได้ด้วย (เดิมเลขเดียวคงที่) — คอลัมน์ จ-อา ต่อแถวประเภท
 * โครง/รูปแบบเดียวกับ PermissionCeilingSettings.tsx (โหลด+แก้ในตัว+PUT ทั้งก้อนทีเดียว) — consume จริงใน GET /api/workload
 */
import { PERMISSION_CATEGORY_LABEL, WEEKDAYS, type ManhourUserType, type Weekday, type WeeklyMinutes } from '@seedoffice/core'
import { Check, Clock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { useToast } from './Toast'

const CATEGORIES: ManhourUserType[] = ['staff', 'outsource', 'customer']
const WEEKDAY_LABEL: Record<Weekday, string> = { mon: 'จ', tue: 'อ', wed: 'พ', thu: 'พฤ', fri: 'ศ', sat: 'ส', sun: 'อา' }

export function ManhourSettings() {
  const toast = useToast()
  const { data, reload } = useLoad<{ manhourMinutesPerDay: Record<ManhourUserType, WeeklyMinutes> }>(() => api.get('/api/admin/manhour'))
  const [minutes, setMinutes] = useState<Record<ManhourUserType, WeeklyMinutes> | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) setMinutes(data.manhourMinutesPerDay)
  }, [data])

  if (!minutes) return null

  const setHours = (cat: ManhourUserType, day: Weekday, hours: string) => {
    const h = Number(hours)
    if (!Number.isFinite(h)) return
    setMinutes({ ...minutes, [cat]: { ...minutes[cat], [day]: Math.round(h * 60) } })
    setSaved(false)
  }

  // เกลี่ยค่าวันจันทร์ไปทุกวัน — ทางลัดตอนอยากตั้งค่าเดียวกันทั้งสัปดาห์ ไม่ต้องกรอกทีละ 7 ช่อง
  const applyMondayToAll = (cat: ManhourUserType) => {
    const monMinutes = minutes[cat].mon
    setMinutes({ ...minutes, [cat]: Object.fromEntries(WEEKDAYS.map((d) => [d, monMinutes])) as WeeklyMinutes })
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
        <span className="text-xs text-muted">ตั้งแยกแต่ละวันในสัปดาห์ได้ (เช่น outsource วันเสาร์-อาทิตย์ให้ชั่วโมงต่างจากวันธรรมดา) — ใช้คำนวณในหน้า Workload</span>
      </div>
      <div className="p-5 space-y-4 overflow-x-auto">
        {CATEGORIES.map((cat) => (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-medium text-body w-24 shrink-0">{PERMISSION_CATEGORY_LABEL[cat]}</span>
              <button type="button" onClick={() => applyMondayToAll(cat)} className="text-[11px] text-brand-600 hover:text-brand-700 underline decoration-dotted">
                ใช้ค่าวันจันทร์กับทุกวัน
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              {WEEKDAYS.map((day) => (
                <label key={day} className="flex flex-col items-center gap-0.5 w-14 shrink-0">
                  <span className="text-[11px] text-muted">{WEEKDAY_LABEL[day]}</span>
                  <input
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    value={minutes[cat][day] / 60}
                    onChange={(e) => setHours(cat, day, e.target.value)}
                    className="w-14 text-sm bg-white border border-border rounded-lg px-1.5 py-1.5 text-right tabular-nums focus:outline-hidden focus:border-brand-400"
                  />
                </label>
              ))}
              <span className="text-xs text-muted shrink-0 ml-1">ชม.</span>
            </div>
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
