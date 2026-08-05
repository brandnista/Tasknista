import { ExternalLink, FileText, GitCompare, MoreVertical, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AddVersionModal } from './ExternalDesignAssetsSection'
import { DEFAULT_PAGE_SIZE, Pager } from './Pager'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'

// ---------- ประเภทข้อมูลจาก API ----------
interface HistoryDoc {
  id: string
  title: string
  kind: string
  docType: 'MOM' | 'BRD' | 'SOW' | 'SRS' | 'PEP' | 'UIR' | 'CR' | null
  docNumber: string | null
  docVersion: string | null
  projectId: string
  projectName: string
  updatedByName: string | null
  uploaderName: string | null
  updatedAt: number | null
  createdAt: number | null
}
interface SowTaskOpt {
  id: string
  code: string | null
  originCode: string | null
  title: string
}
interface ExternalLogRow {
  id: string
  documentName: string
  externalUrl: string
  version: string
  status: 'draft' | 'under_review' | 'approved'
  createdAt: number
  createdByName: string | null
}

// ---------- โมเดลกลาง: เล่ม (series) → เวอร์ชัน ----------
type Category = 'MOM' | 'BRD' | 'SOW' | 'SRS' | 'PEP' | 'UIR' | 'External'
const CATEGORIES: Category[] = ['MOM', 'BRD', 'SOW', 'SRS', 'PEP', 'UIR', 'External']
export const CATEGORY_LABEL: Record<Category, string> = {
  MOM: 'MOM', BRD: 'BRD', SOW: 'SOW', SRS: 'SRS', PEP: 'PEP', UIR: 'UIR', External: 'External / Design',
}

interface VersionRow {
  id: string
  version: string | null
  updatedAt: number | null
  uploaderName: string | null
  href: string
  external: boolean
  status?: ExternalLogRow['status']
  kind?: string
}
interface Series {
  key: string
  category: Category
  projectId: string
  projectName: string
  heading: string
  subtitle: string | null
  versions: VersionRow[]
  latestAt: number
}
interface FlatRow {
  series: Series
  ver: VersionRow
  isLatest: boolean
  firstOfSeries: boolean
}

const DOC_BADGE = 'text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0'
const catBadgeClass = (cat: Category) => `${DOC_BADGE} ${cat === 'External' ? 'bg-info-50 text-info-700' : 'bg-brand-50 text-brand-700'}`
const STATUS_LABEL: Record<ExternalLogRow['status'], string> = { draft: 'Draft', under_review: 'Under Review', approved: 'Approved' }
const STATUS_CHIP: Record<ExternalLogRow['status'], string> = {
  draft: 'bg-divider text-dim',
  under_review: 'bg-warning-100 text-warning-800',
  approved: 'bg-success-100 text-success-700',
}
const fmtDateTime = (t: number | null) =>
  t ? new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtVer = (v: string | null | undefined) => (v ? `v${v.replace(/^v/i, '')}` : 'v—')
const stripVersionSuffix = (title: string) => title.replace(/\s+v\d+(\.\d+)*\s*$/i, '').trim()
const cmpVersionDesc = (a: VersionRow, b: VersionRow) => {
  const pa = (a.version ?? '').split('.').map(Number)
  const pb = (b.version ?? '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (d) return d
  }
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
}

/**
 * Pronista §Project Refactor — ตาราง "ประวัติเอกสาร" ใช้ร่วมกันทั้งหน้า global (/docs/history) และแท็บในโปรเจกต์
 * เมื่อส่ง projectId มา (โหมดฝังในแท็บโปรเจกต์): กรองเหลือแค่โปรเจกต์นั้น ซ่อนคอลัมน์/ฟิลเตอร์โปรเจกต์
 * + โชว์ปุ่ม "เพิ่ม/แก้ไขเวอร์ชัน" (external log เดิมจาก External Design Assets) เมื่อ canEdit
 */
