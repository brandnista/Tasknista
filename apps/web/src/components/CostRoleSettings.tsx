/**
 * Pronista §กำหนดต้นทุน — จับคู่ตำแหน่ง (เลือกจาก Parameter Role ที่ "ตั้งค่าทั่วไป") กับต้นทุน/วัน ใช้ใน Tab "Project Estimate"
 * แยกจากพนักงานจริงโดยเจตนา — PM เลือก Role ต่อ Task เอง (คนเดียวกันรับ Role ต่างกันคนละ Task ได้)
 * บันทึกทั้งลิสต์ทีเดียว (PUT) เหมือน ServiceType/ProductType/TaskType — server เช็คตำแหน่งซ้ำ/ยังไม่เลือกให้แล้ว
 */
import type { CostRole, ParameterRole } from '@seedoffice/core'
import { Briefcase, Check, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'

export function CostRoleSettings() {
  const { data, reload } = useLoad<{ costRoles: CostRole[] }>(() => api.get('/api/admin/config'))
  const { data: rolesData } = useLoad<{ parameterRoles: ParameterRole[] }>(() => api.get('/api/admin/parameter-roles'))
  const [list, setList] = useState<CostRole[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) setList(data.costRoles)
  }, [data])

  const roles = rolesData?.parameterRoles ?? []
  const roleName = (roleId: string) => roles.find((r) => r.id === roleId)?.name ?? '(ตำแหน่งถูกลบไปแล้ว)'

  if (!list) return null

  const setRoleId = (i: number, roleId: string) => {
    setList(list.map((r, idx) => (idx === i ? { ...r, roleId } : r)))
    setSaved(false)
  }
  const setCostPerDay = (i: number, baht: string) => {
    const satang = baht.trim() ? Math.round(Number(baht) * 100) : 0
    setList(list.map((r, idx) => (idx === i ? { ...r, costPerDaySatang: satang } : r)))
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
    setList([...list, { roleId: '', costPerDaySatang: 0, sortOrder: list.length }])
    setSaved(false)
  }

  const save = async () => {
    if (list.some((r) => !r.roleId)) {
      setError('ต้องเลือกตำแหน่งให้ครบทุกแถวก่อนบันทึก')
      return
    }
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const costRoles = list.map((r, i) => ({ ...r, sortOrder: i }))
      await api.put('/api/admin/cost-roles', { costRoles })
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
        <Briefcase className="w-4 h-4 text-muted" />
        <div className="font-semibold text-ink">ตำแหน่ง (ต้นทุน)</div>
        <span className="text-xs text-muted">PM เลือกตำแหน่งนี้ต่อ Task ใน Project Estimate — ต้นทุน/วันดึงจากที่นี่</span>
      </div>

      <div className="p-5 space-y-2">
        {roles.length === 0 && (
          <div className="text-sm text-muted py-4 text-center">
            ยังไม่มี Parameter Role — ไปเพิ่มที่หน้า "ตั้งค่าทั่วไป" ก่อน
          </div>
        )}
        {roles.length > 0 && list.length === 0 && <div className="text-sm text-muted py-4 text-center">ยังไม่มีตำแหน่ง — กด "เพิ่มตำแหน่ง"</div>}
        {list.map((r, i) => {
          const usedElsewhere = new Set(list.filter((_, idx) => idx !== i).map((x) => x.roleId))
          const options = roles.filter((role) => role.id === r.roleId || !usedElsewhere.has(role.id))
          return (
            <div key={i} className="flex items-center gap-2 border border-border-subtle rounded-lg p-2.5">
              <div className="flex flex-col">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-muted hover:text-body disabled:opacity-30">
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} className="text-muted hover:text-body disabled:opacity-30">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              <select
                value={r.roleId}
                onChange={(e) => setRoleId(i, e.target.value)}
                className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-1.5 focus:outline-hidden focus:border-brand-400"
              >
                <option value="">— เลือกตำแหน่ง —</option>
                {options.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
                {r.roleId && !roles.some((role) => role.id === r.roleId) && <option value={r.roleId}>{roleName(r.roleId)}</option>}
              </select>
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={r.costPerDaySatang / 100}
                  onChange={(e) => setCostPerDay(i, e.target.value)}
                  className="w-24 text-sm bg-white border border-border rounded-lg px-2.5 py-1.5 text-right tabular-nums focus:outline-hidden focus:border-brand-400"
                />
                <span className="text-xs text-muted">฿/วัน</span>
              </div>
              <button type="button" onClick={() => remove(i)} title="ลบตำแหน่ง" className="text-muted hover:text-danger-600">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )
        })}

        <button
          type="button"
          onClick={add}
          disabled={roles.length === 0}
          className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800 pt-1 disabled:opacity-40 disabled:hover:text-brand-700"
        >
          <Briefcase className="w-4 h-4" /> เพิ่มตำแหน่ง
        </button>

        {error && <div className="text-xs text-danger-600">{error}</div>}

        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => void save()} disabled={saving} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
            {saving ? 'กำลังบันทึก…' : 'บันทึกตำแหน่ง'}
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
