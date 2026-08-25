import {
  ChevronDown,
  ClipboardList,
  FolderKanban,
  Handshake,
  History,
  IdCard,
  Layers,
  LayoutDashboard,
  ListChecks,
  Menu,
  NotebookText,
  Settings,
  UserCheck,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { api } from '../lib/api'
import { useAuth, type Me, type MenuKey } from '../lib/auth'
import { ROLE_LABEL } from '../lib/role-label'
import { TimerProvider, useTimer } from '../lib/timer'
import { Avatar } from './Avatar'
import { useDialog } from './Dialog'
import { NotificationBell } from './NotificationBell'
import { QuickAddModal } from './QuickAdd'

/** banner เตือนชนเพดานชั่วโมง (SPEC §4.5 — เตือนบนเว็บ) */
function CapBanner() {
  const { capMessage, dismissCap } = useTimer()
  if (!capMessage) return null
  return (
    <div className="bg-warning-50 border-b border-warning-200 text-warning-800 text-sm px-4 py-2.5 flex items-center gap-2">
      <span className="flex-1">⏰ {capMessage}</span>
      <button onClick={dismissCap} className="p-1 rounded hover:bg-warning-100" aria-label="ปิดการแจ้งเตือน">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

type Role = Me['role']

// Pronista §System Requirements Update — menu ที่ไม่มี key = คุมด้วย role อย่างเดียว (owner-only, ไม่ผ่านเพดานเมนูของ ตั้งค่าสิทธิ์ผู้ใช้งาน)
const NAV: { to: string; label: string; icon: typeof LayoutDashboard; roles: Role[]; menuKey?: MenuKey; children?: { to: string; label: string }[] }[] = [
  { to: '/', label: 'ภาพรวม', icon: LayoutDashboard, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'dashboard' },
  { to: '/my-tasks', label: 'งานของฉัน', icon: ClipboardList, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'myTasks' },
  // Pronista §Workspace — Sprint/Backlog รวมทุกโปรเจกต์ (สิทธิ์เห็นเนื้อหาจริงคุมด้วย tabs.sprint ต่อโปรเจกต์อยู่แล้ว เหมือนแท็บ Sprint เดิม)
  { to: '/workspace', label: 'Workspace', icon: Layers, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'workspace' },
  { to: '/projects', label: 'โปรเจกต์', icon: FolderKanban, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'projects' },
  { to: '/docs', label: 'เอกสาร', icon: NotebookText, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'docs' },
  { to: '/docs/history', label: 'ประวัติเอกสาร', icon: History, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'docsHistory' },
  // Pronista §System Requirements Update — "ตั้งค่า" เป็นเมนูแม่ มี sub-menu ในไซด์บาร์เลย (ยกออกจาก tab bar เดิมบนหน้า /admin*)
  {
    to: '/admin',
    label: 'ตั้งค่า',
    icon: Settings,
    roles: ['owner'],
    children: [
      { to: '/admin', label: 'ตั้งค่าทั่วไป' },
      { to: '/admin/permissions', label: 'ตั้งค่าสิทธิ์ผู้ใช้งาน' },
      { to: '/admin/cost', label: 'กำหนดต้นทุน' },
    ],
  },
  // Pronista §Menu Restructure — แยกออกจาก "ตั้งค่าผู้ใช้งาน" เดิม (เคยเป็น 3 แท็บในหน้าเดียว) เป็นเมนูหลักคนละอันตามสเปก
  // เดิม owner-only แบบ hardcode — ตอนนี้คุมผ่านเพดานสิทธิ์ต่อประเภทผู้ใช้งานได้แล้ว (default ปิดหมด ต้องเปิดเองที่ "ตั้งค่าสิทธิ์ผู้ใช้งาน")
  { to: '/employees', label: 'จัดการพนักงาน', icon: Users, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'employees' },
  { to: '/partners', label: 'จัดการพาร์ทเนอร์', icon: Handshake, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'partners' },
  { to: '/customers', label: 'จัดการลูกค้า', icon: UserCheck, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'customers' },
  {
    to: '/members',
    label: 'จัดการสมาชิก',
    icon: IdCard,
    roles: ['owner', 'member', 'vendor', 'guest'],
    menuKey: 'members',
    children: [
      { to: '/members', label: 'สมาชิกทั้งหมด' },
      { to: '/members/orders', label: 'รายการสั่งซื้อ' },
      { to: '/members/payments', label: 'รายการชำระเงิน' },
      { to: '/members/settings', label: 'ตั้งค่า' },
    ],
  },
]

interface DevInfo {
  enabled: boolean
  users: { email: string; name: string; role: Role }[]
}

/** ตัวสลับ user เฉพาะ dev (DEV_AUTH=1) — ไว้เช็ค permission แต่ละ role เหมือน role switcher ใน mockup */
function DevSwitcher({ me }: { me: Me }) {
  const [info, setInfo] = useState<DevInfo | null>(null)
  const { refresh } = useAuth()
  useEffect(() => {
    api.get<DevInfo>('/api/auth/dev-info').then(setInfo).catch(() => setInfo(null))
  }, [])
  if (!info?.enabled) return null
  return (
    <select
      aria-label="dev: สลับผู้ใช้"
      className="w-full text-[11px] text-muted bg-hover rounded-lg px-2 py-1.5 mt-2"
      value={me.email}
      onChange={(e) => {
        void api
          .post('/api/auth/dev-login', { email: e.target.value })
          .then(() => refresh())
      }}
    >
      {info.users.map((u) => (
        <option key={u.email} value={u.email}>
          dev: {u.name} ({u.role})
        </option>
      ))}
    </select>
  )
}

/**
 * Sidebar Profile — trigger button + dropdown panel (avatar/ชื่อ/role, เมนูโปรไฟล์, ออกจากระบบ)
 * อ้างอิงดีไซน์ "sidebar-profile-1c" — ตัด section "สลับ Workspace" ออกตาม fallback ของสเปกเอง
 * (Pronista เป็น single-tenant ไม่มีแนวคิดหลาย workspace ต่อผู้ใช้ — สเปกข้อ 3 บอกไว้ว่า "มี workspace เดียว → ซ่อน section ทั้งบล็อก")
 */
function SidebarProfile({ user, closeMobileNav }: { user: Me; closeMobileNav: () => void }) {
  const { logout } = useAuth()
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // เปลี่ยนหน้า → ปิด panel อัตโนมัติ
  useEffect(() => setOpen(false), [location.pathname])

  const doLogout = async () => {
    setOpen(false)
    const ok = await confirmDialog({ title: 'ต้องการออกจากระบบใช่หรือไม่', confirmLabel: 'ออกจากระบบ', danger: true })
    if (!ok) return
    closeMobileNav()
    await logout()
    navigate('/login')
  }

  return (
    <div ref={rootRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="sidebar-profile-menu"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2.5 p-2.5 rounded-2xl border text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
          open ? 'bg-brand-50 border-brand-200' : 'bg-hover border-border-subtle hover:bg-brand-50 hover:border-brand-200'
        }`}
      >
        <Avatar name={user.name} avatarUrl={user.avatarUrl} className="w-[38px] h-[38px] text-base shrink-0" colorClass="bg-brand-100 text-brand-700" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-extrabold text-ink truncate" title={user.name}>
            {user.name}
          </span>
          <span className="block text-[11.5px] text-dim truncate" title={ROLE_LABEL[user.role]}>
            {ROLE_LABEL[user.role]}
          </span>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        // อยู่ใน flow ปกติ (push nav ด้านล่างลง) ไม่ใช่ popover ลอยทับ — ตามสเปก
        <div
          id="sidebar-profile-menu"
          role="menu"
          className="mt-1 p-2 bg-white border border-border-subtle rounded-2xl shadow-lg so-fade-in space-y-0.5"
        >
          <NavLink
            to="/profile"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              closeMobileNav()
            }}
            className="block px-2.5 py-2 rounded-xl text-[13.5px] text-body hover:bg-divider"
          >
            โปรไฟล์ของฉัน
          </NavLink>
          <div className="h-px bg-border-subtle my-1.5 mx-2" />
          <button
            type="button"
            role="menuitem"
            onClick={() => void doLogout()}
            className="w-full text-left px-2.5 py-2 rounded-xl text-[13.5px] font-semibold text-danger-600 hover:bg-danger-50"
          >
            ออกจากระบบ
          </button>
        </div>
      )}
    </div>
  )
}

export function Layout() {
  const { user } = useAuth()
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  // Pronista §System Requirements Update — sub-menu ของเมนูที่มี children (เช่น "ตั้งค่า") พับเก็บเป็นค่าเริ่มต้น กดที่เมนูแม่ถึงจะกาง
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const s = new Set<string>()
    for (const n of NAV) {
      if (n.children?.some((c) => location.pathname === c.to || (c.to !== '/admin' && location.pathname.startsWith(`${c.to}/`)))) s.add(n.to)
    }
    return s
  })
  const toggleGroup = (to: string) =>
    setOpenGroups((s) => {
      const next = new Set(s)
      if (next.has(to)) next.delete(to)
      else next.add(to)
      return next
    })
  // เปลี่ยนหน้าไปยัง route ที่อยู่ใต้เมนูแม่ตัวไหน (เช่น ลิงก์ตรงจากที่อื่นในแอป) ให้กาง sub-menu นั้นให้อัตโนมัติ
  useEffect(() => {
    const matches = NAV.filter((n) =>
      n.children?.some((c) => location.pathname === c.to || (c.to !== '/admin' && location.pathname.startsWith(`${c.to}/`))),
    )
    if (matches.length === 0) return
    setOpenGroups((s) => {
      const next = new Set(s)
      let changed = false
      for (const m of matches) {
        if (!next.has(m.to)) {
          next.add(m.to)
          changed = true
        }
      }
      return changed ? next : s
    })
  }, [location.pathname])

  // Quick Add (N) จากทุกหน้า — เช็คจาก e.code กันแป้นไทย (SPEC §9)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const typing =
        ['input', 'textarea', 'select'].includes((el?.tagName ?? '').toLowerCase()) ||
        !!el?.isContentEditable // กันชนกับ Tiptap editor (เอกสาร)
      if (e.code === 'KeyN' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setQuickAddOpen(true)
      }
      if (e.code === 'Escape') setQuickAddOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Pronista §System Requirements Update — ซ่อนเมนูตามเพดานสิทธิ์เมนูของหมวดผู้ใช้งาน (owner bypass เสมอ ไม่ผ่านเพดาน)
  const items = useMemo(
    () =>
      user
        ? NAV.filter((n) => n.roles.includes(user.role) && (!n.menuKey || user.role === 'owner' || user.menuVisibility[n.menuKey]))
        : [],
    [user],
  )
  // Pronista §nav highlight — เลือก NAV item ที่ to ตรง/ยาวที่สุด (เจาะจงที่สุด) เป็นตัวไฮไลต์เดียว กัน "/docs" ติดไฮไลต์พร้อม "/docs/history" เพราะ path ขึ้นต้นเหมือนกัน
  const activeTo = useMemo(() => {
    const path = location.pathname
    const matches = items.filter((n) => path === n.to || (n.to !== '/' && path.startsWith(`${n.to}/`)))
    if (matches.length === 0) return null
    return matches.reduce((a, b) => (b.to.length > a.to.length ? b : a)).to
  }, [location.pathname, items])

  if (!user) return null

  const sidebar = (
    <aside
      className={`fixed top-0 bottom-0 right-0 z-40 transition-transform duration-200 lg:static lg:translate-x-0 lg:z-auto w-52 shrink-0 bg-white shadow-xs flex flex-col ${
        navOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="h-16 flex items-center gap-2.5 px-5 border-b border-border-subtle">
        <NavLink to="/" onClick={() => setNavOpen(false)} className="flex items-center gap-2.5 rounded-lg -m-1 p-1 hover:bg-hover" title="ไปหน้าภาพรวม">
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-brand-500 to-brand-700 grid place-items-center text-white shadow-sm shrink-0">
            <ListChecks className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-ink leading-none">Pronista</div>
            <div className="text-[11px] text-muted mt-0.5">Project Management</div>
          </div>
        </NavLink>
        <button
          onClick={() => setNavOpen(false)}
          aria-label="ปิดเมนู"
          className="ml-auto lg:hidden p-2 rounded-lg text-muted hover:bg-divider"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      {/* บัญชีผู้ใช้ — ย้ายขึ้นมาไว้ต่อจากโลโก้ (จุดแรกที่เห็นหลัง login แทนที่จะจมอยู่ล่างสุด) */}
      <div className="p-3 border-b border-border-subtle">
        <SidebarProfile user={user} closeMobileNav={() => setNavOpen(false)} />
        <DevSwitcher me={user} />
      </div>
      <nav className="flex-1 p-3 space-y-0.5 text-sm">
        {items.map(({ to, label, icon: Icon, children }) => {
          const isOpen = !!children && openGroups.has(to)
          return (
            <div key={to}>
              <NavLink
                to={to}
                onClick={(e) => {
                  if (children) {
                    e.preventDefault()
                    toggleGroup(to)
                  } else {
                    setNavOpen(false)
                  }
                }}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer ${
                  to === activeTo
                    ? 'bg-brand-50 text-brand-700 [&_svg]:text-brand-600'
                    : 'text-soft hover:bg-hover'
                }`}
              >
                <Icon className="w-[18px] h-[18px]" /> {label}
                {to === '/my-tasks' && <NotificationBell />}
                {children && <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
              </NavLink>
              {children && isOpen && (
                <div className="ml-[27px] mt-0.5 mb-0.5 space-y-0.5 border-l border-border-subtle pl-3">
                  {children.map((c) => (
                    <NavLink
                      key={c.to}
                      to={c.to}
                      end={c.to === '/admin' || c.to === '/members'}
                      onClick={() => setNavOpen(false)}
                      className={({ isActive }) =>
                        `block px-2.5 py-1.5 rounded-lg cursor-pointer ${
                          isActive ? 'bg-brand-50 text-brand-700 font-medium' : 'text-soft hover:bg-hover'
                        }`
                      }
                    >
                      {c.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </aside>
  )

  return (
    <TimerProvider>
      <div className="flex h-dvh overflow-hidden">
        {navOpen && (
          <div
            onClick={() => setNavOpen(false)}
            className="fixed inset-0 bg-ink/40 z-30 lg:hidden"
          />
        )}
        {sidebar}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="lg:hidden h-12 bg-white border-b border-border-subtle flex items-center gap-2.5 px-4 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-linear-to-br from-brand-500 to-brand-700 grid place-items-center text-white shadow-sm">
              <ListChecks className="w-4 h-4" />
            </div>
            <div className="font-bold text-ink leading-none">Pronista</div>
            <button
              onClick={() => setNavOpen(true)}
              aria-label="เมนู"
              className="ml-auto -mr-1 p-2 rounded-lg text-dim hover:bg-divider"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
          <CapBanner />
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
        {quickAddOpen && <QuickAddModal onClose={() => setQuickAddOpen(false)} />}
      </div>
    </TimerProvider>
  )
}
