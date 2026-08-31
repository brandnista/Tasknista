-- Pronista §Meeting Schedule Tab (2026-08-27) — เตือนล่วงหน้าก่อนประชุมเริ่ม "ไม่ย้อนหลัง"
-- ทำเครื่องหมายผู้เข้าร่วมของประชุมที่เริ่มไปแล้วก่อน migration นี้ว่า "เตือนแล้ว" กันระเบิดแจ้งเตือนย้อนหลังตอน deploy
UPDATE `meeting_participants`
SET `reminded_at` = (unixepoch() * 1000)
WHERE `reminded_at` IS NULL
  AND `meeting_id` IN (SELECT `id` FROM `meetings` WHERE `start_at` < (unixepoch() * 1000));
