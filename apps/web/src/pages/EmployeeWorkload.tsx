/**
 * Pronista §Workload Drill-down (2026-09-07) — เจาะดูงานของพนักงานคนเดียวจากตาราง Workload
 * กดชื่อ/Avatar = เห็นทุกงาน · กดช่องวัน = พก taskIds ของวันนั้นมากรอง (แถบกรองเอาออกได้)
 * Pronista §Calendar/Workload (2026-09-18) — เปิดให้ owner+member+vendor เข้าได้ (เดิม owner-only) เหมือน /workload
 * Pronista §Calendar/Workload ต่อยอด (2026-09-18) — เพิ่มแท็บ "Calendar" โชว์ปฏิทินส่วนตัวของคนนั้นเป็นตารางเดือนจริง
 * (มุมมองปฏิทินแบบเดียวกับ "ปฏิทินทีมงาน" ไม่ใช่ list รายวัน — ตอบโจทย์ "ทีมอยากเห็นว่าพี่แบงค์แต่ละวันมีประชุมอะไรบ้าง")
 */
import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, Rows3, X } from 'lucide-react'
import { useMemo, useState } from 'react'
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
interface CalEvent {
  id: string
  title: string
  startDate: string
  endDate?: string | null
  type: 'holiday' | 'leave' | 'meeting' | 'deadline' | 'other' | 'payroll'
  startAt?: number | null
  endAt?: number | null
  source?: 'local' | 'gcal'
  projectName?: string | null
}

const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const THMF = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
const TYPE_CLS: Record<CalEvent['type'], string> = {
  holiday: 'bg-success-100 text-success-700', leave: 'bg-orange-100 text-orange-700', meeting: 'bg-info-100 text-info-700',
  deadline: 'bg-danger-100 text-danger-600', other: 'bg-divider text-soft', payroll: '',
}
const iso = (d: Date) => d.toISOString().slice(0, 10)
const bkkNow = () => new Date(Date.now() + 7 * 3_600_000)
const todayISO = () => iso(bkkNow())
const fmtHM = (ms: number) => new Date(ms).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
const be = (y: number) => y + 543

