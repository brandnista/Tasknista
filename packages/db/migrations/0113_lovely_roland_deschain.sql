CREATE TABLE `sellnista_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`expiry_date` text NOT NULL,
	`notify_enabled` integer DEFAULT true NOT NULL,
	`notified_tiers` text,
	`expired_notified_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sellnista_subscriptions_expiry_idx` ON `sellnista_subscriptions` (`expiry_date`);--> statement-breakpoint
ALTER TABLE `notifications` ADD `sellnista_subscription_id` text REFERENCES sellnista_subscriptions(id);