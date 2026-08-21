import {
  ChevronDown,
  ClipboardList,
  FolderKanban,
  History,
  Layers,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  NotebookText,
  Settings,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { api } from '../lib/api'
import { useAuth, type Me, type MenuKey } from '../lib/auth'
import { ROLE_LABEL } from '../lib/role-label'
import { TimerProvider, useTimer } from '../lib/timer'
import { Avatar } from './Avatar'
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
      { to: '/admin/users', label: 'ตั้งค่าผู้ใช้งาน' },
      { to: '/admin/permissions', label: 'ตั้งค่าสิทธิ์ผู้ใช้งาน' },
      { to: '/admin/cost', label: 'กำหนดต้นทุน' },
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

export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
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
        <div className="w-8 h-8 rounded-lg bg-linear-to-br from-brand-500 to-brand-700 grid place-items-center text-white shadow-sm">
          <ListChecks className="w-5 h-5" />
        </div>
        <div>
          <div className="font-bold text-ink leading-none">Pronista</div>
          <div className="text-[11px] text-muted mt-0.5">Project Management</div>
        </div>
        <button
          onClick={() => setNavOpen(false)}
          aria-label="ปิดเมนู"
          className="ml-auto lg:hidden p-2 rounded-lg text-muted hover:bg-divider"
        >
          <X className="w-5 h-5" />
        </button>
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
                      end={c.to === '/admin'}
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
      <div className="p-3 border-t border-border-subtle">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <NavLink
            to="/profile"
            onClick={() => setNavOpen(false)}
            title="โปรไฟล์"
            className="flex items-center gap-2.5 min-w-0 flex-1 -mx-1 px-1 py-0.5 rounded-lg hover:bg-hover"
          >
            <Avatar name={user.name} avatarUrl={user.avatarUrl} className="w-8 h-8 text-xs" colorClass="bg-brand-100 text-brand-700" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-strong truncate">{user.name}</div>
              <div className="text-[11px] text-muted truncate">{ROLE_LABEL[user.role]}</div>
            </div>
          </NavLink>
          <button
            onClick={() => {
              void logout().then(() => navigate('/login'))
            }}
            title="ออกจากระบบ"
            className="p-1.5 rounded-lg text-muted hover:bg-divider hover:text-soft"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
        <DevSwitcher me={user} />
      </div>
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
