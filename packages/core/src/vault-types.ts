/**
 * Pronista §Secret Vault Type (2026-09-08) — ประเภทรายการใน Secret Vault มี 2 รูปแบบฟอร์ม:
 * 1) type ทั่วไป (website/api_credential/server/payment_card/identity/note/other) — ฟิลด์เสริม "แนะนำ" ตอนเลือก type
 *    แต่เพิ่ม/ลบเองได้อิสระ (VAULT_TYPE_SUGGESTED_FIELDS)
 * 2) type พาทเนอร์ (payment_gateway ฯลฯ 9 แบบ) — fixed field ตายตัวตามหน้า "จัดการพาทเนอร์" ของ allnista (VAULT_STRUCTURED_FIELDS)
 * ไม่มี type ไหนเป็น fixed schema ระดับ DB (เพิ่ม type ใหม่ไม่ต้อง migration) — ทั้งสองแบบเก็บลง extraFields (key-value) เหมือนกันหมด
 * username/password/url/notes ยังเป็นฟิลด์กลางร่วมทุก type
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

/** ฟิลด์เสริมที่แนะนำตอนเลือก type ครั้งแรก — username/password/url ในฟอร์มมีอยู่แล้ว ไม่ต้องซ้ำที่นี่ (ใช้กับ type ทั่วไปที่ไม่มี fixed schema ใน VAULT_STRUCTURED_FIELDS ด้านล่าง) */
export const VAULT_TYPE_SUGGESTED_FIELDS: Record<VaultItemType, string[]> = {
  website: [],
  api_credential: ['API Key', 'API Secret'],
  server: ['Host', 'Port'],
  payment_gateway: [],
  shipping_aggregator: [],
  social_login: [],
  mobile_login: [],
  order_management: [],
  product_management: [],
  e_fulfillment: [],
  ecommerce_platform: [],
  generative_ai: [],
  payment_card: ['เลขบัตร', 'วันหมดอายุ', 'CVV', 'ชื่อผู้ถือบัตร'],
  identity: ['เลขบัตรประชาชน/พาสปอร์ต', 'ที่อยู่'],
  note: [],
  other: [],
}

/**
 * §Secret Vault Partner Types Structured Fields (2026-09-08) — สำหรับ 9 ประเภทพาทเนอร์ ใช้ fixed field ตรงตัวหน้า
 * "จัดการพาทเนอร์ > แก้ไข" ของ allnista (ไม่ใช่ freeform เพิ่ม/ลบเองแบบ VAULT_TYPE_SUGGESTED_FIELDS) — ค่ายังเก็บใน
 * extraFields (label/value) เหมือนเดิมทุกอย่าง เพียงแต่ฝั่ง UI ล็อคฟิลด์/ลำดับตายตัวตาม type แทนให้เพิ่ม-ลบเอง
 * prefixWithName: true = label จริงจะขึ้นต้นด้วยชื่อรายการ (เช่น "Paysolutions Merchant Id") ตรงกับต้นฉบับ
 * เปิด/ปิดใช้งาน (toggle "Enable ..." ในต้นฉบับ) ไม่ได้อยู่ใน list นี้ — คุมแยกเป็น field ตายตัวหนึ่งอันเสมอที่ Vault.tsx
 */
export interface VaultStructuredField {
  key: string
  label: string
  prefixWithName?: boolean
}

export const VAULT_STRUCTURED_FIELDS: Partial<Record<VaultItemType, VaultStructuredField[]>> = {
  payment_gateway: [
    { key: 'merchant_id', label: 'Merchant Id', prefixWithName: true },
    { key: 'api_key', label: 'API Key', prefixWithName: true },
    { key: 'secret_key', label: 'Secret Key', prefixWithName: true },
  ],
  shipping_aggregator: [
    { key: 'base_url', label: 'BASE URL' },
    { key: 'api_key', label: 'API Key' },
    { key: 'sender_name', label: 'ชื่อผู้ส่ง' },
    { key: 'sender_address', label: 'ที่อยู่ผู้ส่ง' },
    { key: 'sender_district', label: 'ตำบล' },
    { key: 'sender_state', label: 'อำเภอ' },
    { key: 'sender_province', label: 'จังหวัด' },
    { key: 'sender_postcode', label: 'รหัสไปรษณีย์' },
    { key: 'sender_tel', label: 'เบอร์โทรผู้ส่ง' },
  ],
  social_login: [
    { key: 'client_id', label: 'Client ID', prefixWithName: true },
    { key: 'client_secret', label: 'Client Secret', prefixWithName: true },
    { key: 'callback_id', label: 'Callback/Liff ID', prefixWithName: true },
  ],
  mobile_login: [
    { key: 'sms_api_key', label: 'SMS API Key' },
    { key: 'sms_api_secret', label: 'SMS API Secret' },
    { key: 'sms_sender_name', label: 'SMS Sender Name' },
  ],
  order_management: [
    { key: 'base_url', label: 'BASE URL' },
    { key: 'api_key', label: 'API Key' },
    { key: 'api_secret', label: 'API Secret' },
    { key: 'store_id', label: 'Store/Shop ID' },
    { key: 'webhook_url', label: 'Webhook URL' },
  ],
  product_management: [
    { key: 'base_url', label: 'BASE URL' },
    { key: 'api_key', label: 'API Key' },
    { key: 'api_secret', label: 'API Secret' },
    { key: 'store_id', label: 'Shop/Store ID' },
  ],
  e_fulfillment: [
    { key: 'base_url', label: 'BASE URL' },
    { key: 'api_key', label: 'API Key' },
    { key: 'api_secret', label: 'API Secret' },
    { key: 'warehouse_code', label: 'รหัสคลัง/ลูกค้า' },
    { key: 'sender_name', label: 'ชื่อผู้ส่ง' },
    { key: 'sender_address', label: 'ที่อยู่ผู้ส่ง' },
    { key: 'sender_province', label: 'จังหวัด' },
    { key: 'sender_postcode', label: 'รหัสไปรษณีย์' },
    { key: 'sender_tel', label: 'เบอร์โทรผู้ส่ง' },
  ],
  ecommerce_platform: [
    { key: 'site_url', label: 'Store/Site URL' },
    { key: 'api_key', label: 'API Key' },
    { key: 'api_secret', label: 'API Secret' },
    { key: 'store_id', label: 'Store ID' },
  ],
  generative_ai: [{ key: 'api_key', label: 'API Key', prefixWithName: true }],
}

/** ฟิลด์เสริมที่ควร mask ตอนแสดงผล (ชื่อฟิลด์มีคำเหล่านี้ปนอยู่ ไม่สนตัวพิมพ์เล็ก-ใหญ่) — ฟิลด์ทั่วไปอย่าง Host/Port/ชื่อผู้ถือบัตร ไม่ต้อง mask */
const SENSITIVE_FIELD_KEYWORDS = ['secret', 'key', 'cvv', 'password', 'เลขบัตร']

export function isSensitiveFieldLabel(label: string): boolean {
  const lower = label.toLowerCase()
  return SENSITIVE_FIELD_KEYWORDS.some((k) => lower.includes(k))
}
