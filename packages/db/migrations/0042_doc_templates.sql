-- Pronista §Document Template — เพิ่ม kind='template' บน docs + ตารางเก็บข้อมูลที่กรอกจริง (โครงสร้าง template เองอยู่ในโค้ด ไม่ใช่ DB)
ALTER TABLE `docs` ADD `template_type` text;
--> statement-breakpoint
ALTER TABLE `docs` ADD `template_doc_number` text;
--> statement-breakpoint
CREATE TABLE `doc_template_values` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`template_type` text NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `docs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doc_template_values_doc_uq_idx` ON `doc_template_values` (`doc_id`);
