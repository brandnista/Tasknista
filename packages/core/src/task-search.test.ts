import { describe, expect, it } from 'vitest'
import { hasMatchingDescendant, normalizeSearch, taskMatches, taskVisibleForSearch, visibleChildren, type SearchableTask } from './task-search'

const t = (id: string, title: string, code: string | null, parentId: string | null = null): SearchableTask => ({ id, title, code, parentId })
const all = [
  t('p1', 'ระบบล็อกอิน', 'PRO-0001'),
  t('c1', 'ทำหน้าฟอร์ม', 'PRO-0001.1', 'p1'),
  t('c2', 'เขียนเทสต์', 'PRO-0001.2', 'p1'),
  t('p2', 'รายงานยอดขาย', 'PRO-0002'),
  t('g1', 'ลูกของลูก OTP', 'PRO-0002.1.1', 'c3'),
  t('c3', 'ส่งออก Excel', 'PRO-0002.1', 'p2'),
]

describe('PRO-CR-0016 — ค้นหางานข้ามแท็บ + ค้นลึกงานย่อย', () => {
  it('normalizeSearch: trim + ตัวเล็ก · ค่าว่าง/undefined = ""', () => {
    expect(normalizeSearch('  AbC ')).toBe('abc')
    expect(normalizeSearch(undefined)).toBe('')
  })
  it('taskMatches: ตรงชื่อหรือรหัส (ไม่สนตัวพิมพ์) · q ว่าง = ตรงทุกงาน', () => {
    expect(taskMatches(all[0]!, 'ล็อกอิน')).toBe(true)
    expect(taskMatches(all[0]!, 'pro-0001')).toBe(true)
    expect(taskMatches(all[0]!, 'xyz')).toBe(false)
    expect(taskMatches(all[0]!, '')).toBe(true)
  })
  it('ค้นรหัสงานย่อย → งานแม่ต้องโผล่ด้วย (taskVisibleForSearch)', () => {
    expect(taskVisibleForSearch(all, all[0]!, 'pro-0001.2')).toBe(true)
    expect(taskVisibleForSearch(all, all[3]!, 'pro-0001.2')).toBe(false)
  })
  it('ค้นลึกถึงหลาน (ลูกของลูก) → แม่ชั้นบนสุดต้องโผล่', () => {
    expect(hasMatchingDescendant(all, 'p2', 'otp')).toBe(true)
    expect(taskVisibleForSearch(all, all[3]!, 'otp')).toBe(true)
  })
  it('visibleChildren: แม่ไม่ตรงเอง → แสดงเฉพาะลูกที่ตรง · แม่ตรงเอง → แสดงลูกทั้งหมด', () => {
    expect(visibleChildren(all, all[0]!, 'เทสต์').map((c) => c.id)).toEqual(['c2'])
    expect(visibleChildren(all, all[0]!, 'ล็อกอิน').map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(visibleChildren(all, all[0]!, '').map((c) => c.id)).toEqual(['c1', 'c2'])
  })
  it('ไม่มีผลลัพธ์ → ไม่มีงานใดผ่านตัวกรอง', () => {
    expect(all.filter((x) => taskVisibleForSearch(all, x, 'ไม่มีคำนี้แน่นอน'))).toEqual([])
  })
})
