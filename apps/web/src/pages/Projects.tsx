import { Lock, Plus, Search, Unlock, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
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
  statusChip,
  TH_MONTHS,
  yearPos,
  type ProjectRow,
} from '../lib/project-ui'
import { ROLE_LABEL } from '../lib/role-label'
import { useLoad } from '../lib/useLoad'

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
          </div>
          <div className="flex items-center gap-2 mt-2.5">
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${statusChip(p.statusColor)}`}>{p.statusName}</span>
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
          <div className="text-[11px] text-muted mt-3">
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
            {col.items.map((p) => (
              <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)} className="bg-white rounded-lg shadow-xs p-3 cursor-pointer hover:shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <ProjectIcon id={p.id} logo={p.logo} size={16} />
                  <span className="text-sm text-body truncate">{p.name}</span>
                </div>
                {showMoney && p.paidPct != null && <div className="text-[11px] text-dim">{p.paidPct}% จ่ายแล้ว</div>}
                <div className="text-[11px] text-muted">{p.dueDate ? fmtThaiDate(p.dueDate) : 'ไม่มีกำหนดส่ง'}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
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
    <div className="bg-white rounded-lg shadow-xs overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-hover text-dim text-xs">
          <tr>
            <th className="text-left font-medium px-5 py-3 w-14">#</th>
            <th className="text-left font-medium px-3 py-3">ชื่อโปรเจกต์</th>
            <th className="text-left font-medium px-5 py-3 w-40">สถานะ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {pageRows.map((p, i) => (
            <tr key={p.id} onClick={() => navigate(`/projects/${p.id}`)} className="hover:bg-hover cursor-pointer">
              <td className="px-5 py-3 text-muted tabular-nums">{(page - 1) * pageSize + i + 1}</td>
              <td className="px-3 py-3 text-body flex items-center gap-2"><ProjectIcon id={p.id} logo={p.logo} size={16} /> {p.name}</td>
              <td className="px-5 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full ${statusChip(p.statusColor)}`}>{p.statusName}</span></td>
            </tr>
          ))}
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

interface StatusOpt { id: string; name: string }
interface TeamUser { id: string; name: string; role: string }

/** Tasknista §2.4 — คำนวณวันคาดว่าเสร็จจากวันเริ่ม + จำนวนสัปดาห์ของ Sprint */
const addWeeks = (start: string, weeks: string) => {
  const d = new Date(start + 'T00:00:00')
  d.setDate(d.getDate() + Number(weeks) * 7)
  return d.toISOString().slice(0, 10)
}

/** หมวดบริการ/สถานะย่อย (tag) — Tasknista §F1 (รูปแนบ 4) + §2.11 (ใช้ได้ทั้ง product/project) */
const PROJECT_TAGS = [
  'Website Development', 'Mobile Application Development', 'Digital Marketing', 'Digital Production',
  'E-Commerce', 'E-Commerce Management', 'Consulting', 'In-House Training', 'SI & Infrastructure',
  'Sellnista', 'Paynista', 'Signnista', 'Sharenista', 'Munista', 'Jobnista',
  'Auctionnista', 'Allnista', 'Beautynista', 'Brandnista', 'Pronista', 'Packnista',
  // Tasknista §2.11 — "Status UI/Dev" ฝั่ง Product (Debug/Wireframe Design ฯลฯ)
  'Concept Design', 'Wireframe Design', 'Database Design', 'Development', 'Debug',
]

