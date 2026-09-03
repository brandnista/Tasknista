import {
  FileText, Filter, Folder, FolderInput, FolderPlus, FolderUp, Grid2x2, Image as ImageIcon, List, ListTree, Link2, MoreVertical, Pencil, Plus, Search, Trash2, Upload, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Avatar } from '../components/Avatar'
import { useDialog } from '../components/Dialog'
import { SowUploadBreakoutModal } from '../components/SowUploadBreakoutModal'
import { TemplatePickerModal } from '../components/doc-templates/TemplatePickerModal'
import { DEFAULT_PAGE_SIZE, Pager } from '../components/Pager'
import { PageHeader } from '../components/PageHeader'
import { api, ApiError } from '../lib/api'
import { fmtThaiDate } from '../lib/project-ui'
import { useLoad } from '../lib/useLoad'
import { avatarColor } from './ProjectDetail'

// เท่ากับฝั่ง backend (apps/api/src/routes/docs.ts) — ใช้กรองไฟล์ก่อนอัปโหลดตอน "อัปโหลดโฟลเดอร์" กันยิง request ที่รู้อยู่แล้วว่าจะโดนปฏิเสธ
const UPLOAD_ACCEPTED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const UPLOAD_MAX_BYTES = 15 * 1024 * 1024

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
  sizeBytes: number | null
  isTemplate: boolean
  // Pronista §Document Template — เลขที่เอกสาร (โชว์แทนชื่อในทรีถ้ามี) — null ถ้าไม่ใช่ template หรือ template ที่ยังไม่ gen เลขที่
  templateDocNumber: string | null
  // Pronista §Document Traceability — ประเภทเอกสารสำหรับฟิลเตอร์ + โปรเจกต์ที่ผูกไว้อันแรก
  docType: 'MOM' | 'BRD' | 'SOW' | 'SRS' | 'PEP' | 'UIR' | 'CR' | null
  linkedProjectId: string | null
  ownerId: string | null
  visibility: 'private' | 'team'
  myAccess: 'owner' | 'editor' | 'viewer'
  // Pronista §Document Management MVP — Grid view โชว์ "แก้ไขล่าสุดโดยใคร/เมื่อไร"
  updatedAt: string | null
  updatedByName: string | null
  updatedByAvatarUrl: string | null
}
interface ProjectOpt {
  id: string
  name: string
}

const canEditAccess = (a: DocNode['myAccess']) => a === 'owner' || a === 'editor'
const DOC_TYPES = ['MOM', 'BRD', 'SOW', 'SRS', 'PEP', 'UIR', 'CR'] as const
type DocType = (typeof DOC_TYPES)[number]

// Pronista §Document Management — ฟิลเตอร์ "ชนิดไฟล์" แบบ Google Drive (โฟลเดอร์/เอกสาร/Template/ลิงก์/PDF/Word) — คนละแกนกับ "ประเภทเอกสาร" (MOM/SOW/...) ด้านบน ซึ่งเป็นหมวดธุรกิจ ไม่ใช่ชนิดไฟล์
type FileKindFilter = 'all' | 'folder' | 'page' | 'template' | 'link' | 'pdf' | 'word'
const FILE_KIND_LABEL: Record<FileKindFilter, string> = {
  all: 'ทุกชนิดไฟล์', folder: 'โฟลเดอร์', page: 'เอกสาร', template: 'Template', link: 'ลิงก์ Google Docs', pdf: 'PDF', word: 'Word',
}
// kind='file' ใน Docs อัปโหลดได้แค่ PDF/Word เท่านั้น (ดู ACCEPTED_FILE_MIME ฝั่ง API) — mime ที่ไม่ใช่ PDF จึงเป็น Word เสมอ
const fileKindOf = (n: DocNode): FileKindFilter => {
  if (n.kind === 'folder' || n.kind === 'page' || n.kind === 'template' || n.kind === 'link') return n.kind
  return n.mime === 'application/pdf' ? 'pdf' : 'word'
}

