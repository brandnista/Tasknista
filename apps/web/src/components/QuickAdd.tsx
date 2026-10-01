import { parseProjectLogo } from '@seedoffice/core'
import { Star, X } from 'lucide-react'
import { useState } from 'react'
import { useToastAction } from './Toast'
import { api, ApiError } from '../lib/api'
import { taskCreatedMessage } from '../lib/task-url'
import { useLoad } from '../lib/useLoad'

interface ProjectOpt {
  id: string
  name: string
  logo: string | null
  status: string
  statusKind: string
  type: string
}

/** แจ้งหน้าที่สนใจ (เช่น ภาพรวม) ว่ามีงานใหม่ */
export const TASK_CREATED_EVENT = 'so:task-created'

/** Pronista §Quick Add flow (2026-10-01) — กด N: พิมพ์ชื่องาน → เลือกโปรเจกต์ → เลือกประเภทงาน
 *  ไม่เลือกประเภท = "ยังไม่ระบุ" (kind backlog ของโปรเจกต์นั้น) · ไม่เลือกโปรเจกต์ = Backlog กลาง (เลือกประเภทไม่ได้ ต้องมีโปรเจกต์ก่อน) */
const TYPE_OPTIONS = [
  { value: 'backlog', label: 'ยังไม่ระบุ' },
  { value: 'task', label: 'Task' },
  { value: 'defect', label: 'Defect' },
  { value: 'cr', label: 'CR' },
] as const
type QuickType = (typeof TYPE_OPTIONS)[number]['value']

const LAST_PROJECT_KEY = 'pronista_quickadd_project'
const readLastProject = (): string => {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY) ?? ''
  } catch {
    return ''
  }
}
const rememberProject = (id: string) => {
  try {
    if (id) localStorage.setItem(LAST_PROJECT_KEY, id)
    else localStorage.removeItem(LAST_PROJECT_KEY)
  } catch {
    // เบราว์เซอร์ปิดการเก็บข้อมูล — ข้ามได้ แค่ไม่จำโปรเจกต์ล่าสุด
  }
}

