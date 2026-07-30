import { DOC_TEMPLATES } from '@seedoffice/core'
import { useState } from 'react'
import { api } from '../../lib/api'
import { useLoad } from '../../lib/useLoad'

interface ProjectOpt {
  id: string
  name: string
}

const input = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
const label = 'text-xs font-medium text-muted mb-1 block'

/** Tasknista §Document Template — เลือก template (ตอนนี้มีแค่ MOM) + โปรเจกต์ที่ผูก + ตั้งชื่อ แล้วสร้างเอกสารว่างพร้อมกรอก
 * เพิ่ม template ใหม่ (เช่น SRS) ใน registry แล้ว จะโผล่ในลิสต์นี้เองโดยไม่ต้องแก้โค้ดตรงนี้ */
export function TemplatePickerModal({ parentId, onClose, onCreated }: { parentId: string | null; onClose: () => void; onCreated: (docId: string) => void }) {
  const templates = Object.values(DOC_TEMPLATES)
  const [templateType, setTemplateType] = useState(templates[0]?.templateType ?? '')
  const { data: projectOpts } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const [projectId, setProjectId] = useState('')
  const [projectQuery, setProjectQuery] = useState('')
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)
  const selectedProject = (projectOpts ?? []).find((p) => p.id === projectId)
  const filteredProjects = (projectOpts ?? []).filter((p) => p.name.toLowerCase().includes(projectQuery.toLowerCase()))
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    if (!title.trim()) return setError('ต้องระบุชื่อเอกสาร')
    if (!projectId) return setError('ต้องเลือกโปรเจกต์')
    setBusy(true)
    setError('')
    try {
      const created = await api.post<{ id: string }>('/api/docs/template', { templateType, title: title.trim(), projectId, parentId })
      onCreated(created.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'สร้างไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-sm px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-ink text-sm">สร้างเอกสารจาก Template</div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0">✕</button>
          </div>
          <div className="space-y-3">
            <div>
              <label className={label}>เลือก Template</label>
              <select value={templateType} onChange={(e) => setTemplateType(e.target.value)} className={input}>
                {templates.map((t) => <option key={t.templateType} value={t.templateType}>{t.labelThai}</option>)}
              </select>
            </div>
            <div className="relative">
              <label className={label}>โปรเจกต์</label>
              <input
                value={projectDropdownOpen ? projectQuery : (selectedProject?.name ?? '')}
                onChange={(e) => { setProjectQuery(e.target.value); setProjectId('') }}
                onFocus={() => { setProjectQuery(''); setProjectDropdownOpen(true) }}
                onBlur={() => setTimeout(() => setProjectDropdownOpen(false), 150)}
                placeholder="พิมพ์ค้นหาโปรเจกต์…"
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
            <div>
              <label className={label}>ชื่อเอกสาร</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ประชุม Kick-off ครั้งที่ 1" className={input} />
            </div>
            {error && <div className="text-xs text-danger-600">{error}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
              <button onClick={() => void create()} disabled={busy} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
                {busy ? 'กำลังสร้าง…' : 'สร้าง'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
