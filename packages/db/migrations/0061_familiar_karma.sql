ALTER TABLE `company_config` ADD `service_types` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `service_type` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `service_start_date` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `service_end_date` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `notify_before_days` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `expiry_notified_at` integer;--> statement-breakpoint
-- Pronista §Subscription Notify — seed 5 ประเภทโปรเจกต์เริ่มต้นตามที่พี่กำหนด (แก้ไข/เพิ่ม/ลบได้ที่ตั้งค่าภายหลัง)
UPDATE company_config SET service_types = '[{"id":"svc_website_dev","name":"Website Development","sortOrder":0},{"id":"svc_mobile_app","name":"Mobile Application Development","sortOrder":1},{"id":"svc_digital_marketing","name":"Digital Marketing","sortOrder":2},{"id":"svc_digital_production","name":"Digital Production","sortOrder":3},{"id":"svc_ecommerce_mgmt","name":"E-Commerce Management","sortOrder":4}]' WHERE id = 1;