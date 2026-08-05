import { Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { PickableTask } from './TaskPickerModal'

/**
 * Pronista §Back to Basic — เมนู "..." เชื่อมโยงใน Tab Epic/Story: "สร้างใหม่" (พิมพ์ชื่อ) หรือ "เลือกที่มีอยู่แล้ว" (ค้นหา) ในโมดัลเดียว
 * ใช้ร่วมกัน 3 จุด: Epic→เชื่อมกับ Story, Story→เชื่อมกับ Epic, Story→เชื่อมกับ Task
 */
export function LinkOrCreateModal({
  title,
  createPlaceholder,
  pickLabel,
  pickItems,
  onCreateNew,
  onPickExisting,
  onClose,
}: {
  title: string
  createPlaceholder: string
  pickLabel: string
  pickItems: PickableTask[]
  onCreateNew: (title: string) => void
  onPickExisting: (item: PickableTask) => void
  onClose: () => void
}) {
  const [newTitle, setNewTitle] = useState('')
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return pickItems.filter((t) => !needle || t.title.toLowerCase().includes(needle) || (t.code ?? '').toLowerCase().includes(needle)).slice(0, 50)
  }, [pickItems, q])

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-10 mx-auto w-full max-w-md px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[80vh] flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-ink text-sm">{title}</div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex gap-2 mb-4">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newTitle.trim()) onCreateNew(newTitle.trim()) }}
              placeholder={createPlaceholder}
              className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400"
            />
            <button
              onClick={() => newTitle.trim() && onCreateNew(newTitle.trim())}
              disabled={!newTitle.trim()}
              className="text-sm bg-brand-600 text-white px-3 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40 whitespace-nowrap font-medium"
            >
              สร้างใหม่
            </button>
          </div>
          <div className="text-xs font-medium text-muted mb-2">{pickLabel}</div>
          <div className="relative mb-2">
            <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาชื่อ/รหัส..."
              className="w-full text-sm bg-white border border-border rounded-lg pl-9 pr-3 py-2 focus:outline-hidden focus:border-brand-400"
            />
          </div>
          <div className="overflow-y-auto -mx-2 px-2">
            {filtered.length === 0 && <div className="text-xs text-muted text-center py-6">ไม่พบรายการที่ตรงกับคำค้น</div>}
            {filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => onPickExisting(t)}
                className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-hover flex items-center gap-2"
              >
                {t.code && <span className="text-[11px] text-muted shrink-0">{t.code}</span>}
                <span className="text-sm text-body truncate">{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
