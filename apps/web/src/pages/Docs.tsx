import {
  FilePlus, FileText, Filter, Folder, FolderInput, FolderPlus, Grid2x2, Image as ImageIcon, List, ListTree, Link2, MoreVertical, Pencil, Plus, Search, Trash2, Upload, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useDialog } from '../components/Dialog'
import { SowUploadBreakoutModal } from '../components/SowUploadBreakoutModal'
import { TemplatePickerModal } from '../components/doc-templates/TemplatePickerModal'
import { DEFAULT_PAGE_SIZE, Pager } from '../components/Pager'
import { PageHeader } from '../components/PageHeader'
import { api } from '../lib/api'
import { fmtThaiDate } from '../lib/project-ui'
import { useLoad } from '../lib/useLoad'

interface DocNode {
  id: string
  parentId: string | null
  sortOrder: number
  icon: string | null
  title: string
  kind: 'page' | 'link' | 'file' | 'template' | 'folder'
  externalUrl: string | null
  filename: string | null
  mime: string | null
  isTemplate: boolean
  // Tasknista §Document Template — เลขที่เอกสาร (โชว์แทนชื่อในทรีถ้ามี) — null ถ้าไม่ใช่ template หรือ template ที่ยังไม่ gen เลขที่
  templateDocNumber: string | null
  // Tasknista §Document Traceability — ประเภทเอกสารสำหรับฟิลเตอร์ + โปรเจกต์ที่ผูกไว้อันแรก
  docType: 'MOM' | 'BRD' | 'SOW' | 'SRS' | 'PEP' | 'UIR' | 'CR' | null
  linkedProjectId: string | null
  ownerId: string | null
  visibility: 'private' | 'team'
  myAccess: 'owner' | 'editor' | 'viewer'
  // Tasknista §Document Management MVP — Grid view โชว์ "แก้ไขล่าสุดโดยใคร/เมื่อไร"
  updatedAt: string | null
  updatedByName: string | null
}
interface ProjectOpt {
  id: string
  name: string
}

const canEditAccess = (a: DocNode['myAccess']) => a === 'owner' || a === 'editor'
const DOC_TYPES = ['MOM', 'BRD', 'SOW', 'SRS', 'PEP', 'UIR', 'CR'] as const
type DocType = (typeof DOC_TYPES)[number]

/** เมนู "+ เพิ่ม" เดียว (หน้าใหม่/ลิงก์ Google Docs/อัปโหลดไฟล์/เอกสาร Template/อัปโหลดแตกเป็น Task/โฟลเดอร์ใหม่) แทนปุ่มกระจัดกระจาย — ลอยตรงตำแหน่งที่กด */
function AddMenu({ x, y, onClose, onPage, onLink, onUpload, onTemplate, onUploadBreakout, onFolder }: {
  x: number
  y: number
  onClose: () => void
  onPage: () => void
  onLink: () => void
  onUpload: () => void
  onTemplate: () => void
  onUploadBreakout: () => void
  onFolder: () => void
}) {
  const item = 'w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-hover flex items-center gap-2'
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ left: x, top: y }}
        className="absolute w-56 bg-white rounded-lg shadow-2xl border border-border-subtle p-1.5"
      >
        <button className={item} onClick={() => { onPage(); onClose() }}><FilePlus className="w-4 h-4 text-muted" /> หน้าใหม่</button>
        <button className={item} onClick={() => { onFolder(); onClose() }}><FolderPlus className="w-4 h-4 text-muted" /> โฟลเดอร์ใหม่</button>
        <button className={item} onClick={() => { onLink(); onClose() }}><Link2 className="w-4 h-4 text-muted" /> ลิงก์ Google Docs</button>
        <button className={item} onClick={() => { onUpload(); onClose() }}><Upload className="w-4 h-4 text-muted" /> อัปโหลดไฟล์ (Word/PDF)</button>
        <button className={item} onClick={() => { onTemplate(); onClose() }}><FileText className="w-4 h-4 text-muted" /> เอกสาร Template</button>
        <div className="my-1 border-t border-divider" />
        <button className={item} onClick={() => { onUploadBreakout(); onClose() }}><ListTree className="w-4 h-4 text-muted" /> อัปโหลดเอกสาร (แตกเป็น Task)</button>
      </div>
    </div>
  )
}

