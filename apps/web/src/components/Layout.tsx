import {
  Briefcase,
  ChevronDown,
  ClipboardList,
  Folder,
  FolderKanban,
  Handshake,
  History,
  IdCard,
  Layers,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  NotebookText,
  Settings,
  UserCheck,
  Users,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { api } from '../lib/api'
import { useAuth, type Me, type MenuKey } from '../lib/auth'
import { NotificationsProvider } from '../lib/notifications-context'
import { TimerProvider, useTimer } from '../lib/timer'
import { TopbarContext } from '../lib/topbar'
import { NotificationBell } from './NotificationBell'
import { QuickAddModal } from './QuickAdd'
import { Topbar } from './Topbar'

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

// Pronista §Team Chat/Meeting (2026-08-27) — เมนู "ทีม" นับเฉพาะแจ้งเตือนแชท/ประชุม ส่วนที่เหลือ (task/daily report/expiry ฯลฯ) ยังนับที่ "งานของฉัน" เหมือนเดิม กันนับซ้ำ
const TEAM_NOTIFICATION_TYPES = ['chat_mention', 'chat_message', 'meeting_scheduled'] as const
const MY_TASKS_EXCLUDED_TYPES = new Set<string>(TEAM_NOTIFICATION_TYPES)

// Pronista §System Requirements Update — menu ที่ไม่มี key = คุมด้วย role อย่างเดียว (owner-only, ไม่ผ่านเพดานเมนูของ ตั้งค่าสิทธิ์ผู้ใช้งาน)
// Pronista §Menu Restructure (2026-08-28) — children.roles (ไม่บังคับ) = ซ่อน sub-menu ข้อนั้นเพิ่มเติมจาก role ที่ parent อนุญาตไว้แล้ว (ใช้กับ "ไฟล์ของฉัน"/"แชร์กับฉัน" ที่ไม่ให้ guest เห็น ทั้งที่ parent "งานของฉัน" guest เข้าได้)
const NAV: { to: string; label: string; icon: typeof LayoutDashboard; roles: Role[]; menuKey?: MenuKey; children?: { to: string; label: string; roles?: Role[] }[] }[] = [
  { to: '/', label: 'ภาพรวม', icon: LayoutDashboard, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'dashboard' },
  {
    to: '/my-tasks',
    label: 'งานของฉัน',
    icon: ClipboardList,
    roles: ['owner', 'member', 'vendor', 'guest'],
    menuKey: 'myTasks',
    children: [
      { to: '/my-tasks', label: 'งานของฉัน' },
      { to: '/my-tasks/dispatched', label: 'งานที่จ่ายให้คนอื่น' },
      { to: '/my-tasks/daily-report', label: 'Daily Report' },
      { to: '/my-tasks/notes', label: 'My Note' },
      { to: '/my-tasks/meetings', label: 'การประชุม' },
    ],
  },
  // Pronista §Menu Restructure (2026-09-02) — แยก "ไฟล์ของฉัน" ออกจาก "งานของฉัน" เป็นเมนูหลักของตัวเอง "แชร์กับฉัน" ย้ายมาเป็นเมนูย่อยของมันแทน (เดิมเป็นพี่น้องกันใต้งานของฉัน)
  // owner/member/vendor เท่านั้น (ไม่รวม guest — ตกลงกับพี่แบงค์แล้ว)
  {
    to: '/my-tasks/files',
    label: 'ไฟล์ของฉัน',
    icon: Folder,
    roles: ['owner', 'member', 'vendor'],
    menuKey: 'myFiles',
    children: [
      { to: '/my-tasks/files', label: 'ไฟล์ของฉัน' },
      { to: '/my-tasks/shared-files', label: 'แชร์กับฉัน' },
    ],
  },
  // Pronista §Workspace — Sprint/Backlog รวมทุกโปรเจกต์ (สิทธิ์เห็นเนื้อหาจริงคุมด้วย tabs.sprint ต่อโปรเจกต์อยู่แล้ว เหมือนแท็บ Sprint เดิม)
  { to: '/workspace', label: 'Workspace', icon: Layers, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'workspace' },
  { to: '/projects', label: 'โปรเจกต์', icon: FolderKanban, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'projects' },
  { to: '/team', label: 'ทีม', icon: MessageSquare, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'team' },
  { to: '/docs', label: 'เอกสาร', icon: NotebookText, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'docs' },
  { to: '/docs/history', label: 'ประวัติเอกสาร', icon: History, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'docsHistory' },
  // Pronista §Menu Restructure (2026-09-02) — เมนูหลักใหม่ "บริการ" ย้าย "จัดการโดเมน" มาจากใต้ "ตั้งค่า" (ยัง owner-only ไม่มี menuKey เหมือนเดิม — เป็นข้อมูลโครงสร้างพื้นฐานบริษัท ไม่ผ่านเพดานเมนู)
  {
    to: '/admin/domains',
    label: 'บริการ',
    icon: Briefcase,
    roles: ['owner'],
    children: [{ to: '/admin/domains', label: 'จัดการโดเมน' }],
  },
  // Pronista §System Requirements Update — "ตั้งค่า" เป็นเมนูแม่ มี sub-menu ในไซด์บาร์เลย (ยกออกจาก tab bar เดิมบนหน้า /admin*)
  {
    to: '/admin',
    label: 'ตั้งค่า',
    icon: Settings,
    roles: ['owner'],
    children: [
      { to: '/admin', label: 'ตั้งค่าทั่วไป' },
      { to: '/admin/permissions', label: 'ตั้งค่าสิทธิ์ผู้ใช้งาน' },
      { to: '/admin/notifications', label: 'ตั้งค่าการแจ้งเตือน' },
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
    <div className="p-3 border-b border-border-subtle">
      <select
        aria-label="dev: สลับผู้ใช้"
        className="w-full text-[11px] text-muted bg-hover rounded-lg px-2 py-1.5"
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

  // Pronista §Navbar (2026-08-27) — ชื่อบน Topbar: หน้าไหนเรียก <PageHeader> ก็ใช้ของหน้านั้น ไม่งั้น fallback เป็นชื่อเมนูตาม path
  const [pageTitle, setPageTitle] = useState<string | null>(null)
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null)
  const setTitle = useCallback((t: string | null) => setPageTitle(t), [])
  const topbarTitle = pageTitle ?? NAV.find((n) => n.to === activeTo)?.label ?? 'Pronista'
  const topbarValue = useMemo(() => ({ setTitle, actionSlot }), [setTitle, actionSlot])

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
      {/* Pronista §Navbar enrichment (2026-08-27) — บัญชีผู้ใช้ย้ายไปอยู่ที่ TopbarProfile (มุมขวาบน) แทนแล้ว ไม่ซ้ำซ้อนกับตรงนี้อีก */}
      <DevSwitcher me={user} />
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
                {to === '/my-tasks' && <NotificationBell excludeTypes={MY_TASKS_EXCLUDED_TYPES} />}
                {to === '/team' && <NotificationBell types={TEAM_NOTIFICATION_TYPES} />}
                {children && <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
              </NavLink>
              {children && isOpen && (
                <div className="ml-[27px] mt-0.5 mb-0.5 space-y-0.5 border-l border-border-subtle pl-3">
                  {children.filter((c) => !c.roles || (user && c.roles.includes(user.role))).map((c) => (
                    <NavLink
                      key={c.to}
                      to={c.to}
                      end={c.to === '/admin' || c.to === '/members' || c.to === '/my-tasks' || c.to === '/my-tasks/files' || c.to === '/admin/domains'}
                      onClick={() => setNavOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center px-2.5 py-1.5 rounded-lg cursor-pointer ${
                          isActive ? 'bg-brand-50 text-brand-700 font-medium' : 'text-soft hover:bg-hover'
                        }`
                      }
                    >
                      {c.label}
                      {/* Pronista §My Note badge (2026-09-01) — แจ้งเตือนตรงหลังเมนู My Note เมื่อมีคนแชร์ Note มาใหม่ */}
                      {c.to === '/my-tasks/notes' && <NotificationBell types={['note_shared']} />}
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
    <NotificationsProvider>
    <TimerProvider>
      <TopbarContext.Provider value={topbarValue}>
      <div className="flex h-dvh overflow-hidden">
        {navOpen && (
          <div
            onClick={() => setNavOpen(false)}
            className="fixed inset-0 bg-ink/40 z-30 lg:hidden"
          />
        )}
        {sidebar}
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar title={topbarTitle} onOpenNav={() => setNavOpen(true)} actionSlotRef={setActionSlot} />
          <CapBanner />
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
        {quickAddOpen && <QuickAddModal onClose={() => setQuickAddOpen(false)} />}
      </div>
      </TopbarContext.Provider>
    </TimerProvider>
    </NotificationsProvider>
  )
}
