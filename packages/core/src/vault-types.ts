/**
 * Pronista §Secret Vault Type (2026-09-08) — ประเภทรายการใน Secret Vault ควบคุมแค่ "ฟิลด์ที่แนะนำ" ตอนสร้าง/แก้ไข
 * ไม่ใช่ fixed schema ต่อ type (เพิ่ม type ใหม่ไม่ต้อง migration) — username/password/url/notes ยังเป็นฟิลด์กลางร่วมทุก type
 * ฟิลด์เสริมนอกเหนือจากนี้ (เช่น API Secret, Merchant ID, เลขบัตร) เก็บเป็น extraFields แบบ key-value อิสระ ผู้ใช้ลบ/เพิ่มเองได้เสมอ
 */

export const VAULT_ITEM_TYPES = ['website', 'api_credential', 'server', 'payment_gateway', 'payment_card', 'identity', 'note', 'other'] as const
export type VaultItemType = (typeof VAULT_ITEM_TYPES)[number]

export const VAULT_TYPE_LABEL: Record<VaultItemType, string> = {
  website: 'เข้าสู่ระบบเว็บไซต์',
  api_credential: 'API Key / Credential',
  server: 'Server / ฐานข้อมูล',
  payment_gateway: 'Payment Gateway',
  payment_card: 'บัตรชำระเงิน',
  identity: 'เอกสารประจำตัว',
  note: 'โน้ตลับ',
  other: 'อื่นๆ',
}

// ชื่อ icon จาก lucide-react — แม็ปตรงกับที่ import ใช้ในหน้า Vault.tsx
export const VAULT_TYPE_ICON: Record<VaultItemType, string> = {
  website: 'Globe',
  api_credential: 'KeyRound',
  server: 'Server',
  payment_gateway: 'Landmark',
  payment_card: 'CreditCard',
  identity: 'IdCard',
  note: 'StickyNote',
  other: 'Lock',
}

/** ฟิลด์เสริมที่แนะนำตอนเลือก type ครั้งแรก — username/password/url ในฟอร์มมีอยู่แล้ว ไม่ต้องซ้ำที่นี่ */
export const VAULT_TYPE_SUGGESTED_FIELDS: Record<VaultItemType, string[]> = {
  website: [],
  api_credential: ['API Key', 'API Secret'],
  server: ['Host', 'Port'],
  payment_gateway: ['Merchant ID', 'API Key', 'Secret Key'],
  payment_card: ['เลขบัตร', 'วันหมดอายุ', 'CVV', 'ชื่อผู้ถือบัตร'],
  identity: ['เลขบัตรประชาชน/พาสปอร์ต', 'ที่อยู่'],
  note: [],
  other: [],
}

/** ฟิลด์เสริมที่ควร mask ตอนแสดงผล (ชื่อฟิลด์มีคำเหล่านี้ปนอยู่ ไม่สนตัวพิมพ์เล็ก-ใหญ่) — ฟิลด์ทั่วไปอย่าง Host/Port/ชื่อผู้ถือบัตร ไม่ต้อง mask */
const SENSITIVE_FIELD_KEYWORDS = ['secret', 'key', 'cvv', 'password', 'เลขบัตร']

export function isSensitiveFieldLabel(label: string): boolean {
  const lower = label.toLowerCase()
  return SENSITIVE_FIELD_KEYWORDS.some((k) => lower.includes(k))
}
