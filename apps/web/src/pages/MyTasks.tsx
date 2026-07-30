import { Bell, Briefcase, CalendarCheck } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { MyWorkSummary } from '../components/MyWorkSummary'
import { PageHeader } from '../components/PageHeader'
import { StatusKanban, type KanbanTask } from '../components/StatusKanban'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/useLoad'

interface MyTask extends KanbanTask {
  projectId: string
  projectName: string
  myRole: 'owner' | 'editor' | 'viewer'
  // Tasknista §SOW Task/Subtask — ใช้กรอง "งานย่อยที่รอทำ" ใน widget My Work ใหม่
  parentId: string | null
}
interface NotificationRow {
  id: string
  type: 'subtask_assigned' | 'subtask_completed'
  taskId: string | null
  projectId: string | null
  message: string
  isRead: boolean
  createdAt: number
}

const PRIORITY_ORDER: Record<MyTask['priority'], number> = { high: 0, normal: 1, low: 2 }
const bkkToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)

/** Tasknista §My Work/Notification — งานย่อยของฉันที่ยังไม่เสร็จ เรียง priority แล้ว deadline พร้อมปุ่มติ๊กเสร็จตรงๆ */
function PendingSubtasksWidget({ tasks, onOpenTask, onComplete }: { tasks: MyTask[]; onOpenTask: (id: string) => void; onComplete: (id: string) => void }) {
  const pending = tasks
    .filter((t) => t.parentId && t.status !== 'done')
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
  if (pending.length === 0) return null
  return (
    <div className="bg-white rounded-lg shadow-xs p-4 mb-5">
      <div className="text-sm font-semibold text-body mb-2">งานย่อยที่รอทำ</div>
      <div className="divide-y divide-divider">
        {pending.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-2.5">
            <button
              onClick={(e) => { e.stopPropagation(); onComplete(t.id) }}
              title="เสร็จแล้ว"
              className="shrink-0 w-6 h-6 rounded-full border border-border grid place-items-center text-[10px] text-dim hover:border-brand-500 hover:text-brand-600 hover:bg-brand-50"
            >
              ✓
            </button>
            <button onClick={() => onOpenTask(t.id)} className="min-w-0 flex-1 text-left">
              <div className="text-sm text-body truncate">{t.title}</div>
              <div className="text-[11px] text-muted">{t.projectName}</div>
            </button>
            {t.priority === 'high' && <span className="text-[10px] text-danger-600 bg-danger-50 px-1.5 py-0.5 rounded shrink-0">สูง</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Tasknista §My Work/Notification — รายการแจ้งเตือน assign/complete Subtask (ในระบบเท่านั้น ไม่ส่งอีเมล) */
function NotificationsTab({ notifications, onRead }: { notifications: NotificationRow[]; onRead: (id: string) => void }) {
  if (notifications.length === 0) return <div className="text-center text-sm text-muted py-8">ยังไม่มีการแจ้งเตือน</div>
  return (
    <div className="bg-white rounded-lg shadow-xs divide-y divide-divider">
      {notifications.map((n) => {
        const href = n.projectId ? (n.taskId ? `/projects/${n.projectId}?task=${n.taskId}` : `/projects/${n.projectId}`) : undefined
        return (
          <a
            key={n.id}
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={() => { if (!n.isRead) onRead(n.id) }}
            className={`flex items-start gap-3 px-4 py-3 hover:bg-hover ${n.isRead ? '' : 'bg-info-50/40'}`}
          >
            <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.isRead ? 'bg-transparent' : 'bg-info-500'}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-body">{n.message}</div>
              <div className="text-[11px] text-muted mt-0.5">{new Date(n.createdAt).toLocaleString('th-TH')}</div>
            </div>
          </a>
        )
      })}
    </div>
  )
}

/** เมนู "งานของฉัน" — มองจากมุมคน (รวมงานที่ฉันรับผิดชอบข้ามทุกโปรเจกต์) ต่างจากเมนู โปรเจกต์ ที่มองทีละโปรเจกต์ */
export function MyTasksPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const openTask = (id: string) => navigate(`/tasks/${id}`)
  const { data, reload } = useLoad<MyTask[]>(() => api.get('/api/tasks/mine'))
  const { data: notifData, reload: reloadNotifications } = useLoad<NotificationRow[]>(() => api.get('/api/notifications'))
  const tasks = data ?? []
  const notifications = notifData ?? []
  const unreadCount = notifications.filter((n) => !n.isRead).length
  const [tab, setTab] = useState<'work' | 'notifications'>('work')

  const changeStatus = async (taskId: string, status: KanbanTask['status']) => {
    await api.patch(`/api/tasks/${taskId}`, { status })
    await reload()
  }
  const markRead = async (id: string) => {
    await api.post(`/api/notifications/${id}/read`, {})
    await reloadNotifications()
  }

  // Tasknista §My Work/Notification — 2 stat เพิ่มเติมตามสเปก (คำนวณฝั่ง client จากข้อมูลที่โหลดอยู่แล้ว ไม่ต้องเพิ่ม endpoint)
  const assignedProjectsCount = new Set(tasks.map((t) => t.projectId)).size
  const today = bkkToday()
  const assignedTodayCount = notifications.filter((n) => n.type === 'subtask_assigned' && new Date(n.createdAt).toISOString().slice(0, 10) === today).length

  return (
    <>
      <PageHeader title="งานของฉัน" />
      <div className="p-3 sm:p-6">
      <p className="text-sm text-muted mb-4">สวัสดี {user?.name} — นี่คือสรุปงานที่คุณรับผิดชอบ</p>

      <div className="flex bg-divider rounded-lg p-0.5 text-sm font-medium w-fit mb-4">
        <button onClick={() => setTab('work')} className={`px-3 py-1.5 rounded-md ${tab === 'work' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>งานของฉัน</button>
        <button onClick={() => setTab('notifications')} className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 ${tab === 'notifications' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>
          <Bell className="w-3.5 h-3.5" /> แจ้งเตือน
          {unreadCount > 0 && <span className="text-[10px] bg-danger-500 text-white rounded-full w-4 h-4 grid place-items-center">{unreadCount}</span>}
        </button>
      </div>

      {tab === 'work' ? (
        <>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="bg-white rounded-lg shadow-xs p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-brand-50 text-brand-600"><Briefcase className="w-4.5 h-4.5" /></div>
              <div>
                <div className="text-xl font-bold text-ink leading-none">{assignedProjectsCount}</div>
                <div className="text-xs text-muted mt-0.5">โปรเจกต์ที่ได้รับมอบหมาย</div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-xs p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-info-50 text-info-600"><CalendarCheck className="w-4.5 h-4.5" /></div>
              <div>
                <div className="text-xl font-bold text-ink leading-none">{assignedTodayCount}</div>
                <div className="text-xs text-muted mt-0.5">งานที่ถูก Assign วันนี้</div>
              </div>
            </div>
          </div>

          <MyWorkSummary tasks={tasks} onOpenTask={(t) => openTask(t.id)} />

          <PendingSubtasksWidget tasks={tasks} onOpenTask={openTask} onComplete={(id) => void changeStatus(id, 'done')} />

          <StatusKanban
            tasks={tasks}
            canEdit={(t) => (t as MyTask).myRole === 'owner' || (t as MyTask).myRole === 'editor'}
            onOpenTask={openTask}
            onStatusChange={changeStatus}
          />
        </>
      ) : (
        <NotificationsTab notifications={notifications} onRead={markRead} />
      )}
      </div>
    </>
  )
}