/** เมนู "+ เพิ่ม" เดียว (โฟลเดอร์ใหม่/ลิงก์ Google Docs/อัปโหลดไฟล์/เอกสาร Template/อัปโหลดแตกเป็น Task) แทนปุ่มกระจัดกระจาย — ลอยตรงตำแหน่งที่กด
 * Pronista §My Files → เอกสาร (2026-09-01) — ตัด "หน้าใหม่" ออก ซ้ำกับ "สร้างเอกสาร" ในเมนู "ไฟล์ของฉัน" อยู่แล้ว (สร้างที่นั่นแล้วกด "แชร์ไปเอกสาร" แทน) */
function AddMenu({ x, y, onClose, onLink, onUpload, onUploadFolder, onTemplate, onUploadBreakout, onFolder }: {
  x: number
  y: number
  onClose: () => void
  onLink: () => void
  onUpload: () => void
  onUploadFolder: () => void
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
        <button className={item} onClick={() => { onFolder(); onClose() }}><FolderPlus className="w-4 h-4 text-muted" /> โฟลเดอร์ใหม่</button>
        <button className={item} onClick={() => { onLink(); onClose() }}><Link2 className="w-4 h-4 text-muted" /> ลิงก์ Google Docs</button>
        <button className={item} onClick={() => { onUpload(); onClose() }}><Upload className="w-4 h-4 text-muted" /> อัปโหลดไฟล์ (Word/PDF)</button>
        <button className={item} onClick={() => { onUploadFolder(); onClose() }}><FolderUp className="w-4 h-4 text-muted" /> อัปโหลดโฟลเดอร์</button>
        <button className={item} onClick={() => { onTemplate(); onClose() }}><FileText className="w-4 h-4 text-muted" /> เอกสาร Template</button>
        <div className="my-1 border-t border-divider" />
        <button className={item} onClick={() => { onUploadBreakout(); onClose() }}><ListTree className="w-4 h-4 text-muted" /> อัปโหลดเอกสาร (แตกเป็น Task)</button>
      </div>
    </div>
  )
}