function NewProjectModal({ onClose, onCreated, initialName }: { onClose: () => void; onCreated: () => void; initialName?: string }) {
  const { data: cfg } = useLoad<{ projectStatuses: StatusOpt[]; productStatuses: StatusOpt[] }>(() => api.get('/api/config'))
  const { data: users } = useLoad<TeamUser[]>(() => api.get('/api/users'))
  const team = (users ?? []).filter((u) => u.role !== 'vendor')

  const [form, setForm] = useState({
    name: initialName ?? '', category: 'project' as 'product' | 'project', status: '', clientId: '', clientName: '',
    startDate: '', dueDate: '', sprint: '', priority: 'normal' as 'low' | 'normal' | 'high', code: '', url: '',
  })
  const [tags, setTags] = useState<string[]>([])
  const [members, setMembers] = useState<string[]>([])
  const [error, setError] = useState('')

  const statusOptions = (form.category === 'product' ? cfg?.productStatuses : cfg?.projectStatuses) ?? []
  // ตั้งสถานะ default = ตัวแรกของชุด เมื่อเปลี่ยน category / โหลด config
  useEffect(() => {
    const first = statusOptions[0]
    if (first) setForm((f) => ({ ...f, status: first.id }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.category, cfg])

  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  const submit = async () => {
    try {
      const created = await api.post<{ id: string }>('/api/projects', {
        name: form.name,
        type: 'project',
        category: form.category,
        status: form.status || undefined,
        priority: form.priority,
        ...(form.clientId ? { clientId: form.clientId } : form.clientName ? { clientName: form.clientName } : {}),
        ...(tags.length ? { tags } : {}),
        ...(members.length ? { members } : {}),
        ...(form.sprint ? { sprint: form.sprint + ' สัปดาห์' } : {}),
        ...(form.code ? { code: form.code } : {}),
        ...(form.url ? { url: form.url } : {}),
        ...(form.startDate ? { startDate: form.startDate } : {}),
        ...(form.dueDate ? { dueDate: form.dueDate } : {}),
      })
      // Tasknista §Project Refactor — เปิดโปรเจกต์ที่เพิ่งสร้างในแท็บใหม่ทันที (เหมือนแพตเทิร์นเดิมใน Docs.tsx ตอนสร้างเอกสาร)
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
              <input placeholder="ชื่อโปรเจกต์..." value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} autoFocus />
            </div>

            <div>
              <label className={label}>ประเภทงาน</label>
              <div className="flex bg-divider rounded-lg p-0.5 text-sm font-medium">
                {(['product', 'project'] as const).map((t) => (
                  <button key={t} onClick={() => setForm({ ...form, category: t })} className={`flex-1 px-2.5 py-1.5 rounded-md capitalize ${form.category === t ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>
                    {t === 'product' ? '🟢 Product' : '🔵 Project'}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>สถานะ</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={input}>
                  {statusOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Priority</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as 'low' | 'normal' | 'high' })} className={input}>
                  <option value="low">ต่ำ</option>
                  <option value="normal">ปกติ</option>
                  <option value="high">สูง</option>
                </select>
              </div>
            </div>

            <div>
              <label className={label}>หมวดบริการ / สถานะย่อย (Tag · เลือกได้หลายอัน)</label>
              <div className="flex flex-wrap gap-1.5">
                {PROJECT_TAGS.map((t) => {
                  const on = tags.includes(t)
                  return (
                    <button key={t} onClick={() => setTags(toggle(tags, t))} className={`text-xs px-2.5 py-1 rounded-full border ${on ? 'bg-brand-50 border-brand-400 text-brand-700 font-medium' : 'bg-hover border-border-subtle text-dim'}`}>
                      {t}
                    </button>
                  )
                })}
              </div>
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
              <div><label className={label}>Code name</label><input placeholder="เช่น SAP" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={input} maxLength={12} /></div>
            </div>

            <div><label className={label}>URL (ถ้ามี)</label><input placeholder="เช่น https://example.com" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className={input} /></div>

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
interface BoardTaskOpt { id: string; title: string; code: string | null }

/** Tasknista §2.6 — 4 ทางเลือกย้ายงานจาก Backlog: ตั้งเป็นโปรเจกต์ / ย้ายไปโปรเจกต์ / ย้ายเป็น Sub-task / Defect */
function BacklogMoveModal({ task, projects, isOwner, onClose, onMoved, onConvertToProject }: {
  task: BacklogTask
  projects: ProjectRow[]
  isOwner: boolean
  onClose: () => void
  onMoved: () => void
  onConvertToProject: (task: BacklogTask) => void
}) {
  const [mode, setMode] = useState<'menu' | 'move' | 'subtask' | 'defect'>('menu')
  const [projectId, setProjectId] = useState('')
  const [boardTasks, setBoardTasks] = useState<BoardTaskOpt[]>([])
  const [parentTaskId, setParentTaskId] = useState('')
  const [team, setTeam] = useState<TeamUser[]>([])
  const [reporterType, setReporterType] = useState<'customer' | 'self'>('self')
  const [assigneeId, setAssigneeId] = useState('')
  const [links, setLinks] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (mode !== 'subtask' || !projectId) { setBoardTasks([]); return }
    void api.get<{ groups: { tasks: BoardTaskOpt[] }[] }>(`/api/projects/${projectId}/board`).then((b) => {
      setBoardTasks(b.groups.flatMap((g) => g.tasks))
    })
  }, [mode, projectId])

  useEffect(() => {
    if (mode !== 'defect' || team.length > 0) return
    void api.get<TeamUser[]>('/api/users').then((users) => setTeam(users.filter((u) => u.role !== 'vendor')))
  }, [mode, team.length])

  const moveToProject = async () => {
    try {
      // เซิร์ฟเวอร์จะหา/สร้างกลุ่มงานแรกให้เองถ้าโปรเจกต์ยังไม่มีกลุ่มเลย (ไม่บล็อกผู้ใช้)
      await api.patch(`/api/tasks/${task.id}`, { projectId })
      onMoved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ผิดพลาด')
    }
  }
  const moveAsSubtask = async () => {
    if (!parentTaskId) return
    try {
      await api.patch(`/api/tasks/${task.id}`, { parentId: parentTaskId })
      onMoved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ผิดพลาด')
    }
  }
  const createDefect = async () => {
    if (!projectId || !assigneeId) return
    setBusy(true)
    try {
      // เซิร์ฟเวอร์จะหา/สร้างกลุ่มงานแรกให้เองถ้าโปรเจกต์ยังไม่มีกลุ่มเลย (ไม่บล็อกผู้ใช้)
      await api.patch(`/api/tasks/${task.id}`, {
        projectId, kind: 'defect', reporterType, assigneeId,
        ...(links.trim() ? { description: links.trim() } : {}),
      })
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        await fetch(`/api/tasks/${task.id}/attachments`, { method: 'POST', body: form })
      }
      onMoved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ผิดพลาด')
    } finally {
      setBusy(false)
    }
  }

  const item = 'w-full text-left text-sm px-4 py-3 rounded-lg border border-border-subtle hover:bg-hover flex items-center gap-2.5'
  const select = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
  const label = 'text-xs font-medium text-muted mb-1 block'

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-sm px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-ink text-sm truncate">{task.code ? `${task.code} · ` : ''}{task.title}</div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
          </div>

          {mode === 'menu' && (
            <div className="space-y-2">
              {isOwner && (
                <button className={item} onClick={() => onConvertToProject(task)}>🏗️ <span>ตั้งเป็นโปรเจกต์</span></button>
              )}
              <button className={item} onClick={() => setMode('move')}>➡️ <span>ย้ายไปที่โปรเจกต์</span></button>
              <button className={item} onClick={() => setMode('subtask')}>🔗 <span>ย้ายเป็น Sub-task</span></button>
              <button className={item} onClick={() => setMode('defect')}>🐛 <span>Defect</span></button>
            </div>
          )}

          {mode === 'move' && (
            <div className="space-y-3">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={select}>
                <option value="">เลือกโปรเจกต์…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="flex justify-end gap-2">
                <button onClick={() => setMode('menu')} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ย้อนกลับ</button>
                <button onClick={() => void moveToProject()} disabled={!projectId} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">ย้าย</button>
              </div>
            </div>
          )}

          {mode === 'subtask' && (
            <div className="space-y-3">
              <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setParentTaskId('') }} className={select}>
                <option value="">เลือกโปรเจกต์…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={parentTaskId} onChange={(e) => setParentTaskId(e.target.value)} className={select} disabled={!projectId}>
                <option value="">{projectId && boardTasks.length === 0 ? 'โปรเจกต์นี้ยังไม่มี task' : 'เลือก task แม่…'}</option>
                {boardTasks.map((t) => <option key={t.id} value={t.id}>{t.code ? `${t.code} · ` : ''}{t.title}</option>)}
              </select>
              <div className="flex justify-end gap-2">
                <button onClick={() => setMode('menu')} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ย้อนกลับ</button>
                <button onClick={() => void moveAsSubtask()} disabled={!parentTaskId} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">ย้ายเป็น Sub-task</button>
              </div>
            </div>
          )}

          {mode === 'defect' && (
            <div className="space-y-3">
              <div>
                <label className={label}>โปรเจกต์</label>
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={select}>
                  <option value="">เลือกโปรเจกต์…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>ผู้แจ้ง</label>
                <select value={reporterType} onChange={(e) => setReporterType(e.target.value as 'customer' | 'self')} className={select}>
                  <option value="self">พบเอง</option>
                  <option value="customer">ลูกค้า</option>
                </select>
              </div>
              <div>
                <label className={label}>Assign to</label>
                <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={select}>
                  <option value="">เลือกผู้รับผิดชอบ…</option>
                  {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>ลิงก์อ้างอิง (ถ้ามี)</label>
                <textarea value={links} onChange={(e) => setLinks(e.target.value)} placeholder="วางลิงก์ที่เกี่ยวข้อง…" rows={2} className={select} />
              </div>
              <div>
                <label className={label}>แนบไฟล์ (ถ้ามี)</label>
                <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="text-xs text-dim w-full" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setMode('menu')} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ย้อนกลับ</button>
                <button onClick={() => void createDefect()} disabled={!projectId || !assigneeId || busy} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">{busy ? 'กำลังบันทึก…' : 'สร้าง Defect'}</button>
              </div>
            </div>
          )}
          {error && <div className="text-xs text-danger-600 mt-3">{error}</div>}
        </div>
      </div>
    </div>
  )
}

/** Tasknista §F2 — Backlog: งานลอยๆ ที่ยังไม่ผูกโปรเจค · +TASK สร้างไว้ก่อน แล้วจัดเข้าโปรเจกต์ย้อนหลัง */
function BacklogSection({ projects, isOwner, onConvertToProject }: { projects: ProjectRow[]; isOwner: boolean; onConvertToProject: (task: BacklogTask) => void }) {
  const { data, reload } = useLoad<BacklogTask[]>(() => api.get('/api/tasks/backlog'))
  const [title, setTitle] = useState('')
  const [moving, setMoving] = useState<BacklogTask | null>(null)
  const list = data ?? []
  const active = projects.filter((p) => p.statusKind !== 'archived')

  const add = async () => {
    if (!title.trim()) return
    await api.post('/api/tasks/backlog', { title: title.trim() })
    setTitle('')
    void reload()
  }

  // Tasknista §4 — ล็อค/ปลดล็อค task ใน Company Backlog (owner เท่านั้น)
  const toggleLock = async (t: BacklogTask) => {
    await api.patch(`/api/tasks/${t.id}`, { locked: !t.locked })
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
              {t.locked && (
                <span title="ล็อคแล้ว — แก้ไข/ย้าย/ลบได้เฉพาะ Owner" className="shrink-0">
                  <Lock className="w-3.5 h-3.5 text-warning-600" />
                </span>
              )}
              {t.priority === 'high' && <span className="text-[10px] text-danger-600 bg-danger-50 px-1.5 py-0.5 rounded">สูง</span>}
              {t.assigneeName && <span className="text-[11px] text-muted">{t.assigneeName}</span>}
              {isOwner && (
                <button
                  onClick={() => void toggleLock(t)}
                  title={t.locked ? 'ปลดล็อค' : 'ล็อค'}
                  className="w-7 h-7 grid place-items-center rounded-lg border border-border-subtle text-dim bg-white hover:bg-hover shrink-0"
                >
                  {t.locked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                </button>
              )}
              {(isOwner || !t.locked) && (
                <button onClick={() => setMoving(t)} className="text-xs border border-border-subtle rounded-lg px-2.5 py-1.5 text-dim bg-white hover:bg-hover whitespace-nowrap">จัดการ ▾</button>
              )}
            </div>
          ))}
        </div>
      )}
      {moving && (
        <BacklogMoveModal
          task={moving}
          projects={active}
          isOwner={isOwner}
          onClose={() => setMoving(null)}
          onMoved={() => { setMoving(null); void reload() }}
          onConvertToProject={(t) => { setMoving(null); onConvertToProject(t) }}
        />
      )}
    </div>
  )
}

export function ProjectsPage() {
  const { user } = useAuth()
  const canEdit = user?.role !== 'vendor'
  // Tasknista §permission: สร้างโปรเจกต์ใหม่ = จัดการข้อมูลโปรเจกต์ → หัวหน้า (owner) เท่านั้น
  const isOwner = user?.role === 'owner'
  const showMoney = false // Tasknista (PM app) — ซ่อนข้อมูลเงินทั้งหมด (เก็บใน DB แต่ไม่แสดง)
  const { data, loading, reload } = useLoad<ProjectRow[]>(() => api.get('/api/projects'))
  const [searchOpen, setSearchOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  // Tasknista §2.6 — "ตั้งเป็นโปรเจกต์" จาก Backlog: เก็บ task ที่กำลังแปลง + bump key ให้ BacklogSection รีเฟรชหลังลบ task เดิม
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
  const [view, setView] = useState<'table' | 'summary' | 'timeline' | 'board'>('table')
  const [catFilter, setCatFilter] = useState<'all' | 'product' | 'project'>('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [activeOnly, setActiveOnly] = useState(false)
  const statusOptionsInData = useMemo(
    () => [...new Map(rows.map((p) => [p.statusName, p.statusColor])).entries()],
    [rows],
  )
  // Tasknista §โปรเจกต์ — ทุกมุมมอง (Summary/Timeline/Board/รายการ) เรียงตามความเคลื่อนไหวล่าสุดเหมือนกัน
  const filteredRows = rows
    .filter((p) => catFilter === 'all' || p.category === catFilter)
    .filter((p) => statusFilter === 'all' || p.statusName === statusFilter)
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
                {([['table', 'รายการ'], ['summary', 'Summary'], ['timeline', 'Timeline'], ['board', 'Board']] as const).map(([v, lbl]) => (
                  <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-md ${view === v ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>{lbl}</button>
                ))}
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-sm bg-white border border-border rounded-lg px-2.5 py-1.5">
                <option value="all">สถานะ: ทั้งหมด</option>
                {statusOptionsInData.map(([name]) => <option key={name} value={name}>{name}</option>)}
              </select>
              <div className="flex bg-divider rounded-lg p-0.5 text-xs font-medium">
                {([['all', 'ทั้งหมด'], ['product', 'Product'], ['project', 'Project']] as const).map(([k, lbl]) => (
                  <button key={k} onClick={() => setCatFilter(k)} className={`px-2.5 py-1 rounded-md ${catFilter === k ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>{lbl}</button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-dim">
                <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
                เฉพาะที่มีความเคลื่อนไหว
              </label>
            </div>

            {view === 'table' && <TableView rows={filteredRows} />}

            {view === 'summary' && (
              <div className="bg-white rounded-lg shadow-xs p-4 mb-5">
                <div className="font-semibold text-ink text-sm mb-3">โปรเจกต์แยกตามสถานะ</div>
                <StatusDonut rows={filteredRows.filter((p) => p.type === 'project')} />
              </div>
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

            {canEdit && <BacklogSection key={backlogKey} projects={rows} isOwner={isOwner} onConvertToProject={(t) => { setConvertingTask(t); setNewOpen(true) }} />}

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
              // Tasknista §2.6 — "ตั้งเป็นโปรเจกต์": task เดิมกลายร่างเป็นโปรเจกต์ทั้งก้อน → ลบ task ใน Backlog ทิ้ง
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
