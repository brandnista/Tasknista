/** Pronista §PRO-0040 — Project Key (รหัสอ้างอิงโปรเจกต์) แบบ Free Key
 *  ตัวอักษร A-Z / ตัวเลข คั่นด้วยขีด (-) ได้ เช่น MAK, MAK-DIN, MAK-RD · ยาว 2-12 ตัว · ห้ามขึ้นต้น/ลงท้าย/ติดกันสองขีด
 *  (เดิมบังคับ 3 ตัวเป๊ะ) ใช้เป็นคำนำหน้ารหัสงานตรงๆ เช่น MAK-DIN-0001 */
export const PROJECT_KEY_MIN = 2
export const PROJECT_KEY_MAX = 12
export const PROJECT_KEY_REGEX = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/

/** แปลงสิ่งที่ผู้ใช้พิมพ์ในช่อง Project Key ระหว่างพิมพ์: ตัวพิมพ์ใหญ่ · ตัดอักขระอื่นนอกจาก A-Z 0-9 และขีด ·
 *  ไม่ให้ขึ้นต้นด้วยขีดหรือขีดซ้อนกัน · เก็บขีดท้ายไว้ได้ชั่วคราว (กำลังพิมพ์ MAK- ต่อด้วย DIN) · จำกัดความยาว */
export function normalizeProjectKeyInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, PROJECT_KEY_MAX)
}

/** ค่าที่จะส่งบันทึก: ตัดขีดท้ายที่ค้างอยู่ออก */
export function finalizeProjectKey(raw: string): string {
  return normalizeProjectKeyInput(raw).replace(/-+$/, '')
}

export function isValidProjectKey(key: string): boolean {
  return key.length >= PROJECT_KEY_MIN && key.length <= PROJECT_KEY_MAX && PROJECT_KEY_REGEX.test(key)
}

/** คำนำหน้ารหัสงาน/เอกสารจาก Project Key (ข้อมูลเก่าที่ไม่ตรงรูปแบบก็ยังใช้ได้ — ล้างให้เหลือเฉพาะ A-Z 0-9 และขีด) ไม่มี → fallback */
export function projectKeyPrefix(raw: string | null | undefined, fallback: string): string {
  return finalizeProjectKey(raw ?? '') || fallback
}
