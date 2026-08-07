/**
 * ตั้งค่า → Labels (Pronista §Workspace) — owner เพิ่ม/ลบ/เรียง/เปลี่ยนชื่อ+สี แท็กที่ใช้ผูกกับ Task
 * บันทึกทั้งลิสต์ทีเดียว (PUT) · ลบ label ที่ยังมี Task ผูกอยู่ไม่ได้ (server ตอบ 409)
 */
import type { Label } from '@seedoffice/core'
import { BOARD_COLOR_KEYS } from '@seedoffice/core'
import { Check, ChevronDown, ChevronUp, Tag, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { STATUS_SWATCH, statusChip } from '../lib/project-ui'
import { useLoad } from '../lib/useLoad'

const randomId = () => `lbl_${Math.random().toString(36).slice(2, 8)}`

export function LabelSettings() {
  const { data, reload } = useLoad<{ labels: Label[] }>(() => api.get('/api/admin/labels'))
  const [list, setList] = useState<Label[] | null>(null)
  const [colorOpen, setColorOpen] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) setList(data.labels)
  }, [data])

  if (!list) return null

  const patch = (i: number, p: Partial<Label>) => {
    setList(list.map((l, idx) => (idx === i ? { ...l, ...p } : l)))
    setSaved(false)
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const copy = [...list]
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
    setList(copy)
    setSaved(false)
  }
  const remove = (i: number) => {
    setList(list.filter((_, idx) => idx !== i))
    setSaved(false)
  }
  const add = () => {
    setList([...list, { id: randomId(), name: 'Label ใหม่', color: 'slate', sortOrder: list.length }])
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const labels = list.map((l, i) => ({ ...l, name: l.name.trim(), sortOrder: i }))
      await api.put('/api/admin/labels', { labels })
      setSaved(true)
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
        <Tag className="w-4 h-4 text-muted" />
        <div className="font-semibold text-ink">Labels</div>
        <span className="text-xs text-muted">แท็กสีผูกกับ Task เลือกได้หลายอันต่องาน</span>
      </div>

      <div className="p-5 space-y-2">
        {list.map((l, i) => (
          <div key={l.id} className="flex items-center gap-2 border border-border-subtle rounded-lg p-2.5">
            <div className="flex flex-col">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-muted hover:text-body disabled:opacity-30">
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} className="text-muted hover:text-body disabled:opacity-30">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setColorOpen(colorOpen === l.id ? null : l.id)}
                className={`w-6 h-6 rounded-full ${STATUS_SWATCH[l.color] ?? 'bg-slate-400'} ring-2 ring-white shadow-xs`}
                title="เปลี่ยนสี"
              />
              {colorOpen === l.id && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setColorOpen(null)} />
                  <div className="absolute left-0 top-full mt-1 z-50 w-44 bg-white rounded-lg shadow-2xl border border-border-subtle p-2 grid grid-cols-5 gap-1.5">
                    {BOARD_COLOR_KEYS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => { patch(i, { color: c }); setColorOpen(null) }}
                        className={`w-6 h-6 rounded-full ${STATUS_SWATCH[c]} grid place-items-center`}
                      >
                        {l.color === c && <Check className="w-3.5 h-3.5 text-white" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <input
              value={l.name}
              onChange={(e) => patch(i, { name: e.target.value })}
              maxLength={60}
              className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-1.5 focus:outline-hidden focus:border-brand-400"
            />
            <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${statusChip(l.color)}`}>{l.name || '—'}</span>
            <button type="button" onClick={() => remove(i)} title="ลบ label" className="text-muted hover:text-danger-600">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        <button type="button" onClick={add} className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800 pt-1">
          <Tag className="w-4 h-4" /> เพิ่ม Label
        </button>

        {error && <div className="text-xs text-danger-600">{error}</div>}

        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => void save()} disabled={saving} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
            {saving ? 'กำลังบันทึก…' : 'บันทึก Labels'}
          </button>
          {saved && <span className="text-xs text-success-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> บันทึกแล้ว</span>}
        </div>
      </div>
    </div>
  )
}
