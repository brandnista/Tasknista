import { describe, expect, it } from 'vitest'
import { parseChangelogMarkdown } from './changelog-import'

const TODAY = '2026-09-10'

const SAMPLE = `# Changelog 2026-09-03
---
## หลังบ้าน
- แก้ไข \`ตาราง\` งานให้แสดงสถานะถูกต้อง
- เพิ่มปุ่ม **ลบ** งาน
- ปรับปรุงหน้าจอ Login
- เพิ่มระบบแจ้งเตือนอีเมล

**ข้อจำกัด**:
\`\`\`
ระบบยังไม่รองรับไฟล์เกิน 10MB
\`\`\`

## หน้าบ้าน
- ปรับ UI มือถือให้ responsive มากขึ้น

## API
- เพิ่ม endpoint \`/api/reports/summary\`
`

describe('parseChangelogMarkdown', () => {
  it('แยก title + entryDate จากวันที่ใน heading ได้ถูกต้อง (เก็บ title verbatim)', () => {
    const result = parseChangelogMarkdown(SAMPLE, TODAY)
    expect(result.title).toBe('Changelog 2026-09-03')
    expect(result.entryDate).toBe('2026-09-03')
  })

  it('หลังบ้าน: 4 bullet ปกติ + ข้อจำกัดใน code block กลายเป็น bullet ที่ 5 พร้อม label นำหน้า', () => {
    const result = parseChangelogMarkdown(SAMPLE, TODAY)
    const backoffice = result.items.filter((i) => i.category === 'backoffice')
    expect(backoffice).toHaveLength(5)
    expect(backoffice[4]!.text).toBe('ข้อจำกัด:\nระบบยังไม่รองรับไฟล์เกิน 10MB')
  })

  it('จับหมวด หน้าบ้าน/API ถูกต้อง', () => {
    const result = parseChangelogMarkdown(SAMPLE, TODAY)
    expect(result.items.filter((i) => i.category === 'frontend')).toHaveLength(1)
    expect(result.items.filter((i) => i.category === 'api')).toHaveLength(1)
  })

  it('backtick/ตัวหนา ถูกลอกออกหมดจาก bullet ธรรมดา', () => {
    const result = parseChangelogMarkdown(SAMPLE, TODAY)
    const backoffice = result.items.filter((i) => i.category === 'backoffice')
    expect(backoffice[0]!.text).toBe('แก้ไข ตาราง งานให้แสดงสถานะถูกต้อง')
    expect(backoffice[1]!.text).toBe('เพิ่มปุ่ม ลบ งาน')
    expect(result.items.find((i) => i.category === 'api')!.text).toBe('เพิ่ม endpoint /api/reports/summary')
  })

  it('หัวข้อไม่มีวันที่ในชื่อ → fallback เป็น today', () => {
    const result = parseChangelogMarkdown('# Changelog ประจำสัปดาห์\n- แก้บั๊ก', TODAY)
    expect(result.entryDate).toBe(TODAY)
  })

  it('วันที่ใน heading format ผิด (เดือน/วันเกินจริง) → fallback เป็น today เช่นกัน', () => {
    const result = parseChangelogMarkdown('# Changelog 2026-13-45\n- แก้บั๊ก', TODAY)
    expect(result.entryDate).toBe(TODAY)
  })

  it('หัวข้อ ## ไม่ตรง keyword ไหนเลย → category เป็น null พร้อม warning ไม่ throw', () => {
    const result = parseChangelogMarkdown('# Changelog\n## หัวข้อประหลาด\n- ทดสอบบางอย่าง', TODAY)
    expect(result.items[0]).toMatchObject({ category: null, categoryGuess: 'หัวข้อประหลาด', text: 'ทดสอบบางอย่าง' })
    expect(result.warnings).toEqual(['ไม่รู้จักหมวด "หัวข้อประหลาด" — ต้องเลือกหมวดเอง'])
  })

  it('heading ที่ไม่รู้จักซ้ำกันหลายครั้ง → warning ไม่ซ้ำ', () => {
    const result = parseChangelogMarkdown('## แปลกๆ\n- ก\n## แปลกๆ\n- ข', TODAY)
    expect(result.warnings).toHaveLength(1)
  })

  it('เส้นคั่น --- และบรรทัดว่าง ไม่ปนเข้าเนื้อหา', () => {
    const result = parseChangelogMarkdown('# T\n---\n\n## API\n\n- bullet เดียว\n', TODAY)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.text).toBe('bullet เดียว')
  })

  it('บรรทัดต่อท้ายโดยไม่ขึ้น "- " ใหม่ → ต่อเข้า text ของ bullet ล่าสุดด้วยบรรทัดใหม่', () => {
    const result = parseChangelogMarkdown('## API\n- bullet แรก\n  รายละเอียดเพิ่มเติมบรรทัดสอง', TODAY)
    expect(result.items[0]!.text).toBe('bullet แรก\nรายละเอียดเพิ่มเติมบรรทัดสอง')
  })

  it('ไฟล์ว่างเปล่า → คืนค่า empty ทั้งหมด ไม่ throw', () => {
    const result = parseChangelogMarkdown('', TODAY)
    expect(result).toEqual({ title: '', entryDate: TODAY, items: [], warnings: [] })
  })

  it('ไฟล์มีแต่ whitespace/บรรทัดว่าง → เหมือนไฟล์ว่างเปล่า', () => {
    const result = parseChangelogMarkdown('\n\n   \n\n', TODAY)
    expect(result.items).toEqual([])
    expect(result.entryDate).toBe(TODAY)
  })
})
