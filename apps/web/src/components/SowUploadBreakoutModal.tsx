import { AlertTriangle, FileText, Plus, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useDialog } from './Dialog'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'

interface SubtaskCandidate {
  tempId: string
  text: string
  referenceCode: string
  assigneeId: string | null
  estimateHours: string // ช่องกรอกเป็นชั่วโมง (แปลงเป็นนาทีตอนส่ง — ธรรมเนียมเดียวกับหน้ารายละเอียด Task)
}
interface BreakoutCandidate {
  tempId: string
  sourceCode: string | null
  title: string
  // Pronista §SOW Task/Subtask — "ประเภท" auto จากคอลัมน์ 4.4 ของเอกสาร แก้ไขได้ก่อนยืนยัน
  category: string
  priority: 'low' | 'normal' | 'high' | null
  description: string
  referenceCodes: string
  selected: boolean
  subtasks: SubtaskCandidate[]
}
interface ParseResponse {
  pendingFileKey: string
  filename: string
  items: {
    tempId: string
    sourceCode: string | null
    title: string
    category: string
    priority: 'low' | 'normal' | 'high' | null
    description: string
    referenceCodes: string[]
    selected: boolean
    subtasks: { tempId: string; text: string; referenceCode: string | null; assigneeId: string | null; estimateMinutes: number | null }[]
  }[]
  detectionFailed: boolean
  suggestedDocNumber: string | null
  suggestedVersion: string | null
}
interface ProjectOpt {
  id: string
  code: string | null
  name: string
}
interface UserOpt {
  id: string
  name: string
}

