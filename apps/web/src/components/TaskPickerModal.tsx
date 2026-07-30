import { Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

export interface PickableTask {
  id: string
  code: string | null
  title: string
  parentId: string | null
}

/**
 * Tasknista §Project Refactor — ค้นหา+เลือก task ในโปรเจกต์เดียวกัน ใช้เป็น parent
 * (เมนู "จัดการ" ใน Backlog: ย้ายเป็น Task/Subtask/Defect ต้องเลือก parent · เดินหน้าใช้ต่อกับส่วนเชื่อมโยงใน TaskDetail ด้วย)
 */
export function TaskPickerModal({
  title,
  tasks,
  excludeIds,
  onPick,
  onClose,
}: {
  title: string
  tasks: PickableTask[]
  excludeIds?: string[]
  onPick: (task: PickableTask) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const excluded = useMemo(() => new Set(excludeIds ?? []), [excludeIds])
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return tasks
      .filter((t) => !excluded.has(t.id))
      .filter((t) => !needle || t.title.toLowerCase().includes(needle) || (t.code ?? '').toLowerCase().includes(needle))
      .slice(0, 50)
  }, [tasks, excluded, q])

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-10 mx-auto w-full max-w-md px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[80vh] flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-ink text-sm">{title}</div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <div className="relative mb-2">
            <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาชื่องาน/รหัส..."
              className="w-full text-sm bg-white border border-border rounded-lg pl-9 pr-3 py-2 focus:outline-hidden focus:border-brand-400"
            />
          </div>
          <div className="overflow-y-auto -mx-2 px-2">
            {filtered.length === 0 && <div className="text-xs text-muted text-center py-6">ไม่พบงานที่ตรงกับคำค้น</div>}
            {filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => onPick(t)}
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
