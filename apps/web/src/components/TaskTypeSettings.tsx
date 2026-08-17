/**
 * ตั้งค่า → ประเภทงาน (Pronista §System Requirements Update — Task Type/Sub-task Type) — owner เพิ่ม/ลบ/เรียง/ตั้งชื่อประเภทงาน + ตัวเลือกย่อยของแต่ละประเภท
 * เลือกได้ในหน้า Task Detail ทุก kind ของงาน · บันทึกทั้งลิสต์ทีเดียว (PUT) · ลบประเภท/ตัวเลือกย่อยที่ยังมีงานใช้อยู่ไม่ได้ (server ตอบ 409)
 */
import type { TaskType } from '@seedoffice/core'
import { Check, ChevronDown, ChevronUp, ListTree, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'

const randomTypeId = () => `tt_${Math.random().toString(36).slice(2, 8)}`
const randomSubTypeId = () => `tts_${Math.random().toString(36).slice(2, 8)}`

export function TaskTypeSettings() {
  const { data, reload } = useLoad<{ taskTypes: TaskType[] }>(() => api.get('/api/admin/task-types'))
  const [list, setList] = useState<TaskType[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) setList(data.taskTypes)
  }, [data])

  if (!list) return null

  const touch = () => setSaved(false)

  const renameType = (i: number, name: string) => {
    setList(list.map((t, idx) => (idx === i ? { ...t, name } : t)))
    touch()
  }
  const moveType = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const copy = [...list]
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
    setList(copy)
    touch()
  }
  const removeType = (i: number) => {
    setList(list.filter((_, idx) => idx !== i))
    touch()
  }
  const addType = () => {
    setList([...list, { id: randomTypeId(), name: 'ประเภทงานใหม่', sortOrder: list.length, subTypes: [{ id: randomSubTypeId(), name: 'ตัวเลือกย่อยใหม่', sortOrder: 0 }] }])
    touch()
  }

  const renameSubType = (ti: number, si: number, name: string) => {
    setList(list.map((t, idx) => (idx === ti ? { ...t, subTypes: t.subTypes.map((s, sidx) => (sidx === si ? { ...s, name } : s)) } : t)))
    touch()
  }
  const moveSubType = (ti: number, si: number, dir: -1 | 1) => {
    const type = list[ti]
    if (!type) return
    const sj = si + dir
    if (sj < 0 || sj >= type.subTypes.length) return
    const subCopy = [...type.subTypes]
    ;[subCopy[si], subCopy[sj]] = [subCopy[sj]!, subCopy[si]!]
    setList(list.map((t, idx) => (idx === ti ? { ...t, subTypes: subCopy } : t)))
    touch()
  }
  const removeSubType = (ti: number, si: number) => {
    setList(list.map((t, idx) => (idx === ti ? { ...t, subTypes: t.subTypes.filter((_, sidx) => sidx !== si) } : t)))
    touch()
  }
  const addSubType = (ti: number) => {
    setList(
      list.map((t, idx) =>
        idx === ti ? { ...t, subTypes: [...t.subTypes, { id: randomSubTypeId(), name: 'ตัวเลือกย่อยใหม่', sortOrder: t.subTypes.length }] } : t,
      ),
    )
    touch()
  }

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const taskTypes = list.map((t, i) => ({
        ...t,
        name: t.name.trim(),
        sortOrder: i,
        subTypes: t.subTypes.map((s, si) => ({ ...s, name: s.name.trim(), sortOrder: si })),
      }))
      await api.put('/api/admin/task-types', { taskTypes })
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
        <ListTree className="w-4 h-4 text-muted" />
        <div className="font-semibold text-ink">ประเภทงาน (Task Type)</div>
        <span className="text-xs text-muted">เลือกได้ในหน้า Task Detail ของงานทุกประเภท — แต่ละประเภทมีตัวเลือกย่อยของตัวเอง</span>
      </div>

      <div className="p-5 space-y-4">
        {list.map((t, ti) => (
          <div key={t.id} className="border border-border-subtle rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex flex-col">
                <button type="button" onClick={() => moveType(ti, -1)} disabled={ti === 0} className="text-muted hover:text-body disabled:opacity-30">
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => moveType(ti, 1)} disabled={ti === list.length - 1} className="text-muted hover:text-body disabled:opacity-30">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                value={t.name}
                onChange={(e) => renameType(ti, e.target.value)}
                maxLength={60}
                className="flex-1 text-sm font-medium bg-white border border-border rounded-lg px-3 py-1.5 focus:outline-hidden focus:border-brand-400"
              />
              <button type="button" onClick={() => removeType(ti)} title="ลบประเภทงาน" className="text-muted hover:text-danger-600">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="pl-8 space-y-1.5">
              {t.subTypes.map((s, si) => (
                <div key={s.id} className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button type="button" onClick={() => moveSubType(ti, si, -1)} disabled={si === 0} className="text-muted hover:text-body disabled:opacity-30">
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSubType(ti, si, 1)}
                      disabled={si === t.subTypes.length - 1}
                      className="text-muted hover:text-body disabled:opacity-30"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </div>
                  <input
                    value={s.name}
                    onChange={(e) => renameSubType(ti, si, e.target.value)}
                    maxLength={60}
                    className="flex-1 text-xs bg-white border border-border-subtle rounded-lg px-2.5 py-1 focus:outline-hidden focus:border-brand-400"
                  />
                  <button type="button" onClick={() => removeSubType(ti, si)} title="ลบตัวเลือกย่อย" className="text-muted hover:text-danger-600">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => addSubType(ti)} className="text-xs text-brand-700 hover:text-brand-800">
                + เพิ่มตัวเลือกย่อย
              </button>
            </div>
          </div>
        ))}

        <button type="button" onClick={addType} className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800 pt-1">
          <ListTree className="w-4 h-4" /> เพิ่มประเภทงาน
        </button>

        {error && <div className="text-xs text-danger-600">{error}</div>}

        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => void save()} disabled={saving} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
            {saving ? 'กำลังบันทึก…' : 'บันทึกประเภทงาน'}
          </button>
          {saved && <span className="text-xs text-success-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> บันทึกแล้ว</span>}
        </div>
      </div>
    </div>
  )
}
