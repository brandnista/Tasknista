import { getDocTemplate, type TableSectionDef, type TemplateData } from '@seedoffice/core'
import { Download, ListTree, Plus, Printer, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { buildTemplateDocx, downloadBlob } from '../../lib/doc-export/docx-builder'
import { useLoad } from '../../lib/useLoad'
import { SrsLinkedTasksSection } from '../SrsLinkedTasksSection'
import { DocAttachmentsSection } from './DocAttachmentsSection'
import { DocBreakoutModal } from './DocBreakoutModal'
import { RichTextField } from './RichTextField'
import { TemplatePrintView } from './TemplatePrintView'

interface UserOpt {
  id: string
  name: string
}
export interface TemplateDoc {
  id: string
  title: string
  templateType: string | null
  templateDocNumber: string | null
  templateData: TemplateData | null
}

const input = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
const label = 'text-[11px] text-muted block mb-0.5'
const emptyData: TemplateData = { fields: {}, tables: {}, lists: {} }

/** Tasknista §Document Template — วาดฟอร์มจาก SectionDef[] อัตโนมัติ (fields/table/list) + autosave debounce 800ms (mirror DocEditor)
 * ใช้ key={doc.id} ตอน mount (เหมือน DocEditor) ให้ remount สดตอนสลับเอกสาร — ไม่ต้องมี logic reset state เองข้างใน */
export function TemplateFillForm({ doc, canEdit, onMetaChanged }: { doc: TemplateDoc; canEdit: boolean; onMetaChanged: () => void }) {
  const def = doc.templateType ? getDocTemplate(doc.templateType) : undefined
  const { data: userOpts } = useLoad<UserOpt[]>(() => api.get('/api/users'))
  const [data, setData] = useState<TemplateData>(doc.templateData ?? emptyData)
  const [title, setTitle] = useState(doc.title)
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved')
  const [exporting, setExporting] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstRender = useRef(true)
  const dataRef = useRef(data)
  dataRef.current = data
  const [breakoutSection, setBreakoutSection] = useState<(TableSectionDef & { breakoutToTasks: NonNullable<TableSectionDef['breakoutToTasks']> }) | null>(null)
  const [linksRefreshKey, setLinksRefreshKey] = useState(0)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (!canEdit) return
    setSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void api.patch(`/api/docs/${doc.id}/template-values`, { dataJson: JSON.stringify(data) }).then(() => setSaveState('saved'))
    }, 800)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // flush ก่อนสลับ/ปิดเอกสาร — ใช้ ref กัน closure จับ data เก่าตอน mount (deps ว่างจงใจ ให้ cleanup รันครั้งเดียวตอน unmount จริง)
  useEffect(() => {
    return () => {
      if (canEdit && saveTimer.current) {
        clearTimeout(saveTimer.current)
        void api.patch(`/api/docs/${doc.id}/template-values`, { dataJson: JSON.stringify(dataRef.current) })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveTitle = async () => {
    if (canEdit && title.trim() && title !== doc.title) {
      await api.patch(`/api/docs/${doc.id}`, { title: title.trim() })
      onMetaChanged()
    }
  }

  const setFieldValue = (sectionId: string, key: string, value: string) =>
    setData((d) => ({ ...d, fields: { ...d.fields, [sectionId]: { ...d.fields[sectionId], [key]: value } } }))
  const setTableCell = (sectionId: string, rowIdx: number, key: string, value: string) =>
    setData((d) => {
      const rows = [...(d.tables[sectionId] ?? [])]
      rows[rowIdx] = { ...rows[rowIdx], [key]: value }
      return { ...d, tables: { ...d.tables, [sectionId]: rows } }
    })
  const addTableRow = (sectionId: string, columnKeys: string[]) =>
    setData((d) => ({
      ...d,
      tables: { ...d.tables, [sectionId]: [...(d.tables[sectionId] ?? []), Object.fromEntries(columnKeys.map((k) => [k, '']))] },
    }))
  const removeTableRow = (sectionId: string, rowIdx: number) =>
    setData((d) => ({ ...d, tables: { ...d.tables, [sectionId]: (d.tables[sectionId] ?? []).filter((_, i) => i !== rowIdx) } }))
  const setListItem = (sectionId: string, idx: number, value: string) =>
    setData((d) => {
      const items = [...(d.lists[sectionId] ?? [])]
      items[idx] = value
      return { ...d, lists: { ...d.lists, [sectionId]: items } }
    })
  const addListItem = (sectionId: string) => setData((d) => ({ ...d, lists: { ...d.lists, [sectionId]: [...(d.lists[sectionId] ?? []), ''] } }))
  const removeListItem = (sectionId: string, idx: number) =>
    setData((d) => ({ ...d, lists: { ...d.lists, [sectionId]: (d.lists[sectionId] ?? []).filter((_, i) => i !== idx) } }))

  const exportDocx = async () => {
    setExporting(true)
    try {
      const blob = await buildTemplateDocx(def!, data, title)
      downloadBlob(blob, `${title || 'document'}.docx`)
    } finally {
      setExporting(false)
    }
  }

  if (!def) return <div className="flex-1 grid place-items-center text-sm text-muted p-10">ไม่รู้จักประเภท Template นี้</div>

  return (
    <>
      <TemplatePrintView def={def} data={data} title={title} docNumber={doc.templateDocNumber} docId={doc.id} />
      <div className="flex-1 overflow-y-auto print:hidden">
      <div className="max-w-3xl mx-auto px-5 sm:px-10 py-8">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          readOnly={!canEdit}
          className="w-full text-2xl font-bold text-ink leading-snug focus:outline-hidden"
          aria-label="ชื่อเอกสาร"
        />
        <div className="text-xs text-muted mt-2 mb-6 flex items-center gap-2 flex-wrap">
          <span>{def.labelThai}</span>
          {doc.templateDocNumber && <span className="font-mono bg-info-50 text-info-700 px-1.5 py-0.5 rounded">{doc.templateDocNumber}</span>}
          <button
            onClick={() => void exportDocx()}
            disabled={exporting}
            className="ml-auto flex items-center gap-1.5 text-xs border border-border-subtle rounded-lg px-2.5 py-1.5 text-dim hover:bg-hover disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" /> {exporting ? 'กำลังสร้างไฟล์…' : 'ดาวน์โหลด .docx'}
          </button>
          <button
            onClick={() => window.print()}
            title="เปิดหน้าต่าง Print ของเบราว์เซอร์ — เลือก 'Save as PDF' เพื่อได้ไฟล์ PDF"
            className="flex items-center gap-1.5 text-xs border border-border-subtle rounded-lg px-2.5 py-1.5 text-dim hover:bg-hover"
          >
            <Printer className="w-3.5 h-3.5" /> ดาวน์โหลด PDF
          </button>
          {canEdit && (
            <span>{saveState === 'saving' ? 'กำลังบันทึก…' : <><span className="text-success-500">✓</span> บันทึกแล้ว</>}</span>
          )}
        </div>

        <div className="space-y-6">
          {def.sections.map((section) => (
            <div key={section.id}>
              <h3 className="text-sm font-semibold text-ink mb-2">{section.title}</h3>

              {section.kind === 'fields' && (
                <div className="grid sm:grid-cols-2 gap-3">
                  {section.fields.map((f) => (
                    <div key={f.key} className={f.type === 'textarea' || f.type === 'richtext' ? 'sm:col-span-2' : ''}>
                      <label className={label}>{f.label}</label>
                      {f.type === 'richtext' ? (
                        <RichTextField
                          value={data.fields[section.id]?.[f.key] ?? ''}
                          onChange={(md) => setFieldValue(section.id, f.key, md)}
                          readOnly={!canEdit}
                        />
                      ) : f.type === 'textarea' ? (
                        <textarea
                          value={data.fields[section.id]?.[f.key] ?? ''}
                          onChange={(e) => setFieldValue(section.id, f.key, e.target.value)}
                          readOnly={!canEdit}
                          rows={3}
                          className={`${input} resize-y`}
                        />
                      ) : (
                        <input
                          type={f.type === 'date' ? 'date' : 'text'}
                          value={data.fields[section.id]?.[f.key] ?? ''}
                          onChange={(e) => setFieldValue(section.id, f.key, e.target.value)}
                          readOnly={!canEdit}
                          className={input}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {section.kind === 'table' && (
                <div className="space-y-2">
                  {(data.tables[section.id] ?? []).map((row, ri) => (
                    <div key={ri} className="border border-border-subtle rounded-lg p-3 flex items-start gap-2">
                      <div className="flex-1 grid sm:grid-cols-2 gap-2">
                        {section.columns.map((col) => (
                          <div key={col.key}>
                            <label className={label}>{col.label}</label>
                            {col.type === 'member' ? (
                              <select
                                value={row[col.key] ?? ''}
                                onChange={(e) => setTableCell(section.id, ri, col.key, e.target.value)}
                                disabled={!canEdit}
                                className={input}
                              >
                                <option value="">— เลือก —</option>
                                {(userOpts ?? []).map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
                              </select>
                            ) : col.type === 'textarea' ? (
                              <textarea
                                value={row[col.key] ?? ''}
                                onChange={(e) => setTableCell(section.id, ri, col.key, e.target.value)}
                                readOnly={!canEdit}
                                rows={2}
                                className={`${input} resize-y`}
                              />
                            ) : (
                              <input
                                type={col.type === 'date' ? 'date' : 'text'}
                                value={row[col.key] ?? ''}
                                onChange={(e) => setTableCell(section.id, ri, col.key, e.target.value)}
                                readOnly={!canEdit}
                                className={input}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                      {canEdit && (
                        <button onClick={() => removeTableRow(section.id, ri)} className="text-muted hover:text-danger-600 shrink-0 mt-5">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center gap-3">
                    {canEdit && (
                      <button
                        onClick={() => addTableRow(section.id, section.columns.map((c) => c.key))}
                        className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800"
                      >
                        <Plus className="w-4 h-4" /> เพิ่มแถว
                      </button>
                    )}
                    {/* Tasknista §SOW Task/Subtask — เฉพาะ SOW เท่านั้นที่แตกเป็น Task ได้แล้ว (MOM/BRD/SRS/PEP/UIR ปิดใช้งาน ตรงกับ guard ฝั่ง backend ที่ docs.ts) */}
                    {canEdit && section.breakoutToTasks?.docType === 'SOW' && (
                      <button
                        onClick={() => setBreakoutSection(section as TableSectionDef & { breakoutToTasks: NonNullable<TableSectionDef['breakoutToTasks']> })}
                        className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800 ml-auto"
                      >
                        <ListTree className="w-4 h-4" /> แตกเป็น Task
                      </button>
                    )}
                  </div>
                </div>
              )}

              {section.kind === 'list' && (
                <div className="space-y-2">
                  {(data.lists[section.id] ?? []).map((item, ii) => (
                    <div key={ii} className="flex items-center gap-2">
                      <input value={item} onChange={(e) => setListItem(section.id, ii, e.target.value)} readOnly={!canEdit} className={input} />
                      {canEdit && (
                        <button onClick={() => removeListItem(section.id, ii)} className="text-muted hover:text-danger-600 shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {canEdit && (
                    <button onClick={() => addListItem(section.id)} className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800">
                      <Plus className="w-4 h-4" /> เพิ่มรายการ
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {def.sections.some((s) => s.kind === 'table' && s.breakoutToTasks) && <SrsLinkedTasksSection key={linksRefreshKey} docId={doc.id} />}
        <DocAttachmentsSection docId={doc.id} canEdit={canEdit} />
      </div>
      </div>
      {breakoutSection && (
        <DocBreakoutModal
          docId={doc.id}
          section={breakoutSection}
          rows={data.tables[breakoutSection.id] ?? []}
          onClose={() => setBreakoutSection(null)}
          onCreated={(count) => {
            setBreakoutSection(null)
            setLinksRefreshKey((k) => k + 1)
            alert(`สร้าง ${count} Task สำเร็จ`)
          }}
        />
      )}
    </>
  )
}