/** เลือกแท็กประเภทเอกสาร (ไม่บังคับ) หลังเลือกไฟล์แล้ว ก่อนอัปโหลดจริง — ใช้เพื่อให้ฟิลเตอร์หน้าเอกสารหาไฟล์ที่อัปโหลดเองเจอ */
function UploadDocTypeModal({ filename, onClose, onConfirm }: { filename: string; onClose: () => void; onConfirm: (docType: DocType | null) => void }) {
  const [docType, setDocType] = useState<DocType | ''>('')
  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-sm px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5">
          <div className="font-semibold text-ink text-sm mb-1">อัปโหลด — {filename}</div>
          <p className="text-xs text-muted mb-3">แท็กประเภทเอกสาร (ไม่บังคับ) เพื่อให้หาเจอง่ายขึ้นในช่องค้นหา/ฟิลเตอร์</p>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value as DocType | '')}
            className="w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400 mb-4"
          >
            <option value="">ไม่ระบุประเภท</option>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
            <button onClick={() => onConfirm(docType || null)} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700">อัปโหลด</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** เมนูจัดการเอกสาร (⋮): เปลี่ยนชื่อ/ย้ายไปโฟลเดอร์/ลบ — ใช้กับทุกเอกสารที่แก้ไขได้ ทั้ง Grid/List */
function DocActionsMenu({ x, y, onClose, onRename, onMove, onDelete }: {
  x: number
  y: number
  onClose: () => void
  onRename: () => void
  onMove: () => void
  onDelete: () => void
}) {
  const item = 'w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-hover flex items-center gap-2'
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ left: x, top: y }}
        className="absolute w-48 bg-white rounded-lg shadow-2xl border border-border-subtle p-1.5"
      >
        <button className={item} onClick={() => { onRename(); onClose() }}><Pencil className="w-4 h-4 text-muted" /> เปลี่ยนชื่อ</button>
        <button className={item} onClick={() => { onMove(); onClose() }}><FolderInput className="w-4 h-4 text-muted" /> ย้ายไปโฟลเดอร์</button>
        <div className="my-1 border-t border-divider" />
        <button className={`${item} text-danger-600`} onClick={() => { onDelete(); onClose() }}><Trash2 className="w-4 h-4" /> ลบ</button>
      </div>
    </div>
  )
}

