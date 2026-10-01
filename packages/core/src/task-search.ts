/** Pronista §PRO-CR-21092026-0016 — ค้นหางาน (ชื่อ/รหัส) ใช้ได้ทุกแท็บของ Backlog โปรเจกต์ และค้นลึกถึงงานย่อย:
 *  ถ้างานย่อย (หรือหลาน) ตรงคำค้น ต้องแสดงงานแม่ที่ครอบอยู่ด้วย */
export interface SearchableTask {
  id: string
  title: string
  code: string | null
  parentId?: string | null
}

export const normalizeSearch = (q: string | null | undefined): string => (q ?? '').trim().toLowerCase()

/** ตรงคำค้นด้วยตัวเอง (q ต้อง normalize แล้ว) — q ว่าง = ตรงทุกงาน */
export function taskMatches(t: Pick<SearchableTask, 'title' | 'code'>, q: string): boolean {
  if (!q) return true
  return t.title.toLowerCase().includes(q) || (t.code ?? '').toLowerCase().includes(q)
}

/** มีลูก/หลานใน `all` ที่ตรงคำค้นไหม (จำกัดความลึก กันข้อมูลวนลูป) */
export function hasMatchingDescendant(all: SearchableTask[], id: string, q: string, depth = 0): boolean {
  if (!q || depth > 5) return false
  return all.some((c) => c.parentId === id && (taskMatches(c, q) || hasMatchingDescendant(all, c.id, q, depth + 1)))
}

/** งานที่ต้องโชว์เมื่อค้นหา: ตรงเอง หรือมีงานย่อยที่ตรง */
export function taskVisibleForSearch(all: SearchableTask[], t: SearchableTask, q: string): boolean {
  return !q || taskMatches(t, q) || hasMatchingDescendant(all, t.id, q)
}

/** งานย่อยที่ต้องโชว์ใต้ `parent`: แม่ตรงคำค้นเอง → โชว์ลูกทั้งหมด · แม่ไม่ตรง (โผล่เพราะลูกตรง) → โชว์เฉพาะลูกที่ตรง/มีหลานตรง */
export function visibleChildren<T extends SearchableTask>(all: T[], parent: SearchableTask, q: string): T[] {
  const kids = all.filter((c) => c.parentId === parent.id)
  if (!q || taskMatches(parent, q)) return kids
  return kids.filter((c) => taskVisibleForSearch(all, c, q))
}
