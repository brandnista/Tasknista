import type { ReactNode } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { DialogProvider } from './components/Dialog'
import { Layout } from './components/Layout'
import { AuthProvider, useAuth, type Me } from './lib/auth'
import { AdminPage } from './pages/Admin'
import { BoardPage } from './pages/Board'
import { ClientDetailPage } from './pages/ClientDetail'
import { ClientsPage } from './pages/Clients'
import { DashboardPage } from './pages/Dashboard'
import { DocsPage } from './pages/Docs'
import { DocumentComparePage } from './pages/DocumentCompare'
import { DocumentHistoryPage } from './pages/DocumentHistory'
import { DocViewerPage } from './pages/DocViewer'
import { ExpensesPage } from './pages/Expenses'
import { InboxPage } from './pages/Inbox'
import { Login } from './pages/Login'
import { MyTasksPage } from './pages/MyTasks'
import { ProjectDetailPage } from './pages/ProjectDetail'
import { ProjectEditPage } from './pages/ProjectEdit'
import { PayrollPage } from './pages/Payroll'
import { ProfilePage } from './pages/Profile'
import { ProjectsPage } from './pages/Projects'
import { SprintSnapshotPage } from './pages/SprintSnapshot'
import { TaskDetailPage } from './pages/TaskDetail'
import { WorkspacePage } from './pages/Workspace'
import { WorkspaceRoomsPage } from './pages/WorkspaceRooms'

function Protected({ children, roles }: { children: ReactNode; roles?: Me['role'][] }) {
  const { user, loading } = useAuth()
  if (loading)
    return (
      <div className="min-h-dvh grid place-items-center text-sm text-muted">กำลังโหลด…</div>
    )
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  return children
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
      { index: true, element: <DashboardPage /> },
      { path: 'my-tasks', element: <MyTasksPage /> },
      { path: 'workspace', element: <WorkspaceRoomsPage /> },
      { path: 'workspace/:workspaceId', element: <WorkspacePage /> },
      { path: 'projects', element: <ProjectsPage /> },
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
      { path: 'projects/:id', element: <ProjectDetailPage /> },
      { path: 'tasks/:id', element: <TaskDetailPage /> },
      { path: 'projects/:id/sprints/:sprintId/board', element: <BoardPage /> },
      { path: 'projects/:id/sprints/:sprintId/snapshot', element: <SprintSnapshotPage /> },
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
        path: 'docs',
        element: (
          <Protected roles={['owner', 'member']}>
            <DocsPage />
          </Protected>
        ),
      },
      {
        path: 'docs/history',
        element: (
          <Protected roles={['owner', 'member']}>
            <DocumentHistoryPage />
          </Protected>
        ),
      },
      {
        path: 'docs/compare',
        element: (
          <Protected roles={['owner', 'member']}>
            <DocumentComparePage />
          </Protected>
        ),
      },
      {
        path: 'docs/:id',
        element: (
          <Protected roles={['owner', 'member']}>
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
