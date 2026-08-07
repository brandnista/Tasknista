import { AlertTriangle, ChevronDown, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Avatar } from '../components/Avatar'
import { BacklogConvertMenu, CONVERT_LABEL, type ConvertTo } from '../components/BacklogConvertMenu'
import { ConvertBacklogModal } from '../components/ConvertBacklogModal'
import { PageHeader } from '../components/PageHeader'
import { ProjectIcon } from '../components/ProjectIcon'
import { StatusDonut } from '../components/StatusDonut'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import {
  fmtBudgetK,
  fmtThaiDate,
  HEALTH_DOT,
  HEALTH_LABEL,
  PM_HEALTH_BADGE,
  PM_HEALTH_DOT,
  PM_HEALTH_LABEL,
  pmHealthOf,
  statusChip,
  TH_MONTHS,
  yearPos,
  type PmHealth,
  type ProjectRow,
} from '../lib/project-ui'
import { avatarColor } from './ProjectDetail'
import { ROLE_LABEL } from '../lib/role-label'
import { useLoad } from '../lib/useLoad'

function ProgressBar({ p }: { p: ProjectRow }) {
  if (!p.progress || p.progress.total === 0) return <span className="text-[11px] text-muted">ยังไม่มีงาน</span>
  const pct = Math.round((p.progress.done / p.progress.total) * 100)
  return (
    <div className="min-w-[96px]">
      <div className="h-1.5 bg-divider rounded-full overflow-hidden mb-1">
        <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-muted">{p.progress.done}/{p.progress.total} ({pct}%)</span>
    </div>
  )
}
function LeadAvatar({ p }: { p: ProjectRow }) {
  if (!p.leadName) return <span className="text-[11px] text-muted">—</span>
  return <Avatar name={p.leadName} className="w-6 h-6 text-[10px]" colorClass={avatarColor(p.leadName)} />
}
function PmHealthBadge({ health }: { health: PmHealth }) {
  return <span className={`text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${PM_HEALTH_BADGE[health]}`}><span className={`w-1.5 h-1.5 rounded-full ${PM_HEALTH_DOT[health]}`} />{PM_HEALTH_LABEL[health]}</span>
}

const THIS_YEAR = new Date(Date.now() + 7 * 3_600_000).getUTCFullYear()
const todayPos = () => yearPos(new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10), THIS_YEAR)

