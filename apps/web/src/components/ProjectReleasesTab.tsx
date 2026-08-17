import { ArrowDown, ArrowUp, Link2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api, ApiError } from '../lib/api'
import { fmtThaiDate } from '../lib/project-ui'
import { useLoad } from '../lib/useLoad'
import { useDialog } from './Dialog'
import { type PickableTask, TaskPickerModal } from './TaskPickerModal'

interface LinkedTask {
  id: string
  code: string | null
  title: string
  kind: string
}

interface ReleaseItem {
  id: string
  section: string | null
  text: string
  sortOrder: number
  linkedTasks: LinkedTask[]
}

interface ReleaseRow {
  id: string
  version: string
  sortOrder: number
  createdByName: string | null
  createdAt: string
  items: ReleaseItem[]
}

interface DraftItem {
  key: string
  section: string
  text: string
  linkedTasks: LinkedTask[]
}

interface TaskAllRow {
  id: string
  code: string | null
  title: string
  kind: string
  parentId: string | null
}

const emptyDraft = (): DraftItem => ({ key: crypto.randomUUID(), section: '', text: '', linkedTasks: [] })

const LINKABLE_KINDS = new Set(['task', 'defect', 'cr'])

/** ป้ายกำกับต่อท้ายชื่อ/รหัสในชิป — ตามคอนเวนชันเดิมที่ TaskDetail.tsx ใช้กับรายการที่เชื่อมโยง */
function KindBadge({ kind }: { kind: string }) {
  if (kind === 'defect') return <span className="text-[9px] text-danger-600">🐛</span>
  if (kind === 'cr') return <span className="text-[9px] font-semibold text-info-700">CR</span>
  return null
}

/** Pronista §Version Release (ต่อยอด) — แต่ละบรรทัดเชื่อมโยง Task/Defect/CR ได้ (แทน markdown blob เดิม), ใช้ฟอร์มเดียวกันทั้งสร้างใหม่และแก้ไข
 * section = หัวข้อกลุ่ม กรอกเฉพาะแถวที่ขึ้นกลุ่มใหม่ เว้นว่างถ้าอยู่กลุ่มเดิมกับแถวก่อนหน้า */
