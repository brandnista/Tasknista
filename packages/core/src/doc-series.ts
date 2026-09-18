/**
 * Pronista §Project Documents (2026-09-17) — จัดกลุ่มแถว `docs` เป็น "เล่ม" (series): เอกสารที่ docType+docNumber
 * ตรงกันคือเล่มเดียวกัน หลายเวอร์ชัน (v1.0/v1.1/v2.0 ฯลฯ) — ย้าย grouping logic จาก DocumentHistoryTable.tsx (ฝั่ง client)
 * มาเป็น pure function ใช้ร่วมกันได้ทั้ง server (project-documents route) และ client (ตารางประวัติเดิม)
 */

export interface DocSeriesRow {
  id: string
  title: string
  docType: string | null
  docNumber: string | null
  docVersion: string | null
  updatedAt: number | null
}

export interface DocSeries<T extends DocSeriesRow = DocSeriesRow> {
  /** docType+docNumber ถ้ามี ไม่งั้นใช้ id ของแถวเดี่ยว (นับเป็นเล่มเดี่ยว) */
  key: string
  docType: string | null
  docNumber: string | null
  heading: string
  versions: T[] // เรียง desc ตามเวอร์ชัน (ตัวเลขมากสุดก่อน) แล้วตาม updatedAt
  latestAt: number
}

const stripVersionSuffix = (title: string) => title.replace(/\s+v\d+(\.\d+)*\s*$/i, '').trim()

/** เทียบเวอร์ชันแบบ dot-separated numeric string (เช่น "1.0" vs "1.10" vs "2") มากไปน้อย — เวอร์ชัน parse ไม่ได้ถือเป็น 0 ทุก segment */
export function cmpVersionDesc(a: { docVersion: string | null; updatedAt: number | null }, b: { docVersion: string | null; updatedAt: number | null }): number {
  const pa = (a.docVersion ?? '').split('.').map(Number)
  const pb = (b.docVersion ?? '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (d) return d
  }
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
}

/** จัดกลุ่มแถว docs เป็นเล่ม — คืนเรียงจากเล่มที่มีเวอร์ชันล่าสุดก่อน */
export function groupDocSeries<T extends DocSeriesRow>(docs: T[]): DocSeries<T>[] {
  const map = new Map<string, DocSeries<T>>()

  for (const d of docs) {
    const seriesId = d.docNumber ? `num:${d.docType ?? ''}:${d.docNumber}` : `doc:${d.id}`
    const existing = map.get(seriesId)
    if (existing) {
      existing.versions.push(d)
    } else {
      map.set(seriesId, {
        key: seriesId,
        docType: d.docType,
        docNumber: d.docNumber,
        heading: d.docNumber ?? stripVersionSuffix(d.title),
        versions: [d],
        latestAt: d.updatedAt ?? 0,
      })
    }
  }

  const series = [...map.values()]
  for (const s of series) {
    s.versions.sort(cmpVersionDesc)
    s.latestAt = s.versions[0]?.updatedAt ?? 0
  }
  series.sort((a, b) => b.latestAt - a.latestAt)
  return series
}
