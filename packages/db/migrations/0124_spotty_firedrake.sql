ALTER TABLE `calendar_connections` ADD `user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `connection_id` text REFERENCES calendar_connections(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `start_at` integer;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `end_at` integer;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `all_day` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `busy` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `private` integer DEFAULT false NOT NULL;