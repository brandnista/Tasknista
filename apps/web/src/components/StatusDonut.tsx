import { BUCKET_DOT, BUCKET_LABEL, bucketOf, type ProjectBucket, type ProjectRow } from '../lib/project-ui'

/** โดนัทสรุปโปรเจกต์แยกตามสถานะ (SVG มือ — ไม่พึ่ง chart lib) — ใช้ทั้งหน้าโปรเจกต์และภาพรวมองค์กร */
export function StatusDonut({ rows }: { rows: ProjectRow[] }) {
  const counts: Record<ProjectBucket, number> = { active: 0, done: 0, late: 0, hold: 0 }
  for (const p of rows) counts[bucketOf(p)]++
  const total = rows.length
  const order: ProjectBucket[] = ['active', 'done', 'late', 'hold']
  const COLOR_HEX: Record<ProjectBucket, string> = { active: 'var(--color-info-500)', done: 'var(--color-success-500)', late: 'var(--color-danger-500)', hold: 'var(--color-warning-400)' }
  const r = 54
  const circumference = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="flex items-center gap-6 flex-wrap">
      <div className="relative w-36 h-36 shrink-0">
        <svg viewBox="0 0 130 130" className="w-36 h-36 -rotate-90">
          <circle cx="65" cy="65" r={r} fill="none" stroke="var(--color-divider)" strokeWidth="18" />
          {total > 0 && order.map((b) => {
            if (counts[b] === 0) return null
            const frac = counts[b] / total
            const dash = frac * circumference
            const circle = (
              <circle
                key={b}
                cx="65" cy="65" r={r} fill="none"
                stroke={COLOR_HEX[b]} strokeWidth="18"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            )
            offset += dash
            return circle
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-ink">{total}</span>
          <span className="text-[11px] text-muted">โปรเจกต์</span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {order.map((b) => (
          <div key={b} className="flex items-center gap-2 text-sm">
            <span className={`w-2.5 h-2.5 rounded-full ${BUCKET_DOT[b]}`} />
            <span className="text-body">{BUCKET_LABEL[b]}</span>
            <span className="text-muted tabular-nums">({counts[b]})</span>
          </div>
        ))}
      </div>
    </div>
  )
}
