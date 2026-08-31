import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../lib/auth'
import { ROLE_LABEL } from '../lib/role-label'
import { Avatar } from './Avatar'
import { useDialog } from './Dialog'

/**
 * Pronista §Navbar enrichment (2026-08-27) — ไอคอนโปรไฟล์ที่ Topbar (แทนที่ปุ่มเพิ่มงานด่วนที่ย้ายออกไปแล้ว)
 * เดิมมีโปรไฟล์เต็มรูปแบบอยู่แล้วที่หัวไซด์บาร์ (SidebarProfile) แต่บนมือถือไซด์บาร์ถูกซ่อนหลังปุ่มแฮมเบอร์เกอร์
 * อันนี้เป็นทางลัดกดถึงโปรไฟล์/ออกจากระบบได้จากทุกหน้าโดยไม่ต้องเปิดเมนู — พฤติกรรม dropdown เดียวกับ NotificationCenter/SidebarProfile
 */
export function TopbarProfile() {
  const { user, logout } = useAuth()
  const { confirmDialog } = useDialog()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  useEffect(() => setOpen(false), [location.pathname])

  const doLogout = async () => {
    setOpen(false)
    const ok = await confirmDialog({ title: 'ต้องการออกจากระบบใช่หรือไม่', confirmLabel: 'ออกจากระบบ', danger: true })
    if (!ok) return
    await logout()
    navigate('/login')
  }

  if (!user) return null

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={user.name}
        className={`w-9 h-9 grid place-items-center rounded-xl transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${open ? 'bg-brand-50' : 'hover:bg-hover'}`}
      >
        <Avatar name={user.name} avatarUrl={user.avatarUrl} className="w-7 h-7 text-xs" colorClass="bg-brand-100 text-brand-700" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 z-50 w-56 bg-white border border-border-subtle rounded-2xl shadow-lg so-fade-in p-2">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <Avatar name={user.name} avatarUrl={user.avatarUrl} className="w-9 h-9 text-sm shrink-0" colorClass="bg-brand-100 text-brand-700" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink truncate">{user.name}</span>
              <span className="block text-[11px] text-dim truncate">{ROLE_LABEL[user.role]}</span>
            </span>
          </div>
          <div className="h-px bg-border-subtle my-1.5 mx-2" />
          <NavLink to="/profile" role="menuitem" onClick={() => setOpen(false)} className="block px-2.5 py-2 rounded-xl text-[13.5px] text-body hover:bg-divider">
            โปรไฟล์ของฉัน
          </NavLink>
          <div className="h-px bg-border-subtle my-1.5 mx-2" />
          <button type="button" role="menuitem" onClick={() => void doLogout()} className="w-full text-left px-2.5 py-2 rounded-xl text-[13.5px] font-semibold text-danger-600 hover:bg-danger-50">
            ออกจากระบบ
          </button>
        </div>
      )}
    </div>
  )
}
