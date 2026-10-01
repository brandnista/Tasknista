CREATE INDEX `audit_entity_id_at_idx` ON `audit_logs` (`entity_id`,`at`);--> statement-breakpoint
CREATE INDEX `notifications_user_created_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_reviewer_idx` ON `tasks` (`reviewer_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_id`);