import {
  Bell,
  BrainCircuit,
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
  Lock,
  MessageSquare,
  NotebookText,
  Pin,
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
// Pronista §Secret Vault Permission (2026-09-08) — เมนู "Secret Vault" นับแจ้งเตือนเข้าใช้งานแยกของตัวเอง ไม่ปนกับ "งานของฉัน"
const VAULT_NOTIFICATION_TYPES = ['vault_accessed'] as const
const MY_TASKS_EXCLUDED_TYPES = new Set<string>([...TEAM_NOTIFICATION_TYPES, ...VAULT_NOTIFICATION_TYPES])
// Pronista §Pin เมนู — ซ่อนปุ่ม pin/เลื่อนลำดับไว้ก่อน โผล่ตอน hover แถว (เมาส์) เท่านั้น
// อุปกรณ์ที่ไม่มี hover จริง (มือถือ/แตะ) ให้โชว์ค้างเสมอ เพราะแตะแล้วไม่มีทาง "hover ก่อนกด" ได้
const PIN_ROW_ACTION_VISIBILITY = 'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity'
// Pronista §Pin เมนู — เมนูย่อยที่ path ของตัวเองเป็น prefix ของ sibling อื่นในกลุ่มเดียวกัน (เช่น "/my-tasks" กับ "/my-tasks/dispatched") ต้อง end match เป๊ะ ไม่งั้นไฮไลต์เพี้ยน
const CHILD_EXACT_MATCH = new Set(['/', '/admin', '/members', '/my-tasks', '/my-tasks/files', '/admin/domains'])

// Pronista §System Requirements Update — menu ที่ไม่มี key = คุมด้วย role อย่างเดียว (owner-only, ไม่ผ่านเพดานเมนูของ ตั้งค่าสิทธิ์ผู้ใช้งาน)
// Pronista §Menu Restructure (2026-08-28) — children.roles (ไม่บังคับ) = ซ่อน sub-menu ข้อนั้นเพิ่มเติมจาก role ที่ parent อนุญาตไว้แล้ว (ใช้กับ "ไฟล์ของฉัน"/"แชร์กับฉัน" ที่ไม่ให้ guest เห็น ทั้งที่ parent "งานของฉัน" guest เข้าได้)
const NAV: { to: string; label: string; icon: typeof LayoutDashboard; roles: Role[]; menuKey?: MenuKey; children?: { to: string; label: string; roles?: Role[] }[] }[] = [
  {
    to: '/',
    label: 'ภาพรวม',
    icon: LayoutDashboard,
    roles: ['owner', 'member', 'vendor', 'guest'],
    menuKey: 'dashboard',
    // Pronista §Workload (Phase 2, 2026-09-04) — เมนูย่อย Workload owner-only (ภาพรวมภาระงานทีม) ใต้ "ภาพรวม" เดิม
    children: [
      { to: '/', label: 'ภาพรวม' },
      { to: '/workload', label: 'Workload', roles: ['owner'] },
    ],
  },
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
  // Pronista §System Enhancements — เมนูหลักแยกใหม่ "การแจ้งเตือน" (bell dropdown เดิมยังอยู่ที่ Topbar — หน้านี้ดูประวัติเต็ม+filter หมวดหมู่ได้)
  { to: '/notifications', label: 'การแจ้งเตือน', icon: Bell, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'notifications' },
  // Pronista §Menu Restructure (2026-09-02) — เมนูหลักใหม่ "บริการ" ย้าย "จัดการโดเมน" มาจากใต้ "ตั้งค่า" (ยัง owner-only ไม่มี menuKey เหมือนเดิม — เป็นข้อมูลโครงสร้างพื้นฐานบริษัท ไม่ผ่านเพดานเมนู)
  {
    to: '/admin/domains',
    label: 'บริการ',
    icon: Briefcase,
    roles: ['owner'],
    children: [
      { to: '/admin/domains', label: 'จัดการโดเมน' },
      // Pronista §System Enhancements — Sellnista: บริการ Subscription แยกระบบต่างหาก (ไม่ผูก productTypes ของ projects)
      { to: '/admin/sellnista', label: 'Sellnista' },
    ],
  },
  // Pronista §Secret Vault (2026-09-03, เปิดเพดานได้ 2026-09-08) — owner เห็นเสมอ หมวดอื่นเปิด/ปิดได้จาก "เพดานสิทธิ์" (default ปิด, ข้อมูลอ่อนไหว)
  { to: '/vault', label: 'Secret Vault', icon: Lock, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'vault' },
  // Pronista §Second Brain (2026-09-08) — ลิงก์ที่ดักจาก LINE group เฉพาะ ไม่ใช่ข้อมูลอ่อนไหวเหมือน vault — default เปิดให้ staff เห็นได้เลย
  { to: '/second-brain', label: 'Second Brain', icon: BrainCircuit, roles: ['owner', 'member', 'vendor', 'guest'], menuKey: 'secondBrain' },
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
  // Pronista §Layout (2026-09-08) — พับ/กาง sidebar บนจอ desktop ได้ (คนละสถานะกับ navOpen ที่คุมแค่ drawer มือถือ) จำค่าไว้ข้าม session
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('pronista_sidebar_collapsed') === '1'
    } catch {
      return false
    }
  })
  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem('pronista_sidebar_collapsed', next ? '1' : '0')
      } catch {
        // localStorage ปิด/เต็ม — ข้ามการจำค่าไปเงียบๆ ไม่กระทบการใช้งาน
      }
      return next
    })
  }
  // Pronista §Pin เมนู (2026-09-11) — ปักหมุดเมนูโปรดให้ลอยบนสุด sidebar เสมอ แทนที่การลาก-วาง (พี่แบงค์ยืนยันว่าถ้า pin ได้ Drag and Drop ก็ไม่จำเป็น) จำค่าไว้ข้าม session แบบเดียวกับ sidebarCollapsed
  const [pinnedTo, setPinnedTo] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('pronista_pinned_menus')
      return raw ? (JSON.parse(raw) as string[]) : []
    } catch {
      return []
    }
  })
  const persistPinned = (next: string[]) => {
    try {
      localStorage.setItem('pronista_pinned_menus', JSON.stringify(next))
    } catch {
      // localStorage ปิด/เต็ม — ข้ามการจำค่าไปเงียบๆ ไม่กระทบการใช้งาน
    }
    return next
  }
  const togglePin = (to: string) =>
    setPinnedTo((s) => persistPinned(s.includes(to) ? s.filter((t) => t !== to) : [...s, to]))
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  // Pronista §System Requirements Update — sub-menu ของเมนูที่มี children (เช่น "ตั้งค่า") พับเก็บเป็นค่าเริ่มต้น กดที่เมนูแม่ถึงจะกาง
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const s = new Set<string>()
    for (const n of NAV) {
      // c.to === n.to = child ที่เป็นแค่ "ลิงก์ตัวเองของเมนูแม่" (เช่น /admin ใน "ตั้งค่า", /my-tasks ใน "งานของฉัน") ไม่ใช่ prefix ของ route ย่อยจริง
      // ห้ามเอามา startsWith match ไม่งั้นเมนูอื่นที่ path ขึ้นต้นด้วยของเดิม (เช่น /my-tasks/files ของเมนู "ไฟล์ของฉัน" แยกใหม่) จะกางเมนูแม่ผิดตัวไปด้วย
      if (n.children?.some((c) => location.pathname === c.to || (c.to !== n.to && location.pathname.startsWith(`${c.to}/`)))) s.add(n.to)
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
      n.children?.some((c) => location.pathname === c.to || (c.to !== n.to && location.pathname.startsWith(`${c.to}/`))),
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

  // Pronista §Mobile Drawer scroll lock (2026-09-02) — กัน background เลื่อนตามนิ้วขณะ drawer เปิดอยู่บนมือถือ (สเปก §3)
  useEffect(() => {
    if (!navOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [navOpen])

  // Pronista §System Requirements Update — ซ่อนเมนูตามเพดานสิทธิ์เมนูของหมวดผู้ใช้งาน (owner bypass เสมอ ไม่ผ่านเพดาน)
  const items = useMemo(
    () =>
      user
        ? NAV.filter((n) => n.roles.includes(user.role) && (!n.menuKey || user.role === 'owner' || user.menuVisibility[n.menuKey]))
        : [],
    [user],
  )
  // Pronista §Pin เมนูย่อย (2026-09-11) — เมนูย่อย (children) ก็ปักหมุดได้เหมือนเมนูหลัก ใช้ icon ของเมนูแม่แทน (เมนูย่อยไม่มี icon ของตัวเอง)
  const childPinnables = useMemo(
    () =>
      items.flatMap((n) =>
        (n.children ?? [])
          .filter((c) => !c.roles || (user && c.roles.includes(user.role)))
          .map((c) => ({ to: c.to, label: c.label, parentIcon: n.icon, parentLabel: n.label })),
      ),
    [items, user],
  )
  // Pronista §Pin เมนู — เมนูที่ถูกปักหมุด (กรองตามสิทธิ์จริงจาก items แล้ว) ลอยบนสุดตามลำดับที่ผู้ใช้จัด ส่วนที่เหลือแสดงต่อแบบเดิม ไม่ซ้ำกัน
  // แต่ละรายการใน pinnedTo อาจเป็นเมนูหลักหรือเมนูย่อยก็ได้ — to ไม่ซ้ำกันทั้งแอป จึงหาเจอแค่ฝั่งเดียว
  const pinnedEntries = useMemo(
    () =>
      pinnedTo
        .map((to) => {
          const topItem = items.find((n) => n.to === to)
          if (topItem) return { kind: 'top' as const, item: topItem }
          const child = childPinnables.find((c) => c.to === to)
          if (child) return { kind: 'child' as const, child }
          return null
        })
        .filter((e): e is NonNullable<typeof e> => !!e),
    [pinnedTo, items, childPinnables],
  )
  const pinnedSet = useMemo(
    () => new Set(pinnedEntries.map((e) => (e.kind === 'top' ? e.item.to : e.child.to))),
    [pinnedEntries],
  )
  const unpinnedItems = useMemo(() => items.filter((n) => !pinnedSet.has(n.to)), [items, pinnedSet])
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

  const renderNavRow = (item: (typeof items)[number]) => {
    const { to, label, icon: Icon, children } = item
    const isOpen = !!children && openGroups.has(to)
    const isPinned = pinnedSet.has(to)
    return (
      <div key={to}>
        <div className="flex items-center gap-0.5 group">
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
            className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer ${
              to === activeTo
                ? 'bg-brand-50 text-brand-700 [&_svg]:text-brand-600'
                : 'text-soft hover:bg-hover'
            }`}
          >
            <Icon className="w-[18px] h-[18px]" /> {label}
            {to === '/my-tasks' && <NotificationBell excludeTypes={MY_TASKS_EXCLUDED_TYPES} />}
            {to === '/team' && <NotificationBell types={TEAM_NOTIFICATION_TYPES} />}
            {to === '/vault' && <NotificationBell types={VAULT_NOTIFICATION_TYPES} />}
            {children && <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
          </NavLink>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin(to) }}
            aria-label={isPinned ? `เลิกปักหมุด ${label}` : `ปักหมุด ${label}`}
            className={`p-1 rounded hover:bg-divider ${isPinned ? 'text-brand-600' : 'text-muted'} ${PIN_ROW_ACTION_VISIBILITY}`}
          >
            <Pin className={`w-3.5 h-3.5 ${isPinned ? 'fill-current' : ''}`} />
          </button>
        </div>
        {children && isOpen && (
          <div className="ml-[27px] mt-0.5 mb-0.5 space-y-0.5 border-l border-border-subtle pl-3">
            {children.filter((c) => !c.roles || (user && c.roles.includes(user.role))).map((c) => {
              const isChildPinned = pinnedSet.has(c.to)
              return (
                <div key={c.to} className="flex items-center gap-0.5 group">
                  <NavLink
                    to={c.to}
                    end={CHILD_EXACT_MATCH.has(c.to)}
                    onClick={() => setNavOpen(false)}
                    className={({ isActive }) =>
                      `flex-1 flex items-center px-2.5 py-1.5 rounded-lg cursor-pointer ${
                        isActive ? 'bg-brand-50 text-brand-700 font-medium' : 'text-soft hover:bg-hover'
                      }`
                    }
                  >
                    {c.label}
                    {/* Pronista §My Note badge (2026-09-01) — แจ้งเตือนตรงหลังเมนู My Note เมื่อมีคนแชร์ Note มาใหม่ */}
                    {c.to === '/my-tasks/notes' && <NotificationBell types={['note_shared']} />}
                  </NavLink>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin(c.to) }}
                    aria-label={isChildPinned ? `เลิกปักหมุด ${c.label}` : `ปักหมุด ${c.label}`}
                    className={`p-1 rounded hover:bg-divider ${isChildPinned ? 'text-brand-600' : 'text-muted'} ${PIN_ROW_ACTION_VISIBILITY}`}
                  >
                    <Pin className={`w-3.5 h-3.5 ${isChildPinned ? 'fill-current' : ''}`} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // Pronista §Pin เมนูย่อย — แถวเมนูย่อยที่ปักหมุดในส่วน "รายการโปรด" ใช้ icon ของเมนูแม่แทน (เมนูย่อยไม่มี icon ของตัวเอง) + โชว์ชื่อเมนูแม่จางๆ กันชื่อกำกวม (เช่น "ตั้งค่า" อยู่ใต้ทั้ง "จัดการสมาชิก")
  const renderPinnedChildRow = (child: (typeof childPinnables)[number]) => {
    const { to, label, parentIcon: Icon, parentLabel } = child
    return (
      <div key={to} className="flex items-center gap-0.5 group">
        <NavLink
          to={to}
          end={CHILD_EXACT_MATCH.has(to)}
          onClick={() => setNavOpen(false)}
          className={({ isActive }) =>
            `flex-1 flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer ${
              isActive ? 'bg-brand-50 text-brand-700 [&_svg]:text-brand-600' : 'text-soft hover:bg-hover'
            }`
          }
        >
          <Icon className="w-[18px] h-[18px] shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block truncate">{label}</span>
            <span className="block truncate text-[10px] text-muted font-normal leading-tight">{parentLabel}</span>
          </span>
          {to === '/my-tasks/notes' && <NotificationBell types={['note_shared']} />}
        </NavLink>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin(to) }}
          aria-label={`เลิกปักหมุด ${label}`}
          className={`p-1 rounded hover:bg-divider text-brand-600 ${PIN_ROW_ACTION_VISIBILITY}`}
        >
          <Pin className="w-3.5 h-3.5 fill-current" />
        </button>
      </div>
    )
  }

  const sidebar = (
    // Pronista §Mobile safe-area (2026-09-02) — drawer ชิดขอบขวา/บน/ล่างจริงบนมือถือ ต้องกัน notch/home-indicator (สเปก §3) — desktop (lg:static) env() คืน 0 อยู่แล้วไม่กระทบ
    <aside
      className={`fixed top-0 bottom-0 right-0 z-40 transition-[transform,width,opacity] duration-200 lg:static lg:translate-x-0 lg:z-auto w-52 shrink-0 bg-white shadow-xs flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)] ${
        navOpen ? 'translate-x-0' : 'translate-x-full'
      } ${sidebarCollapsed ? 'lg:w-0 lg:opacity-0 lg:pointer-events-none lg:overflow-hidden lg:border-0' : 'lg:w-52 lg:opacity-100'}`}
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
        {pinnedEntries.length > 0 && (
          <>
            <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold text-muted uppercase tracking-wide">รายการโปรด</div>
            {pinnedEntries.map((e) => (e.kind === 'top' ? renderNavRow(e.item) : renderPinnedChildRow(e.child)))}
            <div className="my-2 border-t border-border-subtle" />
          </>
        )}
        {unpinnedItems.map((item) => renderNavRow(item))}
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
          <Topbar
            title={topbarTitle}
            onOpenNav={() => setNavOpen(true)}
            actionSlotRef={setActionSlot}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebarCollapsed}
          />
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
