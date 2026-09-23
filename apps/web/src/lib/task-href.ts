/** Pronista §Task ID URL Slug (2026-09-23) — ลิงก์ใหม่ใช้รหัสงานที่อ่านง่าย (เช่น PRO-TSK-0001) แทน UUID
 * ลิงก์ UUID เดิมยังเปิดได้ตลอดไป (backend รองรับทั้งคู่ที่ GET /tasks/:id/detail) — ใช้ id แทนเฉพาะตอนไม่มี code (เช่น งานเก่าบางตัว) */
export const taskHref = (t: { id: string; code?: string | null }) => `/tasks/${t.code || t.id}`