export function QuickAddModal({ onClose }: { onClose: () => void }) {
  const { data: projectsList } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const [title, setTitle] = useState('')
  const [projectPick, setProjectPick] = useState(readLastProject)
  const [type, setType] = useState<QuickType>('backlog')
  const [star, setStar] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const toastAction = useToastAction()

  const active = (projectsList ?? []).filter((p) => p.statusKind !== 'archived')
  // โปรเจกต์ที่จำไว้อาจถูกเก็บถาวร/ไม่มีสิทธิ์แล้ว — ถ้าไม่อยู่ในรายการให้ถือว่าไม่ได้เลือก (รอรายการโหลดเสร็จก่อนค่อยตัดสิน)
  const projectId = projectsList && !active.some((p) => p.id === projectPick) ? '' : projectPick

  const submit = async () => {
    if (!title.trim() || submitting) return // กัน Task เบิ้ลจากกด Enter รัวๆ
    setSubmitting(true)
    setError('')
    try {
      const name = title.trim()
      let taskId: string
      let kindForMessage: string = type
      let note = ''
      if (!projectId) {
        // ไม่เลือกโปรเจกต์ → Backlog กลาง (ผูกโปรเจกต์/จัดประเภททีหลังได้)
        taskId = (await api.post<{ id: string }>('/api/tasks/backlog', { title: name })).id
        kindForMessage = 'backlog'
      } else if (type === 'task') {
        taskId = (await api.post<{ id: string }>(`/api/projects/${projectId}/backlog`, { title: name, kind: 'task', standalone: true })).id
      } else if (type === 'defect') {
        taskId = (await api.post<{ id: string }>(`/api/projects/${projectId}/backlog`, { title: name, kind: 'defect' })).id
      } else {
        // backlog = ยังไม่ระบุ · cr = สร้างเป็น "ยังไม่ระบุ" ก่อนแล้วแปลงเป็น CR (แปลงไม่สำเร็จ งานก็ยังอยู่ที่ "ยังไม่ระบุ" ไม่หาย)
        taskId = (await api.post<{ id: string }>(`/api/projects/${projectId}/backlog`, { title: name, kind: 'backlog' })).id
        if (type === 'cr') {
          try {
            await api.post(`/api/tasks/${taskId}/convert`, { to: 'cr' })
          } catch {
            kindForMessage = 'backlog'
            note = ' (แปลงเป็น CR ไม่สำเร็จ งานอยู่ที่ "ยังไม่ระบุ" ของโปรเจกต์)'
          }
        }
      }
      if (star) await api.post(`/api/tasks/${taskId}/star`, { on: true })
      rememberProject(projectId)
      toastAction(taskCreatedMessage(kindForMessage, name) + note, taskId)
      window.dispatchEvent(new CustomEvent(TASK_CREATED_EVENT))
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'เพิ่มงานไม่สำเร็จ ลองใหม่อีกครั้ง')
    } finally {
      setSubmitting(false)
    }
  }

  const input = 'w-full text-sm bg-white shadow-xs rounded-lg px-3 py-2'
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="เพิ่มงานด่วน">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-md px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-ink">เพิ่มงานด่วน</div>
            <button onClick={onClose} aria-label="ปิด" className="text-muted hover:text-soft"><X className="w-5 h-5" /></button>
          </div>
          <input
            autoFocus
            placeholder="ชื่องาน..."
            aria-label="ชื่องาน"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) void submit() }}
            disabled={submitting}
            className={`${input} py-2.5 mb-3 focus:outline-hidden focus:ring-2 focus:ring-brand-200`}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-1">
            <div>
              <label htmlFor="qa-project" className="block text-[11px] font-medium text-muted mb-1">โปรเจกต์</label>
              <select
                id="qa-project"
                value={projectId}
                onChange={(e) => { setProjectPick(e.target.value); if (!e.target.value) setType('backlog') }}
                disabled={submitting}
                className={input}
              >
                <option value="">— ไม่ระบุโปรเจกต์ —</option>
                {active.map((p) => {
                  const logo = parseProjectLogo(p.logo)
                  return (
                    <option key={p.id} value={p.id}>
                      {logo.kind === 'emoji' ? `${logo.value} ` : ''}{p.name}
                    </option>
                  )
                })}
              </select>
            </div>
            <div>
              <label htmlFor="qa-type" className="block text-[11px] font-medium text-muted mb-1">ประเภทงาน</label>
              <select
                id="qa-type"
                value={type}
                onChange={(e) => setType(e.target.value as QuickType)}
                disabled={submitting || !projectId}
                className={`${input} disabled:bg-hover disabled:text-muted`}
              >
                {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted mb-3">
            {projectId
              ? type === 'backlog'
                ? 'ไม่เลือกประเภท → งานไปอยู่ที่ "ยังไม่ระบุ" ของโปรเจกต์ จัดประเภททีหลังได้'
                : `งานจะถูกสร้างเป็น ${TYPE_OPTIONS.find((o) => o.value === type)?.label} ในโปรเจกต์ที่เลือก`
              : 'ไม่เลือกโปรเจกต์ → งานไปอยู่ใน Backlog กลาง รอจัดเข้าโปรเจกต์ทีหลัง (เลือกประเภทงานได้หลังเลือกโปรเจกต์)'}
          </p>
          <label className="flex items-center gap-2 text-sm text-soft mb-3 cursor-pointer select-none">
            <input type="checkbox" checked={star} onChange={(e) => setStar(e.target.checked)} className="rounded" />
            <Star className="w-4 h-4 text-warning-400 fill-warning-400" /> ทำวันนี้ (ติดดาว)
          </label>
          {error && <div className="text-xs text-danger-600 mb-2">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
            <button onClick={() => void submit()} disabled={!title.trim() || submitting} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
              {submitting ? 'กำลังเพิ่ม…' : 'เพิ่มงาน'}
            </button>
          </div>
          <p className="text-[11px] text-muted mt-3">ทิป: กด <kbd className="bg-divider px-1 rounded shadow-xs">N</kbd> เปิดด่วนจากทุกหน้า</p>
        </div>
      </div>
    </div>
  )
}
