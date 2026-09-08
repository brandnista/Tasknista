import { describe, expect, it } from 'vitest'
import { extractUrls } from './second-brain'

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