export function EmployeeWorkloadPage() {
  const navigate = useNavigate()
  const { userId } = useParams<{ userId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const ids = searchParams.get('ids')
  const date = searchParams.get('date')
  const [view, setView] = useState<'board' | 'list' | 'calendar'>('board')
  const [monthRef, setMonthRef] = useState(() => bkkNow())

  const { data, loading } = useLoad<EmployeeWorkloadResponse | null>(
    () => (userId ? api.get(`/api/workload/users/${userId}/tasks${ids ? `?ids=${ids}` : ''}`) : Promise.resolve(null)),
    [userId, ids],
  )

  // โหลดครอบทั้งช่วงที่มองเห็นในตาราง (เดือน ±7 วัน กันช่องว่างขอบตารางไม่มีข้อมูล) — mirror pattern จาก TeamCalendar.tsx
  const range = useMemo(() => {
    const start = new Date(Date.UTC(monthRef.getUTCFullYear(), monthRef.getUTCMonth(), 1))
    start.setUTCDate(start.getUTCDate() - 7)
    const end = new Date(Date.UTC(monthRef.getUTCFullYear(), monthRef.getUTCMonth() + 1, 7))
    return { from: iso(start), to: iso(end) }
  }, [monthRef])
  const { data: calData, loading: calLoading } = useLoad<{ events: CalEvent[] }>(
    () => (userId && view === 'calendar' ? api.get(`/api/calendar?from=${range.from}&to=${range.to}&userIds=${userId}`) : Promise.resolve({ events: [] })),
    [userId, view, range.from, range.to],
  )
  const calEvents = (calData?.events ?? []).filter((e) => e.type !== 'payroll')
  const eventsOn = (d: string) => calEvents.filter((e) => e.startDate <= d && (e.endDate ?? e.startDate) >= d).sort((a, b) => (a.startAt ?? 0) - (b.startAt ?? 0))

  const clearDateFilter = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('ids')
    next.delete('date')
    setSearchParams(next)
  }

  const openTask = (id: string) => navigate(`/tasks/${id}`)
  const tasks = data?.tasks ?? []

  const navMonth = (dir: -1 | 1) => {
    const d = new Date(monthRef)
    d.setUTCMonth(d.getUTCMonth() + dir)
    setMonthRef(d)
  }

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
            <button onClick={() => setView('calendar')} className={`flex items-center gap-1.5 text-xs font-medium px-3 h-full border-l border-border ${view === 'calendar' ? 'bg-brand-600 text-white' : 'bg-white text-dim'}`}>
              <CalendarDays className="w-3.5 h-3.5" /> Calendar
            </button>
          </div>
        </div>

        {view !== 'calendar' && loading && <div className="py-10 text-center text-sm text-muted">กำลังโหลด…</div>}

        {view !== 'calendar' && !loading && (view === 'board' ? (
          <StatusKanban tasks={tasks} onOpenTask={openTask} onStatusChange={() => {}} canEdit={false} />
        ) : (
          <TaskListView tasks={tasks} onOpenTask={openTask} />
        ))}

        {view === 'calendar' && (
          <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1">
                <button onClick={() => navMonth(-1)} className="w-9 h-9 grid place-items-center rounded-lg text-muted hover:bg-divider" aria-label="เดือนก่อนหน้า">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={() => setMonthRef(bkkNow())} className="text-xs text-dim hover:bg-divider px-2 py-1.5 rounded-lg">เดือนนี้</button>
                <button onClick={() => navMonth(1)} className="w-9 h-9 grid place-items-center rounded-lg text-muted hover:bg-divider" aria-label="เดือนถัดไป">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <span className="text-sm font-medium text-body">{THMF[monthRef.getUTCMonth()]} {be(monthRef.getUTCFullYear())}</span>
            </div>

            {calLoading && <div className="py-10 text-center text-sm text-muted">กำลังโหลด…</div>}

            {!calLoading && (
              <>
                <div className="grid grid-cols-7 text-[11px] text-muted mb-1">{DOW.map((d) => <div key={d} className="px-2 py-1">{d}</div>)}</div>
                <div className="grid grid-cols-7 gap-px bg-border-subtle rounded-lg overflow-hidden">
                  {Array.from({ length: 42 }, (_, i) => {
                    const first = new Date(Date.UTC(monthRef.getUTCFullYear(), monthRef.getUTCMonth(), 1))
                    const start = new Date(first)
                    start.setUTCDate(1 - first.getUTCDay() + i)
                    const dIso = iso(start)
                    const inMonth = start.getUTCMonth() === monthRef.getUTCMonth()
                    const isToday = dIso === todayISO()
                    const dayEvents = eventsOn(dIso)
                    return (
                      <div key={i} className={`${inMonth ? 'bg-white' : 'bg-hover/60'} min-h-[80px] p-1`}>
                        {isToday ? (
                          <span className="bg-brand-600 text-white w-5 h-5 grid place-items-center rounded-full text-[11px]">{start.getUTCDate()}</span>
                        ) : (
                          <span className={`${inMonth ? 'text-dim' : 'text-border'} text-[11px] px-1`}>{start.getUTCDate()}</span>
                        )}
                        <div className="mt-0.5">
                          {dayEvents.map((e) => (
                            <div
                              key={e.id}
                              title={`${e.startAt && e.endAt ? `${fmtHM(e.startAt)}–${fmtHM(e.endAt)} ` : ''}${e.title}`}
                              className={`truncate rounded px-1 mt-0.5 text-[10px] ${TYPE_CLS[e.type]}`}
                            >
                              {e.startAt && <span className="opacity-70">{fmtHM(e.startAt)} </span>}
                              {e.title}
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}
