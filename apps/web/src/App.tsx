import type { ReactNode } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { DialogProvider } from './components/Dialog'
import { Layout } from './components/Layout'
import { AuthProvider, useAuth, type Me, type MenuKey } from './lib/auth'
import { AdminPage } from './pages/Admin'
import { AdminCostPage } from './pages/AdminCost'
import { AdminDomainsPage } from './pages/AdminDomains'
import { DomainDetailPage } from './pages/DomainDetail'
import { AdminNotificationsPage } from './pages/AdminNotifications'
import { AdminPermissionsPage } from './pages/AdminPermissions'
import { BoardPage } from './pages/Board'
import { ClientDetailPage } from './pages/ClientDetail'
import { ClientsPage } from './pages/Clients'
import { DashboardPage } from './pages/Dashboard'
import { DocsPage } from './pages/Docs'
import { DocumentComparePage } from './pages/DocumentCompare'
import { DocumentHistoryPage } from './pages/DocumentHistory'
import { DocViewerPage } from './pages/DocViewer'
import { EmployeeDetailPage } from './pages/EmployeeDetail'
import { ExpensesPage } from './pages/Expenses'
import { InboxPage } from './pages/Inbox'
import { Login } from './pages/Login'
import { MemberDetailPage } from './pages/MemberDetail'
import { MemberOrdersPage } from './pages/MemberOrders'
import { MemberPaymentsPage } from './pages/MemberPayments'
import { MemberSettingsPage } from './pages/MemberSettings'
import { MembersPage } from './pages/Members'
import { MyFilesPage } from './pages/MyFiles'
import { MyFilePageViewerPage } from './pages/MyFilePageViewer'
import { MyTasksPage } from './pages/MyTasks'
import { MyTasksDailyReportPage } from './pages/MyTasksDailyReport'
import { MyTasksDispatchedPage } from './pages/MyTasksDispatched'
import { MyTasksMeetingsPage } from './pages/MyTasksMeetings'
import { MyTasksNotesPage } from './pages/MyTasksNotes'
import { ProjectDetailPage } from './pages/ProjectDetail'
import { ProjectEditPage } from './pages/ProjectEdit'
import { PayrollPage } from './pages/Payroll'
import { ProfilePage } from './pages/Profile'
import { ProjectsPage } from './pages/Projects'
import { PartnerDetailPage } from './pages/PartnerDetail'
import { SharedFilesPage } from './pages/SharedFiles'
import { SprintSnapshotPage } from './pages/SprintSnapshot'
import { TaskDetailPage } from './pages/TaskDetail'
import { TeamPage } from './pages/Team'
import { UserSettingsPage } from './pages/UserSettings'
import { UserSettingsCustomerDetailPage } from './pages/UserSettingsCustomerDetail'
import { WorkspacePage } from './pages/Workspace'
import { WorkspaceBoardPage } from './pages/WorkspaceBoard'
import { WorkspaceRoomsPage } from './pages/WorkspaceRooms'

// Pronista §System Requirements Update — menuKey = เช็คเพดานเมนูของหมวดผู้ใช้งาน (owner bypass เสมอ) เพิ่มจาก roles เดิม (สิทธิ์ระบบ)
function Protected({ children, roles, menuKey }: { children: ReactNode; roles?: Me['role'][]; menuKey?: MenuKey }) {
  const { user, loading } = useAuth()
  if (loading)
    return (
      <div className="min-h-dvh grid place-items-center text-sm text-muted">กำลังโหลด…</div>
    )
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  if (menuKey && user.role !== 'owner' && !user.menuVisibility[menuKey]) return <Navigate to="/" replace />
  return children
}