const randomId = () => `manual_${Math.random().toString(36).slice(2, 10)}`
const sanitizeCodePrefix = (raw: string | null | undefined, fallback: string) => (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || fallback

/**
 * Pronista §Document Version History — จับ "ชื่อเล่ม" + "เวอร์ชัน" จากชื่อไฟล์ (เหมือน DocUploadBreakoutModal เดิม)
 */
function parseFilenameMeta(name: string): { base: string; version: string | null } {
  const noExt = name.replace(/\.[^.]+$/, '')
  const m = noExt.match(/[\s._-]*[vV](\d+(?:\.\d+)*)\s*$/)
  if (m) return { base: noExt.slice(0, m.index).replace(/[\s._-]+$/, '').trim(), version: m[1]! }
  return { base: noExt.trim(), version: null }
}

/**
 * Pronista §SOW Task/Subtask — แทนที่ DocUploadBreakoutModal เดิม (เคยรองรับ 6 ประเภท) เหลือเฉพาะ SOW เท่านั้นที่แตกเป็น Task ได้ในระบบแล้ว
 * ต่างจากเดิมตรงหน้ารีวิวเป็น tree: Task พ่อ (จากตาราง 4.4) + Subtask ลูก (จากย่อหน้าโมดูล 4.1-4.3 ที่ backend parse มาให้แล้ว) แก้ไข/เพิ่ม/ลบได้ทั้ง 2 ชั้น
 * lockedProject: ใช้ตอนเปิดจากหน้าโปรเจกต์ — ข้ามขั้นเลือกโปรเจกต์เพราะรู้โปรเจกต์อยู่แล้ว
 */
export function SowUploadBreakoutModal({ lockedProject, onClose, onCreated }: {
  lockedProject?: ProjectOpt
  onClose: () => void
  onCreated: () => void
}) {
  const { alertDialog } = useDialog()
  const fileRef = useRef<HTMLInputElement>(null)
  const { data: fetchedProjectOpts } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const { data: userOpts } = useLoad<UserOpt[]>(() => api.get('/api/users'))
  const projectOpts = lockedProject ? [lockedProject] : fetchedProjectOpts
  const [projectId, setProjectId] = useState(lockedProject?.id ?? '')
  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload')
  const [doneInfo, setDoneInfo] = useState<{ docId: string; projectId: string; taskIds: string[]; subtaskCount: number } | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [parsed, setParsed] = useState<ParseResponse | null>(null)
  const [items, setItems] = useState<BreakoutCandidate[]>([])
  const [docTitle, setDocTitle] = useState('')
  const [docNumber, setDocNumber] = useState('')
  const [docVersion, setDocVersion] = useState('1.0')
  // Pronista §Epic Layer — ชื่อ Epic ที่จะครอบ Task ทั้งหมดที่แตกจากเอกสารนี้ (ตั้งต้นจากชื่อเอกสาร แก้ได้อิสระ) — ใช้เฉพาะโหมด V2 เท่านั้น
  const [epicTitle, setEpicTitle] = useState('')
  // Pronista §Project Refactor — SOW Parser Mode: V1 (ค่าเริ่มต้น) แตกเป็น Task แบนราบล้วน ไม่มี Epic/Story · V2 (เดิม) คง Epic>Task>Subtask ไว้ให้เลือกใช้ต่อได้
  const [parserMode, setParserMode] = useState<'V1_SIMPLE_TASK' | 'V2_ADVANCED_HIERARCHY'>('V1_SIMPLE_TASK')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const project = (projectOpts ?? []).find((p) => p.id === projectId) ?? null

  const handleFile = async (file: File) => {
    setParsing(true)
    setParseError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('docType', 'sow')
      const res = await fetch('/api/docs/upload-breakout/parse', { method: 'POST', body: fd })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string }
        setParseError(j.message ?? 'อ่านไฟล์ไม่สำเร็จ')
        return
      }
      const data = (await res.json()) as ParseResponse
      setParsed(data)
      setItems(
        data.items.map((it) => ({
          ...it,
          referenceCodes: it.referenceCodes.join(', '),
          subtasks: it.subtasks.map((s) => ({
            tempId: s.tempId,
            text: s.text,
            referenceCode: s.referenceCode ?? '',
            assigneeId: s.assigneeId,
            estimateHours: s.estimateMinutes != null ? String(s.estimateMinutes / 60) : '',
          })),
        })),
      )
      // ค่าตั้งต้น: ให้ความสำคัญกับข้อมูลในเอกสาร (doc meta) ก่อน แล้วค่อย fallback ไปที่ชื่อไฟล์ — ทุกช่องแก้ไขได้ในหน้ารีวิว
      const fn = parseFilenameMeta(file.name)
      const metaVer = data.suggestedVersion?.match(/[\d.]+/)?.[0]
      setDocTitle(data.suggestedDocNumber || fn.base)
      setDocNumber(data.suggestedDocNumber ?? fn.base)
      setDocVersion(fn.version ?? metaVer ?? '1.0')
      setEpicTitle(fn.base)
      setStep('review')
    } finally {
      setParsing(false)
    }
  }

  const updateItem = (tempId: string, patch: Partial<BreakoutCandidate>) =>
    setItems(items.map((it) => (it.tempId === tempId ? { ...it, ...patch } : it)))
  const removeItem = (tempId: string) => setItems(items.filter((it) => it.tempId !== tempId))
  const addManualItem = () =>
    setItems([...items, { tempId: randomId(), sourceCode: null, title: '', category: '', priority: null, description: '', referenceCodes: '', selected: true, subtasks: [] }])

  const updateSubtask = (parentTempId: string, subTempId: string, patch: Partial<SubtaskCandidate>) =>
    setItems(items.map((it) => (it.tempId !== parentTempId ? it : { ...it, subtasks: it.subtasks.map((s) => (s.tempId === subTempId ? { ...s, ...patch } : s)) })))
  const removeSubtask = (parentTempId: string, subTempId: string) =>
    setItems(items.map((it) => (it.tempId !== parentTempId ? it : { ...it, subtasks: it.subtasks.filter((s) => s.tempId !== subTempId) })))
  const addManualSubtask = (parentTempId: string) =>
    setItems(
      items.map((it) =>
        it.tempId !== parentTempId
          ? it
          : { ...it, subtasks: [...it.subtasks, { tempId: randomId(), text: '', referenceCode: '', assigneeId: null, estimateHours: '' }] },
      ),
    )

  const create = async () => {
    if (!parsed || !projectId) return
    const selected = items.filter((it) => it.selected && it.title.trim())
    if (selected.length === 0) {
      setCreateError('ต้องเลือกอย่างน้อย 1 รายการ และมีชื่อเรื่อง')
      return
    }
    if (!docVersion.trim()) {
      setCreateError('ต้องระบุเวอร์ชันเอกสาร')
      return
    }
    if (parserMode === 'V2_ADVANCED_HIERARCHY' && !epicTitle.trim()) {
      setCreateError('ต้องระบุชื่อ Epic')
      return
    }
    setCreating(true)
    setCreateError('')
    try {
      const result = await api.post<{
        duplicateWarnings: string[]
        unresolvedReferences: string[]
        tasks: { id: string }[]
        subtasks: { id: string }[]
        doc: { id: string }
      }>('/api/docs/upload-breakout/confirm', {
        projectId,
        docType: 'sow',
        pendingFileKey: parsed.pendingFileKey,
        filename: parsed.filename,
        docTitle: docTitle.trim() || parsed.filename,
        docNumber: docNumber.trim() || null,
        docVersion: docVersion.trim(),
        mode: parserMode,
        epicTitle: parserMode === 'V2_ADVANCED_HIERARCHY' ? epicTitle.trim() : undefined,
        items: selected.map((it) => ({
          sourceCode: it.sourceCode,
          title: it.title.trim(),
          category: it.category.trim(),
          description: it.description,
          priority: it.priority,
          referenceCodes: it.referenceCodes.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean),
          subtasks: it.subtasks
            .filter((s) => s.text.trim())
            .map((s) => ({
              text: s.text.trim(),
              referenceCode: s.referenceCode.trim() || null,
              assigneeId: s.assigneeId,
              estimateMinutes: s.estimateHours.trim() ? Math.round(Number(s.estimateHours) * 60) : null,
            })),
        })),
      })
      if (result.duplicateWarnings.length > 0) {
        await alertDialog({ title: `สร้างสำเร็จ แต่พบรหัสซ้ำจากการนำเข้าครั้งก่อน: ${result.duplicateWarnings.join(', ')} (สร้างใหม่ให้แล้ว)` })
      }
      if (result.unresolvedReferences.length > 0) {
        await alertDialog({ title: `สร้าง Task สำเร็จ แต่หารหัสอ้างอิงไม่เจอ: ${result.unresolvedReferences.join(', ')} (พิมพ์ผิด หรือยังไม่ได้แตกเป็น Task ในเล่มก่อนหน้า)` })
      }
      setDoneInfo({ docId: result.doc.id, projectId, taskIds: result.tasks.map((t) => t.id), subtaskCount: result.subtasks.length })
      setStep('done')
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : 'สร้างไม่สำเร็จ')
    } finally {
      setCreating(false)
    }
  }

  const input = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
  const label = 'text-xs font-medium text-muted mb-1 block'

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-10 mx-auto w-full max-w-3xl px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="font-semibold text-ink text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand-600" /> อัปโหลดเอกสาร SOW (แตกเป็น Task/Subtask)
            </div>
            {/* สถานะ done = สร้างของจริงไปแล้ว — ปิดทางไหนก็ต้องให้ parent reload เหมือนกดเสร็จสิ้น */}
            <button onClick={step === 'done' ? onCreated : onClose} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
          </div>

          {step === 'upload' && (
            <div className="space-y-4">
              {lockedProject ? (
                <div className="text-xs text-info-700 bg-info-50 border border-info-100 rounded-lg px-3 py-2">
                  โปรเจกต์: <span className="font-medium">{lockedProject.name}</span>
                </div>
              ) : (
                <div>
                  <label className={label}>โปรเจกต์ (ใช้เดินรหัสอ้างอิงงาน + ลง Backlog)</label>
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={input}>
                    <option value="">เลือกโปรเจกต์…</option>
                    {(projectOpts ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              <div className="text-center py-8">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".docx"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={parsing || !projectId}
                  className="inline-flex flex-col items-center gap-2 border-2 border-dashed border-border rounded-lg px-8 py-8 text-dim hover:border-brand-400 hover:text-brand-600 disabled:opacity-50"
                >
                  <Upload className="w-6 h-6" />
                  <span className="text-sm">{parsing ? 'กำลังอ่านไฟล์…' : !projectId ? 'เลือกโปรเจกต์ก่อน' : 'เลือกไฟล์ .docx'}</span>
                </button>
                <div className="text-xs text-muted mt-3">รับเฉพาะ .docx (ถ้าเป็น .doc เก่า กรุณา Save As เป็น .docx ก่อน)</div>
                {parseError && <div className="text-xs text-danger-600 mt-3">{parseError}</div>}
              </div>
            </div>
          )}

          {step === 'review' && parsed && (
            <div className="space-y-4">
              {parsed.detectionFailed && (
                <div className="flex items-start gap-2 bg-warning-50 border border-warning-100 rounded-lg p-3 text-xs text-warning-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  ไม่พบตารางที่ตรงกับ Template SOW ในเอกสารนี้ — เพิ่มรายการเองด้านล่างได้เลย
                </div>
              )}

              <div className="grid sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1">
                  <label className={label}>ชื่อเอกสาร</label>
                  <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} className={input} />
                </div>
                <div>
                  <label className={label}>เลขที่เอกสาร</label>
                  <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="เช่น BNT-SOW-2026-004" className={input} />
                </div>
                <div>
                  <label className={label}>เวอร์ชัน</label>
                  <input value={docVersion} onChange={(e) => setDocVersion(e.target.value)} placeholder="เช่น 1.0" className={input} />
                </div>
              </div>

              <div className="text-xs text-info-700 bg-info-50 border border-info-100 rounded-lg px-3 py-2">
                จะได้รหัสอ้างอิงเป็น <span className="font-mono font-medium">{sanitizeCodePrefix(project?.code, 'TASK')}-SOW-v{docVersion.trim() || '1.0'}-0xx</span> (ยึดตาม Codename ของโปรเจกต์นี้เสมอ — เลขท้ายรันต่อจากที่มีอยู่)
              </div>

              <div>
                <label className={label}>โหมดการแตกงาน</label>
                <div className="space-y-1.5">
                  <label className="flex items-start gap-2 text-xs text-body cursor-pointer">
                    <input type="radio" name="parserMode" checked={parserMode === 'V1_SIMPLE_TASK'} onChange={() => setParserMode('V1_SIMPLE_TASK')} className="mt-0.5" />
                    <span><span className="font-medium">แบบง่าย (Task เดียว) — แนะนำ</span> — แตกทุกรายการเป็น Task แบนราบ ไม่มี Epic (รองรับฟอร์แมต SOW ที่ยังไม่นิ่งได้ดีกว่า)</span>
                  </label>
                  <label className="flex items-start gap-2 text-xs text-body cursor-pointer">
                    <input type="radio" name="parserMode" checked={parserMode === 'V2_ADVANCED_HIERARCHY'} onChange={() => setParserMode('V2_ADVANCED_HIERARCHY')} className="mt-0.5" />
                    <span><span className="font-medium">แบบขั้นสูง (Epic {'>'} Story {'>'} Task) — ทดลอง</span> — ครอบทุกรายการด้วย Epic เดียวกัน + งานย่อยเป็นลูกของ Task พ่อ</span>
                  </label>
                </div>
              </div>

              {parserMode === 'V2_ADVANCED_HIERARCHY' && (
                <div>
                  <label className={label}>ชื่อ Epic (ครอบ Task ทั้งหมดที่แตกจากเอกสารนี้ในหน้า Backlog)</label>
                  <input value={epicTitle} onChange={(e) => setEpicTitle(e.target.value)} placeholder="เช่น Food Ordering & Dine-in (Phase 2)" className={input} />
                </div>
              )}

              <div className="space-y-3">
                {items.map((it) => (
                  <div key={it.tempId} className="border border-border-subtle rounded-lg p-3 space-y-3">
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={it.selected} onChange={(e) => updateItem(it.tempId, { selected: e.target.checked })} className="mt-2" />
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <input value={it.title} onChange={(e) => updateItem(it.tempId, { title: e.target.value })} placeholder="ชื่องาน" className={`${input} flex-1`} />
                          <select
                            value={it.priority ?? ''}
                            onChange={(e) => updateItem(it.tempId, { priority: (e.target.value || null) as BreakoutCandidate['priority'] })}
                            className="text-xs bg-white border border-border rounded-lg px-2 py-2 focus:outline-hidden"
                          >
                            <option value="">ไม่ระบุ</option>
                            <option value="high">สูง</option>
                            <option value="normal">กลาง</option>
                            <option value="low">ต่ำ</option>
                          </select>
                        </div>
                        <div className="grid sm:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[11px] text-muted mb-0.5 block">เลข Task</label>
                            <input
                              value={it.sourceCode ?? ''}
                              onChange={(e) => updateItem(it.tempId, { sourceCode: e.target.value || null })}
                              placeholder="เว้นว่าง = ออกเลขอัตโนมัติ"
                              title="เลขนี้จะถูกใช้เป็นรหัสงานจริง"
                              className={`${input} font-mono text-xs`}
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-muted mb-0.5 block">ประเภท</label>
                            <input
                              value={it.category}
                              onChange={(e) => updateItem(it.tempId, { category: e.target.value })}
                              placeholder="เช่น User-Facing Feature"
                              className={`${input} text-xs`}
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-muted mb-0.5 block">อ้างอิง BR</label>
                            <input
                              value={it.referenceCodes}
                              onChange={(e) => updateItem(it.tempId, { referenceCodes: e.target.value })}
                              placeholder="คั่นด้วย , ถ้ามีหลายรหัส"
                              className={`${input} font-mono text-xs`}
                            />
                          </div>
                        </div>
                        <textarea
                          value={it.description}
                          onChange={(e) => updateItem(it.tempId, { description: e.target.value })}
                          rows={2}
                          className="w-full text-xs bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400 resize-y"
                        />
                      </div>
                      <button onClick={() => removeItem(it.tempId)} className="text-muted hover:text-danger-600 shrink-0 mt-2"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>

                    {/* Pronista §SOW Task/Subtask — งานย่อยใต้ Task พ่อนี้ (parse จากย่อหน้าโมดูลในเอกสาร แก้/เพิ่ม/ลบได้) */}
                    <div className="pl-6 space-y-2">
                      {it.subtasks.length === 0 && (
                        <div className="text-[11px] text-muted italic">ไม่พบรายละเอียดย่อยจากเอกสาร — เพิ่มเองได้</div>
                      )}
                      {it.subtasks.map((s) => (
                        <div key={s.tempId} className="flex items-center gap-1.5 border-l-2 border-border-subtle pl-2">
                          <input
                            value={s.text}
                            onChange={(e) => updateSubtask(it.tempId, s.tempId, { text: e.target.value })}
                            placeholder="ชื่องานย่อย"
                            className={`${input} flex-1 text-xs py-1.5`}
                          />
                          <select
                            value={s.assigneeId ?? ''}
                            onChange={(e) => updateSubtask(it.tempId, s.tempId, { assigneeId: e.target.value || null })}
                            className="text-xs bg-white border border-border rounded-lg px-1.5 py-1.5 focus:outline-hidden w-28 shrink-0"
                          >
                            <option value="">ยังไม่ระบุ</option>
                            {(userOpts ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                          <input
                            value={s.estimateHours}
                            onChange={(e) => updateSubtask(it.tempId, s.tempId, { estimateHours: e.target.value })}
                            type="number"
                            min="0"
                            step="0.5"
                            placeholder="ชม."
                            title="ชั่วโมงประมาณการ"
                            className="text-xs bg-white border border-border rounded-lg px-1.5 py-1.5 focus:outline-hidden w-16 shrink-0"
                          />
                          <input
                            value={s.referenceCode}
                            onChange={(e) => updateSubtask(it.tempId, s.tempId, { referenceCode: e.target.value })}
                            placeholder="รหัสอ้างอิง"
                            title="Reference Code"
                            className="text-xs bg-white border border-border rounded-lg px-1.5 py-1.5 focus:outline-hidden font-mono w-36 shrink-0"
                          />
                          <button onClick={() => removeSubtask(it.tempId, s.tempId)} className="text-muted hover:text-danger-600 shrink-0"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      ))}
                      <button onClick={() => addManualSubtask(it.tempId)} className="flex items-center gap-1 text-[11px] text-brand-700 hover:text-brand-800">
                        <Plus className="w-3 h-3" /> เพิ่มงานย่อย
                      </button>
                    </div>
                  </div>
                ))}
                {items.length === 0 && <div className="text-center text-xs text-muted py-4">ยังไม่มีรายการ — เพิ่มเองด้านล่าง</div>}
              </div>

              <button onClick={addManualItem} className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800">
                <Plus className="w-4 h-4" /> เพิ่มรายการเอง
              </button>

              {createError && <div className="text-xs text-danger-600">{createError}</div>}

              <div className="flex justify-end gap-2 pt-2 border-t border-divider">
                <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
                <button
                  onClick={() => void create()}
                  disabled={creating}
                  className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40"
                >
                  {creating
                    ? 'กำลังสร้าง…'
                    : `สร้าง ${items.filter((i) => i.selected).length} Task + ${items.filter((i) => i.selected).reduce((n, i) => n + i.subtasks.filter((s) => s.text.trim()).length, 0)} Subtask`}
                </button>
              </div>
            </div>
          )}

          {step === 'done' && doneInfo && (
            <div className="text-center py-6 space-y-4">
              <div className="text-3xl">✅</div>
              <div className="text-sm text-ink font-medium">
                สร้างสำเร็จ — {doneInfo.taskIds.length} Task + {doneInfo.subtaskCount} Subtask ลง Backlog แล้ว
              </div>
              <div className="text-xs text-muted">ระบบเก็บไฟล์ Word ต้นฉบับ SOW ไว้ในเมนูเอกสารแล้ว</div>
              <div className="flex flex-wrap justify-center gap-2">
                <a
                  href={
                    doneInfo.taskIds.length === 1 && doneInfo.subtaskCount === 0
                      ? `/projects/${doneInfo.projectId}?task=${doneInfo.taskIds[0]}`
                      : `/projects/${doneInfo.projectId}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700"
                >
                  {doneInfo.taskIds.length === 1 && doneInfo.subtaskCount === 0
                    ? 'เปิด Task ที่สร้าง'
                    : `เปิดโปรเจกต์ (ดู ${doneInfo.taskIds.length} Task ใน Backlog)`}
                </a>
                <a
                  href={`/docs/${doneInfo.docId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm border border-border-subtle px-4 py-2 rounded-lg hover:bg-hover"
                >
                  เปิดไฟล์ที่อัปโหลด
                </a>
                <button onClick={onCreated} className="text-sm border border-border-subtle px-4 py-2 rounded-lg hover:bg-hover">เสร็จสิ้น</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
