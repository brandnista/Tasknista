import type { DocTemplateDef, TemplateData } from '@seedoffice/core'
import { api } from '../../lib/api'
import { useLoad } from '../../lib/useLoad'

interface DocAttachment {
  id: string
  kind: 'link' | 'file'
  label: string
  url: string | null
  filename: string | null
}

/** markdown→ข้อความอ่านง่ายอย่างง่าย สำหรับพิมพ์ PDF (ตัดสัญลักษณ์ markdown ทั่วไปออก ไม่ได้ full-render) */
function markdownToPlainish(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^[-*]\s+/gm, '• ')
    .trim()
}

/**
 * Tasknista §Document Template — เลย์เอาต์สำหรับ print-to-PDF (`window.print()` + `@media print` ใน index.css)
 * ซ่อนตลอดเวลาปกติ (`hidden print:block`) โผล่เฉพาะตอนสั่งพิมพ์ — ใช้ SectionDef เดียวกับหน้ากรอกฟอร์ม ไม่มีโค้ดเฉพาะ MOM
 * Tasknista §Document Attachments — เพิ่มรายการแนบท้าย (ชื่อลิงก์/ไฟล์) ท้ายเอกสารตอนพิมพ์ + field type 'richtext' render เป็นข้อความอ่านง่าย (ตัด markdown)
 */
export function TemplatePrintView({ def, data, title, docNumber, docId }: { def: DocTemplateDef; data: TemplateData; title: string; docNumber: string | null; docId: string }) {
  const { data: attachments } = useLoad<DocAttachment[]>(() => api.get(`/api/docs/${docId}/attachments`), [docId])
  const cellBase = 'border border-black/30 px-2 py-1 align-top'
  return (
    <div className="template-print-view hidden print:block p-8 text-black text-sm">
      {/* เส้น header สีแบรนด์ + logo — ล้อไฟล์ต้นแบบ BNT_Template_01_MOM_v3.docx (ใช้สีเดียวกับ docx-builder.ts brand.ts) */}
      <div className="flex items-center pb-2 mb-6" style={{ borderBottom: '2px solid #4E6CEF' }}>
        <img src="/brand-logo.png" alt="" className="h-9 w-auto" />
      </div>
      <h1 className="text-2xl font-bold mb-1">{title}</h1>
      {docNumber && <div className="text-xs mb-6">{docNumber}</div>}
      {def.sections.map((section) => (
        <div key={section.id} className="mb-6" style={{ breakInside: 'avoid' }}>
          <h2 className="text-base font-semibold mb-2 pb-1" style={{ borderBottom: '1.5px solid #4E6CEF' }}>{section.title}</h2>

          {section.kind === 'fields' && (
            <table className="w-full border-collapse">
              <tbody>
                {section.fields.map((f) => (
                  <tr key={f.key}>
                    <td className={`${cellBase} font-medium w-1/3`} style={{ background: '#D0D9FF' }}>{f.label}</td>
                    <td className={`${cellBase} whitespace-pre-line`}>
                      {f.type === 'richtext'
                        ? markdownToPlainish(data.fields[section.id]?.[f.key] || '') || '-'
                        : data.fields[section.id]?.[f.key] || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {section.kind === 'table' && (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {section.columns.map((c) => <th key={c.key} className={`${cellBase} font-medium text-left`} style={{ background: '#D0D9FF' }}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {(data.tables[section.id] ?? []).map((row, ri) => (
                  <tr key={ri}>
                    {section.columns.map((c) => <td key={c.key} className={cellBase}>{row[c.key] || '-'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {section.kind === 'list' && (
            <ol className="list-decimal pl-5 space-y-1">
              {(data.lists[section.id] ?? []).filter((s) => s.trim()).map((item, i) => <li key={i}>{item}</li>)}
              {(data.lists[section.id] ?? []).every((s) => !s.trim()) && <li className="list-none">-</li>}
            </ol>
          )}
        </div>
      ))}
      {attachments && attachments.length > 0 && (
        <div className="mb-6" style={{ breakInside: 'avoid' }}>
          <h2 className="text-base font-semibold mb-2 pb-1" style={{ borderBottom: '1.5px solid #4E6CEF' }}>ส่วนแนบท้ายเอกสาร</h2>
          <ul className="list-disc pl-5 space-y-1">
            {attachments.map((a) => (
              <li key={a.id}>{a.kind === 'link' ? `${a.label} — ${a.url}` : a.filename ?? a.label}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
