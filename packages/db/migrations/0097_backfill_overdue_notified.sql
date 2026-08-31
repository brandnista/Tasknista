-- Pronista §Notification overhaul (2026-08-27) — เตือนงานเลยกำหนดครั้งเดียวตอนเลยกำหนดวันแรก "ไม่ย้อนหลัง"
-- ทำเครื่องหมายงานที่เลยกำหนดอยู่แล้วก่อน migration นี้ว่า "แจ้งเตือนแล้ว" กันระเบิดแจ้งเตือนพร้อมกันทั้งหมดตอน deploy
UPDATE `tasks`
SET `due_notified_at` = (unixepoch() * 1000)
WHERE `due_date` IS NOT NULL
  AND `due_date` < date('now')
  AND `status` != 'done'
  AND `due_notified_at` IS NULL;
