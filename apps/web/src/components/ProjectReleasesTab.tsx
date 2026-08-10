import { Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { fmtThaiDate } from '../lib/project-ui'
import { useLoad } from '../lib/useLoad'
import { useDialog } from './Dialog'
import { RichTextField } from './doc-templates/RichTextField'

interface ReleaseRow {
  id: string
  version: string
  notes: string
  sortOrder: number
  createdByName: string | null
  createdAt: string
}

/** Pronista §Version Release — แท็บ "Version Release" ต่อโปรเจกต์ (อยู่ต่อจาก "ประวัติเอกสาร") คอลัมน์ ลำดับ/เวอร์ชั่น/รายละเอียด */
function AddReleaseForm({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated: () => void }) {
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!version.trim()) {
      setError('กรอกเวอร์ชันก่อน')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api.post(`/api/projects/${projectId}/releases`, { version: version.trim(), notes })
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
            <div className="font-semibold text-ink text-sm">เพิ่มเวอร์ชัน (Version Release)</div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <div className="space-y-3">
            <div>
              <label className={label}>เวอร์ชัน</label>
              <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="เช่น v2.1.0 (230)" className={input} autoFocus />
            </div>
            <div>
              <label className={label}>รายละเอียด</label>
              <RichTextField value={notes} onChange={setNotes} readOnly={false} />
            </div>
            {error && <div className="text-xs text-danger-600">{error}</div>}
            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => void save()} disabled={saving} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
              <button onClick={onClose} className="text-sm text-dim hover:text-soft px-3 py-2">ยกเลิก</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ProjectReleasesTab({
  projectId,
  canCreate,
  canDelete,
}: {
  projectId: string
  canCreate: boolean
  canDelete: boolean
}) {
  const { data, reload } = useLoad<{ releases: ReleaseRow[] }>(() => api.get(`/api/projects/${projectId}/releases`))
  const { confirmDialog } = useDialog()
  const [formOpen, setFormOpen] = useState(false)
  const releases = data?.releases ?? []
  const total = releases.length

  const remove = async (id: string, version: string) => {
    const yes = await confirmDialog({ title: `ลบเวอร์ชัน "${version}"?`, message: 'กู้คืนเองไม่ได้ผ่านหน้านี้', confirmLabel: 'ลบ', danger: true })
    if (!yes) return
    await api.delete(`/api/releases/${id}`)
    await reload()
  }

  return (
    <div className="bg-white rounded-lg shadow-xs overflow-hidden">
      <div className="p-4 border-b border-border-subtle flex items-center justify-between">
        <div className="font-semibold text-ink text-sm">Version Release · {total} เวอร์ชัน</div>
        {canCreate && (
          <button onClick={() => setFormOpen(true)} className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800">
            <Plus className="w-4 h-4" /> เพิ่มเวอร์ชัน
          </button>
        )}
      </div>

      {releases.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted">ยังไม่มีเวอร์ชันที่บันทึกไว้{canCreate ? ' — กด "เพิ่มเวอร์ชัน"' : ''}</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-xs text-muted">
              <th className="text-left font-medium px-4 py-2 w-14">ลำดับ</th>
              <th className="text-left font-medium px-4 py-2 w-40">เวอร์ชั่น</th>
              <th className="text-left font-medium px-4 py-2">รายละเอียด</th>
              {canDelete && <th className="w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {releases.map((r, i) => (
              <tr key={r.id} className="align-top">
                <td className="px-4 py-3 text-muted tabular-nums">{total - i}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-ink">{r.version}</div>
                  <div className="text-[11px] text-muted mt-0.5">
                    {fmtThaiDate(r.createdAt.slice(0, 10))}{r.createdByName ? ` · ${r.createdByName}` : ''}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {r.notes.trim() ? <RichTextField value={r.notes} onChange={() => {}} readOnly /> : <span className="text-muted text-xs">—</span>}
                </td>
                {canDelete && (
                  <td className="px-2 py-3">
                    <button onClick={() => void remove(r.id, r.version)} title="ลบเวอร์ชัน" className="text-muted hover:text-danger-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {formOpen && <AddReleaseForm projectId={projectId} onClose={() => setFormOpen(false)} onCreated={() => { setFormOpen(false); void reload() }} />}
    </div>
  )
}
