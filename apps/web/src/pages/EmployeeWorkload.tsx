/**
 * Pronista §Workload Drill-down (2026-09-07) — เจาะดูงานของพนักงานคนเดียวจากตาราง Workload
 * กดชื่อ/Avatar = เห็นทุกงาน · กดช่องวัน = พก taskIds ของวันนั้นมากรอง (แถบกรองเอาออกได้) — owner-only เหมือน /workload
 */
import { LayoutGrid, Rows3, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { Avatar } from '../components/Avatar'
import { PageHeader } from '../components/PageHeader'
import { StatusKanban, type KanbanTask } from '../components/StatusKanban'
import { TaskListView } from '../components/TaskListView'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'

interface EmployeeWorkloadResponse {
  user: { id: string; name: string; avatarUrl: string | null }
  tasks: KanbanTask[]
}

export function EmployeeWorkloadPage() {
  const navigate = useNavigate()
  const { userId } = useParams<{ userId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const ids = searchParams.get('ids')
  const date = searchParams.get('date')
  const [view, setView] = useState<'board' | 'list'>('board')

  const { data, loading } = useLoad<EmployeeWorkloadResponse | null>(
    () => (userId ? api.get(`/api/workload/users/${userId}/tasks${ids ? `?ids=${ids}` : ''}`) : Promise.resolve(null)),
    [userId, ids],
  )

  const clearDateFilter = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('ids')
    next.delete('date')
    setSearchParams(next)
  }

  const openTask = (id: string) => navigate(`/tasks/${id}`)
  const tasks = data?.tasks ?? []

  return (
    <>
      <PageHeader title={data?.user ? `งานของ ${data.user.name}` : 'งานของพนักงาน'} />
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          {data?.user && <Avatar name={data.user.name} avatarUrl={data.user.avatarUrl} className="w-8 h-8 text-sm" />}
          <p className="text-sm text-muted">{data?.user ? `งานทั้งหมดที่มอบหมายให้ ${data.user.name}` : ''}</p>
        </div>

        {ids && (
          <div className="flex items-center gap-2 mb-4 text-xs font-medium bg-brand-50 border border-brand-200 text-brand-700 rounded-lg px-3 py-2 w-fit">
            <span>กรองเฉพาะวันที่ {date ?? ''}</span>
            <button type="button" onClick={clearDateFilter} className="hover:text-brand-900" aria-label="เอาตัวกรองออก">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex justify-end mb-3">
          <div className="border border-border rounded-lg overflow-hidden h-9 inline-flex">
            <button onClick={() => setView('board')} className={`flex items-center gap-1.5 text-xs font-medium px-3 h-full ${view === 'board' ? 'bg-brand-600 text-white' : 'bg-white text-dim'}`}>
              <LayoutGrid className="w-3.5 h-3.5" /> Board
            </button>
            <button onClick={() => setView('list')} className={`flex items-center gap-1.5 text-xs font-medium px-3 h-full border-l border-border ${view === 'list' ? 'bg-brand-600 text-white' : 'bg-white text-dim'}`}>
              <Rows3 className="w-3.5 h-3.5" /> List
            </button>
          </div>
        </div>

        {loading && <div className="py-10 text-center text-sm text-muted">กำลังโหลด…</div>}

        {!loading &&
          (view === 'board' ? (
            <StatusKanban tasks={tasks} onOpenTask={openTask} onStatusChange={() => {}} canEdit={false} />
          ) : (
            <TaskListView tasks={tasks} onOpenTask={openTask} />
          ))}
      </div>
    </>
  )
}