function ReleaseForm({
  projectId,
  release,
  onClose,
  onSaved,
}: {
  projectId: string
  release?: ReleaseRow
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!release
  const [version, setVersion] = useState(release?.version ?? '')
  const [items, setItems] = useState<DraftItem[]>(
    release && release.items.length > 0
      ? release.items.map((it) => ({ key: crypto.randomUUID(), section: it.section ?? '', text: it.text, linkedTasks: it.linkedTasks }))
      : [emptyDraft()],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [linkingKey, setLinkingKey] = useState<string | null>(null)
  const { data: taskCandidates } = useLoad<TaskAllRow[]>(
    () => (linkingKey ? api.get(`/api/projects/${projectId}/tasks/all`) : Promise.resolve([])),
    [linkingKey],
  )
  const pickable: PickableTask[] = (taskCandidates ?? [])
    .filter((t) => LINKABLE_KINDS.has(t.kind))
    .map((t) => ({ id: t.id, code: t.code, title: t.title, parentId: t.parentId }))

  const updateItem = (key: string, patch: Partial<DraftItem>) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  const removeItem = (key: string) => setItems((prev) => (prev.length === 1 ? prev : prev.filter((it) => it.key !== key)))
  const moveItem = (index: number, dir: -1 | 1) =>
    setItems((prev) => {
      const next = [...prev]
      const swapWith = index + dir
      if (swapWith < 0 || swapWith >= next.length) return prev
      ;[next[index], next[swapWith]] = [next[swapWith]!, next[index]!]
      return next
    })
  const pickTask = (pt: PickableTask) => {
    const full = (taskCandidates ?? []).find((t) => t.id === pt.id)
    if (!full || !linkingKey) return
    updateItem(linkingKey, {
      linkedTasks: [
        ...(items.find((it) => it.key === linkingKey)?.linkedTasks ?? []).filter((lt) => lt.id !== full.id),
        { id: full.id, code: full.code, title: full.title, kind: full.kind },
      ],
    })
    setLinkingKey(null)
  }
  const unlinkTask = (key: string, taskId: string) => {
    const it = items.find((i) => i.key === key)
    if (!it) return
    updateItem(key, { linkedTasks: it.linkedTasks.filter((lt) => lt.id !== taskId) })
  }

  const save = async () => {
    if (!version.trim()) {
      setError('กรอกเวอร์ชันก่อน')
      return
    }
    const cleanItems = items.filter((it) => it.text.trim())
    const payload = {
      version: version.trim(),
      items: cleanItems.map((it) => ({
        section: it.section.trim() || undefined,
        text: it.text.trim(),
        linkedTaskIds: it.linkedTasks.map((lt) => lt.id),
      })),
    }
    setSaving(true)
    setError('')
    try {
      if (isEdit) await api.patch(`/api/releases/${release.id}`, payload)
      else await api.post(`/api/projects/${projectId}/releases`, payload)
      onSaved()
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
      <div className="absolute inset-x-0 top-6 mx-auto w-full max-w-xl px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[88vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="font-semibold text-ink text-sm">{isEdit ? 'แก้ไขเวอร์ชัน' : 'เพิ่มเวอร์ชัน'} (Version Release)</div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <div className="space-y-3">
            <div>
              <label className={label}>เวอร์ชัน</label>
              <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="เช่น v2.1.0 (230)" className={input} autoFocus />
            </div>
            <div>
              <label className={label}>รายละเอียด</label>
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={it.key} className="border border-border-subtle rounded-lg p-2.5 space-y-1.5">
                    <input
                      value={it.section}
                      onChange={(e) => updateItem(it.key, { section: e.target.value })}
                      placeholder="หัวข้อกลุ่ม (กรอกเฉพาะแถวที่ขึ้นกลุ่มใหม่ — เว้นว่างถ้าอยู่กลุ่มเดิม)"
                      className="w-full text-xs font-semibold text-ink placeholder:font-normal placeholder:text-muted focus:outline-hidden"
                    />
                    <div className="flex items-start gap-2">
                      <textarea
                        value={it.text}
                        onChange={(e) => updateItem(it.key, { text: e.target.value })}
                        placeholder="รายละเอียดของข้อนี้..."
                        rows={2}
                        className="flex-1 text-sm bg-hover rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:bg-white focus:border focus:border-brand-400 resize-none"
                      />
                      <div className="flex flex-col gap-1 shrink-0">
                        <button onClick={() => moveItem(i, -1)} disabled={i === 0} title="เลื่อนขึ้น" className="text-muted hover:text-ink disabled:opacity-25 disabled:hover:text-muted">
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => moveItem(i, 1)} disabled={i === items.length - 1} title="เลื่อนลง" className="text-muted hover:text-ink disabled:opacity-25 disabled:hover:text-muted">
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setLinkingKey(it.key)} title="เชื่อมโยง Task/Defect/CR" className="text-muted hover:text-brand-600">
                          <Link2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => removeItem(it.key)} title="ลบข้อนี้" className="text-muted hover:text-danger-600">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {it.linkedTasks.length > 0 && (
                      <div className="flex flex-wrap gap-1 pl-1">
                        {it.linkedTasks.map((lt) => (
                          <span key={lt.id} className="flex items-center gap-1 text-[11px] bg-hover rounded-lg px-1.5 py-0.5">
                            <KindBadge kind={lt.kind} />
                            {lt.code ?? lt.title}
                            <button onClick={() => unlinkTask(it.key, lt.id)} title="เลิกเชื่อมโยง" className="text-muted hover:text-danger-600">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={() => setItems((prev) => [...prev, emptyDraft()])}
                className="mt-2 flex items-center gap-1.5 text-xs text-brand-700 hover:text-brand-800"
              >
                <Plus className="w-3.5 h-3.5" /> เพิ่มบรรทัด
              </button>
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
      {linkingKey && (
        <TaskPickerModal
          title="เชื่อมโยง Task/Defect/CR"
          tasks={pickable}
          excludeIds={(items.find((it) => it.key === linkingKey)?.linkedTasks ?? []).map((lt) => lt.id)}
          onPick={pickTask}
          onClose={() => setLinkingKey(null)}
        />
      )}
    </div>
  )
}

/** จัดกลุ่ม items ตาม section ต่อเนื่องกัน — item ที่ section ว่างถือว่าอยู่กลุ่มเดียวกับ item ก่อนหน้า */
function groupItems(items: ReleaseItem[]) {
  const groups: { section: string | null; items: ReleaseItem[] }[] = []
  for (const it of items) {
    if (it.section || groups.length === 0) groups.push({ section: it.section, items: [it] })
    else groups[groups.length - 1]!.items.push(it)
  }
  return groups
}

function ReleaseNotesView({ items }: { items: ReleaseItem[] }) {
  const navigate = useNavigate()
  if (items.length === 0) return <span className="text-muted text-xs">—</span>
  return (
    <div className="space-y-3">
      {groupItems(items).map((g, gi) => (
        <div key={gi}>
          {g.section && <div className="font-semibold text-ink text-sm mb-1">{g.section}</div>}
          <ul className="space-y-1">
            {g.items.map((it) => (
              <li key={it.id} className="text-sm text-body flex items-start gap-1.5">
                <span className="text-muted shrink-0">•</span>
                <span>
                  {it.text}
                  {it.linkedTasks.length > 0 && (
                    <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
                      {it.linkedTasks.map((lt) => (
                        <button
                          key={lt.id}
                          onClick={() => navigate(`/tasks/${lt.id}`)}
                          title={lt.title}
                          className="inline-flex items-center gap-1 text-[11px] bg-hover hover:bg-divider rounded-lg px-1.5 py-0.5 align-middle"
                        >
                          <KindBadge kind={lt.kind} />
                          {lt.code ?? lt.title}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export function ProjectReleasesTab({
  projectId,
  canCreate,
  canEdit,
  canDelete,
}: {
  projectId: string
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}) {
  const { data, reload } = useLoad<{ releases: ReleaseRow[] }>(() => api.get(`/api/projects/${projectId}/releases`))
  const { confirmDialog } = useDialog()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ReleaseRow | null>(null)
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
              {(canEdit || canDelete) && <th className="w-16" />}
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
                  <ReleaseNotesView items={r.items} />
                </td>
                {(canEdit || canDelete) && (
                  <td className="px-2 py-3">
                    <div className="flex items-center gap-1">
                      {canEdit && (
                        <button onClick={() => setEditing(r)} title="แก้ไขเวอร์ชัน" className="text-muted hover:text-brand-600">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => void remove(r.id, r.version)} title="ลบเวอร์ชัน" className="text-muted hover:text-danger-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {formOpen && <ReleaseForm projectId={projectId} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); void reload() }} />}
      {editing && (
        <ReleaseForm projectId={projectId} release={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload() }} />
      )}
    </div>
  )
}
