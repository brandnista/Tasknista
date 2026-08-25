/**
 * ตั้งค่าผู้ใช้งาน → เพดานสิทธิ์ (Pronista §System Requirements Update) — ระบบสิทธิ์ 2 ชั้น
 * ชั้นที่ 1 = ตำแหน่งที่ assign (พนักงานในระบบเท่านั้น) · ชั้นที่ 2 = เพดานนี้ ครอบทับอีกที (AND กัน จำกัดได้อย่างเดียว)
 * พนักงาน Outsource/ลูกค้า ไม่มีตำแหน่งของตัวเอง — เพดานของ 2 หมวดนี้ = สิทธิ์จริงที่ใช้กำหนด "มองเห็นเมนู/แท็บ" ไหนบ้าง (การเขียนข้อมูลยังถูกกันไว้อีกชั้นเสมอ)
 */
import {
  PERMISSION_CATEGORIES,
  PERMISSION_CATEGORY_LABEL,
  PERMISSION_MENU_KEYS,
  PERMISSION_MENU_LABEL,
  PERMISSION_RESOURCE_KEYS,
  PERMISSION_TAB_KEYS,
  type CeilingPermissions,
  type PermissionCategory,
  type PermissionMenuKey,
  type PermissionResourceKey,
  type PermissionTabKey,
} from '@seedoffice/core'
import { Check, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'

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
  task: 'Task', doc: 'เอกสาร', sprint: 'Sprint', defect: 'Defect', cr: 'CR', release: 'Version Release', changeLog: 'Change Log',
}
const CATEGORY_DESC: Record<PermissionCategory, string> = {
  staff: 'ครอบสิทธิ์ตำแหน่งอีกชั้น (position × เพดานนี้) — ตำแหน่งเปิดได้เท่าที่เพดานอนุญาต',
  outsource: 'ไม่มีตำแหน่งของตัวเอง — เพดานนี้คือสิทธิ์จริงที่ใช้ (คุมเมนู/แท็บที่มองเห็นเป็นหลัก)',
  customer: 'ไม่มีตำแหน่งของตัวเอง — เพดานนี้คือสิทธิ์จริงที่ใช้ (คุมเมนู/แท็บที่มองเห็นเป็นหลัก)',
}
// Pronista §Menu Restructure — แยกกลุ่มเมนู "จัดการข้อมูล" (พนักงาน/พาร์ทเนอร์/ลูกค้า/สมาชิก) ออกจากเมนูใช้งานทั่วไป ให้เห็นชัดเจน ไม่ปนกันเป็นแถวเดียว
const ADMIN_MENU_KEYS: PermissionMenuKey[] = ['employees', 'partners', 'customers', 'members']
const GENERAL_MENU_KEYS = PERMISSION_MENU_KEYS.filter((k) => !ADMIN_MENU_KEYS.includes(k))

function CeilingCard({ category, permissions, onChange }: { category: PermissionCategory; permissions: CeilingPermissions; onChange: (p: CeilingPermissions) => void }) {
  const toggleMenu = (k: PermissionMenuKey) => onChange({ ...permissions, menus: { ...permissions.menus, [k]: !permissions.menus[k] } })
  const toggleTab = (k: PermissionTabKey) => onChange({ ...permissions, tabs: { ...permissions.tabs, [k]: !permissions.tabs[k] } })
  const toggleAction = (k: PermissionResourceKey, action: 'create' | 'edit' | 'delete') =>
    onChange({ ...permissions, actions: { ...permissions.actions, [k]: { ...permissions.actions[k], [action]: !permissions.actions[k][action] } } })

  return (
    <div className="border border-border-subtle rounded-lg p-4">
      <div className="font-semibold text-sm text-ink mb-0.5">{PERMISSION_CATEGORY_LABEL[category]}</div>
      <div className="text-[11px] text-muted mb-3">{CATEGORY_DESC[category]}</div>
      <div className="mb-3">
        <div className="text-xs font-medium text-dim mb-1.5">มองเห็นเมนูหลัก (sidebar)</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {GENERAL_MENU_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm text-body cursor-pointer">
              <input type="checkbox" checked={permissions.menus[k]} onChange={() => toggleMenu(k)} className="rounded" />
              {PERMISSION_MENU_LABEL[k]}
            </label>
          ))}
        </div>
      </div>
      <div className="mb-4">
        <div className="text-xs font-medium text-dim mb-1.5">เมนูจัดการข้อมูล (พนักงาน/พาร์ทเนอร์/ลูกค้า/สมาชิก)</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {ADMIN_MENU_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm text-body cursor-pointer">
              <input type="checkbox" checked={permissions.menus[k]} onChange={() => toggleMenu(k)} className="rounded" />
              {PERMISSION_MENU_LABEL[k]}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-1">
        <div>
          <div className="text-xs font-medium text-dim mb-1.5">มองเห็นแท็บ (ในหน้าโปรเจกต์)</div>
          <div className="space-y-1">
            {PERMISSION_TAB_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm text-body cursor-pointer">
                <input type="checkbox" checked={permissions.tabs[k]} onChange={() => toggleTab(k)} className="rounded" />
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
                      <input type="checkbox" checked={permissions.actions[k][action]} onChange={() => toggleAction(k, action)} className="rounded" />
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

export function PermissionCeilingSettings() {
  const { data, reload } = useLoad<{ ceilings: Record<PermissionCategory, CeilingPermissions> }>(() => api.get('/api/admin/permission-ceilings'))
  const [ceilings, setCeilings] = useState<Record<PermissionCategory, CeilingPermissions> | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) setCeilings(data.ceilings)
  }, [data])

  if (!ceilings) return null

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await api.put('/api/admin/permission-ceilings', { ceilings })
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
        <ShieldAlert className="w-4 h-4 text-muted" />
        <div className="font-semibold text-ink">เพดานสิทธิ์ต่อประเภทผู้ใช้งาน</div>
        <span className="text-xs text-muted">กำหนดเพดานสูงสุดที่แต่ละหมวดผู้ใช้งานทำได้ในทุกโปรเจกต์ — ตำแหน่งของพนักงานในระบบต้องอยู่ใต้เพดานนี้เสมอ</span>
      </div>
      <div className="p-5 space-y-4">
        {PERMISSION_CATEGORIES.map((cat) => (
          <CeilingCard
            key={cat}
            category={cat}
            permissions={ceilings[cat]}
            onChange={(p) => { setCeilings({ ...ceilings, [cat]: p }); setSaved(false) }}
          />
        ))}

        {error && <div className="text-xs text-danger-600">{error}</div>}

        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => void save()} disabled={saving} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
            {saving ? 'กำลังบันทึก…' : 'บันทึกเพดานสิทธิ์'}
          </button>
          {saved && <span className="text-xs text-success-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> บันทึกแล้ว</span>}
        </div>
      </div>
    </div>
  )
}
