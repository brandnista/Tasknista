/**
 * Pronista §Position-based permission — owner assign ตำแหน่ง (BA/PM/ฯลฯ) ให้ member เป็นรายโปรเจกต์ (สิทธิ์มาจากตำแหน่งที่เลือกล้วนๆ)
 * Pronista §Member Management — เพิ่ม/ลบ vendor(outsource)/guest(ลูกค้า) เป็นสมาชิกโปรเจกต์ได้ด้วย (ไม่มีตำแหน่ง สิทธิ์มาจากเพดานหมวดตรงๆ) แยก state จาก member เพราะไม่มี positionId
 * Pronista §Project members — open to all roles (2026-09-15) — แยกออกมาจาก ProjectEdit.tsx เดิม (MembersSection) ให้ใช้ร่วมกันได้ทั้งตอนสร้าง+แก้ไขโปรเจกต์
 * เปลี่ยนกลุ่ม Admin จาก read-only display (เดิม owner เข้าถึงทุกโปรเจกต์เสมออยู่แล้ว จึงไม่ให้เลือก) → เป็น checkbox แบบเดียวกับ outsource/customers
 * เพราะ owner ไม่เคยอ่านสิทธิ์จาก project_members/positionId เลย (getProjectPermissions/getProjectRole bypass ก่อนถึงจุดนั้น) — แถวนี้จึงเป็นแค่ข้อมูล "แสดงผล" ล้วนๆ เลือกได้อย่างปลอดภัย
 * controlled component: แค่เก็บ assignments/extraMembers ที่เลือกไว้ใน state ของหน้าแม่ ไม่ยิง API เอง — ผู้เรียกตัดสินใจว่าจะ POST ทันที (สร้างโปรเจกต์) หรือ diff แล้วค่อย POST (แก้ไขโปรเจกต์)
 */
import { ROLE_LABEL } from '../lib/role-label'

export interface PickerUser { id: string; name: string; role: 'owner' | 'member' | 'vendor' | 'guest' }
export interface PositionOpt { id: string; name: string }

export function ProjectMembersPicker({
  users,
  assignments,
  extraMembers,
  positions,
  onChangePosition,
  onToggleExtra,
  // Pronista §Project members — open to all roles (2026-09-15) — ตอนสร้างโปรเจกต์ไม่มีการเลือกตำแหน่งรายคนแบบละเอียด (ทุกคนที่ติ๊กได้ "เข้าถึงเต็มรูปแบบ" เป็นค่าเริ่มต้นเหมือนเดิม ปรับละเอียดทีหลังผ่านหน้าแก้ไข)
  // teamMode="checkbox" ให้กลุ่ม "ทีมงาน (member)" ใช้ checkbox ผ่าน extraMembers เหมือนกลุ่มอื่นแทน select ตำแหน่ง (ค่าเริ่มต้น "select" = พฤติกรรมเดิมของหน้าแก้ไข)
  teamMode = 'select',
}: {
  users: PickerUser[]
  assignments: Record<string, string>
  extraMembers: Record<string, boolean>
  positions: PositionOpt[]
  onChangePosition: (userId: string, positionId: string) => void
  onToggleExtra: (userId: string, checked: boolean) => void
  teamMode?: 'select' | 'checkbox'
}) {
  // ตำแหน่ง (catalog) มีผลเฉพาะ role=member — owner/vendor/guest ไม่มีตำแหน่งของตัวเอง (สิทธิ์มาจาก bypass/เพดานหมวดโดยตรง)
  const admins = users.filter((u) => u.role === 'owner')
  const team = users.filter((u) => u.role === 'member')
  const outsource = users.filter((u) => u.role === 'vendor')
  const customers = users.filter((u) => u.role === 'guest')
  return (
    <div>
      <div className="text-[11px] font-medium text-muted mb-1.5">Admin (owner)</div>
      <div className="divide-y divide-divider mb-4">
        {admins.map((u) => (
          <label key={u.id} className="flex items-center gap-3 py-2.5 cursor-pointer">
            <span className="flex-1 text-sm text-body">{u.name}</span>
            <span className="text-xs text-muted">Admin · เข้าถึงเต็มรูปแบบทุกโปรเจกต์เสมอ (ติ๊กแค่ให้แสดงในรายชื่อสมาชิก)</span>
            <input type="checkbox" checked={extraMembers[u.id] ?? false} onChange={(e) => onToggleExtra(u.id, e.target.checked)} />
          </label>
        ))}
        {admins.length === 0 && <div className="text-sm text-muted py-3">ไม่มี Admin ในระบบ</div>}
      </div>

      <div className="text-[11px] font-medium text-muted mb-1.5 pt-3 border-t border-border-subtle">ทีมงาน (member)</div>
      <div className="divide-y divide-divider mb-4">
        {team.map((u) =>
          teamMode === 'checkbox' ? (
            <label key={u.id} className="flex items-center gap-3 py-2.5 cursor-pointer">
              <span className="flex-1 text-sm text-body">{u.name}</span>
              <span className="text-xs text-muted">เข้าถึงเต็มรูปแบบ (ปรับตำแหน่งละเอียดได้ทีหลังที่หน้าแก้ไข)</span>
              <input type="checkbox" checked={extraMembers[u.id] ?? false} onChange={(e) => onToggleExtra(u.id, e.target.checked)} />
            </label>
          ) : (
            <div key={u.id} className="flex items-center gap-3 py-2.5">
              <span className="flex-1 text-sm text-body">{u.name}</span>
              <select
                value={assignments[u.id] ?? ''}
                onChange={(e) => onChangePosition(u.id, e.target.value)}
                className="text-sm bg-white border border-border rounded-lg px-2.5 py-1.5"
              >
                <option value="">— ยังไม่ใช่สมาชิก — (เอาออก)</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          ),
        )}
        {team.length === 0 && <div className="text-sm text-muted py-3">ไม่มีพนักงาน (member) ในระบบ</div>}
      </div>

      <div className="text-[11px] font-medium text-muted mb-1.5 pt-3 border-t border-border-subtle">Outsource (vendor)</div>
      <div className="divide-y divide-divider mb-4">
        {outsource.map((u) => (
          <label key={u.id} className="flex items-center gap-3 py-2.5 cursor-pointer">
            <span className="flex-1 text-sm text-body">{u.name}</span>
            <span className="text-xs text-muted">{ROLE_LABEL[u.role]} · สิทธิ์ตามเพดาน outsource</span>
            <input type="checkbox" checked={extraMembers[u.id] ?? false} onChange={(e) => onToggleExtra(u.id, e.target.checked)} />
          </label>
        ))}
        {outsource.length === 0 && <div className="text-sm text-muted py-3">ไม่มี outsource ในระบบ</div>}
      </div>

      <div className="text-[11px] font-medium text-muted mb-1.5 pt-3 border-t border-border-subtle">ลูกค้า (guest)</div>
      <div className="divide-y divide-divider">
        {customers.map((u) => (
          <label key={u.id} className="flex items-center gap-3 py-2.5 cursor-pointer">
            <span className="flex-1 text-sm text-body">{u.name}</span>
            <span className="text-xs text-muted">{ROLE_LABEL[u.role]} · สิทธิ์ตามเพดานลูกค้า</span>
            <input type="checkbox" checked={extraMembers[u.id] ?? false} onChange={(e) => onToggleExtra(u.id, e.target.checked)} />
          </label>
        ))}
        {customers.length === 0 && <div className="text-sm text-muted py-3">ไม่มีลูกค้าในระบบ</div>}
      </div>
    </div>
  )
}
