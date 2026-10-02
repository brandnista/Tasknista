import { DEFAULT_MEETING_REMINDER_MINUTES, NOTIFICATION_CATEGORIES } from '@seedoffice/core'
import { Bell } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useDialog } from './Dialog'
import { SaveBar } from './SaveBar'
import { useToast } from './Toast'

/**
 * Pronista §Notification overhaul (2026-08-27) — ตั้งค่าส่วนตัว: ปิด/เปิดแจ้งเตือนเป็นกลุ่ม (6 กลุ่ม จาก NOTIFICATION_CATEGORIES)
 * switch markup ตามแบบเดิมของ DailyReportTab.tsx (role="switch" + thumb เลื่อน) — ไม่ประดิษฐ์ของใหม่
 * Pronista §Meeting Schedule Tab (2026-08-27) — เพิ่มช่องตั้งนาทีล่วงหน้าก่อนประชุมเริ่ม เฉพาะแถวหมวด "ประชุม" (ปิดกรอกไม่ได้ถ้าปิดหมวดนี้ไว้)
 * Pronista §Save button (2026-10-02) — สลับสวิตช์/แก้นาทีแล้วยังไม่บันทึกจนกดปุ่ม "บันทึก" (เดิมบันทึกทันทีโดยไม่มีแจ้งผล และไม่ดักข้อผิดพลาด)
 */
export function NotificationPrefs() {
  const toast = useToast()
  const { alertDialog } = useDialog()
  // ค่าจาก server (ใช้เทียบว่ามีการแก้ไขไหม) กับค่าใน draft ที่ผู้ใช้เห็น
  const [saved, setSaved] = useState<{ disabled: string[]; minutes: number } | null>(null)
  const [disabled, setDisabled] = useState<string[]>([])
  const [reminderMinutes, setReminderMinutes] = useState<number>(DEFAULT_MEETING_REMINDER_MINUTES)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get<{ disabledTypes: string[]; meetingReminderMinutes: number }>('/api/notification-prefs').then((d) => {
      setSaved({ disabled: d.disabledTypes, minutes: d.meetingReminderMinutes })
      setDisabled(d.disabledTypes)
      setReminderMinutes(d.meetingReminderMinutes)
    })
  }, [])

  const clampMinutes = (v: number) => Math.min(120, Math.max(1, v || DEFAULT_MEETING_REMINDER_MINUTES))
  const disabledChanged = saved ? [...saved.disabled].sort().join() !== [...disabled].sort().join() : false
  const minutesChanged = saved ? clampMinutes(reminderMinutes) !== saved.minutes : false
  const dirty = disabledChanged || minutesChanged

  const toggle = (cat: (typeof NOTIFICATION_CATEGORIES)[number]) => {
    const isOff = cat.types.every((t) => disabled.includes(t))
    setDisabled(isOff ? disabled.filter((t) => !cat.types.includes(t)) : [...new Set([...disabled, ...cat.types])])
  }

  const save = async () => {
    if (!saved) return
    const minutes = clampMinutes(reminderMinutes)
    const body: { disabledTypes?: string[]; meetingReminderMinutes?: number } = {}
    if (disabledChanged) body.disabledTypes = disabled
    if (minutesChanged) body.meetingReminderMinutes = minutes
    setSaving(true)
    try {
      await api.patch('/api/notification-prefs', body)
      setSaved({ disabled, minutes })
      setReminderMinutes(minutes)
      toast('บันทึกสำเร็จ')
    } catch (e) {
      await alertDialog({ title: 'บันทึกไม่สำเร็จ', message: e instanceof ApiError ? e.message : 'กรุณาลองใหม่อีกครั้ง' })
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    if (!saved) return
    setDisabled(saved.disabled)
    setReminderMinutes(saved.minutes)
  }

  return (
    <div className="bg-white rounded-lg shadow-xs overflow-hidden">
      <div className="p-5 border-b border-border-subtle flex items-center gap-2">
        <Bell className="w-4 h-4 text-muted" />
        <div className="font-semibold text-ink">การแจ้งเตือน</div>
      </div>
      {saved === null ? (
        <div className="p-5 text-sm text-muted">กำลังโหลด…</div>
      ) : (
        <>
          <div className="divide-y divide-divider">
            {NOTIFICATION_CATEGORIES.map((cat) => {
              const on = !cat.types.every((t) => disabled.includes(t))
              return (
                <div key={cat.key} className="p-4 flex items-center justify-between gap-4">
                  <span className="text-sm text-body">{cat.label}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    {cat.key === 'meeting' && (
                      <label className={`flex items-center gap-1.5 text-xs ${on ? 'text-muted' : 'text-muted/50'}`}>
                        เตือนล่วงหน้า
                        <input
                          type="number"
                          min={1}
                          max={120}
                          value={reminderMinutes}
                          disabled={!on || saving}
                          onChange={(e) => setReminderMinutes(Number(e.target.value))}
                          className="w-14 text-sm bg-hover rounded-lg px-2 py-1 text-center disabled:opacity-50 focus:outline-hidden"
                        />
                        นาที
                      </label>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      onClick={() => toggle(cat)}
                      disabled={saving}
                      className={`relative w-[38px] h-[22px] rounded-full shrink-0 transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:outline-offset-2 ${on ? 'bg-brand-600' : 'bg-border'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow-xs transition-transform ${on ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="px-4 py-3 border-t border-divider space-y-3">
            <p className="text-[11px] text-muted">ปิดหมวดไหน จะไม่มีแจ้งเตือนประเภทนั้นส่งมาให้อีกเลย จนกว่าจะเปิดกลับ</p>
            <SaveBar inline dirty={dirty} saving={saving} onSave={() => void save()} onDiscard={discard} />
          </div>
        </>
      )}
    </div>
  )
}