/** เลือกแท็กประเภทเอกสาร (ไม่บังคับ) หลังเลือกไฟล์แล้ว ก่อนอัปโหลดจริง — ใช้เพื่อให้ฟิลเตอร์หน้าเอกสารหาไฟล์ที่อัปโหลดเองเจอ */
// Pronista §Document project link fix — เอกสารที่อัปโหลดผ่านทางนี้เดิมผูกโปรเจกต์ไม่ได้เลย (ไม่มีช่องให้เลือก) ทำให้ไม่โผล่ "ประวัติเอกสาร"
// (หน้านั้นกรองเอาเฉพาะเอกสารที่มี docLinks ผูกโปรเจกต์) — เพิ่มช่องเลือกโปรเจกต์แบบพิมพ์ค้นหา (ไม่บังคับ ตามแพตเทิร์นเดียวกับ TemplatePickerModal)
function UploadDocTypeModal({ filename, onClose, onConfirm }: { filename: string; onClose: () => void; onConfirm: (docType: DocType | null, projectId: string | null, docNumber: string | null, docVersion: string | null) => void }) {
  const [docType, setDocType] = useState<DocType | ''>('')
  const { data: projectOpts } = useLoad<{ id: string; name: string }[]>(() => api.get('/api/projects'))
  const [projectId, setProjectId] = useState('')
  // Pronista §Document Versioning fix (2026-09-01) — ระบุเลขที่เอกสาร/เวอร์ชันได้ตั้งแต่ตอนอัปโหลด (ไม่บังคับ) เอกสารที่มีเลขที่เดียวกันจะถูกจับกลุ่มเป็น "เล่มเดียวกัน หลายเวอร์ชัน" ในหน้าประวัติเอกสาร/เปรียบเทียบเอกสาร
  const [docNumber, setDocNumber] = useState('')
  const [docVersion, setDocVersion] = useState('')
  const [projectQuery, setProjectQuery] = useState('')
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)
  const selectedProject = (projectOpts ?? []).find((p) => p.id === projectId)
  const filteredProjects = (projectOpts ?? []).filter((p) => p.name.toLowerCase().includes(projectQuery.toLowerCase()))
  const input = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
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
            className={`${input} mb-3`}
          >
            <option value="">ไม่ระบุประเภท</option>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted mb-1 block">เลขที่เอกสาร (ไม่บังคับ)</label>
              <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="เช่น BNT-MOM-2026-014" className={input} />
            </div>
            <div className="w-28">
              <label className="text-xs font-medium text-muted mb-1 block">เวอร์ชัน</label>
              <input value={docVersion} onChange={(e) => setDocVersion(e.target.value)} placeholder="เช่น 1.0" className={input} />
            </div>
          </div>
          <p className="text-[11px] text-muted -mt-2 mb-3">เอกสารที่มีเลขที่เดียวกันจะถูกจับกลุ่มเป็น "เล่มเดียวกัน หลายเวอร์ชัน" — เปรียบเทียบเอกสารกันได้ในหน้าประวัติเอกสาร</p>
          <div className="relative mb-4">
            <label className="text-xs font-medium text-muted mb-1 block">โปรเจกต์ (ไม่บังคับ — ผูกแล้วจะโผล่ในประวัติเอกสารของโปรเจกต์นั้น)</label>
            <input
              value={projectDropdownOpen ? projectQuery : (selectedProject?.name ?? '')}
              onChange={(e) => { setProjectQuery(e.target.value); setProjectId('') }}
              onFocus={() => { setProjectQuery(''); setProjectDropdownOpen(true) }}
              onBlur={() => setTimeout(() => setProjectDropdownOpen(false), 150)}
              placeholder="พิมพ์ค้นหาโปรเจกต์… (ไม่เลือก = ไม่ผูกโปรเจกต์)"
              className={input}
            />
            {projectDropdownOpen && (
              <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-border rounded-lg shadow-lg">
                {filteredProjects.length === 0 && <div className="px-3 py-2 text-xs text-muted">ไม่พบโปรเจกต์</div>}
                {filteredProjects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setProjectId(p.id); setProjectQuery(''); setProjectDropdownOpen(false) }}
                    className="w-full text-left text-sm px-3 py-2 hover:bg-hover"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
            <button onClick={() => onConfirm(docType || null, projectId || null, docNumber.trim() || null, docVersion.trim() || null)} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700">อัปโหลด</button>
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

// Pronista §Document List View file-type indicator (2026-09-02) — เดิม List view เห็นแต่ไอคอนเอกสารสีเดียวหมด ไม่รู้ว่า Word/PDF/รูปภาพ
// ต่างจาก Grid view ที่แยกสีตาม mime ชัดเจน (DocFileTile) — ทำให้เหมือนกันโดยใช้ badge เล็กแบบเดียวกัน (mime-aware) แทนไอคอนสีเดียว
function DocRowIcon({ n }: { n: DocNode }) {
  if (n.icon) return <span className="shrink-0 text-sm leading-none">{n.icon}</span>
  if (n.kind === 'folder') return <Folder className="w-3.5 h-3.5 text-muted shrink-0" />
  if (n.kind === 'link') return <Link2 className="w-3.5 h-3.5 text-info-500 shrink-0" />
  const mime = n.mime ?? ''
  const base = 'w-5 h-5 rounded grid place-items-center shrink-0'
  if (mime === 'application/pdf') return <div className={`${base} bg-danger-600 text-white text-[8px] font-bold`}>PDF</div>
  if (mime.includes('word')) return <div className={`${base} bg-info-600 text-white text-[10px] font-bold`}>W</div>
  if (mime.startsWith('image/')) return <div className={`${base} bg-warning-100 text-warning-700`}><ImageIcon className="w-3 h-3" /></div>
  return <FileText className="w-3.5 h-3.5 text-brand-500 shrink-0" />
}

/** Pronista §Document Management MVP — ไอคอนสีตามประเภทไฟล์จริง (Word/PDF/รูปภาพ/ลิงก์/หน้าวิกิ) ใช้ในการ์ด Grid view */
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

// Pronista §Document Management — คอลัมน์ "ขนาดไฟล์" (2026-09-01) — เฉพาะ kind='file' เท่านั้น (page/link/folder/template ไม่มี sizeBytes)
function fmtSize(n: number | null): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
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
        {n.kind === 'file' && n.sizeBytes != null && <span className="text-xs text-muted shrink-0">{fmtSize(n.sizeBytes)}</span>}
      </div>
      {(updated || n.updatedByName) && (
        <div className="flex items-center gap-1.5 text-xs text-muted truncate">
          {n.updatedByName && <Avatar name={n.updatedByName} avatarUrl={n.updatedByAvatarUrl} className="w-4 h-4 text-[8px]" colorClass={avatarColor(n.updatedByName)} />}
          <span className="truncate">{n.updatedByName ? `${n.updatedByName} แก้ไข` : 'แก้ไข'}{updated ? ` • ${updated}` : ''}</span>
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
      {/* Pronista §Document Management — คอลัมน์ท้ายแถวทุกอันต้อง "กว้างคงที่ + render เสมอ" ไม่ใช่แค่ conditional (เดิม conditional ล้วน ทำให้ความกว้างจริงต่อแถวไม่เท่ากัน คอลัมน์ที่อยู่หลังจากนั้นเลยเบี้ยว เพราะชื่อเอกสาร flex-1 ไปกินพื้นที่ต่างกันในแต่ละแถว) */}
      <span title={n.updatedByName ? `${n.updatedByName} แก้ไขล่าสุด` : undefined} className="hidden sm:flex items-center gap-1 text-xs text-muted shrink-0 w-28">
        {n.updatedByName && (
          <>
            <Avatar name={n.updatedByName} avatarUrl={n.updatedByAvatarUrl} className="w-4 h-4 text-[8px] shrink-0" colorClass={avatarColor(n.updatedByName)} />
            <span className="truncate">{n.updatedByName}</span>
          </>
        )}
      </span>
      <span className="hidden sm:inline text-xs text-muted shrink-0 w-20 truncate">{projectName ?? ''}</span>
      <span className="hidden sm:inline text-xs text-muted shrink-0 w-14 text-right">{n.kind === 'file' ? fmtSize(n.sizeBytes) : ''}</span>
      <span className="shrink-0 w-14 flex justify-center">{n.docType && <span className={DOC_TYPE_BADGE}>{n.docType}</span>}</span>
      <span className="shrink-0 w-6 h-6 grid place-items-center">
        {onMenu && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMenu(e.currentTarget.getBoundingClientRect()) }}
            title="จัดการเอกสาร"
            className="w-6 h-6 grid place-items-center rounded text-muted hover:bg-border opacity-0 group-hover:opacity-100"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        )}
      </span>
    </a>
  )
}

