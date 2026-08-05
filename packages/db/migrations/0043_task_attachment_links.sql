-- Pronista §attachment links — task_attachments รองรับลิงก์ภายนอก (Google Docs/Figma/Canva/อื่นๆ) นอกเหนือจากไฟล์อัปโหลด
-- 1 แถวเป็นได้ทั้งไฟล์ (r2_key มีค่า) หรือลิงก์ (external_url มีค่า) — ทำ r2_key/mime/size_bytes ให้ nullable ได้
-- task_attachments ไม่มีตารางอื่นอ้าง FK เข้ามา (ไม่ใช่ FK target) — rebuild ตรงๆ ได้เลยไม่ต้อง backup/restore แบบตาราง sprints
CREATE TABLE `__new_task_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`r2_key` text,
	`filename` text NOT NULL,
	`mime` text,
	`size_bytes` integer,
	`external_url` text,
	`link_type` text,
	`uploaded_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_task_attachments`("id", "task_id", "r2_key", "filename", "mime", "size_bytes", "uploaded_by", "created_at") SELECT "id", "task_id", "r2_key", "filename", "mime", "size_bytes", "uploaded_by", "created_at" FROM `task_attachments`;
--> statement-breakpoint
DROP TABLE `task_attachments`;
--> statement-breakpoint
ALTER TABLE `__new_task_attachments` RENAME TO `task_attachments`;
--> statement-breakpoint
CREATE INDEX `task_attachments_task_idx` ON `task_attachments` (`task_id`);
