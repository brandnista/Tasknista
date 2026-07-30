/**
 * Tasknista §Document Management MVP — แถบแบ่งหน้า (เลือกจำนวนต่อหน้า + ก่อนหน้า/ถัดไป)
 * ค่าเริ่มต้น 20 รายการ/หน้า แก้ได้ · ใช้ในหน้า "เอกสาร" และ "ประวัติเอกสาร"
 */
export const DEFAULT_PAGE_SIZE = 20
export const PAGE_SIZES = [20, 50, 100, 200] as const

export function Pager({
  page,
  pageSize,
  total,
  unitLabel,
  onPage,
  onPageSize,
}: {
  page: number
  pageSize: number
  total: number
  unitLabel: string
  onPage: (p: number) => void
  onPageSize: (n: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center justify-between px-4 py-3 text-xs text-dim flex-wrap gap-2">
      <label className="flex items-center gap-1.5">
        แสดงหน้าละ
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="text-xs bg-white border border-border rounded-lg px-1.5 py-1"
        >
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {unitLabel} · ทั้งหมด {total} {unitLabel}
      </label>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-2.5 py-1 rounded-lg border border-border-subtle disabled:opacity-30 hover:bg-hover"
        >
          ก่อนหน้า
        </button>
        <span>หน้า {page} / {totalPages}</span>
        <button
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="px-2.5 py-1 rounded-lg border border-border-subtle disabled:opacity-30 hover:bg-hover"
        >
          ถัดไป
        </button>
      </div>
    </div>
  )
}