export function DocsPage() {
  const { data: nodes, reload: reloadTree } = useLoad<DocNode[]>(() => api.get('/api/docs'))
  const { data: projectOpts } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const { alertDialog, confirmDialog, promptDialog } = useDialog()
  const [addMenu, setAddMenu] = useState<{ parentId: string | null; x: number; y: number } | null>(null)
  const [templatePicker, setTemplatePicker] = useState<{ parentId: string | null } | null>(null)
  const [pendingUpload, setPendingUpload] = useState<File | null>(null)
  const [uploadBreakoutOpen, setUploadBreakoutOpen] = useState(false)
  const [searchParams] = useSearchParams()

  // Pronista §Document Management MVP — สลับมุมมอง List (ทรีเดิม) / Grid (การ์ดไฟล์แบบ flat) จำโหมดล่าสุดไว้
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => (localStorage.getItem('docs-view-mode') === 'grid' ? 'grid' : 'list'))
  useEffect(() => { localStorage.setItem('docs-view-mode', viewMode) }, [viewMode])
  // เลือกโฟลเดอร์แนะนำ = กรองรายการเอกสารด้านล่างให้เหลือเฉพาะเอกสารในโฟลเดอร์นั้น (รวมโฟลเดอร์ย่อย)
  const [activeFolder, setActiveFolder] = useState<string | null>(null)

  // ค้นหา/ฟิลเตอร์แบบ Google Drive — มีตัวใดตัวหนึ่งใช้งานอยู่ = สลับจากทรีเป็นลิสต์แบนของผลลัพธ์
  const [search, setSearch] = useState('')
  const [docTypeFilters, setDocTypeFilters] = useState<Set<DocType>>(new Set())
  const [projectFilter, setProjectFilter] = useState('')
  const [fileKindFilter, setFileKindFilter] = useState<FileKindFilter>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Pronista §Document Management MVP — แบ่งหน้า: ค่าเริ่มต้น 20 เอกสาร/หน้า แก้ได้
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

  const filtersActive = search.trim() !== '' || docTypeFilters.size > 0 || projectFilter !== '' || fileKindFilter !== 'all'
  const toggleDocTypeFilter = (t: DocType) =>
    setDocTypeFilters((s) => { const next = new Set(s); if (next.has(t)) next.delete(t); else next.add(t); return next })
  const clearFilters = () => { setSearch(''); setDocTypeFilters(new Set()); setProjectFilter(''); setFileKindFilter('all') }

  const filteredList = useMemo(() => {
    if (!filtersActive) return []
    const q = search.trim().toLowerCase()
    return (nodes ?? [])
      .filter((n) => (fileKindFilter === 'folder' ? n.kind === 'folder' : n.kind !== 'folder'))
      .filter((n) => !q || n.title.toLowerCase().includes(q) || (n.templateDocNumber ?? '').toLowerCase().includes(q))
      .filter((n) => docTypeFilters.size === 0 || (n.docType && docTypeFilters.has(n.docType)))
      .filter((n) => !projectFilter || n.linkedProjectId === projectFilter)
      .filter((n) => fileKindFilter === 'all' || fileKindOf(n) === fileKindFilter)
  }, [nodes, search, docTypeFilters, projectFilter, fileKindFilter, filtersActive])

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

  // Pronista §bugfix — เดิม pill โชว์แค่โฟลเดอร์ระดับบนสุด (children ของ null) เท่านั้น กด "+" สร้างโฟลเดอร์ลูกได้ 1 ชั้น แต่โฟลเดอร์ลูกนั้นไม่มี pill/แถวของตัวเอง
  // เลยไม่มีทางเข้าถึงปุ่ม "+" อีกทีเพื่อสร้างโฟลเดอร์ซ้อนอีกชั้น — เปลี่ยนเป็นเบราว์เซอร์โฟลเดอร์จริง: pill โชว์เฉพาะลูกของ activeFolder (เดินลึกได้ไม่จำกัดชั้น) + breadcrumb ด้านบนไว้ย้อนกลับ
  const folderPills = useMemo(() => (children.get(activeFolder) ?? []).filter((n) => n.kind === 'folder'), [children, activeFolder])
  const activeFolderNode = useMemo(() => (activeFolder ? (nodes ?? []).find((n) => n.id === activeFolder) ?? null : null), [activeFolder, nodes])
  const folderBreadcrumb = useMemo(() => {
    const byId = new Map((nodes ?? []).map((n) => [n.id, n]))
    const trail: DocNode[] = []
    let cur = activeFolderNode
    while (cur) {
      trail.unshift(cur)
      cur = cur.parentId ? (byId.get(cur.parentId) ?? null) : null
    }
    return trail
  }, [activeFolderNode, nodes])

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

  // Pronista §Document Management MVP — มุมมองหลัก (List/Grid) แสดง "รายการเอกสาร" แบบแบนเสมอ ไม่ใช่ทรีโฟลเดอร์
  const mainDocs = useMemo(
    () => (nodes ?? []).filter((n) => n.kind !== 'folder' && (!folderDescendantIds || folderDescendantIds.has(n.id))),
    [nodes, folderDescendantIds],
  )

  // รายการที่กำลังแสดง (ผลค้นหา/ฟิลเตอร์ หรือรายการหลัก) → แบ่งหน้าตาม pageSize
  const visibleDocs = filtersActive ? filteredList : mainDocs
  const pageDocs = useMemo(() => visibleDocs.slice((page - 1) * pageSize, page * pageSize), [visibleDocs, page, pageSize])
  // กลับหน้าแรกเมื่อเงื่อนไข/มุมมองเปลี่ยน
  useEffect(() => { setPage(1) }, [search, docTypeFilters, projectFilter, fileKindFilter, activeFolder, pageSize])

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
  const confirmUpload = async (docType: DocType | null, projectId: string | null, docNumber: string | null, docVersion: string | null) => {
    const file = pendingUpload
    setPendingUpload(null)
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    form.append('title', file.name)
    if (uploadParent.current) form.append('parentId', uploadParent.current)
    if (docType) form.append('docType', docType)
    if (projectId) form.append('projectId', projectId)
    if (docNumber) form.append('docNumber', docNumber)
    if (docVersion) form.append('docVersion', docVersion)
    const res = await fetch('/api/docs/upload', { method: 'POST', body: form })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { message?: string }
      await alertDialog({ title: j.message ?? 'อัปโหลดไม่สำเร็จ — รับเฉพาะ Word (.docx/.doc) และ PDF ขนาดไม่เกิน 15MB' })
      return
    }
    const created = (await res.json()) as { id: string }
    await reloadTree()
    window.open(`/docs/${created.id}`, '_blank', 'noopener')
  }

  // "อัปโหลดโฟลเดอร์" — เลือกทั้งโฟลเดอร์จากเครื่อง (input[webkitdirectory]) แล้วสร้างโครงสร้างโฟลเดอร์ย่อยตาม path จริง + อัปโหลดไฟล์ Word/PDF เข้าตำแหน่งที่ถูกต้อง
  // ตั้ง webkitdirectory ผ่าน ref แทน JSX attribute เพราะ React's InputHTMLAttributes ไม่มี prop นี้ (เป็น non-standard DOM property)
  const folderUploadRef = useRef<HTMLInputElement>(null)
  const triggerUploadFolder = (parentId: string | null) => {
    uploadParent.current = parentId
    folderUploadRef.current?.click()
  }
  const [folderUploadProgress, setFolderUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const handleFolderUpload = async (fileList: FileList) => {
    const rootParentId = uploadParent.current
    const files = Array.from(fileList)
    if (files.length === 0) return
    setFolderUploadProgress({ done: 0, total: files.length })
    try {
      // เก็บทุก path โฟลเดอร์ที่ต้องมี (ทุกระดับ) จาก webkitRelativePath เช่น "งาน CR/รอบ1/ใบเสนอราคา.pdf" → "งาน CR", "งาน CR/รอบ1"
      const dirPaths = new Set<string>()
      for (const f of files) {
        const segments = f.webkitRelativePath.split('/').slice(0, -1)
        for (let i = 1; i <= segments.length; i++) dirPaths.add(segments.slice(0, i).join('/'))
      }
      // สร้างจากตื้นไปลึก ให้โฟลเดอร์แม่มี id ก่อนสร้างลูก
      const sortedDirs = Array.from(dirPaths).sort((a, b) => a.split('/').length - b.split('/').length)
      const dirIdOf = new Map<string, string>()
      for (const dir of sortedDirs) {
        const segments = dir.split('/')
        const parentPath = segments.slice(0, -1).join('/')
        const parentId = parentPath ? (dirIdOf.get(parentPath) ?? rootParentId) : rootParentId
        const created = await api.post<{ id: string }>('/api/docs/folder', { title: segments[segments.length - 1], parentId })
        dirIdOf.set(dir, created.id)
      }
      let uploaded = 0
      let skipped = 0
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!
        setFolderUploadProgress({ done: i, total: files.length })
        if (file.size === 0 || file.size > UPLOAD_MAX_BYTES || !UPLOAD_ACCEPTED_MIME.has(file.type)) {
          skipped++
          continue
        }
        const dirPath = file.webkitRelativePath.split('/').slice(0, -1).join('/')
        const parentId = dirPath ? (dirIdOf.get(dirPath) ?? rootParentId) : rootParentId
        const form = new FormData()
        form.append('file', file)
        form.append('title', file.name)
        if (parentId) form.append('parentId', parentId)
        const res = await fetch('/api/docs/upload', { method: 'POST', body: form })
        if (res.ok) uploaded++
        else skipped++
      }
      await reloadTree()
      void confirmDialog({
        title: 'อัปโหลดโฟลเดอร์เสร็จแล้ว',
        message: `สำเร็จ ${uploaded} ไฟล์${skipped ? `, ข้าม ${skipped} ไฟล์ (รับเฉพาะ Word/PDF ไม่เกิน 15MB)` : ''}`,
        confirmLabel: 'ตกลง',
      })
    } catch (e) {
      void confirmDialog({ title: 'อัปโหลดโฟลเดอร์ไม่สำเร็จ', message: e instanceof ApiError ? e.message : undefined, confirmLabel: 'ตกลง' })
    } finally {
      setFolderUploadProgress(null)
    }
  }

  return (
    <>
      <PageHeader
        title="เอกสาร"
        action={
          <button
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAddMenu({ parentId: activeFolder, x: r.right - 208, y: r.bottom + 4 }) }}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-3.5 py-2 rounded-lg"
          >
            <Plus className="w-4 h-4" /> เพิ่ม
          </button>
        }
      />
      <div className="p-4 sm:p-6">
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
            className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border ${filtersOpen || docTypeFilters.size > 0 || projectFilter || fileKindFilter !== 'all' ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-border-subtle text-dim hover:bg-hover'}`}
          >
            <Filter className="w-3.5 h-3.5" /> ฟิลเตอร์{docTypeFilters.size + (projectFilter ? 1 : 0) + (fileKindFilter !== 'all' ? 1 : 0) > 0 ? ` (${docTypeFilters.size + (projectFilter ? 1 : 0) + (fileKindFilter !== 'all' ? 1 : 0)})` : ''}
          </button>
          {filtersActive && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-muted hover:text-danger-600">
              <X className="w-3.5 h-3.5" /> ล้าง
            </button>
          )}
          {/* Pronista §Document Management MVP — สลับมุมมอง Grid/List มุมขวาบน */}
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
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted">ชนิดไฟล์:</span>
                <select
                  value={fileKindFilter}
                  onChange={(e) => setFileKindFilter(e.target.value as FileKindFilter)}
                  className="text-sm bg-white border border-border rounded-lg px-2.5 py-1.5 focus:outline-hidden"
                >
                  {(Object.keys(FILE_KIND_LABEL) as FileKindFilter[]).map((k) => <option key={k} value={k}>{FILE_KIND_LABEL[k]}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-muted mr-1">ประเภทเอกสาร:</span>
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

        {/* Pronista §bugfix — โฟลเดอร์แนะนำ (Google Docs style) ตอนนี้เป็นเบราว์เซอร์โฟลเดอร์จริง คลิกชื่อโฟลเดอร์ = เข้าไปดูโฟลเดอร์ย่อยข้างใน (breadcrumb ย้อนกลับได้) แก้ปัญหาสร้างโฟลเดอร์ซ้อนโฟลเดอร์ไม่ได้ (เดิมมีแค่ชั้นบนสุดที่กด "+" ได้)
            เอกสารด้านล่างยังกรองตาม activeFolder เหมือนเดิม (ไล่ลงทุกชั้นลูกหลาน) ซ่อนตอนกำลังค้นหา/ฟิลเตอร์ */}
        {!filtersActive && (folderPills.length > 0 || activeFolder) && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="flex items-center gap-1 text-xs font-medium flex-wrap">
                <button onClick={() => setActiveFolder(null)} className={!activeFolder ? 'text-brand-700' : 'text-muted hover:text-ink hover:underline'}>โฟลเดอร์แนะนำ</button>
                {folderBreadcrumb.map((n) => (
                  <span key={n.id} className="flex items-center gap-1">
                    <span className="text-border">/</span>
                    <button onClick={() => setActiveFolder(n.id)} className={n.id === activeFolder ? 'text-brand-700' : 'text-muted hover:text-ink hover:underline'}>{n.title}</button>
                  </span>
                ))}
              </div>
              {(!activeFolder || canEditAccess(activeFolderNode?.myAccess ?? 'viewer')) && (
                <button onClick={() => void addFolder(activeFolder)} className="flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800">
                  <FolderPlus className="w-3.5 h-3.5" /> โฟลเดอร์ใหม่ที่นี่
                </button>
              )}
            </div>
            {folderPills.length === 0 ? (
              <div className="text-xs text-muted py-1">ยังไม่มีโฟลเดอร์ย่อยในนี้</div>
            ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {folderPills.map((f) => {
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
                    className={`group relative shrink-0 flex items-center gap-1 shadow-xs rounded-lg pl-3.5 pr-2 py-2.5 text-sm border ${isDropTarget ? 'bg-brand-100 border-brand-400 ring-2 ring-brand-300' : 'bg-white text-soft hover:bg-hover border-border-subtle'}`}
                  >
                    <button
                      onClick={() => setActiveFolder(f.id)}
                      className="flex items-center gap-2 min-w-0"
                    >
                      <Folder className="w-4 h-4 shrink-0 text-brand-500" />
                      <span className="whitespace-nowrap">{f.title}</span>
                    </button>
                    {canEditAccess(f.myAccess) && (
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={() => void renameFolder(f)}
                          title="เปลี่ยนชื่อโฟลเดอร์"
                          className="w-5 h-5 grid place-items-center rounded text-dim hover:bg-border"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => { if (activeFolder === f.id) setActiveFolder(null); void deleteFolder(f) }}
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
            )}
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
          onLink={() => void addLink(addMenu.parentId)}
          onUpload={() => triggerUpload(addMenu.parentId)}
          onUploadFolder={() => triggerUploadFolder(addMenu.parentId)}
          onTemplate={() => setTemplatePicker({ parentId: addMenu.parentId })}
          onUploadBreakout={() => setUploadBreakoutOpen(true)}
          onFolder={() => void addFolder(addMenu.parentId)}
        />
      )}
      <input ref={uploadRef} type="file" accept=".docx,.doc,.pdf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingUpload(f); e.target.value = '' }} />
      <input
        ref={(el) => { folderUploadRef.current = el; if (el) el.webkitdirectory = true }}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => { const files = e.target.files; if (files && files.length) void handleFolderUpload(files); e.target.value = '' }}
      />
      {pendingUpload && (
        <UploadDocTypeModal filename={pendingUpload.name} onClose={() => setPendingUpload(null)} onConfirm={(docType, projectId, docNumber, docVersion) => void confirmUpload(docType, projectId, docNumber, docVersion)} />
      )}
      {folderUploadProgress && (
        <div className="fixed bottom-4 right-4 z-[60] bg-white shadow-2xl border border-border-subtle rounded-lg px-4 py-3 text-sm text-body">
          กำลังอัปโหลดโฟลเดอร์… {folderUploadProgress.done}/{folderUploadProgress.total} ไฟล์
        </div>
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
