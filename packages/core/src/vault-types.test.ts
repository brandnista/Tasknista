import { describe, expect, it } from 'vitest'
import { isSensitiveFieldLabel, VAULT_ITEM_TYPES, VAULT_TYPE_ICON, VAULT_TYPE_LABEL, VAULT_TYPE_SUGGESTED_FIELDS } from './vault-types'

describe('vault-types', () => {
  it('ทุก type มี label/icon/suggestedFields ครบ ไม่มีหลุด', () => {
    for (const t of VAULT_ITEM_TYPES) {
      expect(VAULT_TYPE_LABEL[t]).toBeTruthy()
      expect(VAULT_TYPE_ICON[t]).toBeTruthy()
      expect(VAULT_TYPE_SUGGESTED_FIELDS[t]).toBeDefined()
    }
  })

  it('isSensitiveFieldLabel — ฟิลด์ที่มีคำอ่อนไหวปน (ไม่สนตัวพิมพ์เล็ก-ใหญ่) → true, ฟิลด์ทั่วไป → false', () => {
    expect(isSensitiveFieldLabel('API Secret')).toBe(true)
    expect(isSensitiveFieldLabel('api key')).toBe(true)
    expect(isSensitiveFieldLabel('CVV')).toBe(true)
    expect(isSensitiveFieldLabel('เลขบัตร')).toBe(true)
    expect(isSensitiveFieldLabel('Host')).toBe(false)
    expect(isSensitiveFieldLabel('Port')).toBe(false)
    expect(isSensitiveFieldLabel('ชื่อผู้ถือบัตร')).toBe(false)
  })
})
