import { describe, expect, it } from 'vitest'
import { finalizeProjectKey, isValidProjectKey, normalizeProjectKeyInput, projectKeyPrefix } from './project-key'

describe('PRO-0040 — Project Key แบบ Free Key', () => {
  it('รับรูปแบบตัวอย่างจากโจทย์: MAK-DIN และ MAK-RD (และ 3 ตัวแบบเดิม)', () => {
    for (const k of ['MAK-DIN', 'MAK-RD', 'MAK', 'AB', 'A1-B2-C3']) expect(isValidProjectKey(k)).toBe(true)
  })
  it('ปฏิเสธ: สั้นไป/ยาวเกิน 12/ตัวพิมพ์เล็ก/ขีดต้น-ท้าย-ซ้อน/อักขระอื่น/เว้นวรรค', () => {
    for (const k of ['A', 'ABCDEFGHIJKLM', 'mak-din', '-MAK', 'MAK-', 'MAK--DIN', 'MAK_DIN', 'MAK DIN', 'มาก']) expect(isValidProjectKey(k)).toBe(false)
  })
  it('ระหว่างพิมพ์: ตัวพิมพ์ใหญ่ ตัดอักขระแปลก ขีดซ้อน/ขีดนำหน้า แต่เก็บขีดท้ายไว้ให้พิมพ์ต่อได้', () => {
    expect(normalizeProjectKeyInput('mak-din')).toBe('MAK-DIN')
    expect(normalizeProjectKeyInput('mak_d i n')).toBe('MAKDIN')
    expect(normalizeProjectKeyInput('--mak--din')).toBe('MAK-DIN')
    expect(normalizeProjectKeyInput('MAK-')).toBe('MAK-')
    expect(normalizeProjectKeyInput('ABCDEFGHIJKLMNOP')).toHaveLength(12)
  })
  it('ตอนบันทึก: ตัดขีดท้ายที่ค้างออก', () => {
    expect(finalizeProjectKey('mak-')).toBe('MAK')
    expect(finalizeProjectKey('mak-rd')).toBe('MAK-RD')
  })
  it('คำนำหน้ารหัสงาน: คงขีดไว้ (MAK-DIN → MAK-DIN) ไม่มี/ภาษาไทยล้วน → fallback', () => {
    expect(projectKeyPrefix('MAK-DIN', 'TSK')).toBe('MAK-DIN')
    expect(projectKeyPrefix('PRO', 'TSK')).toBe('PRO')
    expect(projectKeyPrefix(null, 'TSK')).toBe('TSK')
    expect(projectKeyPrefix('สสว', 'TSK')).toBe('TSK')
  })
})