/** เลือกโฟลเดอร์ปลายทาง (แสดงย่อหน้าตามความลึก) — ว่าง = ย้ายออกมาไว้บนสุด (ไม่อยู่ในโฟลเดอร์) */
function MoveDocModal({ doc, folders, onClose, onConfirm }: {
  doc: DocNode
  folders: { id: string; label: string }[]
  onClose: () => void
  onConfirm: (parentId: string | null) => void
}) {
  const [target, setTarget] = useState(doc.parentId ?? '')
  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-sm px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5">
          <div className="font-semibold text-ink text-sm mb-1">ย้าย &quot;{doc.templateDocNumber ?? doc.title}&quot;</div>
          <p className="text-xs text-muted mb-3">เลือกโฟลเดอร์ปลายทาง</p>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400 mb-4"
          >
            <option value="">(ไม่อยู่ในโฟลเดอร์ — บนสุด)</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
            <button onClick={() => onConfirm(target || null)} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700">ย้าย</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** ไล่โฟลเดอร์ทั้งหมดจากบนลงล่าง คืนรายการ {id,label} พร้อมย่อหน้าแสดงความลึก ไว้ใช้เป็นตัวเลือกใน MoveDocModal */
function buildFolderOptions(folders: DocNode[]): { id: string; label: string }[] {
  const childrenOf = new Map<string | null, DocNode[]>()
  for (const f of folders) {
    const key = f.parentId
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key)!.push(f)
  }
  const out: { id: string; label: string }[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const f of childrenOf.get(parentId) ?? []) {
      out.push({ id: f.id, label: `${'　'.repeat(depth)}${depth > 0 ? '└ ' : ''}${f.title}` })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

const DOC_TYPE_BADGE = 'text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-brand-50 text-brand-700'

function DocRowIcon({ n }: { n: DocNode }) {
  if (n.icon) return <span className="shrink-0 text-sm leading-none">{n.icon}</span>
  if (n.kind === 'folder') return <Folder className="w-3.5 h-3.5 text-muted shrink-0" />
  if (n.kind === 'link') return <Link2 className="w-3.5 h-3.5 text-info-500 shrink-0" />
  return <FileText className="w-3.5 h-3.5 text-brand-500 shrink-0" />
}

/** Tasknista §Document Management MVP — ไอคอนสีตามประเภทไฟล์จริง (Word/PDF/รูปภาพ/ลิงก์/หน้าวิกิ) ใช้ในการ์ด Grid view */
function DocFileTile({ n }: { n: DocNode }) {
  const mime = n.mime ?? ''
  const base = 'w-8 h-8 rounded-md grid place-items-center shrink-0'
  if (mime === 'application/pdf') return <div className={`${base} bg-danger-600 text-white text-[10px] font-bold`}>PDF</div>
  if (mime.includes('word')) return <div className={`${base} bg-info-600 text-white text-sm font-bold`}>W</div>
  if (mime.startsWith('image/')) return <div className={`${base} bg-warning-100 text-warning-700`}><ImageIcon className="w-4 h-4" /></div>
  if (n.kind === 'link') return <div className={`${base} bg-info-50 text-info-600`}><Link2 className="w-4 h-4" /></div>
  return <div className={`${base} bg-brand-50 text-brand-600`}><FileText className="w-4 h-4" /></div>
}

/** 2026-07-15T08:11:00.000Z → "15:11" ถ้าเป็นวันนี้ (Asia/Bangkok) หรือ "9 ก.ค." ถ้าไม่ใช่ */
function fmtUpdated(iso: string | null): string | null {
  if (!iso) return null
  const bkk = new Date(new Date(iso).getTime() + 7 * 3_600_000)
  const bkkNow = new Date(Date.now() + 7 * 3_600_000)
  const bkkDateStr = bkk.toISOString().slice(0, 10)
  if (bkkDateStr === bkkNow.toISOString().slice(0, 10)) {
    return `${String(bkk.getUTCHours()).padStart(2, '0')}:${String(bkk.getUTCMinutes()).padStart(2, '0')}`
  }
  return fmtThaiDate(bkkDateStr)
}

/** การ์ด Grid view แบบ Google Docs — ไอคอนตามประเภทไฟล์จริง + ใครแก้ไขล่าสุดเมื่อไร + ปุ่มจัดการ (⋮) ถ้าแก้ไขได้ + ลากเข้าโฟลเดอร์แนะนำได้ */
function DocGridCard({ n, projectName, onMenu }: { n: DocNode; projectName: string | null; onMenu?: (rect: DOMRect) => void }) {
  const updated = fmtUpdated(n.updatedAt)
  const canEdit = canEditAccess(n.myAccess)
  return (
    <a
      href={`/docs/${n.id}`}
      target="_blank"
      rel="noopener"
      draggable={canEdit}
      onDragStart={(e) => { if (!canEdit) return; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.id) }}
      className="group relative flex flex-col gap-2 border border-border-subtle rounded-lg p-3 hover:bg-hover"
    >
      {onMenu && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMenu(e.currentTarget.getBoundingClientRect()) }}
          title="จัดการเอกสาร"
          className="absolute top-1.5 right-1.5 w-6 h-6 grid place-items-center rounded text-muted hover:bg-border opacity-0 group-hover:opacity-100"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="flex items-center gap-2 min-w-0 pr-5">
        <DocFileTile n={n} />
        <span className="text-sm text-body truncate flex-1 min-w-0">{n.templateDocNumber ?? n.title}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {n.docType && <span className={DOC_TYPE_BADGE}>{n.docType}</span>}
        {projectName && <span className="text-xs text-muted truncate">{projectName}</span>}
      </div>
      {(updated || n.updatedByName) && (
        <div className="text-xs text-muted truncate">
          {n.updatedByName ? `${n.updatedByName} แก้ไข` : 'แก้ไข'}{updated ? ` • ${updated}` : ''}
        </div>
      )}
    </a>
  )
}

