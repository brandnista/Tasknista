-- Tasknista §Document Version History — เพิ่มเลขที่เอกสาร (เล่ม) + เวอร์ชัน แบบ general ให้ docs ทุกประเภท/ทุก kind
-- backfill จากคอลัมน์เดิม: template_doc_number / srs_doc_number -> doc_number, srs_version -> doc_version
ALTER TABLE `docs` ADD `doc_number` text;--> statement-breakpoint
ALTER TABLE `docs` ADD `doc_version` text;--> statement-breakpoint
UPDATE `docs` SET `doc_number` = COALESCE(`template_doc_number`, `srs_doc_number`) WHERE `doc_number` IS NULL;--> statement-breakpoint
UPDATE `docs` SET `doc_version` = `srs_version` WHERE `doc_version` IS NULL;
