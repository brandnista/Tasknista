/**
 * ตั้งค่า → Preset สถานะ Sprint Board (Tasknista §Sprint & Board) — owner เพิ่ม/ลบ/เรียง/เปลี่ยนชื่อ+สี ได้ทั้ง preset และคอลัมน์ในนั้น
 * บันทึกทั้งลิสต์ทีเดียว (PUT) · ลบ preset ที่ sprint ใช้อยู่ไม่ได้ (server ตอบ 409)
 */
import { BOARD_COLOR_KEYS } from '@seedoffice/core'
import { Check, ChevronDown, ChevronUp, LayoutGrid, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { STATUS_SWATCH, statusChip } from '../lib/project-ui'
import { useLoad } from '../lib/useLoad'

interface Column { id: string; name: string; color: string; sortOrder: number }
interface Preset { id: string; name: string; columns: Column[] }

const randomId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`

function ColumnRow({ col, onChange, onMove, onRemove, canMoveUp, canMoveDown, colorOpen, onToggleColor }: {
  col: Column
  onChange: (patch: Partial<Column>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  colorOpen: boolean
  onToggleColor: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col">
        <button type="button" onClick={() => onMove(-1)} disabled={!canMoveUp} className="text-muted hover:text-body disabled:opacity-30">
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={!canMoveDown} className="text-muted hover:text-body disabled:opacity-30">
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="relative">
        <button type="button" onClick={onToggleColor} className={`w-6 h-6 rounded-full ${STATUS_SWATCH[col.color] ?? 'bg-slate-400'} ring-2 ring-white shadow-xs`} title="เปลี่ยนสี" />
        {colorOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={onToggleColor} />
            <div className="absolute left-0 top-full mt-1 z-50 w-44 bg-white rounded-lg shadow-2xl border border-border-subtle p-2 grid grid-cols-5 gap-1.5">
              {BOARD_COLOR_KEYS.map((c) => (
                <button key={c} type="button" onClick={() => { onChange({ color: c }); onToggleColor() }} className={`w-6 h-6 rounded-full ${STATUS_SWATCH[c]} grid place-items-center`}>
                  {col.color === c && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <input
        value={col.name}
        onChange={(e) => onChange({ name: e.target.value })}
        maxLength={40}
        className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-1.5 focus:outline-hidden focus:border-brand-400"
      />
      <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${statusChip(col.color)}`}>{col.name || '—'}</span>
      <button type="button" onClick={onRemove} title="ลบคอลัมน์" className="text-muted hover:text-danger-600">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export function BoardPresetSettings() {
  const { data, reload } = useLoad<{ boardPresets: Preset[] }>(() => api.get('/api/config'))
  const [list, setList] = useState<Preset[] | null>(null)
  const [colorOpen, setColorOpen] = useState<string | null>(null) // `${presetIdx}:${colIdx}`
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) setList(data.boardPresets)
  }, [data])

  if (!list) return null

  const updatePreset = (pi: number, patch: Partial<Preset>) => {
    setList(list.map((p, i) => (i === pi ? { ...p, ...patch } : p)))
    setSaved(false)
  }
  const updateColumn = (pi: number, ci: number, patch: Partial<Column>) => {
    updatePreset(pi, { columns: list[pi]!.columns.map((c, i) => (i === ci ? { ...c, ...patch } : c)) })
  }
  const moveColumn = (pi: number, ci: number, dir: -1 | 1) => {
    const cols = [...list[pi]!.columns]
    const cj = ci + dir
    if (cj < 0 || cj >= cols.length) return
    ;[cols[ci], cols[cj]] = [cols[cj]!, cols[ci]!]
    updatePreset(pi, { columns: cols })
  }
  const removeColumn = (pi: number, ci: number) => {
    updatePreset(pi, { columns: list[pi]!.columns.filter((_, i) => i !== ci) })
  }
  const addColumn = (pi: number) => {
    const cols = list[pi]!.columns
    updatePreset(pi, { columns: [...cols, { id: randomId('col'), name: 'คอลัมน์ใหม่', color: 'sky', sortOrder: cols.length }] })
  }
  const addPreset = () => {
    setList([...list, { id: randomId('preset'), name: 'Preset ใหม่', columns: [{ id: 'todo', name: 'To do', color: 'slate', sortOrder: 0 }, { id: 'done', name: 'Done', color: 'emerald', sortOrder: 1 }] }])
    setSaved(false)
  }
  const removePreset = (pi: number) => {
    setList(list.filter((_, i) => i !== pi))
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const presets = list.map((p) => ({ ...p, name: p.name.trim(), columns: p.columns.map((c, i) => ({ ...c, name: c.name.trim(), sortOrder: i })) }))
      await api.put('/api/admin/board-presets', { presets })
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
      <div className="p-5 border-b border-border-subtle flex items-center gap-2">
        <LayoutGrid className="w-4 h-4 text-muted" />
        <div className="font-semibold text-ink">Preset สถานะ Sprint Board</div>
        <span className="text-xs text-muted">แต่ละ Sprint เลือกใช้ preset หนึ่งอันตอนสร้าง — แก้/เพิ่มเองได้</span>
      </div>

      <div className="p-5 space-y-5">
        {list.map((p, pi) => (
          <div key={p.id} className="border border-border-subtle rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <input
                value={p.name}
                onChange={(e) => updatePreset(pi, { name: e.target.value })}
                maxLength={60}
                className="flex-1 text-sm font-semibold bg-white border border-border rounded-lg px-3 py-1.5 focus:outline-hidden focus:border-brand-400"
              />
              <button type="button" onClick={() => removePreset(pi)} title="ลบ preset" className="text-muted hover:text-danger-600">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 pl-2">
              {p.columns.map((col, ci) => (
                <ColumnRow
                  key={col.id}
                  col={col}
                  onChange={(patch) => updateColumn(pi, ci, patch)}
                  onMove={(dir) => moveColumn(pi, ci, dir)}
                  onRemove={() => removeColumn(pi, ci)}
                  canMoveUp={ci > 0}
                  canMoveDown={ci < p.columns.length - 1}
                  colorOpen={colorOpen === `${pi}:${ci}`}
                  onToggleColor={() => setColorOpen(colorOpen === `${pi}:${ci}` ? null : `${pi}:${ci}`)}
                />
              ))}
              <button type="button" onClick={() => addColumn(pi)} className="flex items-center gap-1.5 text-xs text-brand-700 hover:text-brand-800 pt-1">
                <Plus className="w-3.5 h-3.5" /> เพิ่มคอลัมน์
              </button>
            </div>
          </div>
        ))}

        <button type="button" onClick={addPreset} className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800">
          <Plus className="w-4 h-4" /> เพิ่ม Preset
        </button>

        {error && <div className="text-xs text-danger-600">{error}</div>}

        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => void save()} disabled={saving} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
            {saving ? 'กำลังบันทึก…' : 'บันทึก Preset'}
          </button>
          {saved && <span className="text-xs text-success-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> บันทึกแล้ว</span>}
        </div>
      </div>
    </div>
  )
}
