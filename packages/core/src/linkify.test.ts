import { describe, expect, it } from 'vitest'
import { firstLink, linkHost, splitLinks } from './linkify'

describe('splitLinks', () => {
  it('ลิงก์ล้วน → 1 ลิงก์ (กรณีจริงจากแชท)', () => {
    expect(splitLinks('https://pronista-team-flow-01a08486.brandnista-co-ltd.workers.dev/')).toEqual([
      { type: 'link', value: 'https://pronista-team-flow-01a08486.brandnista-co-ltd.workers.dev/' },
    ])
  })
  it('ข้อความปนลิงก์ · ตัดเครื่องหมายท้ายประโยค', () => {
    expect(splitLinks('ดูตรงนี้ https://example.com/a?b=1, แล้วบอกด้วย')).toEqual([
      { type: 'text', value: 'ดูตรงนี้ ' },
      { type: 'link', value: 'https://example.com/a?b=1' },
      { type: 'text', value: ', แล้วบอกด้วย' },
    ])
  })
  it('หลายลิงก์ · ขึ้นบรรทัดใหม่', () => {
    const r = splitLinks('http://a.io/x\nhttps://b.io')
    expect(r.filter((s) => s.type === 'link').map((s) => s.value)).toEqual(['http://a.io/x', 'https://b.io'])
  })
  it('วงเล็บที่เป็นส่วนของลิงก์คงไว้ · วงเล็บปิดครอบลิงก์ตัดออก', () => {
    expect(firstLink('https://en.wikipedia.org/wiki/Foo_(bar)')).toBe('https://en.wikipedia.org/wiki/Foo_(bar)')
    expect(firstLink('(ดู https://example.com/x)')).toBe('https://example.com/x')
  })
  it('ไม่ใช่ลิงก์ → ข้อความล้วน · ไม่รับ javascript:', () => {
    expect(splitLinks('สวัสดี')).toEqual([{ type: 'text', value: 'สวัสดี' }])
    expect(firstLink('javascript:alert(1) http:// ')).toBeNull()
  })
  it('linkHost ตัด www', () => {
    expect(linkHost('https://www.example.com/a')).toBe('example.com')
    expect(linkHost('not a url')).toBeNull()
  })
})
