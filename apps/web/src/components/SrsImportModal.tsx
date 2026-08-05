import { AlertTriangle, FileText, Plus, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'

interface SrsCandidate {
  tempId: string
  headingStyle: string
  sourceCode: string | null
  title: string
  priorityRaw: string | null
  priority: 'low' | 'normal' | 'high' | null
  description: string
  selected: boolean
}
interface SrsDetectedGroup {
  prefix: string
  headingStyle: string
  isDominant: boolean
  candidates: SrsCandidate[]
}
interface ParseResponse {
  pendingFileKey: string
  filename: string
  detectedGroups: SrsDetectedGroup[]
  detectionFailed: boolean
  suggestedDocNumber: string | null
  suggestedVersion: string | null
}

const randomId = () => `manual_${Math.random().toString(36).slice(2, 10)}`

// Pronista §Sprint & Board แก้ไข flow (ข้อ 10) — mirror apps/api/src/lib/task-code.ts sanitizeCodePrefix ไว้ preview รหัสจริงที่จะได้
// (ตัว running number ท้ายสุดรู้แน่นอนได้ตอน confirm เท่านั้น — พรีวิวนี้บอกแค่รูปแบบ prefix ให้เห็นว่ายึด Codename โปรเจกต์ ไม่ใช่ code จากเอกสาร)
const sanitizeCodePrefix = (raw: string | null | undefined, fallback: string) => (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || fallback

/** Pronista §SRS import — นำเข้าเอกสาร SRS มาแตกเป็น Task: อัปโหลด → พาร์สหาโครงสร้าง → รีวิว/แก้/เลือก → ยืนยันสร้าง */
export function SrsImportModal({ projectId, projectCode, onClose, onCreated }: { projectId: string; projectCode: string | null; onClose: () => void; onCreated: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<'upload' | 'review'>('upload')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [parsed, setParsed] = useState<ParseResponse | null>(null)
  const [groupIdx, setGroupIdx] = useState(0)
  const [items, setItems] = useState<SrsCandidate[]>([])
  const [docTitle, setDocTitle] = useState('')
  const [srsDocNumber, setSrsDocNumber] = useState('')
  const [srsVersion, setSrsVersion] = useState('1.0')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const handleFile = async (file: File) => {
    setParsing(true)
    setParseError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/docs/srs/parse', { method: 'POST', body: fd })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string }
        setParseError(j.message ?? 'อ่านไฟล์ไม่สำเร็จ')
        return
      }
      const data = (await res.json()) as ParseResponse
      setParsed(data)
      const dominantIdx = Math.max(0, data.detectedGroups.findIndex((g) => g.isDominant))
      setGroupIdx(dominantIdx)
      setItems(data.detectedGroups[dominantIdx]?.candidates.map((c) => ({ ...c })) ?? [])
      setDocTitle(data.suggestedDocNumber || file.name.replace(/\.docx$/i, ''))
      setSrsDocNumber(data.suggestedDocNumber ?? '')
      setSrsVersion(data.suggestedVersion?.match(/[\d.]+/)?.[0] ?? '1.0')
      setStep('review')
    } finally {
      setParsing(false)
    }
  }

  const switchGroup = (idx: number) => {
    setGroupIdx(idx)
    setItems(parsed!.detectedGroups[idx]!.candidates.map((c) => ({ ...c })))
  }
  const updateItem = (tempId: string, patch: Partial<SrsCandidate>) => {
    setItems(items.map((it) => (it.tempId === tempId ? { ...it, ...patch } : it)))
  }
  const removeItem = (tempId: string) => setItems(items.filter((it) => it.tempId !== tempId))
  const addManualItem = () =>
    setItems([...items, { tempId: randomId(), headingStyle: '', sourceCode: null, title: '', priorityRaw: null, priority: null, description: '', selected: true }])

  const create = async () => {
    if (!parsed) return
    const selected = items.filter((it) => it.selected && it.title.trim())
    if (selected.length === 0) {
      setCreateError('ต้องเลือกอย่างน้อย 1 รายการ และมีชื่อเรื่อง')
      return
    }
    if (!srsVersion.trim()) {
      setCreateError('ต้องระบุเวอร์ชันเอกสาร')
      return
    }
    setCreating(true)
    setCreateError('')
    try {
      const result = await api.post<{ duplicateWarnings: string[]; tasks: unknown[] }>('/api/docs/srs/confirm', {
        projectId,
        pendingFileKey: parsed.pendingFileKey,
        filename: parsed.filename,
        docTitle: docTitle.trim() || parsed.filename,
        srsDocNumber: srsDocNumber.trim() || null,
        srsVersion: srsVersion.trim(),
        items: selected.map((it) => ({
          sourceCode: it.sourceCode,
          title: it.title.trim(),
          description: it.description,
          priority: it.priority,
        })),
      })
      if (result.duplicateWarnings.length > 0) {
        alert(`สร้างสำเร็จ แต่พบรหัสซ้ำจากการนำเข้าครั้งก่อน: ${result.duplicateWarnings.join(', ')} (สร้างใหม่ให้แล้ว)`)
      }
      onCreated()
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
      <div className="absolute inset-x-0 top-10 mx-auto w-full max-w-2xl px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="font-semibold text-ink text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand-600" /> นำเข้าเอกสาร SRS
            </div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
          </div>

          {step === 'upload' && (
            <div className="text-center py-10">
              <input
                ref={fileRef}
                type="file"
                accept=".docx"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={parsing}
                className="inline-flex flex-col items-center gap-2 border-2 border-dashed border-border rounded-lg px-8 py-8 text-dim hover:border-brand-400 hover:text-brand-600 disabled:opacity-50"
              >
                <Upload className="w-6 h-6" />
                <span className="text-sm">{parsing ? 'กำลังอ่านไฟล์…' : 'เลือกไฟล์ .docx'}</span>
              </button>
              <div className="text-xs text-muted mt-3">รับเฉพาะ .docx (ถ้าเป็น .doc เก่า กรุณา Save As เป็น .docx ก่อน)</div>
              {parseError && <div className="text-xs text-danger-600 mt-3">{parseError}</div>}
            </div>
          )}

          {step === 'review' && parsed && (
            <div className="space-y-4">
              {parsed.detectionFailed && (
                <div className="flex items-start gap-2 bg-warning-50 border border-warning-100 rounded-lg p-3 text-xs text-warning-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  ไม่พบรูปแบบข้อความต้องการอัตโนมัติในเอกสารนี้ — เพิ่มรายการเองด้านล่างได้เลย
                </div>
              )}

              <div className="grid sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1">
                  <label className={label}>ชื่อเอกสาร</label>
                  <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} className={input} />
                </div>
                <div>
                  <label className={label}>เลขที่เอกสาร</label>
                  <input value={srsDocNumber} onChange={(e) => setSrsDocNumber(e.target.value)} placeholder="เช่น BNT-SRS-2026-004" className={input} />
                </div>
                <div>
                  <label className={label}>เวอร์ชัน</label>
                  <input value={srsVersion} onChange={(e) => setSrsVersion(e.target.value)} placeholder="เช่น 1.0" className={input} />
                </div>
              </div>

              <div className="text-xs text-info-700 bg-info-50 border border-info-100 rounded-lg px-3 py-2">
                จะได้รหัสอ้างอิงเป็น <span className="font-mono font-medium">{sanitizeCodePrefix(projectCode, 'TASK')}-SRS-v{srsVersion.trim() || '1.0'}-0xx</span> (ยึดตาม Codename ของโปรเจกต์นี้เสมอ — เลขท้ายรันต่อจากที่มีอยู่)
              </div>

              {parsed.detectedGroups.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">พบหลายรูปแบบ เลือกกลุ่มที่ต้องการ:</span>
                  {parsed.detectedGroups.map((g, i) => (
                    <button
                      key={`${g.headingStyle}-${g.prefix}`}
                      onClick={() => switchGroup(i)}
                      className={`text-xs px-2.5 py-1 rounded-full border ${i === groupIdx ? 'bg-brand-50 border-brand-200 text-brand-700' : 'border-border-subtle text-dim hover:bg-hover'}`}
                    >
                      {g.prefix} ({g.candidates.length}){g.isDominant ? ' ★' : ''}
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {items.map((it) => (
                  <div key={it.tempId} className="border border-border-subtle rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={it.selected} onChange={(e) => updateItem(it.tempId, { selected: e.target.checked })} className="mt-2" />
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          {it.sourceCode && (
                            <span
                              title="รหัสอ้างอิงจากเอกสารต้นฉบับเท่านั้น — ไม่ใช่รหัสงานจริงที่จะถูกสร้าง (ดูรหัสจริงด้านบน)"
                              className="text-[11px] font-mono text-muted bg-divider px-1.5 py-0.5 rounded shrink-0"
                            >
                              อ้างอิง: {it.sourceCode}
                            </span>
                          )}
                          <input value={it.title} onChange={(e) => updateItem(it.tempId, { title: e.target.value })} placeholder="ชื่องาน" className={`${input} flex-1`} />
                          <select
                            value={it.priority ?? ''}
                            onChange={(e) => updateItem(it.tempId, { priority: (e.target.value || null) as SrsCandidate['priority'] })}
                            className="text-xs bg-white border border-border rounded-lg px-2 py-2 focus:outline-hidden"
                          >
                            <option value="">ไม่ระบุ</option>
                            <option value="high">สูง</option>
                            <option value="normal">กลาง</option>
                            <option value="low">ต่ำ</option>
                          </select>
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
                  {creating ? 'กำลังสร้าง…' : `สร้าง ${items.filter((i) => i.selected).length} Tasks`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
