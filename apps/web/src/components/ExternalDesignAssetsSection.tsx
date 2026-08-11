import { X } from 'lucide-react'
import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { DateInputTH } from './DateInputTH'

interface SowTaskOpt {
  id: string
  code: string | null
  originCode: string | null
  title: string
}
interface UserOpt {
  id: string
  name: string
}

/**
 * Pronista §External Document Version Logging → §Project Refactor — เดิมเป็นแท็บ "External Design Assets" แยก
 * ตอนนี้ตารางรวมย้ายไปอยู่ใน "ประวัติเอกสาร" (DocumentHistoryTable.tsx) แล้ว เหลือแค่ modal นี้ที่ยังใช้ร่วมกันสำหรับเพิ่ม/แก้ไขเวอร์ชัน external log
 */
export function AddVersionModal({ projectId, sowTaskOptions, onClose, onCreated }: {
  projectId: string
  sowTaskOptions: SowTaskOpt[]
  onClose: () => void
  onCreated: () => void
}) {
  const { data: userOpts } = useLoad<UserOpt[]>(() => api.get('/api/users'))
  const [documentName, setDocumentName] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [version, setVersion] = useState('v1.0')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [createdBy, setCreatedBy] = useState('')
  const [reviewedBy, setReviewedBy] = useState('')
  const [status, setStatus] = useState<'draft' | 'under_review' | 'approved'>('draft')
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggleTask = (id: string) =>
    setSelectedTasks((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next })

  const save = async () => {
    if (!documentName.trim() || !externalUrl.trim() || !version.trim() || !createdBy) {
      setError('กรอกชื่อเอกสาร, ลิงก์, เวอร์ชัน และเลือกผู้จัดทำก่อน')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api.post(`/api/projects/${projectId}/external-doc-logs`, {
        documentName: documentName.trim(),
        externalUrl: externalUrl.trim(),
        version: version.trim(),
        startDate: startDate || null,
        endDate: endDate || null,
        createdBy,
        reviewedBy: reviewedBy || null,
        status,
        relatedTaskIds: [...selectedTasks],
      })
      onCreated()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const input = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
  const label = 'text-xs font-medium text-muted mb-1 block'

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-10 mx-auto w-full max-w-lg px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="font-semibold text-ink text-sm">Add/Update Version — บันทึกเป็นประวัติแถวใหม่เสมอ</div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <div className="space-y-3">
            <div>
              <label className={label}>ชื่อเอกสาร</label>
              <input value={documentName} onChange={(e) => setDocumentName(e.target.value)} placeholder="เช่น User Interface Design" className={input} />
            </div>
            <div>
              <label className={label}>ลิงก์ภายนอก (Canva/Figma/อื่นๆ)</label>
              <input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://www.canva.com/design/…" className={input} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>เวอร์ชัน</label>
                <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="เช่น v1.0" className={input} />
              </div>
              <div>
                <label className={label}>สถานะ</label>
                <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={input}>
                  <option value="draft">Draft</option>
                  <option value="under_review">Under Review</option>
                  <option value="approved">Approved</option>
                </select>
              </div>
              <div>
                <label className={label}>วันที่เริ่มทำ</label>
                <DateInputTH value={startDate} onChange={setStartDate} className={input} />
              </div>
              <div>
                <label className={label}>วันที่สิ้นสุด/ส่งมอบ</label>
                <DateInputTH value={endDate} onChange={setEndDate} className={input} />
              </div>
              <div>
                <label className={label}>ผู้จัดทำ</label>
                <select value={createdBy} onChange={(e) => setCreatedBy(e.target.value)} className={input}>
                  <option value="">— เลือก —</option>
                  {(userOpts ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>ผู้ตรวจรีวิว</label>
                <select value={reviewedBy} onChange={(e) => setReviewedBy(e.target.value)} className={input}>
                  <option value="">— ไม่ระบุ —</option>
                  {(userOpts ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={label}>รหัส SOW ที่เกี่ยวข้อง ({selectedTasks.size} รายการ)</label>
              {sowTaskOptions.length === 0 ? (
                <div className="text-xs text-muted border border-border-subtle rounded-lg px-3 py-2">
                  โปรเจกต์นี้ยังไม่มี Task จากเอกสาร SOW — อัปโหลดเอกสาร SOW แตกเป็น Task ก่อน แล้วค่อยกลับมาผูก
                </div>
              ) : (
                <div className="border border-border-subtle rounded-lg divide-y divide-divider max-h-44 overflow-y-auto">
                  {sowTaskOptions.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-hover">
                      <input type="checkbox" checked={selectedTasks.has(t.id)} onChange={() => toggleTask(t.id)} />
                      {t.originCode && <span className="text-[10px] font-mono bg-info-100 text-info-700 px-1.5 py-0.5 rounded shrink-0">{t.originCode}</span>}
                      <span className="truncate">{t.title}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            {error && <div className="text-xs text-danger-600">{error}</div>}
            <div className="flex justify-end gap-2 pt-2 border-t border-divider">
              <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
              <button onClick={() => void save()} disabled={saving} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
                {saving ? 'กำลังบันทึก…' : 'บันทึกเวอร์ชัน'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
