/**
 * ตั้งค่า → Parameter Role (Pronista §Parameter Role) — owner เพิ่ม/ลบ/เรียง/ตั้งชื่อตำแหน่ง
 * ข้อมูลกลาง ใช้เลือกในเมนู "กำหนดต้นทุน" (dropdown จับคู่ตำแหน่ง↔ต้นทุน/วัน) และ Tab "Project Estimate" ในอนาคต
 * บันทึกทั้งลิสต์ทีเดียว (PUT) · ลบตำแหน่งที่ "กำหนดต้นทุน" ยังใช้อยู่ไม่ได้ (server ตอบ 409)
 */
import type { ParameterRole } from '@seedoffice/core'
import { Check, ChevronDown, ChevronUp, Trash2, UserCog } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'

const randomId = () => `role_${Math.random().toString(36).slice(2, 8)}`

export function ParameterRoleSettings() {
  const { data, reload } = useLoad<{ parameterRoles: ParameterRole[] }>(() => api.get('/api/admin/parameter-roles'))
  const [list, setList] = useState<ParameterRole[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) setList(data.parameterRoles)
  }, [data])

  if (!list) return null

  const rename = (i: number, name: string) => {
    setList(list.map((r, idx) => (idx === i ? { ...r, name } : r)))
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
    setList([...list, { id: randomId(), name: 'ตำแหน่งใหม่', sortOrder: list.length }])
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const parameterRoles = list.map((r, i) => ({ ...r, name: r.name.trim(), sortOrder: i }))
      await api.put('/api/admin/parameter-roles', { parameterRoles })
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
        <UserCog className="w-4 h-4 text-muted" />
        <div className="font-semibold text-ink">Parameter Role</div>
        <span className="text-xs text-muted">ข้อมูลกลาง — ใช้เลือกที่เมนู "กำหนดต้นทุน" และ Tab "Project Estimate"</span>
      </div>

      <div className="p-5 space-y-2">
        {list.map((r, i) => (
          <div key={r.id} className="flex items-center gap-2 border border-border-subtle rounded-lg p-2.5">
            <div className="flex flex-col">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-muted hover:text-body disabled:opacity-30">
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} className="text-muted hover:text-body disabled:opacity-30">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              value={r.name}
              onChange={(e) => rename(i, e.target.value)}
              maxLength={60}
              className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-1.5 focus:outline-hidden focus:border-brand-400"
            />
            <button type="button" onClick={() => remove(i)} title="ลบตำแหน่ง" className="text-muted hover:text-danger-600">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        <button type="button" onClick={add} className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800 pt-1">
          <UserCog className="w-4 h-4" /> เพิ่ม Role
        </button>

        {error && <div className="text-xs text-danger-600">{error}</div>}

        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => void save()} disabled={saving} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
            {saving ? 'กำลังบันทึก…' : 'บันทึก Parameter Role'}
          </button>
          {saved && (
            <span className="text-xs text-success-600 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> บันทึกแล้ว
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