function Timeline({ rows, showMoney }: { rows: ProjectRow[]; showMoney: boolean }) {
  const active = rows.filter((p) => p.type === 'project' && p.statusKind !== 'archived' && p.startDate && p.dueDate)
  if (active.length === 0)
    return <div className="text-sm text-muted text-center py-6">ยังไม่มีโปรเจกต์ที่มีช่วงเวลา — สร้างโปรเจกต์แรกแล้วใส่วันเริ่ม/กำหนดส่ง</div>
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1180px]">
        <div className="flex text-[11px] text-muted mb-1">
          <div className="w-56 shrink-0 sticky left-0 bg-white z-20"></div>
          <div className="flex-1 flex">
            {TH_MONTHS.map((m) => (
              <div key={m} className="flex-1 text-center">{m}</div>
            ))}
          </div>
        </div>
        {active.map((p) => {
          const L = yearPos(p.startDate!, THIS_YEAR)
          const W = Math.max(2, yearPos(p.dueDate!, THIS_YEAR) - L)
          return (
            <div key={p.id} className="flex items-center py-1">
              <div className="w-56 shrink-0 sticky left-0 bg-white z-20 flex items-center gap-2 text-sm pr-3">
                <ProjectIcon id={p.id} logo={p.logo} size={16} />
                <Link to={`/projects/${p.id}`} className="font-medium text-body truncate hover:text-brand-600 hover:underline">
                  {p.name}
                </Link>
                {showMoney && p.quotedSatang != null && (
                  <span className="ml-auto text-xs text-muted tabular-nums shrink-0">{fmtBudgetK(p.quotedSatang)}</span>
                )}
              </div>
              <div className="relative flex-1 h-7 bg-hover rounded-md">
                <div className="absolute top-0 bottom-0 w-px bg-danger-400 z-10" style={{ left: `${todayPos()}%` }} />
                <div className={`group absolute inset-y-1 rounded-md ${statusChip(p.statusColor)}`} style={{ left: `${L}%`, width: `${W}%` }}>
                  <div className="flex items-center h-full px-2 text-[11px] font-medium truncate">{p.statusName}</div>
                  <div className="absolute left-2 bottom-full mb-1 whitespace-nowrap bg-ink text-white text-[11px] rounded-lg px-2 py-1 opacity-0 group-hover:opacity-100 pointer-events-none transition shadow-lg z-30">
                    {fmtThaiDate(p.startDate)} – {fmtThaiDate(p.dueDate, true)}
                  </div>
                </div>
                {(p.milestones ?? []).filter((m) => m.dueDate).map((m, i) => (
                  <div
                    key={i}
                    title={`${m.name} (${fmtThaiDate(m.dueDate)})`}
                    className={`group/m absolute top-1/2 w-2.5 h-2.5 -translate-y-1/2 -translate-x-1/2 rotate-45 z-20 border-2 border-white ${m.status === 'done' ? 'bg-brand-600' : 'bg-white ring-1 ring-brand-600'}`}
                    style={{ left: `${yearPos(m.dueDate!, THIS_YEAR)}%` }}
                  >
                    <div className="absolute -rotate-45 left-1/2 -translate-x-1/2 bottom-full mb-1.5 whitespace-nowrap bg-ink text-white text-[11px] rounded-lg px-2 py-1 opacity-0 group-hover/m:opacity-100 pointer-events-none transition shadow-lg z-30">
                      {m.name} · {fmtThaiDate(m.dueDate)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Cards({ rows, showMoney }: { rows: ProjectRow[]; showMoney: boolean }) {
  const navigate = useNavigate()
  const list = rows.filter((p) => p.type === 'project' && p.statusKind !== 'archived')
  if (list.length === 0)
    return <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted">ยังไม่มีงานโปรเจกต์ — กด "โปรเจกต์ใหม่" มุมขวาบน</div>
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {list.map((p) => (
        <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)} className="bg-white rounded-lg shadow-xs p-5 cursor-pointer hover:shadow-sm transition">
          <div className="flex items-center gap-2">
            <ProjectIcon id={p.id} logo={p.logo} size={20} />
            <div className="flex-1 min-w-0 font-semibold text-strong truncate">{p.name}</div>
            <LeadAvatar p={p} />
          </div>
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${statusChip(p.statusColor)}`}>{p.statusName}</span>
            <PmHealthBadge health={pmHealthOf(p)} />
            {showMoney && p.paidPct != null && (
              <span className="text-xs text-dim tabular-nums">
                {p.paidPct}% <span className="text-muted">จ่ายแล้ว</span>
              </span>
            )}
            {showMoney && p.health && (
              <span className="group relative">
                <span className={`block w-2.5 h-2.5 rounded-full ${HEALTH_DOT[p.health]}`} />
                <span className="absolute left-0 top-full mt-1 w-44 bg-ink text-white text-[11px] rounded-lg p-2 opacity-0 group-hover:opacity-100 pointer-events-none transition shadow-lg z-20">
                  {p.paidPct != null ? `ลูกค้าจ่าย ${p.paidPct}% · ` : ''}งวดนี้ใช้งบ {p.usagePct}% · {HEALTH_LABEL[p.health]}
                </span>
              </span>
            )}
            <span className="ml-auto text-[11px] text-muted">{p.clientName ?? ''}</span>
          </div>
          <div className="mt-3"><ProgressBar p={p} /></div>
          <div className="text-[11px] text-muted mt-2">
            {p.startDate ? `${fmtThaiDate(p.startDate)} – ${fmtThaiDate(p.dueDate)}` : 'ยังไม่กำหนดช่วงเวลา'}
          </div>
        </div>
      ))}
    </div>
  )
}

/** มุมมองการ์ดเรียงตามงานที่ขยับล่าสุด — ค่าเริ่มต้นของแท็บ Summary */
/** มุมมอง Board — จัดการ์ดเป็นคอลัมน์ตามสถานะโปรเจกต์ (เหมือน Kanban งาน แต่จัดกลุ่มโปรเจกต์แทน) */
function BoardView({ rows, showMoney }: { rows: ProjectRow[]; showMoney: boolean }) {
  const navigate = useNavigate()
  const list = rows.filter((p) => p.type === 'project')
  const columns = new Map<string, { color: string; items: ProjectRow[] }>()
  for (const p of list) {
    if (!columns.has(p.statusName)) columns.set(p.statusName, { color: p.statusColor, items: [] })
    columns.get(p.statusName)!.items.push(p)
  }
  if (columns.size === 0)
    return <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted">ยังไม่มีงานโปรเจกต์</div>
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {[...columns.entries()].map(([name, col]) => (
        <div key={name} className="bg-hover/60 rounded-lg p-2 w-64 shrink-0">
          <div className="flex items-center gap-1.5 px-1.5 py-1 mb-1.5">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusChip(col.color)}`}>{name}</span>
            <span className="text-xs text-muted">{col.items.length}</span>
          </div>
          <div className="space-y-2">
            {col.items.map((p) => {
              const health = pmHealthOf(p)
              return (
                <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)} className="bg-white rounded-lg shadow-xs p-3 cursor-pointer hover:shadow-sm">
                  <div className="flex items-center gap-2 mb-1.5">
                    <ProjectIcon id={p.id} logo={p.logo} size={16} />
                    <span className="text-sm text-body truncate flex-1">{p.name}</span>
                    <LeadAvatar p={p} />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                    <PmHealthBadge health={health} />
                    {showMoney && p.paidPct != null && <span className="text-[11px] text-dim">{p.paidPct}% จ่ายแล้ว</span>}
                  </div>
                  <ProgressBar p={p} />
                  <div className={`text-[11px] mt-1.5 flex items-center gap-1 ${health === 'delayed' ? 'text-danger-600 font-medium' : 'text-muted'}`}>
                    {health === 'delayed' && <AlertTriangle className="w-3 h-3" />}
                    {p.dueDate ? fmtThaiDate(p.dueDate) : 'ไม่มีกำหนดส่ง'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Pronista §PM View — Executive Dashboard: ให้ PM ประเมินสถานะรวมได้ใน 3 วินาที (ไม่แตะเรื่องเงินเลย ตาม showMoney=false) */
function ExecutiveWidgets({ rows }: { rows: ProjectRow[] }) {
  const list = rows.filter((p) => p.type === 'project')
  const withProgress = list.filter((p) => p.progress && p.progress.total > 0)
  const avgProgress = withProgress.length === 0 ? 0 : Math.round(withProgress.reduce((s, p) => s + (p!.progress!.done / p!.progress!.total) * 100, 0) / withProgress.length)
  const delayed = list.filter((p) => pmHealthOf(p) === 'delayed')
  const atRisk = list.filter((p) => pmHealthOf(p) === 'at_risk')
  const onTrack = list.filter((p) => pmHealthOf(p) === 'on_track')
  const capacity = new Map<string, number>()
  for (const p of list) {
    if (!p.leadName || pmHealthOf(p) === 'completed') continue
    capacity.set(p.leadName, (capacity.get(p.leadName) ?? 0) + 1)
  }
  const maxCap = Math.max(1, ...capacity.values())

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-lg shadow-xs p-4">
          <div className="text-xs text-muted mb-1">Overall Progress</div>
          <div className="text-2xl font-bold text-ink">{avgProgress}%</div>
        </div>
        <div className="bg-white rounded-lg shadow-xs p-4">
          <div className="text-xs text-muted mb-1">On Track</div>
          <div className="text-2xl font-bold text-success-600">{onTrack.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow-xs p-4">
          <div className="text-xs text-muted mb-1">At Risk</div>
          <div className="text-2xl font-bold text-warning-600">{atRisk.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow-xs p-4">
          <div className="text-xs text-muted mb-1">Delayed</div>
          <div className="text-2xl font-bold text-danger-600">{delayed.length}</div>
        </div>
      </div>

      {delayed.length > 0 && (
        <div className="bg-white rounded-lg shadow-xs p-4 mb-4">
          <div className="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-danger-600" /> Overdue & Blocker</div>
          <div className="divide-y divide-divider">
            {delayed.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1 truncate text-body">{p.name}</span>
                <span className="text-[11px] text-danger-600">เกินกำหนด {p.dueDate ? fmtThaiDate(p.dueDate) : ''}</span>
                <span className="text-[11px] text-muted">{p.leadName ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {capacity.size > 0 && (
        <div className="bg-white rounded-lg shadow-xs p-4 mb-4">
          <div className="text-sm font-semibold text-ink mb-2.5">Team Capacity / Workload</div>
          {[...capacity.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => (
            <div key={name} className="flex items-center gap-2.5 mb-1.5 last:mb-0">
              <span className="text-xs text-muted w-16 shrink-0 truncate">{name}</span>
              <div className="flex-1 h-3 bg-divider rounded-full overflow-hidden"><div className="h-full bg-brand-500 rounded-full" style={{ width: `${(count / maxCap) * 100}%` }} /></div>
              <span className="text-xs text-dim w-4 text-right">{count}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** Pronista §PM View — Backlog พับเก็บได้ ไม่ให้แย่งพื้นที่ Dashboard */
function CollapsibleBacklog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-5">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 bg-white rounded-lg shadow-xs px-4 py-3 text-sm font-medium text-ink hover:bg-hover">
        <ChevronDown className={`w-4 h-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        Backlog
        <span className="text-xs font-normal text-muted">— งานลอยๆ ยังไม่ผูกโปรเจกต์</span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

/** Pronista §Subscription Notify — Dashboard รวมโปรเจกต์ที่ใกล้/เลยวันหมดอายุบริการ (nearExpiry จาก server)
 * คอลัมน์ตามที่กำหนด: ชื่อโปรเจกต์ / Service Type / ชื่อลูกค้า / วันที่หมดอายุ — เรียงตามวันหมดอายุใกล้สุดก่อน */
function ExpiringServicesTable({ rows }: { rows: ProjectRow[] }) {
  const navigate = useNavigate()
  const list = rows.filter((p) => p.nearExpiry).sort((a, b) => (a.serviceEndDate ?? '').localeCompare(b.serviceEndDate ?? ''))

  if (list.length === 0)
    return <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted">ไม่มีโปรเจกต์ที่ใกล้หมดอายุบริการ</div>

  return (
    <div className="bg-white rounded-lg shadow-xs overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-hover text-dim text-xs">
          <tr>
            <th className="text-left font-medium px-5 py-3">ชื่อโปรเจกต์</th>
            <th className="text-left font-medium px-3 py-3">Service Type</th>
            <th className="text-left font-medium px-3 py-3">ชื่อลูกค้า</th>
            <th className="text-left font-medium px-3 py-3 w-40">วันที่หมดอายุ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {list.map((p) => {
            const overdue = p.serviceEndDate ? p.serviceEndDate < new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10) : false
            return (
              <tr key={p.id} onClick={() => navigate(`/projects/${p.id}`)} className="hover:bg-hover cursor-pointer">
                <td className="px-5 py-3 text-body">
                  <div className="flex items-center gap-2"><ProjectIcon id={p.id} logo={p.logo} size={16} /> {p.name}</div>
                </td>
                <td className="px-3 py-3 text-muted">{(p.category === 'product' ? p.productTypeName : p.serviceTypeName) ?? '—'}</td>
                <td className="px-3 py-3 text-muted">{p.clientName ?? '—'}</td>
                <td className={`px-3 py-3 whitespace-nowrap ${overdue ? 'text-danger-600 font-medium' : 'text-body'}`}>
                  {p.serviceEndDate ? fmtThaiDate(p.serviceEndDate) : '—'}{overdue && <span className="ml-1.5 text-[10px] bg-danger-50 text-danger-600 px-1.5 py-0.5 rounded">เลยกำหนด</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const PAGE_SIZES = [10, 25, 50, 100] as const

/** มุมมองตาราง (ชื่อ + สถานะ) แบบ default — เรียงลำดับ, เลือกจำนวนต่อหน้าได้ */
function TableView({ rows }: { rows: ProjectRow[] }) {
  const navigate = useNavigate()
  const list = rows.filter((p) => p.type === 'project')
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10)
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [rows.length, pageSize])
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize))
  const pageRows = list.slice((page - 1) * pageSize, page * pageSize)

  if (list.length === 0)
    return <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted">ยังไม่มีงานโปรเจกต์</div>

  return (
    <div className="bg-white rounded-lg shadow-xs overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-hover text-dim text-xs">
          <tr>
            <th className="text-left font-medium px-5 py-3 w-14">#</th>
            <th className="text-left font-medium px-3 py-3">ชื่อโปรเจกต์ / ลูกค้า</th>
            <th className="text-left font-medium px-3 py-3 w-32">สถานะ</th>
            <th className="text-left font-medium px-3 py-3 w-28">สุขภาพ</th>
            <th className="text-left font-medium px-3 py-3 w-32">ความคืบหน้า</th>
            <th className="text-left font-medium px-3 py-3 w-16">หัวหน้า</th>
            <th className="text-left font-medium px-3 py-3 w-40">เริ่ม – กำหนดส่ง</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {pageRows.map((p, i) => {
            const health = pmHealthOf(p)
            const overdue = health === 'delayed'
            return (
              <tr key={p.id} onClick={() => navigate(`/projects/${p.id}`)} className="hover:bg-hover cursor-pointer">
                <td className="px-5 py-3 text-muted tabular-nums">{(page - 1) * pageSize + i + 1}</td>
                <td className="px-3 py-3 text-body">
                  <div className="flex items-center gap-2"><ProjectIcon id={p.id} logo={p.logo} size={16} /> {p.name}</div>
                  {p.clientName && <div className="text-[11px] text-muted mt-0.5 pl-6">{p.clientName}</div>}
                </td>
                <td className="px-3 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full ${statusChip(p.statusColor)}`}>{p.statusName}</span></td>
                <td className="px-3 py-3"><PmHealthBadge health={health} /></td>
                <td className="px-3 py-3"><ProgressBar p={p} /></td>
                <td className="px-3 py-3"><LeadAvatar p={p} /></td>
                <td className={`px-3 py-3 text-[12px] whitespace-nowrap ${overdue ? 'text-danger-600 font-medium' : 'text-muted'}`}>
                  {p.startDate ? fmtThaiDate(p.startDate) : '—'} – {p.dueDate ? fmtThaiDate(p.dueDate) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="flex items-center justify-between px-5 py-3 border-t border-divider text-xs text-dim">
        <label className="flex items-center gap-1.5">
          แสดงหน้าละ
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number])} className="text-xs bg-white border border-border rounded-lg px-1.5 py-1">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          รายการ · ทั้งหมด {list.length} รายการ
        </label>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-2.5 py-1 rounded-lg border border-border-subtle disabled:opacity-30 hover:bg-hover">ก่อนหน้า</button>
          <span>หน้า {page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-2.5 py-1 rounded-lg border border-border-subtle disabled:opacity-30 hover:bg-hover">ถัดไป</button>
        </div>
      </div>
    </div>
  )
}

type Filter = 'all' | 'project' | 'recurring' | 'archived'
const FILTER_LABEL: Record<Filter, string> = { all: 'ทั้งหมด', project: 'กำลังทำ', recurring: 'งานต่อเนื่อง', archived: 'archived' }

function SearchModal({ rows, onClose }: { rows: ProjectRow[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const navigate = useNavigate()
  const hits = useMemo(() => {
    return rows.filter((p) => {
      if (filter === 'archived' && p.statusKind !== 'archived') return false
      if (filter === 'project' && (p.type !== 'project' || p.statusKind === 'archived')) return false
      if (filter === 'recurring' && (p.type !== 'recurring' || p.statusKind === 'archived')) return false
      return p.name.toLowerCase().includes(q.trim().toLowerCase())
    })
  }, [rows, q, filter])

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/40" />
      <div className="absolute inset-x-0 top-20 mx-auto w-full max-w-xl px-4">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle">
            <Search className="w-4 h-4 text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาโปรเจกต์ (active + archived)..."
              className="flex-1 text-sm bg-transparent focus:outline-hidden placeholder:text-muted"
            />
            <kbd className="text-[10px] text-muted border border-border-subtle rounded px-1.5 py-0.5">esc</kbd>
          </div>
          <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border-subtle text-xs flex-wrap">
            <span className="text-muted mr-1">กรอง:</span>
            {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded-full ${filter === f ? 'bg-brand-600 text-white' : 'bg-divider text-soft'}`}
              >
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>
          <div className="max-h-[52vh] overflow-y-auto p-2">
            {hits.length === 0 && <div className="text-sm text-muted text-center py-8">ไม่พบโปรเจกต์</div>}
            {hits.map((p) => (
              <div
                key={p.id}
                onClick={() => {
                  onClose()
                  navigate(`/projects/${p.id}`)
                }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-hover cursor-pointer text-sm"
              >
                <ProjectIcon id={p.id} logo={p.logo} size={20} />
                <span className={`flex-1 min-w-0 truncate ${p.statusKind === 'archived' ? 'text-muted' : 'text-strong'}`}>{p.name}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${statusChip(p.statusColor)}`}>{p.statusName}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

interface TeamUser { id: string; name: string; role: string }

/** Pronista §2.4 — คำนวณวันคาดว่าเสร็จจากวันเริ่ม + จำนวนสัปดาห์ของ Sprint */
const addWeeks = (start: string, weeks: string) => {
  const d = new Date(start + 'T00:00:00')
  d.setDate(d.getDate() + Number(weeks) * 7)
  return d.toISOString().slice(0, 10)
}

interface ClientOpt { id: string; name: string }
interface ServiceTypeOpt { id: string; name: string }
interface ProductTypeOpt { id: string; name: string }

/** Pronista §Back to Basic (ต่อยอด) — ดึงตัวอักษร/ตัวเลขตัวแรกของชื่อมาเป็น Project Key อัตโนมัติ เช่น "MAKAN App Redesign" → "MAK" */
const autoProjectKey = (name: string) => name.replace(/[^a-zA-Zก-๙0-9]/g, '').slice(0, 3).toUpperCase()

function NewProjectModal({ onClose, onCreated, initialName }: { onClose: () => void; onCreated: () => void; initialName?: string }) {
  const { data: users } = useLoad<TeamUser[]>(() => api.get('/api/users'))
  const { data: clientData } = useLoad<{ rows: ClientOpt[] }>(() => api.get('/api/clients'))
  const { data: serviceTypeData } = useLoad<{ serviceTypes: ServiceTypeOpt[] }>(() => api.get('/api/admin/service-types'))
  const { data: productTypeData } = useLoad<{ productTypes: ProductTypeOpt[] }>(() => api.get('/api/admin/product-types'))
  const clients = clientData?.rows ?? []
  const serviceTypes = serviceTypeData?.serviceTypes ?? []
  const productTypes = productTypeData?.productTypes ?? []
  const team = (users ?? []).filter((u) => u.role !== 'vendor')

  const [form, setForm] = useState({
    name: initialName ?? '', category: 'project' as 'product' | 'project', description: '', clientId: '', clientName: '', leadId: '',
    startDate: '', dueDate: '', sprint: '', priority: 'normal' as 'low' | 'normal' | 'high', code: initialName ? autoProjectKey(initialName) : '',
    // Pronista §Subscription Notify — ประเภทโปรเจกต์ (project) / ประเภทสินค้า (product) + ช่วงเวลาให้บริการ (ไม่ติ๊ก = lifetime ไม่มีวันหมดอายุ)
    serviceType: '', productType: '', hasServicePeriod: false, serviceStartDate: '', serviceEndDate: '', notifyValue: '30', notifyUnit: 'day' as 'day' | 'month',
  })
  const [codeTouched, setCodeTouched] = useState(false)
  const [newClient, setNewClient] = useState(false)
  const [members, setMembers] = useState<string[]>([])
  const [error, setError] = useState('')

  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  const submit = async () => {
    try {
      const notifyBeforeDays = form.hasServicePeriod && form.notifyValue ? Number(form.notifyValue) * (form.notifyUnit === 'month' ? 30 : 1) : null
      const created = await api.post<{ id: string }>('/api/projects', {
        name: form.name,
        type: 'project',
        category: form.category,
        priority: form.priority,
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.clientId ? { clientId: form.clientId } : form.clientName.trim() ? { clientName: form.clientName.trim() } : {}),
        ...(form.leadId ? { leadId: form.leadId } : {}),
        ...(members.length ? { members } : {}),
        ...(form.sprint ? { sprint: form.sprint + ' สัปดาห์' } : {}),
        ...(form.code ? { code: form.code } : {}),
        ...(form.startDate ? { startDate: form.startDate } : {}),
        ...(form.dueDate ? { dueDate: form.dueDate } : {}),
        ...(form.serviceType ? { serviceType: form.serviceType } : {}),
        ...(form.productType ? { productType: form.productType } : {}),
        ...(form.hasServicePeriod && form.serviceStartDate ? { serviceStartDate: form.serviceStartDate } : {}),
        ...(form.hasServicePeriod && form.serviceEndDate ? { serviceEndDate: form.serviceEndDate } : {}),
        ...(notifyBeforeDays ? { notifyBeforeDays } : {}),
      })
      // Pronista §Project Refactor — เปิดโปรเจกต์ที่เพิ่งสร้างในแท็บใหม่ทันที (เหมือนแพตเทิร์นเดิมใน Docs.tsx ตอนสร้างเอกสาร)
      window.open(`/projects/${created.id}`, '_blank', 'noopener')
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ผิดพลาด')
    }
  }
  const input = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
  const label = 'text-xs font-medium text-muted mb-1 block'
  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-12 mx-auto w-full max-w-lg px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[88vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="font-semibold text-ink">โปรเจกต์ใหม่</div>
            <button onClick={onClose} className="text-muted hover:text-soft"><X className="w-5 h-5" /></button>
          </div>
          <div className="space-y-3.5">
            <div>
              <label className={label}>ชื่อโปรเจกต์</label>
              <input
                placeholder="ชื่อโปรเจกต์..."
                value={form.name}
                onChange={(e) => { const name = e.target.value; setForm({ ...form, name, code: codeTouched ? form.code : autoProjectKey(name) }) }}
                className={input}
                autoFocus
              />
            </div>

            <div>
              <label className={label}>คำอธิบายโปรเจกต์ (ถ้ามี)</label>
              <textarea placeholder="โปรยสั้นๆ ว่าโปรเจกต์นี้เกี่ยวกับอะไร…" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className={input} maxLength={300} />
            </div>

            <div>
              <label className={label}>ประเภทงาน</label>
              <div className="flex bg-divider rounded-lg p-0.5 text-sm font-medium">
                {(['product', 'project'] as const).map((t) => (
                  <button key={t} onClick={() => setForm({ ...form, category: t })} className={`flex-1 px-2.5 py-1.5 rounded-md capitalize ${form.category === t ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>
                    {t === 'product' ? '🟢 Product' : '🔵 Service'}
                  </button>
                ))}
              </div>
            </div>

            <>
              {form.category === 'project' ? (
                <div>
                  <label className={label}>Service Type</label>
                  <select value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })} className={input}>
                    <option value="">— ไม่ระบุ —</option>
                    {serviceTypes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className={label}>Product Type</label>
                  <select value={form.productType} onChange={(e) => setForm({ ...form, productType: e.target.value })} className={input}>
                    <option value="">— ไม่ระบุ —</option>
                    {productTypes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="flex items-center gap-2 text-sm text-body cursor-pointer mb-2">
                  <input type="checkbox" checked={form.hasServicePeriod} onChange={(e) => setForm({ ...form, hasServicePeriod: e.target.checked })} />
                  มีระยะเวลาให้บริการ (ไม่ติ๊ก = lifetime ไม่มีวันหมดอายุ)
                </label>
                {form.hasServicePeriod && (
                  <div className="space-y-3 pl-1">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={label}>วันเริ่มบริการ</label>
                        <input type="date" value={form.serviceStartDate} onChange={(e) => setForm({ ...form, serviceStartDate: e.target.value })} className={input} />
                      </div>
                      <div>
                        <label className={label}>วันหมดอายุบริการ</label>
                        <input type="date" value={form.serviceEndDate} onChange={(e) => setForm({ ...form, serviceEndDate: e.target.value })} className={input} />
                      </div>
                    </div>
                    <div>
                      <label className={label}>แจ้งเตือนล่วงหน้าก่อนหมดอายุ</label>
                      <div className="flex gap-2">
                        <input type="number" min={1} value={form.notifyValue} onChange={(e) => setForm({ ...form, notifyValue: e.target.value })} className={`${input} w-24`} />
                        <select value={form.notifyUnit} onChange={(e) => setForm({ ...form, notifyUnit: e.target.value as 'day' | 'month' })} className={input}>
                          <option value="day">วัน</option>
                          <option value="month">เดือน</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Priority</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as 'low' | 'normal' | 'high' })} className={input}>
                  <option value="low">ต่ำ</option>
                  <option value="normal">ปกติ</option>
                  <option value="high">สูง</option>
                </select>
              </div>
              <div>
                <label className={label}>Project Lead / หัวหน้าโครงการ</label>
                <select value={form.leadId} onChange={(e) => setForm({ ...form, leadId: e.target.value })} className={input}>
                  <option value="">— ไม่ระบุ —</option>
                  {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className={label}>ลูกค้า (ถ้ามี)</label>
              {newClient ? (
                <div className="flex gap-2">
                  <input placeholder="ชื่อลูกค้าใหม่…" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className={input} autoFocus />
                  <button onClick={() => { setNewClient(false); setForm({ ...form, clientName: '' }) }} className="text-xs px-2.5 rounded-lg border border-border-subtle text-dim hover:bg-hover whitespace-nowrap">ยกเลิก</button>
                </div>
              ) : (
                <select
                  value={form.clientId}
                  onChange={(e) => { if (e.target.value === '__new__') { setNewClient(true); setForm({ ...form, clientId: '' }) } else setForm({ ...form, clientId: e.target.value }) }}
                  className={input}
                >
                  <option value="">— ไม่ระบุ —</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="__new__">+ ลูกค้าใหม่…</option>
                </select>
              )}
            </div>

            <div>
              <label className={label}>สมาชิกในโปรเจกต์ (เลือกได้หลายคน)</label>
              <div className="border border-border-subtle rounded-lg max-h-32 overflow-y-auto divide-y divide-divider">
                {team.map((u) => (
                  <label key={u.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-hover">
                    <input type="checkbox" checked={members.includes(u.id)} onChange={() => setMembers(toggle(members, u.id))} />
                    <span className="text-body">{u.name}</span>
                    <span className="text-[11px] text-muted ml-auto">{ROLE_LABEL[u.role as keyof typeof ROLE_LABEL] ?? u.role}</span>
                  </label>
                ))}
              </div>
              {members.length > 0 && <div className="text-[11px] text-brand-700 mt-1">เลือก {members.length} คน</div>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>วันเริ่ม</label>
                <input type="date" value={form.startDate} onChange={(e) => { const s = e.target.value; setForm({ ...form, startDate: s, dueDate: s && form.sprint ? addWeeks(s, form.sprint) : form.dueDate }) }} className={input} />
              </div>
              <div>
                <label className={label}>Sprint (กี่สัปดาห์)</label>
                <select value={form.sprint} onChange={(e) => { const w = e.target.value; setForm({ ...form, sprint: w, dueDate: form.startDate && w ? addWeeks(form.startDate, w) : form.dueDate }) }} className={input}>
                  <option value="">—</option>
                  {['1', '2', '3', '4', '6', '8'].map((w) => <option key={w} value={w}>{w} สัปดาห์</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>คาดว่าเสร็จ {form.sprint && form.startDate && <span className="text-[10px] text-brand-600">(ล้อกับ Sprint)</span>}</label>
                <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={input} />
              </div>
              <div>
                <label className={label}>Project Key (รหัสอ้างอิง)</label>
                <input
                  placeholder="เช่น MAK"
                  value={form.code}
                  onChange={(e) => { setCodeTouched(true); setForm({ ...form, code: e.target.value.toUpperCase() }) }}
                  className={`${input} font-mono`}
                  maxLength={12}
                />
              </div>
            </div>

            <div className="text-[11px] text-muted">เลือกไอคอน/โลโก้ได้ในหน้าแก้ไขหลังสร้าง</div>
          </div>
          {error && <div className="text-xs text-danger-600 mt-3">{error}</div>}
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
            <button onClick={() => void submit()} disabled={!form.name} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">สร้าง</button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface BacklogTask { id: string; title: string; priority: string; assigneeName: string | null; code: string | null; locked: boolean }

/** Pronista §F2 — Backlog: งานลอยๆ ที่ยังไม่ผูกโปรเจค · +TASK สร้างไว้ก่อน แล้วจัดเข้าโปรเจกต์ย้อนหลัง
 * Pronista §Backlog cross-project convert — เมนู "จัดการ" ใช้ตัวเดียวกับ Backlog ของโปรเจกต์ (ย้ายเป็น Epic/Story/Task/Subtask/Defect/CR + เลือกโปรเจกต์ปลายทางเอง เพราะงานพวกนี้ยังไม่มีโปรเจกต์เลย) */
function BacklogSection({ isOwner, onConvertToProject }: { isOwner: boolean; onConvertToProject: (task: BacklogTask) => void }) {
  const { data, reload } = useLoad<BacklogTask[]>(() => api.get('/api/tasks/backlog'))
  const [title, setTitle] = useState('')
  const [convertModal, setConvertModal] = useState<{ taskId: string; to: ConvertTo } | null>(null)
  const list = data ?? []

  const add = async () => {
    if (!title.trim()) return
    await api.post('/api/tasks/backlog', { title: title.trim() })
    setTitle('')
    void reload()
  }

  return (
    <div className="bg-info-50 border border-info-100 rounded-lg shadow-xs p-4 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-semibold text-ink text-sm">📥 Backlog</span>
        <span className="text-[11px] text-muted">งานลอยๆ ยังไม่ผูกโปรเจค · จัดเข้าโปรเจกต์ย้อนหลังได้</span>
        <span className="ml-auto text-[11px] bg-info-100 text-info-700 px-2 py-0.5 rounded-full">{list.length} งาน</span>
      </div>
      <div className="flex gap-2 mb-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add() }} placeholder="พิมพ์ชื่องานแล้วกด Enter หรือ +TASK…" className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400" />
        <button onClick={() => void add()} disabled={!title.trim()} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40 whitespace-nowrap font-medium">+ TASK</button>
      </div>
      {list.length === 0 ? (
        <div className="text-center text-xs text-muted py-3">ยังไม่มีงานใน Backlog — พิมพ์ด้านบนเพื่อเพิ่ม</div>
      ) : (
        <div className="divide-y divide-divider">
          {list.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-border shrink-0" />
              {t.code && <span className="text-[11px] font-mono text-muted shrink-0">{t.code}</span>}
              <span className="flex-1 text-sm text-body truncate">{t.title}</span>
              {t.priority === 'high' && <span className="text-[10px] text-danger-600 bg-danger-50 px-1.5 py-0.5 rounded">สูง</span>}
              {t.assigneeName && <span className="text-[11px] text-muted">{t.assigneeName}</span>}
              <BacklogConvertMenu
                onConvertDirect={(to) => setConvertModal({ taskId: t.id, to })}
                onConvertPick={(to) => setConvertModal({ taskId: t.id, to })}
                extraItems={isOwner ? [{ label: '🏗️ ตั้งเป็นโปรเจกต์', onClick: () => onConvertToProject(t) }] : undefined}
              />
            </div>
          ))}
        </div>
      )}
      {convertModal && (
        <ConvertBacklogModal
          taskId={convertModal.taskId}
          to={convertModal.to}
          title={CONVERT_LABEL[convertModal.to]}
          onClose={() => setConvertModal(null)}
          onConverted={() => { setConvertModal(null); void reload() }}
        />
      )}
    </div>
  )
}

export function ProjectsPage() {
  const { user } = useAuth()
  const canEdit = user?.role !== 'vendor'
  // Pronista §permission: สร้างโปรเจกต์ใหม่ = จัดการข้อมูลโปรเจกต์ → หัวหน้า (owner) เท่านั้น
  const isOwner = user?.role === 'owner'
  const showMoney = false // Pronista (PM app) — ซ่อนข้อมูลเงินทั้งหมด (เก็บใน DB แต่ไม่แสดง)
  const { data, loading, reload } = useLoad<ProjectRow[]>(() => api.get('/api/projects'))
  const [searchOpen, setSearchOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  // Pronista §2.6 — "ตั้งเป็นโปรเจกต์" จาก Backlog: เก็บ task ที่กำลังแปลง + bump key ให้ BacklogSection รีเฟรชหลังลบ task เดิม
  const [convertingTask, setConvertingTask] = useState<{ id: string; title: string } | null>(null)
  const [backlogKey, setBacklogKey] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['input', 'textarea', 'select'].includes((document.activeElement?.tagName ?? '').toLowerCase())
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyK') { e.preventDefault(); setSearchOpen(true) }
      else if (e.code === 'Slash' && !typing) { e.preventDefault(); setSearchOpen(true) }
      else if (e.code === 'Escape') { setSearchOpen(false); setNewOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rows = data ?? []
  const [view, setView] = useState<'table' | 'summary' | 'timeline' | 'board' | 'expiring'>('table')
  const expiringCount = rows.filter((p) => p.nearExpiry).length
  const [catFilter, setCatFilter] = useState<'all' | 'product' | 'project'>('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [leadFilter, setLeadFilter] = useState('all')
  const [healthFilter, setHealthFilter] = useState<'all' | PmHealth>('all')
  const [activeOnly, setActiveOnly] = useState(false)
  const statusOptionsInData = useMemo(
    () => [...new Map(rows.map((p) => [p.statusName, p.statusColor])).entries()],
    [rows],
  )
  const leadOptionsInData = useMemo(() => [...new Set(rows.map((p) => p.leadName).filter((n): n is string => !!n))], [rows])
  // Pronista §โปรเจกต์ — ทุกมุมมอง (Summary/Timeline/Board/รายการ) เรียงตามความเคลื่อนไหวล่าสุดเหมือนกัน
  const filteredRows = rows
    .filter((p) => catFilter === 'all' || p.category === catFilter)
    .filter((p) => statusFilter === 'all' || p.statusName === statusFilter)
    .filter((p) => leadFilter === 'all' || p.leadName === leadFilter)
    .filter((p) => healthFilter === 'all' || pmHealthOf(p) === healthFilter)
    .filter((p) => !activeOnly || p.lastActivityAt != null)
    .sort((a, b) => (b.lastActivityAt ?? Date.parse(b.createdAt)) - (a.lastActivityAt ?? Date.parse(a.createdAt)))

  return (
    <>
      <PageHeader
        title="โปรเจกต์"
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => setSearchOpen(true)} title="ค้นหา (⌘K)" className="w-9 h-9 grid place-items-center rounded-lg border border-border-subtle text-dim hover:bg-hover">
              <Search className="w-4 h-4" />
            </button>
            {isOwner && (
              <button onClick={() => setNewOpen(true)} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-3.5 py-2 rounded-lg">
                <Plus className="w-4 h-4" /> โปรเจกต์ใหม่
              </button>
            )}
          </div>
        }
      />
      <div className="p-3 sm:p-6">
        {loading ? (
          <div className="bg-white rounded-lg shadow-xs p-10 text-center text-sm text-muted">กำลังโหลด…</div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="flex bg-divider rounded-lg p-0.5 text-sm font-medium">
                {([['table', 'List'], ['summary', 'Summary'], ['timeline', 'Timeline'], ['board', 'Board']] as const).map(([v, lbl]) => (
                  <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-md ${view === v ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>{lbl}</button>
                ))}
              </div>
              <button
                onClick={() => setView('expiring')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${view === 'expiring' ? 'bg-danger-600 text-white' : 'bg-white border border-border-subtle text-dim hover:bg-hover'}`}
              >
                <AlertTriangle className="w-3.5 h-3.5" /> บริการใกล้หมดอายุ
                {expiringCount > 0 && <span className={`text-[10px] rounded-full px-1.5 ${view === 'expiring' ? 'bg-white/20' : 'bg-danger-50 text-danger-600'}`}>{expiringCount}</span>}
              </button>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-sm bg-white border border-border rounded-lg px-2.5 py-1.5">
                <option value="all">สถานะ: ทั้งหมด</option>
                {statusOptionsInData.map(([name]) => <option key={name} value={name}>{name}</option>)}
              </select>
              <select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value as 'all' | PmHealth)} className="text-sm bg-white border border-border rounded-lg px-2.5 py-1.5">
                <option value="all">สุขภาพ: ทั้งหมด</option>
                {(['on_track', 'at_risk', 'delayed', 'completed'] as const).map((h) => <option key={h} value={h}>{PM_HEALTH_LABEL[h]}</option>)}
              </select>
              <select value={leadFilter} onChange={(e) => setLeadFilter(e.target.value)} className="text-sm bg-white border border-border rounded-lg px-2.5 py-1.5">
                <option value="all">หัวหน้า: ทั้งหมด</option>
                {leadOptionsInData.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <div className="flex bg-divider rounded-lg p-0.5 text-xs font-medium">
                {([['all', 'ทั้งหมด'], ['product', 'Product'], ['project', 'Service']] as const).map(([k, lbl]) => (
                  <button key={k} onClick={() => setCatFilter(k)} className={`px-2.5 py-1 rounded-md ${catFilter === k ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>{lbl}</button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-dim">
                <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
                เฉพาะที่มีความเคลื่อนไหว
              </label>
            </div>

            {view === 'table' && <TableView rows={filteredRows} />}

            {view === 'expiring' && <ExpiringServicesTable rows={rows} />}

            {view === 'summary' && (
              <>
                <ExecutiveWidgets rows={filteredRows} />
                <div className="bg-white rounded-lg shadow-xs p-4 mb-5">
                  <div className="font-semibold text-ink text-sm mb-3">โปรเจกต์แยกตามสถานะ</div>
                  <StatusDonut rows={filteredRows.filter((p) => p.type === 'project')} />
                </div>
              </>
            )}

            {view === 'timeline' && (
              <div className="bg-white rounded-lg shadow-xs p-4 mb-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold text-ink text-sm">ไทม์ไลน์</span>
                  <span className="text-[11px] text-muted">เส้นแดง = วันนี้ · ปี {THIS_YEAR + 543}</span>
                </div>
                <Timeline rows={filteredRows} showMoney={showMoney} />
              </div>
            )}

            {canEdit && (
              <CollapsibleBacklog>
                <BacklogSection key={backlogKey} isOwner={isOwner} onConvertToProject={(t) => { setConvertingTask(t); setNewOpen(true) }} />
              </CollapsibleBacklog>
            )}

            {view === 'summary' && (
              <>
                <div className="font-semibold text-ink mb-3">
                  โปรเจกต์ที่อัปเดตล่าสุด <span className="text-xs font-normal text-muted">· {filteredRows.filter((p) => p.type === 'project').length} รายการ</span>
                </div>
                <Cards rows={filteredRows} showMoney={showMoney} />
              </>
            )}
            {view === 'board' && <BoardView rows={filteredRows} showMoney={showMoney} />}
          </>
        )}
      </div>
      {searchOpen && <SearchModal rows={rows} onClose={() => setSearchOpen(false)} />}
      {newOpen && (
        <NewProjectModal
          initialName={convertingTask?.title}
          onClose={() => { setNewOpen(false); setConvertingTask(null) }}
          onCreated={() => {
            void (async () => {
              // Pronista §2.6 — "ตั้งเป็นโปรเจกต์": task เดิมกลายร่างเป็นโปรเจกต์ทั้งก้อน → ลบ task ใน Backlog ทิ้ง
              if (convertingTask) await api.delete(`/api/tasks/${convertingTask.id}`)
              setNewOpen(false)
              setConvertingTask(null)
              setBacklogKey((k) => k + 1)
              void reload()
            })()
          }}
        />
      )}
    </>
  )
}
