import { useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { TaskPickerModal, type PickableTask } from './TaskPickerModal'

interface ProjectOpt {
  id: string
  name: string
  code: string | null
}

interface AllProjectTask extends PickableTask {
  kind: 'task' | 'defect' | 'cr' | 'backlog'
}

const NEEDS_PARENT = new Set(['task', 'subtask'])

/**
 * Tasknista §Backlog cross-project convert — เมนู "จัดการ" ใน Backlog ของโปรเจกต์:
 * เลือกโปรเจกต์ปลายทางก่อนเสมอ (default = โปรเจกต์ปัจจุบัน) แล้วค่อยเลือก parent (เฉพาะ task/subtask) จากโปรเจกต์ที่เลือก
 */
export function ConvertBacklogModal({
  taskId,
  to,
  title,
  currentProjectId,
  excludeTaskIds,
  onClose,
  onConverted,
}: {
  taskId: string
  to: 'epic' | 'story' | 'task' | 'subtask' | 'defect' | 'cr'
  title: string
  // Tasknista §Company Backlog convert — ไม่ระบุ (งานลอยๆ ไม่มีโปรเจกต์เดิม) = บังคับให้เลือกโปรเจกต์ปลายทางเอง (placeholder ว่างไว้)
  currentProjectId?: string
  excludeTaskIds?: string[]
  onClose: () => void
  onConverted: () => void
}) {
  const { data: projects } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const [targetProjectId, setTargetProjectId] = useState(currentProjectId ?? '')
  const [step, setStep] = useState<'project' | 'parent'>('project')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const { data: parentTasks } = useLoad<AllProjectTask[]>(
    () => (step === 'parent' ? api.get(`/api/projects/${targetProjectId}/tasks/all`) : Promise.resolve([])),
    [step, targetProjectId],
  )

  const convert = async (targetParentId?: string) => {
    setBusy(true)
    setError('')
    try {
      await api.post(`/api/tasks/${taskId}/convert`, { to, targetProjectId, targetParentId })
      onConverted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ผิดพลาด')
      setBusy(false)
    }
  }

  const goNext = () => {
    if (NEEDS_PARENT.has(to)) setStep('parent')
    else void convert()
  }

  if (step === 'parent') {
    const options = (parentTasks ?? []).filter(
      (t) => t.kind === 'task' && (to === 'subtask' ? t.parentId !== null : t.parentId === null) && !(excludeTaskIds ?? [taskId]).includes(t.id),
    )
    return (
      <TaskPickerModal
        title={`${title} — เลือก ${to === 'subtask' ? 'Task แม่' : 'Story แม่'}`}
        tasks={options}
        onPick={(picked) => void convert(picked.id)}
        onClose={onClose}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-sm px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-ink text-sm">{title}</div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <label className="text-xs font-medium text-muted mb-1 block">โปรเจกต์ปลายทาง</label>
          <select
            value={targetProjectId}
            onChange={(e) => setTargetProjectId(e.target.value)}
            className="w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400 mb-3"
          >
            {!currentProjectId && <option value="">— เลือกโปรเจกต์ปลายทาง —</option>}
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</option>
            ))}
          </select>
          {error && <div className="text-xs text-danger-600 mb-3">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
            <button onClick={goNext} disabled={busy || !targetProjectId} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
              {NEEDS_PARENT.has(to) ? 'ถัดไป' : busy ? 'กำลังบันทึก…' : 'ยืนยัน'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