// Pronista §System Requirements Update — ถ้าเพดานหมวดผู้ใช้งานปิด "ภาพรวม" ไว้ (เช่น ลูกค้า) พา redirect ไปเมนูแรกที่มองเห็นได้แทน กัน loop กับ '/' เอง
const FALLBACK_ORDER: { menuKey: MenuKey; to: string }[] = [
  { menuKey: 'projects', to: '/projects' },
  { menuKey: 'docs', to: '/docs' },
  { menuKey: 'myTasks', to: '/my-tasks' },
  { menuKey: 'workspace', to: '/workspace' },
]
function DashboardGate() {
  const { user } = useAuth()
  if (user && user.role !== 'owner' && !user.menuVisibility.dashboard) {
    const fallback = FALLBACK_ORDER.find((f) => user.menuVisibility[f.menuKey])
    if (fallback) return <Navigate to={fallback.to} replace />
  }
  return <DashboardPage />
}

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: (
      <Protected>
        <Layout />
      </Protected>
    ),
    children: [
      { index: true, element: <DashboardGate /> },
      { path: 'my-tasks', element: <Protected menuKey="myTasks"><MyTasksPage /></Protected> },
      { path: 'my-tasks/dispatched', element: <Protected menuKey="myTasks"><MyTasksDispatchedPage /></Protected> },
      { path: 'my-tasks/daily-report', element: <Protected menuKey="myTasks"><MyTasksDailyReportPage /></Protected> },
      { path: 'my-tasks/notes', element: <Protected menuKey="myTasks"><MyTasksNotesPage /></Protected> },
      { path: 'my-tasks/meetings', element: <Protected menuKey="myTasks"><MyTasksMeetingsPage /></Protected> },
      // Pronista §My Files (2026-08-28) — owner/member/vendor เท่านั้น (ไม่รวม guest — ตกลงกับพี่แบงค์แล้ว)
      { path: 'my-tasks/files', element: <Protected menuKey="myTasks" roles={['owner', 'member', 'vendor']}><MyFilesPage /></Protected> },
      { path: 'my-tasks/files/:id', element: <Protected menuKey="myTasks" roles={['owner', 'member', 'vendor']}><MyFilePageViewerPage /></Protected> },
      { path: 'my-tasks/shared-files', element: <Protected menuKey="myTasks" roles={['owner', 'member', 'vendor']}><SharedFilesPage /></Protected> },
      { path: 'workspace', element: <Protected menuKey="workspace"><WorkspaceRoomsPage /></Protected> },
      { path: 'workspace/:workspaceId', element: <Protected menuKey="workspace"><WorkspacePage /></Protected> },
      { path: 'workspace/:workspaceId/sprints/:sprintId/board', element: <Protected menuKey="workspace"><WorkspaceBoardPage /></Protected> },
      { path: 'projects', element: <Protected menuKey="projects"><ProjectsPage /></Protected> },
      { path: 'team', element: <Protected menuKey="team"><TeamPage /></Protected> },
      {
        path: 'projects/:id/edit',
        element: (
          // Pronista §permission (Jira-style project role) — เข้าหน้าได้ทั้ง owner+member เพราะ editor ของโปรเจกต์นี้ก็แก้ได้
          // (สิทธิ์ระดับโปรเจกต์จริงๆ เช็คใน ProjectEditPage เอง ไม่ใช่ role บริษัทตรงนี้)
          <Protected roles={['owner', 'member']}>
            <ProjectEditPage />
          </Protected>
        ),
      },
      { path: 'projects/:id', element: <Protected menuKey="projects"><ProjectDetailPage /></Protected> },
      { path: 'tasks/:id', element: <TaskDetailPage /> },
      { path: 'projects/:id/sprints/:sprintId/board', element: <Protected menuKey="projects"><BoardPage /></Protected> },
      { path: 'projects/:id/sprints/:sprintId/snapshot', element: <Protected menuKey="projects"><SprintSnapshotPage /></Protected> },
      {
        path: 'clients',
        element: (
          <Protected roles={['owner', 'member']}>
            <ClientsPage />
          </Protected>
        ),
      },
      {
        path: 'clients/:id',
        element: (
          <Protected roles={['owner', 'member']}>
            <ClientDetailPage />
          </Protected>
        ),
      },
      {
        // Pronista §System Requirements Update — เอกสาร คุมด้วยเพดานเมนู "docs" แทน role hardcode เดิม (ลูกค้า/outsource เห็นได้ถ้าเพดานเปิด)
        path: 'docs',
        element: (
          <Protected menuKey="docs">
            <DocsPage />
          </Protected>
        ),
      },
      {
        path: 'docs/history',
        element: (
          <Protected menuKey="docsHistory">
            <DocumentHistoryPage />
          </Protected>
        ),
      },
      {
        path: 'docs/compare',
        element: (
          <Protected menuKey="docs">
            <DocumentComparePage />
          </Protected>
        ),
      },
      {
        path: 'docs/:id',
        element: (
          <Protected menuKey="docs">
            <DocViewerPage />
          </Protected>
        ),
      },
      {
        path: 'inbox',
        element: (
          <Protected roles={['owner', 'member']}>
            <InboxPage />
          </Protected>
        ),
      },
      { path: 'payroll', element: <PayrollPage /> },
      { path: 'profile', element: <ProfilePage /> },
      {
        path: 'expenses',
        element: (
          <Protected roles={['owner', 'member']}>
            <ExpensesPage />
          </Protected>
        ),
      },
      {
        path: 'admin',
        element: (
          <Protected roles={['owner']}>
            <AdminPage />
          </Protected>
        ),
      },
      {
        // Pronista §Menu Restructure — ย้ายจาก admin/users (แท็บ "พนักงานในระบบ") ขึ้นเป็นเมนูหลัก
        // เดิม owner-only hardcode — ตอนนี้คุมผ่านเพดานเมนู "employees" ได้ (default ปิด, API ฝั่ง server ก็ scope ตามหมวดเดียวกัน)
        path: 'employees',
        element: (
          <Protected menuKey="employees">
            <UserSettingsPage tab="staff" />
          </Protected>
        ),
      },
      {
        path: 'employees/:id',
        element: (
          <Protected menuKey="employees">
            <EmployeeDetailPage />
          </Protected>
        ),
      },
      {
        // Pronista §Menu Restructure — ย้ายจาก admin/users/outsource ขึ้นเป็นเมนูหลัก
        path: 'partners',
        element: (
          <Protected menuKey="partners">
            <UserSettingsPage tab="outsource" />
          </Protected>
        ),
      },
      {
        path: 'partners/:id',
        element: (
          <Protected menuKey="partners">
            <PartnerDetailPage />
          </Protected>
        ),
      },
      {
        // Pronista §Menu Restructure — ย้ายจาก admin/users/customers ขึ้นเป็นเมนูหลัก
        path: 'customers',
        element: (
          <Protected menuKey="customers">
            <UserSettingsPage tab="customer" />
          </Protected>
        ),
      },
      {
        path: 'customers/:id',
        element: (
          <Protected menuKey="customers">
            <UserSettingsCustomerDetailPage />
          </Protected>
        ),
      },
      {
        path: 'members',
        element: (
          <Protected menuKey="members">
            <MembersPage />
          </Protected>
        ),
      },
      {
        path: 'members/:id',
        element: (
          <Protected menuKey="members">
            <MemberDetailPage />
          </Protected>
        ),
      },
      {
        path: 'members/orders',
        element: (
          <Protected menuKey="members">
            <MemberOrdersPage />
          </Protected>
        ),
      },
      {
        path: 'members/payments',
        element: (
          <Protected menuKey="members">
            <MemberPaymentsPage />
          </Protected>
        ),
      },
      {
        path: 'members/settings',
        element: (
          <Protected menuKey="members">
            <MemberSettingsPage />
          </Protected>
        ),
      },
      {
        path: 'admin/permissions',
        element: (
          <Protected roles={['owner']}>
            <AdminPermissionsPage />
          </Protected>
        ),
      },
      {
        path: 'admin/notifications',
        element: (
          <Protected roles={['owner']}>
            <AdminNotificationsPage />
          </Protected>
        ),
      },
      {
        path: 'admin/cost',
        element: (
          <Protected roles={['owner']}>
            <AdminCostPage />
          </Protected>
        ),
      },
      {
        path: 'admin/domains',
        element: (
          <Protected roles={['owner']}>
            <AdminDomainsPage />
          </Protected>
        ),
      },
      {
        path: 'admin/domains/:id',
        element: (
          <Protected roles={['owner']}>
            <DomainDetailPage />
          </Protected>
        ),
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export function App() {
  return (
    <AuthProvider>
      <DialogProvider>
        <RouterProvider router={router} />
      </DialogProvider>
    </AuthProvider>
  )
}
