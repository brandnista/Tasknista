import { DEFAULT_MEETING_REMINDER_MINUTES, NOTIFICATION_CATEGORIES } from '@seedoffice/core'
import { Bell } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'

/**
 * Pronista §Notification overhaul (2026-08-27) — ตั้งค่าส่วนตัว: ปิด/เปิดแจ้งเตือนเป็นกลุ่ม (6 กลุ่ม จาก NOTIFICATION_CATEGORIES)
 * switch markup ตามแบบเดิมของ DailyReportTab.tsx (role="switch" + thumb เลื่อน) — ไม่ประดิษฐ์ของใหม่
 * Pronista §Meeting Schedule Tab (2026-08-27) — เพิ่มช่องตั้งนาทีล่วงหน้าก่อนประชุมเริ่ม เฉพาะแถวหมวด "ประชุม" (ปิดกรอกไม่ได้ถ้าปิดหมวดนี้ไว้)
 */
export function NotificationPrefs() {
  const [disabled, setDisabled] = useState<string[] | null>(null)
  const [reminderMinutes, setReminderMinutes] = useState<number>(DEFAULT_MEETING_REMINDER_MINUTES)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    api.get<{ disabledTypes: string[]; meetingReminderMinutes: number }>('/api/notification-prefs').then((d) => {
      setDisabled(d.disabledTypes)
      setReminderMinutes(d.meetingReminderMinutes)
    })
  }, [])

  const toggle = async (cat: (typeof NOTIFICATION_CATEGORIES)[number]) => {
    if (!disabled) return
    const isOff = cat.types.every((t) => disabled.includes(t))
    const next = isOff ? disabled.filter((t) => !cat.types.includes(t)) : [...new Set([...disabled, ...cat.types])]
    setDisabled(next)
    setSaving(cat.key)
    try {
      await api.patch('/api/notification-prefs', { disabledTypes: next })
    } finally {
      setSaving(null)
    }
  }

  const saveReminderMinutes = async (minutes: number) => {
    setReminderMinutes(minutes)
    setSaving('meetingReminderMinutes')
    try {
      await api.patch('/api/notification-prefs', { meetingReminderMinutes: minutes })
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-xs overflow-hidden">
      <div className="p-5 border-b border-border-subtle flex items-center gap-2">
        <Bell className="w-4 h-4 text-muted" />
        <div className="font-semibold text-ink">การแจ้งเตือน</div>
      </div>
      {disabled === null ? (
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
                          disabled={!on || saving === 'meetingReminderMinutes'}
                          onChange={(e) => setReminderMinutes(Number(e.target.value))}
                          onBlur={(e) => {
                            const v = Math.min(120, Math.max(1, Number(e.target.value) || DEFAULT_MEETING_REMINDER_MINUTES))
                            void saveReminderMinutes(v)
                          }}
                          className="w-14 text-sm bg-hover rounded-lg px-2 py-1 text-center disabled:opacity-50 focus:outline-hidden"
                        />
                        นาที
                      </label>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      onClick={() => void toggle(cat)}
                      disabled={saving === cat.key}
                      className={`relative w-[38px] h-[22px] rounded-full shrink-0 transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:outline-offset-2 ${on ? 'bg-brand-600' : 'bg-border'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow-xs transition-transform ${on ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-muted px-4 py-3 border-t border-divider">ปิดหมวดไหน จะไม่มีแจ้งเตือนประเภทนั้นส่งมาให้อีกเลย จนกว่าจะเปิดกลับ</p>
        </>
      )}
    </div>
  )
}
