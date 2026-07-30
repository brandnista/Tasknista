-- Tasknista §SRS import
ALTER TABLE `docs` ADD `srs_doc_number` text;
--> statement-breakpoint
ALTER TABLE `docs` ADD `srs_version` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `srs_ref_code` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `srs_source_code` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD `srs_doc_id` text REFERENCES docs(id);
--> statement-breakpoint
CREATE INDEX `tasks_srs_ref_idx` ON `tasks` (`srs_ref_code`);
