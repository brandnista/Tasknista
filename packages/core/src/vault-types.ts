/**
 * Pronista §Secret Vault Type (2026-09-08) — ประเภทรายการใน Secret Vault ควบคุมแค่ "ฟิลด์ที่แนะนำ" ตอนสร้าง/แก้ไข
 * ไม่ใช่ fixed schema ต่อ type (เพิ่ม type ใหม่ไม่ต้อง migration) — username/password/url/notes ยังเป็นฟิลด์กลางร่วมทุก type
 * ฟิลด์เสริมนอกเหนือจากนี้ (เช่น API Secret, Merchant ID, เลขบัตร) เก็บเป็น extraFields แบบ key-value อิสระ ผู้ใช้ลบ/เพิ่มเองได้เสมอ
 */

// §Secret Vault Partner Types (2026-09-08) — เพิ่มตามหมวดพาทเนอร์จริงที่ใช้ในระบบ allnista (จัดการพาทเนอร์ > Global Setting)
// อ้างอิงฟิลด์จาก prototype "จัดการพาทเนอร์" — ตัดเฉพาะ toggle เปิด/ปิดใช้งาน + dropdown ความถี่/ทิศทางซิงค์ออก
// (เป็น operational config ของระบบ allnista เอง ไม่ใช่ "ความลับ" ที่ควรเก็บใน vault) เหลือเฉพาะฟิลด์ credential/ค่าคอนฟิกจริงที่ต้องเก็บอ้างอิง
export const VAULT_ITEM_TYPES = [
  'website',
  'api_credential',
  'server',
  'payment_gateway',
  'shipping_aggregator',
  'social_login',
  'mobile_login',
  'order_management',
  'product_management',
  'e_fulfillment',
  'ecommerce_platform',
  'generative_ai',
  'payment_card',
  'identity',
  'note',
  'other',
] as const
export type VaultItemType = (typeof VAULT_ITEM_TYPES)[number]

export const VAULT_TYPE_LABEL: Record<VaultItemType, string> = {
  website: 'เข้าสู่ระบบเว็บไซต์',
  api_credential: 'API Key / Credential',
  server: 'Server / ฐานข้อมูล',
  payment_gateway: 'Payment Gateway',
  shipping_aggregator: 'Shipping Aggregator (ขนส่ง)',
  social_login: 'Social Login (LINE/Facebook/Google)',
  mobile_login: 'Mobile Phone Login (SMS OTP)',
  order_management: 'Order Management System (OMS)',
  product_management: 'Product Management System (PMS)',
  e_fulfillment: 'e-Fulfillment (คลังสินค้า)',
  ecommerce_platform: 'E-Commerce Platform',
  generative_ai: 'Generative-AI',
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
  shipping_aggregator: 'Truck',
  social_login: 'Users',
  mobile_login: 'Smartphone',
  order_management: 'ClipboardList',
  product_management: 'Package',
  e_fulfillment: 'Warehouse',
  ecommerce_platform: 'ShoppingCart',
  generative_ai: 'Sparkles',
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
  shipping_aggregator: ['BASE URL', 'API Key', 'ชื่อผู้ส่ง', 'ที่อยู่ผู้ส่ง', 'ตำบล', 'อำเภอ', 'จังหวัด', 'รหัสไปรษณีย์', 'เบอร์โทรผู้ส่ง'],
  social_login: ['Client ID', 'Client Secret', 'Callback/Liff ID'],
  mobile_login: ['SMS API Key', 'SMS API Secret', 'SMS Sender Name'],
  order_management: ['BASE URL', 'API Key', 'API Secret', 'Store/Shop ID', 'Webhook URL'],
  product_management: ['BASE URL', 'API Key', 'API Secret', 'Shop/Store ID'],
  e_fulfillment: ['BASE URL', 'API Key', 'API Secret', 'รหัสคลัง/ลูกค้า', 'ชื่อผู้ส่ง', 'ที่อยู่ผู้ส่ง', 'จังหวัด', 'รหัสไปรษณีย์', 'เบอร์โทรผู้ส่ง'],
  ecommerce_platform: ['Store/Site URL', 'API Key', 'API Secret', 'Store ID'],
  generative_ai: ['API Key'],
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
