-- Pronista §Daily Report multi-recipient — backfill: รายงานเก่าที่มี recipient_id เดี่ยว ย้ายเข้าตาราง daily_report_recipients
-- reviewed_at ของแถวใหม่ = reviewed_at เดิมของรายงาน (ถ้า status='reviewed') ไม่งั้น null
INSERT INTO daily_report_recipients (id, report_id, recipient_id, reviewed_at, created_at)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
  id, recipient_id, CASE WHEN status = 'reviewed' THEN reviewed_at ELSE NULL END, created_at
FROM daily_reports
WHERE recipient_id IS NOT NULL;