/** แถว List view — เหมือนเดิม + ปุ่มจัดการ (⋮) ถ้าแก้ไขได้ + ลากเข้าโฟลเดอร์แนะนำได้ */
function DocListRow({ n, projectName, onMenu }: { n: DocNode; projectName: string | null; onMenu?: (rect: DOMRect) => void }) {
  const canEdit = canEditAccess(n.myAccess)
  return (
    <a
      href={`/docs/${n.id}`}
      target="_blank"
      rel="noopener"
      draggable={canEdit}
      onDragStart={(e) => { if (!canEdit) return; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.id) }}
      className="group flex items-center gap-2.5 px-3 py-2.5 hover:bg-hover rounded-lg"
    >
      <DocRowIcon n={n} />
      <span className="flex-1 min-w-0 truncate text-sm text-body">{n.templateDocNumber ?? n.title}</span>
      {projectName && <span className="text-xs text-muted shrink-0 hidden sm:inline">{projectName}</span>}
      {n.docType && <span className={DOC_TYPE_BADGE}>{n.docType}</span>}
      {onMenu && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMenu(e.currentTarget.getBoundingClientRect()) }}
          title="จัดการเอกสาร"
          className="w-6 h-6 grid place-items-center rounded text-muted hover:bg-border shrink-0 opacity-0 group-hover:opacity-100"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </button>
      )}
    </a>
  )
}

