import { describe, expect, it } from 'vitest'
import { extractUrls, stripUrls } from './second-brain'

describe('extractUrls', () => {
  it('ข้อความมี 1 ลิงก์ — ดึงมาได้', () => {
    expect(extractUrls('ลองอ่านอันนี้ดู https://example.com/article สนุกมาก')).toEqual(['https://example.com/article'])
  })

  it('ข้อความมีหลายลิงก์ — ดึงมาได้ครบตามลำดับ', () => {
    expect(extractUrls('http://a.com กับ https://b.com/path?x=1')).toEqual(['http://a.com', 'https://b.com/path?x=1'])
  })

  it('ข้อความไม่มีลิงก์เลย — คืน array ว่าง', () => {
    expect(extractUrls('วันนี้กินอะไรดี')).toEqual([])
  })

  it('ลิงก์ซ้ำกันในข้อความเดียว — dedupe เหลือตัวเดียว', () => {
    expect(extractUrls('https://example.com/x ลองดูนะ https://example.com/x')).toEqual(['https://example.com/x'])
  })

  it('ลิงก์ต่อท้ายด้วยวงเล็บ/จุลภาค/มหัพภาค — ตัดออก ไม่ติดมาด้วย', () => {
    expect(extractUrls('(https://example.com/a) และ https://example.com/b, ลองดู https://example.com/c.')).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ])
  })

  it('ข้อความว่างเปล่า — คืน array ว่าง ไม่ throw', () => {
    expect(extractUrls('')).toEqual([])
  })
})

describe('stripUrls', () => {
  it('ตัดลิงก์เดียวออกเหลือโน้ตล้วน', () => {
    expect(stripUrls('https://youtu.be/x อันนี้ดีมะ', ['https://youtu.be/x'])).toBe('อันนี้ดีมะ')
  })

  it('ข้อความมีแต่ลิงก์ไม่มีโน้ต — คืนค่าว่าง', () => {
    expect(stripUrls('https://example.com/a', ['https://example.com/a'])).toBe('')
  })

  it('หลายลิงก์ตัดออกหมด เหลือโน้ตตรงกลาง', () => {
    expect(stripUrls('https://a.com ลองดู https://b.com นะ', ['https://a.com', 'https://b.com'])).toBe('ลองดู นะ')
  })

  it('ไม่มีลิงก์ในข้อความเลย — คืนข้อความเดิม (trim แล้ว)', () => {
    expect(stripUrls('  ข้อความธรรมดา  ', [])).toBe('ข้อความธรรมดา')
  })
})
