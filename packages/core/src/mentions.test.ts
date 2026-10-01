import { describe, expect, it } from 'vitest'
import { extractMentionedUserIds, mentionMarkdown } from './mentions'

describe('PRO-0024 — mention ในคอมเมนต์', () => {
  it('mentionMarkdown สร้างลิงก์ และแกะ id กลับได้', () => {
    const md = `ฝากดูหน่อย ${mentionMarkdown('11111111-2222-3333-4444-555555555555', 'อาร์ม')} ครับ`
    expect(md).toContain('[@อาร์ม](/mention/11111111-2222-3333-4444-555555555555)')
    expect(extractMentionedUserIds(md)).toEqual(['11111111-2222-3333-4444-555555555555'])
  })
  it('แท็กหลายคน/แท็กซ้ำ → ไม่ซ้ำ เรียงตามที่เจอ', () => {
    const md = `${mentionMarkdown('u_a', 'A')} ${mentionMarkdown('u_b', 'B')} ${mentionMarkdown('u_a', 'A')}`
    expect(extractMentionedUserIds(md)).toEqual(['u_a', 'u_b'])
  })
  it('ลิงก์ธรรมดา / ข้อความ @ ล้วนๆ ไม่ถูกนับเป็น mention', () => {
    expect(extractMentionedUserIds('[เว็บ](https://example.com/mention/abc) และ @someone')).toEqual([])
    expect(extractMentionedUserIds('')).toEqual([])
  })
  it('ชื่อที่มีวงเล็บเหลี่ยม ไม่ทำลายโครงลิงก์', () => {
    const md = mentionMarkdown('u_x', 'ชื่อ [พิเศษ]')
    expect(md).toBe('[@ชื่อ (พิเศษ)](/mention/u_x)')
    expect(extractMentionedUserIds(md)).toEqual(['u_x'])
  })
  it('จำกัดไม่เกิน 20 คนต่อหนึ่งคอมเมนต์ (กันสแปม)', () => {
    const md = Array.from({ length: 30 }, (_, i) => mentionMarkdown(`u${i}`, `N${i}`)).join(' ')
    expect(extractMentionedUserIds(md)).toHaveLength(20)
  })
})