export function DocsPage() {
  const { data: nodes, reload: reloadTree } = useLoad<DocNode[]>(() => api.get('/api/docs'))
  const { data: projectOpts } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const { confirmDialog, promptDialog } = useDialog()
  const [addMenu, setAddMenu] = useState<{ parentId: string | null; x: number; y: number } | null>(null)
  const [templatePicker, setTemplatePicker] = useState<{ parentId: string | null } | null>(null)
  const [pendingUpload, setPendingUpload] = useState<File | null>(null)
  const [uploadBreakoutOpen, setUploadBreakoutOpen] = useState(false)
  const [searchParams] = useSearchParams()

  // Tasknista §Document Management MVP — สลับมุมมอง List (ทรีเดิม) / Grid (การ์ดไฟล์แบบ flat) จำโหมดล่าสุดไว้
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => (localStorage.getItem('docs-view-mode') === 'grid' ? 'grid' : 'list'))
  useEffect(() => { localStorage.setItem('docs-view-mode', viewMode) }, [viewMode])
  // เลือกโฟลเดอร์แนะนำ = กรองรายการเอกสารด้านล่างให้เหลือเฉพาะเอกสารในโฟลเดอร์นั้น (รวมโฟลเดอร์ย่อย)
  const [activeFolder, setActiveFolder] = useState<string | null>(null)

  // ค้นหา/ฟิลเตอร์แบบ Google Drive — มีตัวใดตัวหนึ่งใช้งานอยู่ = สลับจากทรีเป็นลิสต์แบนของผลลัพธ์
  const [search, setSearch] = useState('')
  const [docTypeFilters, setDocTypeFilters] = useState<Set<DocType>>(new Set())
  const [projectFilter, setProjectFilter] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Tasknista §Document Management MVP — แบ่งหน้า: ค่าเริ่มต้น 20 เอกสาร/หน้า แก้ได้
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [page, setPage] = useState(1)

  // เมนูจัดการเอกสาร (⋮) ต่อรายการ — เปลี่ยนชื่อ/ย้ายไปโฟลเดอร์/ลบ
  const [docMenu, setDocMenu] = useState<{ n: DocNode; x: number; y: number } | null>(null)
  const [movingDoc, setMovingDoc] = useState<DocNode | null>(null)
  // ลากเอกสารมาวางบนโฟลเดอร์แนะนำ — ไฮไลต์โฟลเดอร์ที่กำลังลากผ่านอยู่
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)

  useEffect(() => {
    const q = searchParams.get('q')
    if (q) setSearch(q)
  }, [searchParams])

  const filtersActive = search.trim() !== '' || docTypeFilters.size > 0 || projectFilter !== ''
  const toggleDocTypeFilter = (t: DocType) =>
    setDocTypeFilters((s) => { const next = new Set(s); if (next.has(t)) next.delete(t); else next.add(t); return next })
  const clearFilters = () => { setSearch(''); setDocTypeFilters(new Set()); setProjectFilter('') }

  const filteredList = useMemo(() => {
    if (!filtersActive) return []
    const q = search.trim().toLowerCase()
    return (nodes ?? [])
      .filter((n) => n.kind !== 'folder')
      .filter((n) => !q || n.title.toLowerCase().includes(q) || (n.templateDocNumber ?? '').toLowerCase().includes(q))
      .filter((n) => docTypeFilters.size === 0 || (n.docType && docTypeFilters.has(n.docType)))
      .filter((n) => !projectFilter || n.linkedProjectId === projectFilter)
  }, [nodes, search, docTypeFilters, projectFilter, filtersActive])

  const projectNameOf = useCallback(
    (id: string | null) => (id ? (projectOpts ?? []).find((p) => p.id === id)?.name ?? null : null),
    [projectOpts],
  )

  const children = useMemo(() => {
    const map = new Map<string | null, DocNode[]>()
    for (const n of nodes ?? []) {
      const key = n.parentId
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(n)
    }
    return map
  }, [nodes])

  // Tasknista §Document Management MVP — โฟลเดอร์ระดับบนสุด โชว์เป็นการ์ดลัดด้านบน (Google Docs style)
  const rootFolders = useMemo(() => (children.get(null) ?? []).filter((n) => n.kind === 'folder'), [children])

  // เอกสารทั้งหมด (ไม่รวมโฟลเดอร์เอง) ภายใต้โฟลเดอร์ที่เลือกไว้ — ไล่ลงไปทุกชั้นของโฟลเดอร์ย่อย
  const folderDescendantIds = useMemo(() => {
    if (!activeFolder) return null
    const ids = new Set<string>()
    const walk = (id: string) => {
      for (const child of children.get(id) ?? []) {
        ids.add(child.id)
        if (child.kind === 'folder') walk(child.id)
      }
    }
    walk(activeFolder)
    return ids
  }, [activeFolder, children])

  // Tasknista §Document Management MVP — มุมมองหลัก (List/Grid) แสดง "รายการเอกสาร" แบบแบนเสมอ ไม่ใช่ทรีโฟลเดอร์
  const mainDocs = useMemo(
    () => (nodes ?? []).filter((n) => n.kind !== 'folder' && (!folderDescendantIds || folderDescendantIds.has(n.id))),
    [nodes, folderDescendantIds],
  )

  // รายการที่กำลังแสดง (ผลค้นหา/ฟิลเตอร์ หรือรายการหลัก) → แบ่งหน้าตาม pageSize
  const visibleDocs = filtersActive ? filteredList : mainDocs
  const pageDocs = useMemo(() => visibleDocs.slice((page - 1) * pageSize, page * pageSize), [visibleDocs, page, pageSize])
  // กลับหน้าแรกเมื่อเงื่อนไข/มุมมองเปลี่ยน
  useEffect(() => { setPage(1) }, [search, docTypeFilters, projectFilter, activeFolder, pageSize])

  const addPage = useCallback(
    async (parentId: string | null) => {
      const title = await promptDialog({
        title: parentId ? 'เพิ่มหน้าย่อย' : 'หน้าใหม่',
        placeholder: 'ชื่อหน้า เช่น คู่มือพนักงานใหม่...',
        confirmLabel: 'สร้างหน้า',
      })
      if (!title?.trim()) return
      const created = await api.post<{ id: string }>('/api/docs', { title: title.trim(), ...(parentId ? { parentId } : {}) })
      await reloadTree()
      window.open(`/docs/${created.id}`, '_blank', 'noopener')
    },
    [reloadTree, promptDialog],
  )

  const addFolder = useCallback(
    async (parentId: string | null) => {
      const title = await promptDialog({ title: 'โฟลเดอร์ใหม่', placeholder: 'ชื่อโฟลเดอร์ เช่น MOM...', confirmLabel: 'สร้างโฟลเดอร์' })
      if (!title?.trim()) return
      await api.post('/api/docs/folder', { title: title.trim(), ...(parentId ? { parentId } : {}) })
      await reloadTree()
    },
    [reloadTree, promptDialog],
  )

  // เปลี่ยนชื่อ/ลบ โฟลเดอร์ — ใช้จากการ์ด "โฟลเดอร์แนะนำ"
  const renameFolder = useCallback(
    async (n: DocNode) => {
      const title = await promptDialog({ title: 'เปลี่ยนชื่อโฟลเดอร์', initialValue: n.title, confirmLabel: 'บันทึก' })
      if (!title?.trim() || title.trim() === n.title) return
      await api.patch(`/api/docs/${n.id}`, { title: title.trim() })
      await reloadTree()
    },
    [reloadTree, promptDialog],
  )
  const deleteFolder = useCallback(
    async (n: DocNode) => {
      const yes = await confirmDialog({ title: 'ลบโฟลเดอร์นี้?', message: `"${n.title}" และเอกสารข้างในทั้งหมดจะถูกลบ`, confirmLabel: 'ลบ', danger: true })
      if (!yes) return
      await api.delete(`/api/docs/${n.id}`)
      await reloadTree()
    },
    [reloadTree, confirmDialog],
  )

  // ตัวเลือกโฟลเดอร์ปลายทางสำหรับ "ย้ายไปโฟลเดอร์" — ทุกโฟลเดอร์ในระบบ (ไม่ใช่แค่บนสุด) พร้อมย่อหน้าตามความลึก
  const folderOptions = useMemo(() => buildFolderOptions((nodes ?? []).filter((n) => n.kind === 'folder')), [nodes])

  // เปลี่ยนชื่อ/ย้าย/ลบ เอกสารทั่วไป (ไม่ใช่โฟลเดอร์) — ใช้จากปุ่มจัดการ (⋮) ในมุมมองรายการ/ตาราง
  const renameDoc = useCallback(
    async (n: DocNode) => {
      const title = await promptDialog({ title: 'เปลี่ยนชื่อเอกสาร', initialValue: n.templateDocNumber ?? n.title, confirmLabel: 'บันทึก' })
      if (!title?.trim() || title.trim() === n.title) return
      await api.patch(`/api/docs/${n.id}`, { title: title.trim() })
      await reloadTree()
    },
    [reloadTree, promptDialog],
  )
  const moveDocTo = useCallback(
    async (docId: string, parentId: string | null) => {
      await api.patch(`/api/docs/${docId}`, { parentId })
      await reloadTree()
    },
    [reloadTree],
  )
  const deleteDoc = useCallback(
    async (n: DocNode) => {
      const yes = await confirmDialog({ title: 'ลบเอกสารนี้?', message: `"${n.templateDocNumber ?? n.title}" จะถูกลบ`, confirmLabel: 'ลบ', danger: true })
      if (!yes) return
      await api.delete(`/api/docs/${n.id}`)
      await reloadTree()
    },
    [reloadTree, confirmDialog],
  )

  const addLink = useCallback(
    async (parentId: string | null) => {
      const title = await promptDialog({ title: 'ลิงก์ Google Docs / Drive', placeholder: 'ชื่อเอกสาร…', confirmLabel: 'ถัดไป' })
      if (!title?.trim()) return
      const url = await promptDialog({ title: 'วางลิงก์', placeholder: 'https://docs.google.com/...', confirmLabel: 'เพิ่ม' })
      if (!url?.trim()) return
      const created = await api.post<{ id: string }>('/api/docs/link', { title: title.trim(), externalUrl: url.trim(), ...(parentId ? { parentId } : {}) })
      await reloadTree()
      window.open(`/docs/${created.id}`, '_blank', 'noopener')
    },
    [reloadTree, promptDialog],
  )

  const uploadRef = useRef<HTMLInputElement>(null)
  const uploadParent = useRef<string | null>(null)
  const triggerUpload = (parentId: string | null) => {
    uploadParent.current = parentId
    uploadRef.current?.click()
  }
  const confirmUpload = async (docType: DocType | null) => {
    const file = pendingUpload
    setPendingUpload(null)
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    form.append('title', file.name)
    if (uploadParent.current) form.append('parentId', uploadParent.current)
    if (docType) form.append('docType', docType)
    const res = await fetch('/api/docs/upload', { method: 'POST', body: form })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { message?: string }
      alert(j.message ?? 'อัปโหลดไม่สำเร็จ — รับเฉพาะ Word (.docx/.doc) และ PDF ขนาดไม่เกิน 15MB')
      return
    }
    const created = (await res.json()) as { id: string }
    await reloadTree()
    window.open(`/docs/${created.id}`, '_blank', 'noopener')
  }

  return (
    <>
      <PageHeader
        title="เอกสาร"
        action={
          <button
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAddMenu({ parentId: null, x: r.right - 208, y: r.bottom + 4 }) }}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-3.5 py-2 rounded-lg"
          >
            <Plus className="w-4 h-4" /> เพิ่ม
          </button>
        }
      />
      <div className="p-3 sm:p-6">
        {/* แถบค้นหา/ฟิลเตอร์ แบบ Google Drive — ประเภทเอกสาร + โปรเจกต์ */}
        <div className="bg-white rounded-lg shadow-xs p-3 mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-48">
            <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อเอกสาร / เลขที่เอกสาร..."
              className="w-full text-sm bg-hover rounded-lg pl-9 pr-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-brand-200"
            />
          </div>
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border ${filtersOpen || docTypeFilters.size > 0 || projectFilter ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-border-subtle text-dim hover:bg-hover'}`}
          >
            <Filter className="w-3.5 h-3.5" /> ฟิลเตอร์{docTypeFilters.size + (projectFilter ? 1 : 0) > 0 ? ` (${docTypeFilters.size + (projectFilter ? 1 : 0)})` : ''}
          </button>
          {filtersActive && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-muted hover:text-danger-600">
              <X className="w-3.5 h-3.5" /> ล้าง
            </button>
          )}
          {/* Tasknista §Document Management MVP — สลับมุมมอง Grid/List มุมขวาบน */}
          <div className="flex items-center gap-0.5 bg-hover rounded-lg p-0.5 ml-auto">
            <button
              onClick={() => setViewMode('list')}
              title="มุมมองรายการ"
              className={`w-7 h-7 grid place-items-center rounded-md ${viewMode === 'list' ? 'bg-white shadow-xs text-brand-700' : 'text-muted hover:text-soft'}`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              title="มุมมองตาราง"
              className={`w-7 h-7 grid place-items-center rounded-md ${viewMode === 'grid' ? 'bg-white shadow-xs text-brand-700' : 'text-muted hover:text-soft'}`}
            >
              <Grid2x2 className="w-3.5 h-3.5" />
            </button>
          </div>
          {filtersOpen && (
            <div className="w-full flex flex-wrap items-center gap-3 pt-2 border-t border-divider">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-muted mr-1">ประเภท:</span>
                {DOC_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleDocTypeFilter(t)}
                    className={`text-xs font-medium px-2.5 py-1 rounded-full border ${docTypeFilters.has(t) ? 'bg-brand-600 border-brand-600 text-white' : 'border-border-subtle text-dim hover:bg-hover'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted">โปรเจกต์:</span>
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="text-sm bg-white border border-border rounded-lg px-2.5 py-1.5 focus:outline-hidden"
                >
                  <option value="">ทุกโปรเจกต์</option>
                  {(projectOpts ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Tasknista §Document Management MVP — โฟลเดอร์แนะนำ (Google Docs style) ด้านบนสุด — คลิกเพื่อกรองรายการเอกสารด้านล่าง ซ่อนตอนกำลังค้นหา/ฟิลเตอร์ */}
        {!filtersActive && rootFolders.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-muted">โฟลเดอร์แนะนำ</div>
              {activeFolder && (
                <button onClick={() => setActiveFolder(null)} className="flex items-center gap-1 text-xs text-muted hover:text-danger-600">
                  <X className="w-3.5 h-3.5" /> ล้างตัวกรองโฟลเดอร์
                </button>
              )}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {rootFolders.map((f) => {
                const active = activeFolder === f.id
                const isDropTarget = dragOverFolderId === f.id
                return (
                  <div
                    key={f.id}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverFolderId(f.id) }}
                    onDragLeave={() => setDragOverFolderId((cur) => (cur === f.id ? null : cur))}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragOverFolderId(null)
                      const docId = e.dataTransfer.getData('text/plain')
                      if (docId) void moveDocTo(docId, f.id)
                    }}
                    className={`group relative shrink-0 flex items-center gap-1 shadow-xs rounded-lg pl-3.5 pr-2 py-2.5 text-sm border ${isDropTarget ? 'bg-brand-100 border-brand-400 ring-2 ring-brand-300' : active ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white text-soft hover:bg-hover border-border-subtle'}`}
                  >
                    <button
                      onClick={() => setActiveFolder((cur) => (cur === f.id ? null : f.id))}
                      className="flex items-center gap-2 min-w-0"
                    >
                      <Folder className={`w-4 h-4 shrink-0 ${active ? 'text-brand-600' : 'text-brand-500'}`} />
                      <span className="whitespace-nowrap">{f.title}</span>
                    </button>
                    {canEditAccess(f.myAccess) && (
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAddMenu({ parentId: f.id, x: r.left, y: r.bottom + 4 }) }}
                          title="เพิ่มในโฟลเดอร์นี้"
                          className="w-5 h-5 grid place-items-center rounded text-dim hover:bg-border"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => void renameFolder(f)}
                          title="เปลี่ยนชื่อโฟลเดอร์"
                          className="w-5 h-5 grid place-items-center rounded text-dim hover:bg-border"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => { if (active) setActiveFolder(null); void deleteFolder(f) }}
                          title="ลบโฟลเดอร์"
                          className="w-5 h-5 grid place-items-center rounded text-dim hover:bg-danger-100 hover:text-danger-600"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {visibleDocs.length === 0 ? (
          <div className="bg-white rounded-lg shadow-xs p-2">
            <div className="text-sm text-muted px-3 py-8 text-center">
              {filtersActive ? 'ไม่พบเอกสารที่ตรงกับตัวกรอง' : 'ยังไม่มีเอกสาร — กด "+ เพิ่ม" เริ่มหน้าแรก (เช่น คู่มือพนักงานใหม่)'}
            </div>
          </div>
        ) : (
          <>
            <div className={`bg-white rounded-lg shadow-xs ${viewMode === 'grid' ? 'p-3' : 'p-2'}`}>
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {pageDocs.map((n) => (
                    <DocGridCard
                      key={n.id}
                      n={n}
                      projectName={projectNameOf(n.linkedProjectId)}
                      onMenu={canEditAccess(n.myAccess) ? (rect) => setDocMenu({ n, x: rect.right - 176, y: rect.bottom + 4 }) : undefined}
                    />
                  ))}
                </div>
              ) : (
                <div className="divide-y divide-divider">
                  {pageDocs.map((n) => (
                    <DocListRow
                      key={n.id}
                      n={n}
                      projectName={projectNameOf(n.linkedProjectId)}
                      onMenu={canEditAccess(n.myAccess) ? (rect) => setDocMenu({ n, x: rect.right - 176, y: rect.bottom + 4 }) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="bg-white rounded-lg shadow-xs mt-2">
              <Pager page={page} pageSize={pageSize} total={visibleDocs.length} unitLabel="เอกสาร" onPage={setPage} onPageSize={setPageSize} />
            </div>
          </>
        )}
      </div>

      {addMenu && (
        <AddMenu
          x={addMenu.x}
          y={addMenu.y}
          onClose={() => setAddMenu(null)}
          onPage={() => void addPage(addMenu.parentId)}
          onLink={() => void addLink(addMenu.parentId)}
          onUpload={() => triggerUpload(addMenu.parentId)}
          onTemplate={() => setTemplatePicker({ parentId: addMenu.parentId })}
          onUploadBreakout={() => setUploadBreakoutOpen(true)}
          onFolder={() => void addFolder(addMenu.parentId)}
        />
      )}
      <input ref={uploadRef} type="file" accept=".docx,.doc,.pdf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingUpload(f); e.target.value = '' }} />
      {pendingUpload && (
        <UploadDocTypeModal filename={pendingUpload.name} onClose={() => setPendingUpload(null)} onConfirm={(docType) => void confirmUpload(docType)} />
      )}
      {templatePicker && (
        <TemplatePickerModal
          parentId={templatePicker.parentId}
          onClose={() => setTemplatePicker(null)}
          onCreated={async (docId) => {
            setTemplatePicker(null)
            await reloadTree()
            window.open(`/docs/${docId}`, '_blank', 'noopener')
          }}
        />
      )}
      {uploadBreakoutOpen && (
        <SowUploadBreakoutModal
          onClose={() => setUploadBreakoutOpen(false)}
          onCreated={() => { setUploadBreakoutOpen(false); void reloadTree() }}
        />
      )}
      {docMenu && (
        <DocActionsMenu
          x={docMenu.x}
          y={docMenu.y}
          onClose={() => setDocMenu(null)}
          onRename={() => void renameDoc(docMenu.n)}
          onMove={() => setMovingDoc(docMenu.n)}
          onDelete={() => void deleteDoc(docMenu.n)}
        />
      )}
      {movingDoc && (
        <MoveDocModal
          doc={movingDoc}
          folders={folderOptions}
          onClose={() => setMovingDoc(null)}
          onConfirm={(parentId) => { const d = movingDoc; setMovingDoc(null); void moveDocTo(d.id, parentId) }}
        />
      )}
    </>
  )
}
