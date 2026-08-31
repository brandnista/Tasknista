/** ชนิดไฟล์ที่ browser เปิดดูตรงๆ ได้อย่างปลอดภัย (inline) — นอกเหนือจากนี้บังคับ attachment เสมอ (รวม svg+xml ที่ฝังสคริปต์ได้)
 * ใช้ร่วมกันทุกจุดที่ดาวน์โหลดไฟล์ที่ผู้ใช้อัปโหลดเอง (my-files.ts, my-notes.ts attachments) กันรายการหลุดไม่ตรงกัน */
export const INLINE_SAFE_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'])
