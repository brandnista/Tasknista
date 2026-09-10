/**
 * Pronista §Change Log (Internal) — แท็บ "Change Log" ต่อโปรเจกต์ (มุมมองทีมพัฒนา แยกจาก "Version Release" ที่เป็นมุมมองภายนอก)
 * โครงสร้างมิเรอร์ ProjectReleasesTab.tsx เป๊ะ (ฟอร์ม/การเชื่อมโยง Task-Defect-CR/แสดงผล) ต่างแค่ 5 หมวดคงที่แทน section แบบ freeform
 * (แทนที่ฟีดกิจกรรมอัตโนมัติจาก audit_logs เดิม — ตอนนี้เป็นระบบบันทึกที่ทีมพัฒนากรอกเองแล้ว)
 */
import { CHANGELOG_CATEGORIES, type ChangelogCategory, CHANGELOG_CATEGORY_LABEL, parseChangelogMarkdown, type ParsedChangelog } from '@seedoffice/core'
import { ArrowDown, ArrowUp, Bug, Link2, ListPlus, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { api, ApiError } from '../lib/api'
import { fmtThaiDate } from '../lib/project-ui'
import { useLoad } from '../lib/useLoad'
import { useDialog } from './Dialog'
import { DateInputTH } from './DateInputTH'
import { type PickableTask, TaskPickerModal } from './TaskPickerModal'
import { useToast } from './Toast'

interface LinkedTask {
  id: string
  code: string | null
  title: string
  kind: string
}

interface ChangelogItem {
  id: string
  category: ChangelogCategory
  text: string
  sortOrder: number
  linkedTasks: LinkedTask[]
}

interface ChangelogRow {
  id: string
  changelogNo: number
  title: string
  entryDate: string
  createdByName: string | null
  createdAt: string
  items: ChangelogItem[]
}

interface DraftItem {
  key: string
  category: ChangelogCategory
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

const bkkToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)
const emptyDraft = (category: ChangelogCategory): DraftItem => ({ key: crypto.randomUUID(), category, text: '', linkedTasks: [] })
const LINKABLE_KINDS = new Set(['task', 'defect', 'cr'])

/** ป้ายกำกับต่อท้ายชื่อ/รหัสในชิป — ตามคอนเวนชันเดิมที่ TaskDetail.tsx/ProjectReleasesTab.tsx ใช้กับรายการที่เชื่อมโยง */
function KindBadge({ kind }: { kind: string }) {
  if (kind === 'defect') return <span className="text-[9px] text-danger-600">🐛</span>
  if (kind === 'cr') return <span className="text-[9px] font-semibold text-info-700">CR</span>
  return null
}

function ChangelogForm({
  projectId,
  changelog,
  importedDraft,
  canCreateTask,
  onClose,
  onSaved,
}: {
  projectId: string
  changelog?: ChangelogRow
  // Pronista §Import Changelog จากไฟล์ .md — เติมฟอร์มจากผลลัพธ์ parseChangelogMarkdown แทนคีย์มือทีละบรรทัด (ใช้ได้เฉพาะตอนสร้างใหม่ ไม่ใช่ตอนแก้ไข)
  importedDraft?: ParsedChangelog
  canCreateTask: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const { alertDialog } = useDialog()
  const isEdit = !!changelog
  const [title, setTitle] = useState(changelog?.title ?? importedDraft?.title ?? '')
  const [entryDate, setEntryDate] = useState(changelog?.entryDate ?? importedDraft?.entryDate ?? bkkToday())
  const [items, setItems] = useState<DraftItem[]>(() => {
    if (changelog && changelog.items.length > 0)
      return changelog.items.map((it) => ({ key: crypto.randomUUID(), category: it.category, text: it.text, linkedTasks: it.linkedTasks }))
    if (importedDraft)
      // หมวดที่เดาไม่ได้ (category: null) → เริ่มที่หมวดแรกไปก่อน ให้ผู้ใช้ย้ายเองผ่าน select ของแต่ละบรรทัด (ดู warnings banner ด้านล่าง)
      return importedDraft.items.map((pi) => ({ key: crypto.randomUUID(), category: pi.category ?? CHANGELOG_CATEGORIES[0], text: pi.text, linkedTasks: [] }))
    return []
  })
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
  const removeItem = (key: string) => setItems((prev) => prev.filter((it) => it.key !== key))
  const addItem = (category: ChangelogCategory) => setItems((prev) => [...prev, emptyDraft(category)])
  /** เลื่อนขึ้น/ลงเฉพาะภายในหมวดเดียวกัน (หมวดคงที่ 5 ตัว เรียงลำดับตาม CHANGELOG_CATEGORIES เสมอ ไม่สลับข้ามหมวด) */
  const moveItem = (key: string, dir: -1 | 1) =>
    setItems((prev) => {
      const it = prev.find((i) => i.key === key)
      if (!it) return prev
      const catPositions = prev.map((x, idx) => (x.category === it.category ? idx : -1)).filter((idx) => idx !== -1)
      const pos = catPositions.indexOf(prev.indexOf(it))
      const swapPos = pos + dir
      if (swapPos < 0 || swapPos >= catPositions.length) return prev
      const i1 = catPositions[pos]!
      const i2 = catPositions[swapPos]!
      const next = [...prev]
      ;[next[i1], next[i2]] = [next[i2]!, next[i1]!]
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

  // Pronista §Import Changelog จากไฟล์ .md — สร้าง Task/Defect ตรงจากข้อความของบรรทัดนี้เลย ไม่ต้องพิมพ์ซ้ำในอีกหน้า แล้วผูกกลับเข้า linkedTasks ทันที
  const [creatingKey, setCreatingKey] = useState<string | null>(null)
  const createTaskFromItem = async (it: DraftItem, asDefect: boolean) => {
    if (creatingKey || !it.text.trim()) return
    setCreatingKey(it.key)
    try {
      const firstLine = it.text.split('\n')[0] ?? ''
      const isShort = it.text.length <= 120 && !it.text.includes('\n')
      const created = await api.post<LinkedTask>(`/api/projects/${projectId}/tasks`, {
        title: isShort ? it.text : firstLine.slice(0, 120),
        description: isShort ? undefined : it.text,
      })
      if (!asDefect) {
        updateItem(it.key, { linkedTasks: [...it.linkedTasks, created] })
        return
      }
      try {
        const converted = await api.post<LinkedTask>(`/api/tasks/${created.id}/convert`, { to: 'defect' })
        updateItem(it.key, { linkedTasks: [...it.linkedTasks, converted] })
      } catch {
        // สร้าง task สำเร็จแล้ว แต่ convert เป็น defect ไม่ผ่าน (เช่น สิทธิ์ task.create ผ่านแต่ไม่ใช่ owner/editor ของโปรเจกต์) — ยังผูก task ธรรมดาไว้ก่อน ไม่ทิ้งงานที่สร้างไปแล้ว
        updateItem(it.key, { linkedTasks: [...it.linkedTasks, created] })
        await alertDialog({ title: 'สร้าง Task แล้ว แต่แปลงเป็น Defect ไม่สำเร็จ (สิทธิ์ไม่พอ) — ไปแปลงเองที่หน้า Task ได้' })
      }
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'สร้างงานไม่สำเร็จ' })
    } finally {
      setCreatingKey(null)
    }
  }

  const save = async () => {
    if (!title.trim()) {
      setError('กรอกหัวข้อหลักก่อน')
      return
    }
    if (!entryDate) {
      setError('กรอกวันที่บันทึกก่อน')
      return
    }
    const cleanItems = items.filter((it) => it.text.trim())
    const payload = {
      title: title.trim(),
      entryDate,
      items: cleanItems.map((it) => ({
        category: it.category,
        text: it.text.trim(),
        linkedTaskIds: it.linkedTasks.map((lt) => lt.id),
      })),
    }
    setSaving(true)
    setError('')
    try {
      if (isEdit) await api.patch(`/api/changelogs/${changelog.id}`, payload)
      else await api.post(`/api/projects/${projectId}/changelogs`, payload)
      toast('บันทึกสำเร็จ')
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
      <div className="absolute inset-x-0 top-6 mx-auto w-full max-w-2xl px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[88vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="font-semibold text-ink text-sm">{isEdit ? 'แก้ไข Changelog' : 'เพิ่ม Changelog'}</div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <div className="space-y-3">
            {importedDraft && importedDraft.warnings.length > 0 && (
              <div className="text-xs text-warning-800 bg-warning-100 rounded-lg p-2.5 space-y-1">
                <div className="font-medium">นำเข้าจากไฟล์แล้ว แต่มีบางหมวดที่เดาไม่ได้ — ตรวจ/เลือกหมวดให้ถูกก่อนบันทึก:</div>
                <ul className="list-disc pl-4">
                  {importedDraft.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={label}>วันที่บันทึก</label>
                <DateInputTH value={entryDate} onChange={setEntryDate} className={input} />
              </div>
              <div>
                <label className={label}>หัวข้อหลัก</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ระบบแต้มสะสมและส่วนลดจากการใช้แต้มสะสม" className={input} autoFocus />
              </div>
            </div>

            <div className="space-y-3">
              {CHANGELOG_CATEGORIES.map((cat) => {
                const catItems = items.filter((it) => it.category === cat)
                return (
                  <div key={cat} className="border border-border-subtle rounded-lg p-2.5">
                    <div className="text-xs font-semibold text-ink mb-1.5">{CHANGELOG_CATEGORY_LABEL[cat]}</div>
                    <div className="space-y-1.5">
                      {catItems.map((it, i) => (
                        <div key={it.key} className="bg-hover rounded-lg p-2 space-y-1.5">
                          <div className="flex items-start gap-2">
                            {/* min-w-0 กันจอเล็ก — select มีข้อความยาว (เช่น "หน้าบ้าน (Frontend: Desktop + Mobile)") ถ้าไม่กัน flex item จะไม่ยอมหดต่ำกว่าความกว้างเนื้อหา ดันปุ่มไอคอนข้างๆ หลุดจอ */}
                            <div className="flex-1 min-w-0 space-y-1">
                              {/* Pronista §Import Changelog จากไฟล์ .md — ย้ายหมวดของบรรทัดนี้ได้เอง (ช่องว่างเดิมที่ไม่เคยแก้หมวดได้เลย ใช้ได้ทั้งตอนนำเข้าและคีย์มือ) */}
                              <select
                                value={it.category}
                                onChange={(e) => updateItem(it.key, { category: e.target.value as ChangelogCategory })}
                                className="w-full max-w-full text-[11px] bg-white rounded px-1.5 py-0.5 focus:outline-hidden"
                              >
                                {CHANGELOG_CATEGORIES.map((c) => <option key={c} value={c}>{CHANGELOG_CATEGORY_LABEL[c]}</option>)}
                              </select>
                              <textarea
                                value={it.text}
                                onChange={(e) => updateItem(it.key, { text: e.target.value })}
                                placeholder="รายละเอียดของข้อนี้..."
                                rows={2}
                                className="w-full text-sm bg-white rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:border focus:border-brand-400 resize-none"
                              />
                            </div>
                            <div className="flex flex-col gap-1 shrink-0">
                              <button onClick={() => moveItem(it.key, -1)} disabled={i === 0} title="เลื่อนขึ้น" className="text-muted hover:text-ink disabled:opacity-25 disabled:hover:text-muted">
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => moveItem(it.key, 1)} disabled={i === catItems.length - 1} title="เลื่อนลง" className="text-muted hover:text-ink disabled:opacity-25 disabled:hover:text-muted">
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => setLinkingKey(it.key)} title="เชื่อมโยง Task/Defect/CR" className="text-muted hover:text-brand-600">
                                <Link2 className="w-3.5 h-3.5" />
                              </button>
                              {canCreateTask && (
                                <>
                                  <button
                                    onClick={() => void createTaskFromItem(it, false)}
                                    disabled={!!creatingKey || !it.text.trim()}
                                    title="สร้าง Task จากข้อความนี้"
                                    className="text-muted hover:text-brand-600 disabled:opacity-25 disabled:hover:text-muted"
                                  >
                                    <ListPlus className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => void createTaskFromItem(it, true)}
                                    disabled={!!creatingKey || !it.text.trim()}
                                    title="สร้าง Defect จากข้อความนี้"
                                    className="text-muted hover:text-danger-600 disabled:opacity-25 disabled:hover:text-muted"
                                  >
                                    <Bug className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              <button onClick={() => removeItem(it.key)} title="ลบข้อนี้" className="text-muted hover:text-danger-600">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          {it.linkedTasks.length > 0 && (
                            <div className="flex flex-wrap gap-1 pl-1">
                              {it.linkedTasks.map((lt) => (
                                <span key={lt.id} className="flex items-center gap-1 text-[11px] bg-white rounded-lg px-1.5 py-0.5">
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
                      onClick={() => addItem(cat)}
                      className="mt-1.5 flex items-center gap-1.5 text-xs text-brand-700 hover:text-brand-800"
                    >
                      <Plus className="w-3.5 h-3.5" /> เพิ่มบรรทัด
                    </button>
                  </div>
                )
              })}
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

function ChangelogItemsView({ items }: { items: ChangelogItem[] }) {
  const navigate = useNavigate()
  return (
    <div className="space-y-2.5">
      {CHANGELOG_CATEGORIES.map((cat) => {
        const catItems = items.filter((it) => it.category === cat).sort((a, b) => a.sortOrder - b.sortOrder)
        return (
          <div key={cat}>
            <div className="font-semibold text-ink text-xs mb-1">{CHANGELOG_CATEGORY_LABEL[cat]}</div>
            {catItems.length === 0 ? (
              <div className="text-sm text-muted pl-2.5">-</div>
            ) : (
              <ul className="space-y-1">
                {catItems.map((it) => {
                  const lines = it.text.split('\n').map((l) => l.trim()).filter(Boolean)
                  return lines.map((line, li) => (
                    <li key={`${it.id}-${li}`} className="text-sm text-body flex items-start gap-1.5">
                      <span className="text-muted shrink-0">•</span>
                      <span>
                        {line}
                        {li === lines.length - 1 && it.linkedTasks.length > 0 && (
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
                  ))
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function ProjectChangeLogTab({
  projectId,
  canCreate,
  canEdit,
  canDelete,
  canCreateTask,
}: {
  projectId: string
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  // Pronista §Import Changelog จากไฟล์ .md — สิทธิ์สร้าง Task/Defect จากบรรทัด changelog แยกจาก canCreate (changeLog.create) เอง
  canCreateTask: boolean
}) {
  const { data, reload } = useLoad<{ changelogs: ChangelogRow[] }>(() => api.get(`/api/projects/${projectId}/changelogs`))
  const { confirmDialog, alertDialog } = useDialog()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ChangelogRow | null>(null)
  const [importedDraft, setImportedDraft] = useState<ParsedChangelog | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const changelogs = data?.changelogs ?? []
  const total = changelogs.length

  // Pronista §Import Changelog จากไฟล์ .md — parse ฝั่ง browser ล้วนๆ ไม่ยิง API (ไฟล์ไม่ต้องอัปโหลดขึ้น server)
  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // เผื่อเลือกไฟล์เดิมซ้ำ ให้ onChange ยิงอีกรอบได้
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.md') && !file.name.toLowerCase().endsWith('.markdown')) {
      await alertDialog({ title: 'รองรับเฉพาะไฟล์ .md เท่านั้น' })
      return
    }
    const text = await file.text()
    setImportedDraft(parseChangelogMarkdown(text, bkkToday()))
    setFormOpen(true)
  }

  const remove = async (id: string, title: string) => {
    const yes = await confirmDialog({ title: `ลบ Changelog "${title}"?`, message: 'กู้คืนเองไม่ได้ผ่านหน้านี้', confirmLabel: 'ลบ', danger: true })
    if (!yes) return
    await api.delete(`/api/changelogs/${id}`)
    await reload()
  }

  return (
    <div className="bg-white rounded-lg shadow-xs overflow-hidden">
      <div className="p-4 border-b border-border-subtle flex items-center justify-between">
        <div className="font-semibold text-ink text-sm">Change Log · {total} รายการ</div>
        {canCreate && (
          <div className="flex items-center gap-3">
            <input ref={fileInputRef} type="file" accept=".md,.markdown" className="hidden" onChange={(e) => void onFileSelected(e)} />
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 text-sm text-muted hover:text-ink">
              <Upload className="w-3.5 h-3.5" /> นำเข้าจาก .md
            </button>
            <button onClick={() => { setImportedDraft(null); setFormOpen(true) }} className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800">
              <Plus className="w-4 h-4" /> เพิ่ม Changelog
            </button>
          </div>
        )}
      </div>

      {changelogs.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted">ยังไม่มี Changelog ที่บันทึกไว้{canCreate ? ' — กด "เพิ่ม Changelog"' : ''}</div>
      ) : (
        // Pronista §Mobile horizontal-scroll fix (2026-09-02) — เดิมไม่มี overflow-x-auto เลย
        <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-xs text-muted">
              <th className="text-left font-medium px-4 py-2 w-14">เลขที่</th>
              <th className="text-left font-medium px-4 py-2 w-48">วันที่ / หัวข้อ</th>
              <th className="text-left font-medium px-4 py-2">รายละเอียด</th>
              {(canEdit || canDelete) && <th className="w-16" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {changelogs.map((cl) => (
              <tr key={cl.id} className="align-top">
                <td className="px-4 py-3 text-muted tabular-nums">#{cl.changelogNo}</td>
                <td className="px-4 py-3">
                  <div className="text-[11px] text-muted whitespace-nowrap">{fmtThaiDate(cl.entryDate)}</div>
                  <div className="font-semibold text-ink whitespace-nowrap">{cl.title}</div>
                  <div className="text-[11px] text-muted mt-0.5 whitespace-nowrap">{cl.createdByName ?? ''}</div>
                </td>
                <td className="px-4 py-3">
                  <ChangelogItemsView items={cl.items} />
                </td>
                {(canEdit || canDelete) && (
                  <td className="px-2 py-3">
                    <div className="flex items-center gap-1">
                      {canEdit && (
                        <button onClick={() => setEditing(cl)} title="แก้ไข Changelog" className="text-muted hover:text-brand-600">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => void remove(cl.id, cl.title)} title="ลบ Changelog" className="text-muted hover:text-danger-600">
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
        </div>
      )}

      {formOpen && (
        <ChangelogForm
          projectId={projectId}
          importedDraft={importedDraft ?? undefined}
          canCreateTask={canCreateTask}
          onClose={() => { setFormOpen(false); setImportedDraft(null) }}
          onSaved={() => { setFormOpen(false); setImportedDraft(null); void reload() }}
        />
      )}
      {editing && (
        <ChangelogForm projectId={projectId} changelog={editing} canCreateTask={canCreateTask} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload() }} />
      )}
    </div>
  )
}