export function DocumentHistoryTable({ projectId, projectName, canEdit }: {
  projectId?: string
  projectName?: string
  canEdit?: boolean
}) {
  const { data: internal, loading: loadingInternal } = useLoad<{ docs: HistoryDoc[] }>(() => api.get('/api/document-history'))
  const { data: externalGlobal, loading: loadingExternalGlobal } = useLoad<{ logs: (ExternalLogRow & { projectId: string; projectName: string })[] }>(
    () => (projectId ? Promise.resolve({ logs: [] }) : api.get('/api/external-doc-logs')),
    [projectId],
  )
  const { data: externalScoped, loading: loadingExternalScoped, reload: reloadScoped } = useLoad<{ logs: ExternalLogRow[]; sowTaskOptions: SowTaskOpt[] }>(
    () => (projectId ? api.get(`/api/projects/${projectId}/external-doc-logs`) : Promise.resolve({ logs: [], sowTaskOptions: [] })),
    [projectId],
  )
  const [typeFilter, setTypeFilter] = useState<Category | ''>('')
  const [projectFilter, setProjectFilter] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [compareFrom, setCompareFrom] = useState<FlatRow | null>(null)
  const [addVersionOpen, setAddVersionOpen] = useState(false)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [page, setPage] = useState(1)

  const loading = loadingInternal || loadingExternalGlobal || loadingExternalScoped

  const allSeries = useMemo<Series[]>(() => {
    const map = new Map<string, Series>()

    for (const d of internal?.docs ?? []) {
      if (projectId && d.projectId !== projectId) continue
      const cat = (d.docType ?? null) as Category | null
      if (!cat || !CATEGORIES.includes(cat)) continue
      const seriesId = d.docNumber ? `num:${d.docNumber}` : `doc:${d.id}`
      const key = `${d.projectId}|${cat}|${seriesId}`
      const heading = d.docNumber ?? stripVersionSuffix(d.title)
      const ver: VersionRow = { id: d.id, version: d.docVersion, updatedAt: d.updatedAt, uploaderName: d.uploaderName, href: `/docs/${d.id}`, external: false, kind: d.kind }
      const existing = map.get(key)
      if (existing) {
        existing.versions.push(ver)
        if (!existing.subtitle) existing.subtitle = d.docNumber ? stripVersionSuffix(d.title) : null
      } else {
        map.set(key, {
          key, category: cat, projectId: d.projectId, projectName: d.projectName,
          heading, subtitle: d.docNumber ? stripVersionSuffix(d.title) : null, versions: [ver], latestAt: d.updatedAt ?? 0,
        })
      }
    }

    const externalLogs = projectId
      ? (externalScoped?.logs ?? []).map((log) => ({ ...log, projectId, projectName: projectName ?? '' }))
      : (externalGlobal?.logs ?? [])
    for (const log of externalLogs) {
      const key = `${log.projectId}|External|${log.documentName}`
      const ver: VersionRow = {
        id: log.id, version: log.version, updatedAt: log.createdAt, uploaderName: log.createdByName,
        href: '', external: true, status: log.status,
      }
      const existing = map.get(key)
      if (existing) existing.versions.push(ver)
      else map.set(key, { key, category: 'External', projectId: log.projectId, projectName: log.projectName, heading: log.documentName, subtitle: null, versions: [ver], latestAt: log.createdAt })
    }
    // href ของ external ต้องมาจาก externalUrl จริง (ไม่ได้ดึงมาข้างบนเพื่อลดโค้ดซ้ำ) — เติมทีหลัง
    const hrefById = new Map(
      (projectId ? (externalScoped?.logs ?? []) : (externalGlobal?.logs ?? [])).map((l) => [l.id, l.externalUrl]),
    )
    for (const s of map.values()) for (const v of s.versions) if (v.external) v.href = hrefById.get(v.id) ?? ''

    const series = [...map.values()]
    for (const s of series) {
      s.versions.sort(cmpVersionDesc)
      s.latestAt = s.versions[0]?.updatedAt ?? 0
    }
    series.sort((a, b) => b.latestAt - a.latestAt)
    return series
  }, [internal, externalGlobal, externalScoped, projectId, projectName])

  const presentCats = useMemo(() => CATEGORIES.filter((c) => allSeries.some((s) => s.category === c)), [allSeries])
  const projectOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of allSeries) if (!m.has(s.projectId)) m.set(s.projectId, s.projectName)
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'th'))
  }, [allSeries])

  const shownSeries = useMemo(
    () => allSeries.filter((s) => (!typeFilter || s.category === typeFilter) && (projectId || !projectFilter || s.projectId === projectFilter)),
    [allSeries, typeFilter, projectFilter, projectId],
  )

  useEffect(() => { setPage(1) }, [typeFilter, projectFilter, pageSize])

  const totalVersions = useMemo(() => shownSeries.reduce((n, s) => n + s.versions.length, 0), [shownSeries])
  const pageSeries = useMemo(() => shownSeries.slice((page - 1) * pageSize, page * pageSize), [shownSeries, page, pageSize])

  const rows = useMemo<FlatRow[]>(
    () => pageSeries.flatMap((s) => s.versions.map((ver, i) => ({ series: s, ver, isLatest: i === 0, firstOfSeries: i === 0 }))),
    [pageSeries],
  )

  const removeExternalLog = async (id: string, label: string) => {
    if (!confirm(`ลบ log "${label}"? (ใช้เฉพาะกรณีกรอกผิด — ประวัติเวอร์ชันควรเก็บไว้)`)) return
    await api.delete(`/api/external-doc-logs/${id}`)
    void reloadScoped()
  }

  const selectCls = 'text-sm bg-white border border-border rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:border-brand-400'

  return (
    <div>
      <div className="bg-white rounded-lg shadow-xs p-3 mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-muted">ประเภท:</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as Category | '')} className={selectCls}>
            <option value="">ทั้งหมด</option>
            {presentCats.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
        {!projectId && (
          <label className="flex items-center gap-1.5">
            <span className="text-xs text-muted">โปรเจกต์:</span>
            <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className={selectCls}>
              <option value="">ทุกโปรเจกต์</option>
              {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <span className="text-xs text-muted">{shownSeries.length} เล่ม · {totalVersions} เวอร์ชัน</span>
        {projectId && canEdit && (
          <button
            onClick={() => setAddVersionOpen(true)}
            className="ml-auto flex items-center gap-1.5 text-xs bg-brand-600 text-white rounded-lg px-3 py-1.5 hover:bg-brand-700 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" /> เพิ่ม/แก้ไขเวอร์ชัน (External)
          </button>
        )}
      </div>

      {loading ? (
        <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted">กำลังโหลด…</div>
      ) : shownSeries.length === 0 ? (
        <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted">
          {allSeries.length === 0 ? 'ยังไม่มีประวัติเอกสาร' : 'ไม่มีเอกสารตรงกับตัวกรอง'}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-left text-[11px] text-muted border-b border-divider bg-hover/40">
                  <th className="py-2.5 pl-3 pr-3 font-medium">ประเภท</th>
                  <th className="py-2.5 pr-3 font-medium">ชื่อเล่ม</th>
                  {!projectId && <th className="py-2.5 pr-3 font-medium">โปรเจกต์</th>}
                  <th className="py-2.5 pr-3 font-medium">เวอร์ชัน</th>
                  <th className="py-2.5 pr-3 font-medium">ผู้อัปโหลด</th>
                  <th className="py-2.5 pr-3 font-medium">แก้ไขล่าสุด</th>
                  <th className="py-2.5 pr-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {rows.map(({ series: s, ver: v, isLatest, firstOfSeries }) => (
                  <tr key={v.id} className={`hover:bg-hover align-top ${firstOfSeries ? 'border-t-2 border-border-subtle first:border-t-0' : ''}`}>
                    <td className="py-3 pl-3 pr-3">
                      {firstOfSeries ? <span className={catBadgeClass(s.category)}>{CATEGORY_LABEL[s.category]}</span> : null}
                    </td>
                    <td className="py-3 pr-3 max-w-[300px]">
                      <div className="font-mono text-body truncate">{s.heading}</div>
                      {s.subtitle && <div className="text-xs text-muted truncate">{s.subtitle}</div>}
                    </td>
                    {!projectId && (
                      <td className="py-3 pr-3">
                        <Link to={`/projects/${s.projectId}${s.category === 'External' ? '?tab=assets' : ''}`} className="text-brand-700 hover:underline whitespace-nowrap">
                          {s.projectName}
                        </Link>
                      </td>
                    )}
                    <td className="py-3 pr-3 whitespace-nowrap">
                      <span className={`${DOC_BADGE} ${isLatest ? 'bg-success-100 text-success-700' : 'bg-divider text-dim'} font-mono`}>{fmtVer(v.version)}</span>
                      {isLatest && s.versions.length > 1 && <span className="text-[10px] text-success-700 ml-1.5">ล่าสุด</span>}
                      {v.external && v.status && (
                        <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_CHIP[v.status]}`}>{STATUS_LABEL[v.status]}</span>
                      )}
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap text-body">{v.uploaderName ?? '—'}</td>
                    <td className="py-3 pr-3 whitespace-nowrap text-xs text-body">{fmtDateTime(v.updatedAt)}</td>
                    <td className="py-3 pr-3 whitespace-nowrap text-right relative">
                      {v.external ? (
                        <div className="inline-flex items-center gap-2">
                          <a href={v.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
                            เปิดลิงก์ <ExternalLink className="w-3 h-3" />
                          </a>
                          {projectId && canEdit && (
                            <button onClick={() => void removeExternalLog(v.id, `${s.heading} ${fmtVer(v.version)}`)} title="ลบ (กรณีกรอกผิด)" className="text-muted hover:text-danger-600">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => setMenuFor(menuFor === v.id ? null : v.id)}
                            className="inline-flex items-center gap-1 text-xs text-dim border border-border-subtle rounded-lg px-2 py-1 hover:bg-hover"
                          >
                            การจัดการ <MoreVertical className="w-3 h-3" />
                          </button>
                          {menuFor === v.id && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)} />
                              <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg shadow-2xl border border-border-subtle p-1.5 z-50 text-left">
                                <a
                                  href={v.href}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={() => setMenuFor(null)}
                                  className="w-full flex items-center gap-2 text-left text-sm px-3 py-2 rounded-lg hover:bg-hover"
                                >
                                  <FileText className="w-3.5 h-3.5 text-muted" /> เปิดเอกสาร
                                </a>
                                <button
                                  onClick={() => { setMenuFor(null); setCompareFrom({ series: s, ver: v, isLatest, firstOfSeries }) }}
                                  className="w-full flex items-center gap-2 text-left text-sm px-3 py-2 rounded-lg hover:bg-hover"
                                >
                                  <GitCompare className="w-3.5 h-3.5 text-muted" /> เปรียบเทียบเอกสาร
                                </button>
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-divider">
            <Pager page={page} pageSize={pageSize} total={shownSeries.length} unitLabel="เล่ม" onPage={setPage} onPageSize={setPageSize} />
          </div>
        </div>
      )}

      {compareFrom && (
        <ComparePickerModal from={compareFrom} allSeries={allSeries} onClose={() => setCompareFrom(null)} />
      )}

      {addVersionOpen && projectId && (
        <AddVersionModal
          projectId={projectId}
          sowTaskOptions={externalScoped?.sowTaskOptions ?? []}
          onClose={() => setAddVersionOpen(false)}
          onCreated={() => { setAddVersionOpen(false); void reloadScoped() }}
        />
      )}
    </div>
  )
}

/** Pronista §Document Diff — เลือกอีกเวอร์ชัน (ประเภทเอกสารเดียวกัน ไม่ใช่ตัวเอง) แล้วเปิดหน้าเปรียบเทียบในแท็บใหม่ */
function ComparePickerModal({ from, allSeries, onClose }: { from: FlatRow; allSeries: Series[]; onClose: () => void }) {
  const candidates = useMemo(
    () =>
      allSeries
        .filter((s) => s.category === from.series.category)
        .flatMap((s) => s.versions.filter((v) => !v.external && v.id !== from.ver.id).map((v) => ({ series: s, ver: v }))),
    [allSeries, from],
  )
  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-md px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-ink text-sm">เลือกเวอร์ชันที่จะเปรียบเทียบกับ {from.series.heading} · {fmtVer(from.ver.version)}</div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0">✕</button>
          </div>
          {candidates.length === 0 ? (
            <div className="text-sm text-muted text-center py-6">ไม่มีเอกสารประเภท {CATEGORY_LABEL[from.series.category]} อื่นให้เทียบ</div>
          ) : (
            <div className="space-y-1.5">
              {candidates.map((c) => (
                <a
                  key={c.ver.id}
                  href={`/docs/compare?a=${from.ver.id}&b=${c.ver.id}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={onClose}
                  className="block border border-border-subtle rounded-lg px-3 py-2 hover:bg-hover"
                >
                  <div className="text-sm text-body font-mono truncate">{c.series.heading} <span className="text-muted">· {fmtVer(c.ver.version)}</span></div>
                  <div className="text-[11px] text-muted">{c.series.projectName}</div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
