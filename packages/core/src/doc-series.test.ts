import { describe, expect, it } from 'vitest'
import { cmpVersionDesc, groupDocSeries, type DocSeriesRow } from './doc-series'

const row = (over: Partial<DocSeriesRow> & { id: string }): DocSeriesRow => ({
  title: 'เอกสาร',
  docType: 'MOM',
  docNumber: null,
  docVersion: null,
  updatedAt: 0,
  ...over,
})

describe('cmpVersionDesc', () => {
  it('เวอร์ชันมากกว่ามาก่อน', () => {
    expect(cmpVersionDesc({ docVersion: '2.0', updatedAt: 1 }, { docVersion: '1.0', updatedAt: 100 })).toBeLessThan(0)
  })
  it('เทียบทีละ segment ไม่ใช่ string เทียบตรงๆ (1.10 > 1.9)', () => {
    expect(cmpVersionDesc({ docVersion: '1.10', updatedAt: 1 }, { docVersion: '1.9', updatedAt: 1 })).toBeLessThan(0)
  })
  it('เวอร์ชันเท่ากัน — ใหม่กว่าตาม updatedAt มาก่อน', () => {
    expect(cmpVersionDesc({ docVersion: '1.0', updatedAt: 200 }, { docVersion: '1.0', updatedAt: 100 })).toBeLessThan(0)
  })
  it('ไม่มีเวอร์ชันเลยทั้งคู่ — ถือเป็น 0 เท่ากัน ใช้ updatedAt ตัดสิน', () => {
    expect(cmpVersionDesc({ docVersion: null, updatedAt: 200 }, { docVersion: null, updatedAt: 100 })).toBeLessThan(0)
  })
})

describe('groupDocSeries', () => {
  it('docType+docNumber ตรงกัน — group เป็นเล่มเดียว หลายเวอร์ชัน', () => {
    const docs = [
      row({ id: 'a', docNumber: 'BNT-MOM-001', docVersion: '1.0', updatedAt: 100 }),
      row({ id: 'b', docNumber: 'BNT-MOM-001', docVersion: '2.0', updatedAt: 200 }),
    ]
    const series = groupDocSeries(docs)
    expect(series).toHaveLength(1)
    expect(series[0]!.versions.map((v) => v.id)).toEqual(['b', 'a']) // v2.0 มาก่อน v1.0
    expect(series[0]!.heading).toBe('BNT-MOM-001')
    expect(series[0]!.latestAt).toBe(200)
  })

  it('docNumber ต่างกัน — คนละเล่ม', () => {
    const docs = [row({ id: 'a', docNumber: 'BNT-MOM-001' }), row({ id: 'b', docNumber: 'BNT-MOM-002' })]
    expect(groupDocSeries(docs)).toHaveLength(2)
  })

  it('docType ต่างกันแต่ docNumber ชนกันโดยบังเอิญ — ไม่ group รวมกัน', () => {
    const docs = [row({ id: 'a', docType: 'MOM', docNumber: 'X-001' }), row({ id: 'b', docType: 'BRD', docNumber: 'X-001' })]
    expect(groupDocSeries(docs)).toHaveLength(2)
  })

  it('docNumber ว่าง (null) — แต่ละแถวนับเป็นเล่มเดี่ยวของตัวเอง ไม่ group รวมกัน', () => {
    const docs = [row({ id: 'a', docNumber: null, title: 'ไฟล์เดี่ยว 1' }), row({ id: 'b', docNumber: null, title: 'ไฟล์เดี่ยว 2' })]
    const series = groupDocSeries(docs)
    expect(series).toHaveLength(2)
    expect(series.map((s) => s.heading).sort()).toEqual(['ไฟล์เดี่ยว 1', 'ไฟล์เดี่ยว 2'])
  })

  it('เรียงเล่มจาก latestAt มากไปน้อย', () => {
    const docs = [row({ id: 'a', docNumber: 'OLD', updatedAt: 10 }), row({ id: 'b', docNumber: 'NEW', updatedAt: 900 })]
    const series = groupDocSeries(docs)
    expect(series.map((s) => s.docNumber)).toEqual(['NEW', 'OLD'])
  })

  it('array ว่าง — คืน array ว่าง', () => {
    expect(groupDocSeries([])).toEqual([])
  })
})
