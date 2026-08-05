import type { TableColumnDef, TableSectionDef, TemplateTableRow } from '@seedoffice/core'
import { AlertTriangle, FileText, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { useLoad } from '../../lib/useLoad'
import type { DocLinkRow } from '../SrsLinkedTasksSection'

interface Candidate {
  tempId: string
  sourceCode: string | null
  title: string
  priority: 'low' | 'normal' | 'high' | null
  description: string
  referenceCodes: string
  selected: boolean
}
interface ProjectInfo {
  id: string
  code: string | null
}

const randomId = () => `row_${Math.random().toString(36).slice(2, 10)}`

// เดาค่า priority เบื้องต้นจากข้อความที่พิมพ์ในตาราง (รองรับ P0-P2, MoSCoW แบบ BRD, และคำไทย) — ผู้ใช้ยังแก้เองในหน้ารีวิวได้เสมอ
function guessPriority(raw: string): 'low' | 'normal' | 'high' | null {
  const t = raw.trim().toUpperCase()
  if (t === 'P0' || t === 'HIGH' || t === 'MUST HAVE' || raw.trim() === 'สูง') return 'high'
  if (t === 'P1' || t === 'NORMAL' || t === 'SHOULD HAVE' || raw.trim() === 'กลาง') return 'normal'
  if (t === 'P2' || t === 'LOW' || t === 'COULD HAVE' || raw.trim() === 'ต่ำ') return 'low'
  return null
}

const sanitizeCodePrefix = (raw: string | null | undefined, fallback: string) => (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || fallback

/**
 * Pronista §Document Traceability — แตกแถวจากตาราง breakoutToTasks (MOM/BRD/SOW/SRS ทั้งหมด) ในเอกสาร Template ให้เป็น Task จริง
 * generalize จาก SrsBreakoutModal เดิม (เคยใช้กับ SRS อย่างเดียว) — ต่างกันแค่ endpoint (/breakout แทน /srs-breakout), docVersion แทน srsVersion,
 * และเพิ่มช่อง "อ้างอิง [เล่มก่อนหน้า]" ให้แก้ได้ก่อนส่ง (resolve เป็น task_references ฝั่ง backend อัตโนมัติ)
 */
export function DocBreakoutModal({
  docId,
  section,
  rows,
  onClose,
  onCreated,
}: {
  docId: string
  section: TableSectionDef & { breakoutToTasks: NonNullable<TableSectionDef['breakoutToTasks']> }
  rows: TemplateTableRow[]
  onClose: () => void
  onCreated: (count: number) => void
}) {
  const { data: links } = useLoad<DocLinkRow[]>(() => api.get(`/api/docs/${docId}/links`), [docId])
  const existingSourceCodes = new Set((links ?? []).filter((l) => l.taskSrsSourceCode).map((l) => l.taskSrsSourceCode!))
  // เอกสาร Template ผูกโปรเจกต์ตรงๆ ไว้ตั้งแต่สร้าง (docLinks แถวที่ projectId ไม่ว่าง, taskId ว่าง) — ใช้แค่ preview รหัสอ้างอิง (โค้ดจริงฝั่ง backend คำนวณเองจาก docLinks อยู่แล้ว)
  const linkedProjectId = (links ?? []).find((l) => l.projectId)?.projectId ?? null
  const { data: project } = useLoad<ProjectInfo | null>(
    () => (linkedProjectId ? api.get(`/api/projects/${linkedProjectId}`) : Promise.resolve(null)),
    [linkedProjectId],
  )

  const cols: TableColumnDef[] = section.columns
  const colLabel = (key: string) => cols.find((c) => c.key === key)?.label ?? key
  const { sourceCodeKey, titleKey, priorityKey, descriptionKeys, docType, referenceCodeKey } = section.breakoutToTasks

  const [items, setItems] = useState<Candidate[]>([])
  const [initialized, setInitialized] = useState(false)
  const [docVersion, setDocVersion] = useState('1.0')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  useEffect(() => {
    if (initialized || !links) return
    const built = rows
      .map((row): Candidate | null => {
        const title = (row[titleKey] ?? '').trim()
        if (!title) return null
        const sourceCode = (row[sourceCodeKey] ?? '').trim() || null
        const description = descriptionKeys
          .map((k) => {
            const v = (row[k] ?? '').trim()
            return v ? `${colLabel(k)}:\n${v}` : null
          })
          .filter((v): v is string => !!v)
          .join('\n\n')
        return {
          tempId: randomId(),
          sourceCode,
          title,
          priority: priorityKey ? guessPriority(row[priorityKey] ?? '') : null,
          description,
          referenceCodes: referenceCodeKey ? (row[referenceCodeKey] ?? '').trim() : '',
          selected: !(sourceCode && existingSourceCodes.has(sourceCode)),
        }
      })
      .filter((c): c is Candidate => c !== null)
    setItems(built)
    setInitialized(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links])

  const updateItem = (tempId: string, patch: Partial<Candidate>) => setItems(items.map((it) => (it.tempId === tempId ? { ...it, ...patch } : it)))
  const removeItem = (tempId: string) => setItems(items.filter((it) => it.tempId !== tempId))

  const create = async () => {
    const selected = items.filter((it) => it.selected && it.title.trim())
    if (selected.length === 0) {
      setCreateError('ต้องเลือกอย่างน้อย 1 รายการ และมีชื่อเรื่อง')
      return
    }
    if (!docVersion.trim()) {
      setCreateError('ต้องระบุเวอร์ชันเอกสาร')
      return
    }
    setCreating(true)
    setCreateError('')
    try {
      const result = await api.post<{ duplicateWarnings: string[]; unresolvedReferences: string[]; tasks: unknown[] }>(`/api/docs/${docId}/breakout`, {
        docVersion: docVersion.trim(),
        items: selected.map((it) => ({
          sourceCode: it.sourceCode,
          title: it.title.trim(),
          description: it.description,
          priority: it.priority,
          referenceCodes: it.referenceCodes.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean),
        })),
      })
      if (result.duplicateWarnings.length > 0) {
        alert(`สร้างสำเร็จ แต่พบรหัสซ้ำจากที่แตกไปแล้วก่อนหน้า: ${result.duplicateWarnings.join(', ')} (สร้างใหม่ให้แล้ว)`)
      }
      if (result.unresolvedReferences.length > 0) {
        alert(`สร้าง Task สำเร็จ แต่หารหัสอ้างอิงไม่เจอ: ${result.unresolvedReferences.join(', ')} (พิมพ์ผิด หรือยังไม่ได้แตกเป็น Task ในเล่มก่อนหน้า)`)
      }
      onCreated(result.tasks.length)
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : 'สร้างไม่สำเร็จ')
    } finally {
      setCreating(false)
    }
  }

  const input = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
  const label = 'text-xs font-medium text-muted mb-1 block'
  const projectCodePrefix = sanitizeCodePrefix(project?.code, 'TASK')

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-10 mx-auto w-full max-w-2xl px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="font-semibold text-ink text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand-600" /> แตกเป็น Task
            </div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
          </div>

          {items.length === 0 && (
            <div className="flex items-start gap-2 bg-warning-50 border border-warning-100 rounded-lg p-3 text-xs text-warning-800 mb-4">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              ยังไม่มีแถวที่กรอกชื่อไว้ในตาราง — กรอกตารางในฟอร์มก่อนแล้วเปิดใหม่
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className={label}>เวอร์ชันเอกสาร (สำหรับรหัสอ้างอิงงาน)</label>
              <input value={docVersion} onChange={(e) => setDocVersion(e.target.value)} placeholder="เช่น 1.0" className={input} />
            </div>
          </div>
          <div className="text-xs text-info-700 bg-info-50 border border-info-100 rounded-lg px-3 py-2 mb-4">
            จะได้รหัสอ้างอิงเป็น <span className="font-mono font-medium">{projectCodePrefix}-{docType}-v{docVersion.trim() || '1.0'}-0xx</span> (ยึดตาม Codename ของโปรเจกต์นี้เสมอ — เลขท้ายรันต่อจากที่มีอยู่)
          </div>

          <div className="space-y-2">
            {items.map((it) => (
              <div key={it.tempId} className="border border-border-subtle rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <input type="checkbox" checked={it.selected} onChange={(e) => updateItem(it.tempId, { selected: e.target.checked })} className="mt-2" />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      {it.sourceCode && (
                        <span
                          title={existingSourceCodes.has(it.sourceCode) ? 'แตกเป็น Task ไปแล้วก่อนหน้า — ติ๊กเองถ้าต้องการสร้างซ้ำ' : 'รหัสอ้างอิงจากตารางในฟอร์ม'}
                          className={`text-[11px] font-mono px-1.5 py-0.5 rounded shrink-0 ${existingSourceCodes.has(it.sourceCode) ? 'bg-success-100 text-success-700' : 'text-muted bg-divider'}`}
                        >
                          {existingSourceCodes.has(it.sourceCode) ? '✓ แตกแล้ว: ' : 'อ้างอิง: '}{it.sourceCode}
                        </span>
                      )}
                      <input value={it.title} onChange={(e) => updateItem(it.tempId, { title: e.target.value })} placeholder="ชื่องาน" className={`${input} flex-1`} />
                      {priorityKey && (
                        <select
                          value={it.priority ?? ''}
                          onChange={(e) => updateItem(it.tempId, { priority: (e.target.value || null) as Candidate['priority'] })}
                          className="text-xs bg-white border border-border rounded-lg px-2 py-2 focus:outline-hidden"
                        >
                          <option value="">ไม่ระบุ</option>
                          <option value="high">สูง</option>
                          <option value="normal">กลาง</option>
                          <option value="low">ต่ำ</option>
                        </select>
                      )}
                    </div>
                    <textarea
                      value={it.description}
                      onChange={(e) => updateItem(it.tempId, { description: e.target.value })}
                      rows={2}
                      className="w-full text-xs bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400 resize-y"
                    />
                    {referenceCodeKey && (
                      <input
                        value={it.referenceCodes}
                        onChange={(e) => updateItem(it.tempId, { referenceCodes: e.target.value })}
                        placeholder={`${colLabel(referenceCodeKey)} (คั่นด้วย , ถ้ามีหลายรหัส)`}
                        className={`${input} font-mono text-xs`}
                      />
                    )}
                  </div>
                  <button onClick={() => removeItem(it.tempId)} className="text-muted hover:text-danger-600 shrink-0 mt-2"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>

          {createError && <div className="text-xs text-danger-600 mt-3">{createError}</div>}

          <div className="flex justify-end gap-2 pt-4 mt-2 border-t border-divider">
            <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
            <button
              onClick={() => void create()}
              disabled={creating || items.length === 0}
              className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40"
            >
              {creating ? 'กำลังสร้าง…' : `สร้าง ${items.filter((i) => i.selected).length} Tasks`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
