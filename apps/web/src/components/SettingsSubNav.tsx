/** Pronista §System Requirements Update — สับเมนูย่อยของ "ตั้งค่า" (ตั้งค่าทั่วไป / ตั้งค่าผู้ใช้งาน / ตั้งค่าสิทธิ์ผู้ใช้งาน) ตามแผนผังที่ owner วาดไว้ */
import { Link, useLocation } from 'react-router'

const ITEMS = [
  { to: '/admin', label: 'ตั้งค่าทั่วไป' },
  { to: '/admin/users', label: 'ตั้งค่าผู้ใช้งาน' },
  { to: '/admin/permissions', label: 'ตั้งค่าสิทธิ์ผู้ใช้งาน' },
  { to: '/admin/cost', label: 'กำหนดต้นทุน' },
] as const

export function SettingsSubNav() {
  const { pathname } = useLocation()
  return (
    <div className="flex bg-divider rounded-lg p-0.5 w-fit mb-4 flex-wrap">
      {ITEMS.map((item) => {
        const active = item.to === '/admin' ? pathname === '/admin' : pathname.startsWith(item.to)
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`px-3 py-1.5 rounded-md whitespace-nowrap text-sm font-medium ${active ? 'bg-white shadow-xs text-ink' : 'text-dim hover:text-body'}`}
          >
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}
