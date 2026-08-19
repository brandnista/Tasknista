/**
 * ตั้งค่า → ตำแหน่งและสิทธิ์ (Pronista §Position-based permission) — owner เพิ่ม/ลบ/เรียง/ตั้งชื่อ + checkbox สิทธิ์ละเอียด
 * แต่ละตำแหน่งคุม 2 แกน: มองเห็นแท็บไหน (tabs) + เพิ่ม/แก้ไข/ลบ resource ไหนได้บ้าง (actions) — assign ต่อโปรเจกต์ที่หน้าแก้ไขโปรเจกต์
 * บันทึกทั้งลิสต์ทีเดียว (PUT) · ลบตำแหน่งที่ยังมีสมาชิกโปรเจกต์ใช้อยู่ไม่ได้ (server ตอบ 409)
 */
import {
  PERMISSION_RESOURCE_KEYS,
  PERMISSION_TAB_KEYS,
  type PermissionResourceKey,
  type PermissionTabKey,
  type Position,
} from '@seedoffice/core'
import { Check, ChevronDown, ChevronUp, ShieldCheck, Trash2, UserCog } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'

const randomId = () => `pos_${Math.random().toString(36).slice(2, 8)}`

const TAB_LABEL: Record<PermissionTabKey, string> = {
  sprint: 'Sprint',
  docs: 'เอกสาร',
  assets: 'ประวัติเอกสาร',
  releases: 'Version Release',
  changeLog: 'Change Log',
  backlogEpic: 'Backlog: Epic',
  backlogStory: 'Backlog: Story',
  backlogTask: 'Backlog: Task',
  backlogDefect: 'Backlog: Defect',
  backlogCr: 'Backlog: CR',
  backlogSummary: 'Backlog: ภาพรวมโครงสร้าง',
}

const RESOURCE_LABEL: Record<PermissionResourceKey, string> = {
  task: 'Task',
  doc: 'เอกสาร',
  sprint: 'Sprint',
  defect: 'Defect',
  cr: 'CR',
  release: 'Version Release',
  changeLog: 'Change Log',
}

const DENY_ALL_PERMISSIONS = (): Position['permissions'] => ({
  tabs: Object.fromEntries(PERMISSION_TAB_KEYS.map((k) => [k, false])) as Record<PermissionTabKey, boolean>,
  actions: Object.fromEntries(
    PERMISSION_RESOURCE_KEYS.map((k) => [k, { create: false, edit: false, delete: false }]),
  ) as Position['permissions']['actions'],
})

function PositionCard({
  position, onChange, onMove, onRemove, canMoveUp, canMoveDown,
}: {
  position: Position
  onChange: (patch: Partial<Position>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  canMoveUp: boolean
  canMoveDown: boolean
}) {
  const toggleTab = (k: PermissionTabKey) =>
    onChange({ permissions: { ...position.permissions, tabs: { ...position.permissions.tabs, [k]: !position.permissions.tabs[k] } } })
  const toggleAction = (k: PermissionResourceKey, action: 'create' | 'edit' | 'delete') =>
    onChange({
      permissions: {
        ...position.permissions,
        actions: { ...position.permissions.actions, [k]: { ...position.permissions.actions[k], [action]: !position.permissions.actions[k][action] } },
      },
    })

  return (
    <div className="border border-border-subtle rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex flex-col">
          <button type="button" onClick={() => onMove(-1)} disabled={!canMoveUp} className="text-muted hover:text-body disabled:opacity-30">
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={!canMoveDown} className="text-muted hover:text-body disabled:opacity-30">
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
        <input
          value={position.name}
          onChange={(e) => onChange({ name: e.target.value })}
          maxLength={60}
          className="flex-1 text-sm font-semibold bg-white border border-border rounded-lg px-3 py-1.5 focus:outline-hidden focus:border-brand-400"
        />
        <button type="button" onClick={onRemove} title="ลบตำแหน่ง" className="text-muted hover:text-danger-600">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-1">
        <div>
          <div className="text-xs font-medium text-dim mb-1.5">มองเห็นแท็บ</div>
          <div className="space-y-1">
            {PERMISSION_TAB_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm text-body cursor-pointer">
                <input type="checkbox" checked={position.permissions.tabs[k]} onChange={() => toggleTab(k)} className="rounded" />
                {TAB_LABEL[k]}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-dim mb-1.5">สิทธิ์การทำงาน</div>
          <table className="text-sm w-full">
            <thead>
              <tr className="text-xs text-muted">
                <th className="text-left font-medium"></th>
                <th className="text-center font-medium px-1.5">เพิ่ม</th>
                <th className="text-center font-medium px-1.5">แก้ไข</th>
                <th className="text-center font-medium px-1.5">ลบ</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSION_RESOURCE_KEYS.map((k) => (
                <tr key={k}>
                  <td className="text-body py-0.5">{RESOURCE_LABEL[k]}</td>
                  {(['create', 'edit', 'delete'] as const).map((action) => (
                    <td key={action} className="text-center">
                      <input
                        type="checkbox"
                        checked={position.permissions.actions[k][action]}
                        onChange={() => toggleAction(k, action)}
                        className="rounded"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export function PositionSettings() {
  const { data, reload } = useLoad<{ positions: Position[] }>(() => api.get('/api/admin/positions'))
  const [list, setList] = useState<Position[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) setList(data.positions)
  }, [data])

  if (!list) return null

  const update = (i: number, patch: Partial<Position>) => {
    setList(list.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
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
    setList([...list, { id: randomId(), name: 'ตำแหน่งใหม่', sortOrder: list.length, permissions: DENY_ALL_PERMISSIONS() }])
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const positions = list.map((p, i) => ({ ...p, name: p.name.trim(), sortOrder: i }))
      await api.put('/api/admin/positions', { positions })
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
        <div className="font-semibold text-ink">ตำแหน่งและสิทธิ์</div>
        <span className="text-xs text-muted">กำหนดตำแหน่ง (BA/PM/ฯลฯ) แล้ว assign ต่อโปรเจกต์ได้ที่หน้าแก้ไขโปรเจกต์</span>
      </div>

      <div className="p-5 space-y-4">
        {list.map((p, i) => (
          <PositionCard
            key={p.id}
            position={p}
            onChange={(patch) => update(i, patch)}
            onMove={(dir) => move(i, dir)}
            onRemove={() => remove(i)}
            canMoveUp={i > 0}
            canMoveDown={i < list.length - 1}
          />
        ))}

        <button type="button" onClick={add} className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800">
          <ShieldCheck className="w-4 h-4" /> เพิ่มตำแหน่ง
        </button>

        {error && <div className="text-xs text-danger-600">{error}</div>}

        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => void save()} disabled={saving} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
            {saving ? 'กำลังบันทึก…' : 'บันทึกตำแหน่ง'}
          </button>
          {saved && <span className="text-xs text-success-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> บันทึกแล้ว</span>}
        </div>
      </div>
    </div>
  )
}
