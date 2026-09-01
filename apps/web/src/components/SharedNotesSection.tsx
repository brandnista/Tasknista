/**
 * Pronista §My Note shared split (2026-09-01) — บันทึกที่แชร์กันไปมา (ของฉันแชร์ให้คนอื่น + คนอื่นแชร์มาหาฉัน) ย้ายมาอยู่ที่เมนู "แชร์กับฉัน"
 * แทนที่จะปนอยู่บนบอร์ด "บันทึกของฉัน" (พี่แจ้งว่ากวนตา) — แสดงเป็น list เรียบง่าย กดแล้วเปิดไปหน้า My Note พร้อม deep link "?open="
 */
import { CheckSquare, FileText } from 'lucide-react'
import { useLoad } from '../lib/useLoad'
import { api } from '../lib/api'
import { parseBody, type Note } from './MyNoteTab'

const notePreviewShort = (n: Note): string => {
  const body = parseBody(n.body)
  if (body.mode === 'text') return body.text.slice(0, 80)
  return body.items.map((i) => i.text).join(' · ').slice(0, 80)
}

export function SharedNotesSection() {
  const { data: shared } = useLoad<Note[]>(() => api.get('/api/my-notes/shared'))
  if (!shared || shared.length === 0) return null

  return (
    <div>
      <div className="text-sm font-medium text-strong mb-2">บันทึกที่แชร์กับฉัน</div>
      <div className="bg-white rounded-lg shadow-xs overflow-hidden">
        <div className="hidden sm:flex items-center gap-2.5 px-4 py-2 text-[11px] font-medium text-muted border-b border-divider">
          <span className="flex-1 min-w-0">ชื่อ</span>
          <span className="shrink-0 w-20">ประเภท</span>
          <span className="shrink-0 w-20 text-right">แชร์โดย</span>
          <span className="shrink-0 w-16 text-right">วันที่แก้ไข</span>
        </div>
        <div className="divide-y divide-divider">
          {shared.map((n) => {
            const body = parseBody(n.body)
            const title = n.title || notePreviewShort(n) || 'บันทึกไม่มีหัวข้อ'
            return (
              <a
                key={n.id}
                href={`/my-tasks/notes?open=${n.id}`}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-hover"
              >
                {body.mode === 'checklist' ? (
                  <CheckSquare className="w-4 h-4 text-success-600 shrink-0" />
                ) : (
                  <FileText className="w-4 h-4 text-info-600 shrink-0" />
                )}
                <span className="flex-1 min-w-0 truncate text-sm text-body">{title}</span>
                <span className="shrink-0 w-20 text-[11px] text-muted hidden sm:inline">{body.mode === 'checklist' ? 'เช็คลิสต์' : 'ข้อความ'}</span>
                <span className="shrink-0 w-20 text-[11px] text-muted text-right truncate hidden sm:inline">{n.ownerName ?? ''}</span>
                <span className="shrink-0 w-16 text-[11px] text-muted text-right hidden sm:inline">
                  {new Date(n.updatedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                </span>
              </a>
            )
          })}
        </div>
      </div>
    </div>
  )
}
