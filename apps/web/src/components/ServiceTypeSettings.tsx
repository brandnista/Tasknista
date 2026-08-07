/**
 * ตั้งค่า → ประเภทบริการ (Service Type) (Pronista §Subscription Notify) — owner เพิ่ม/ลบ/เรียง/ตั้งชื่อประเภทบริการ (Website Dev/Mobile App/ฯลฯ)
 * เลือกได้ตอนสร้างโปรเจกต์ที่มีระยะเวลาให้บริการ · บันทึกทั้งลิสต์ทีเดียว (PUT) · ลบประเภทที่ยังมีโปรเจกต์ใช้อยู่ไม่ได้ (server ตอบ 409)
 */
import type { ServiceType } from '@seedoffice/core'
import { Check, ChevronDown, ChevronUp, Tag, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'

const randomId = () => `svc_${Math.random().toString(36).slice(2, 8)}`

export function ServiceTypeSettings() {
  const { data, reload } = useLoad<{ serviceTypes: ServiceType[] }>(() => api.get('/api/admin/service-types'))
  const [list, setList] = useState<ServiceType[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) setList(data.serviceTypes)
  }, [data])

  if (!list) return null

  const rename = (i: number, name: string) => {
    setList(list.map((s, idx) => (idx === i ? { ...s, name } : s)))
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
    setList([...list, { id: randomId(), name: 'ประเภทใหม่', sortOrder: list.length }])
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const serviceTypes = list.map((s, i) => ({ ...s, name: s.name.trim(), sortOrder: i }))
      await api.put('/api/admin/service-types', { serviceTypes })
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
        <div className="font-semibold text-ink">ประเภทบริการ (Service Type)</div>
        <span className="text-xs text-muted">เลือกได้ตอนสร้างโปรเจกต์ที่มีระยะเวลาให้บริการ (Subscription Notify)</span>
      </div>

      <div className="p-5 space-y-2">
        {list.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2 border border-border-subtle rounded-lg p-2.5">
            <div className="flex flex-col">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-muted hover:text-body disabled:opacity-30">
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} className="text-muted hover:text-body disabled:opacity-30">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              value={s.name}
              onChange={(e) => rename(i, e.target.value)}
              maxLength={60}
              className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-1.5 focus:outline-hidden focus:border-brand-400"
            />
            <button type="button" onClick={() => remove(i)} title="ลบประเภท" className="text-muted hover:text-danger-600">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        <button type="button" onClick={add} className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800 pt-1">
          <Tag className="w-4 h-4" /> เพิ่มประเภทบริการ
        </button>

        {error && <div className="text-xs text-danger-600">{error}</div>}

        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => void save()} disabled={saving} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
            {saving ? 'กำลังบันทึก…' : 'บันทึกประเภทบริการ'}
          </button>
          {saved && <span className="text-xs text-success-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> บันทึกแล้ว</span>}
        </div>
      </div>
    </div>
  )
}
