/**
 * Pronista §System Requirements Update — แถบยืนยัน "โยนเข้า Sprint" แบบเลือกหลายงานด้วย checkbox
 * ใช้ร่วมกันทั้ง Workspace.tsx (Backlog Grid) และ ProjectDetail.tsx (SprintSection's Backlog panel)
 * แสดงเฉพาะตอนมีงานถูกเลือกอย่างน้อย 1 รายการ — ยอดรวมชั่วโมงคำนวณจาก candidateTasks ที่หน้าเรียกส่งมาเอง (estimateMinutes)
 */
import { minutesToHoursLabel } from '@seedoffice/core'
import { ChevronDown, X } from 'lucide-react'
import { useState } from 'react'
import { api, ApiError } from '../lib/api'

export interface SprintOption {
  id: string
  label: string
}

export function SprintBulkAddBar({
  selectedCount,
  totalMinutes,
  sprintOptions,
  onConfirm,
  onClear,
}: {
  selectedCount: number
  totalMinutes: number
  sprintOptions: SprintOption[]
  onConfirm: (sprintId: string) => Promise<void>
  onClear: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (selectedCount === 0) return null

  const pick = async (sprintId: string) => {
    setPickerOpen(false)
    setSaving(true)
    setError('')
    try {
      await onConfirm(sprintId)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'โยนงานเข้า Sprint ไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sticky bottom-0 z-20 flex items-center gap-3 bg-ink text-white rounded-lg shadow-lg px-4 py-2.5 mt-2 flex-wrap">
      <span className="text-sm font-medium">เลือก {selectedCount} งาน</span>
      <span className="text-sm text-white/70">รวม ⏱ {minutesToHoursLabel(totalMinutes)} ชม.</span>
      <div className="relative ml-auto">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          disabled={saving || sprintOptions.length === 0}
          className="flex items-center gap-1 text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-40 px-3 py-1.5 rounded-lg"
        >
          {saving ? 'กำลังโยนเข้า Sprint…' : 'โยนเข้า Sprint'} <ChevronDown className="w-3.5 h-3.5" />
        </button>
        {pickerOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} />
            <div className="absolute right-0 bottom-full mb-1 z-40 w-56 bg-white rounded-lg shadow-2xl border border-border-subtle py-1 text-sm max-h-64 overflow-y-auto">
              {sprintOptions.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted">ยังไม่มี Sprint ที่เปิดอยู่</div>
              ) : (
                sprintOptions.map((s) => (
                  <button key={s.id} onClick={() => void pick(s.id)} className="w-full text-left px-3 py-1.5 text-body hover:bg-hover truncate">
                    {s.label}
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
      <button type="button" onClick={onClear} title="ยกเลิกการเลือก" className="text-white/70 hover:text-white">
        <X className="w-4 h-4" />
      </button>
      {error && <div className="basis-full text-xs text-danger-300">{error}</div>}
    </div>
  )
}

/** ยิง batch endpoint จริง — คืนสรุปจำนวนที่เพิ่มสำเร็จ/ข้าม ให้หน้าเรียกไปโชว์ต่อได้ */
export async function addTasksToSprintBatch(sprintId: string, taskIds: string[]): Promise<{ added: number; skipped: number }> {
  return api.post(`/api/sprints/${sprintId}/tasks/batch`, { taskIds })
}
