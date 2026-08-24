CREATE TABLE `member_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`fee_satang` integer NOT NULL,
	`ordered_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `member_orders_member_idx` ON `member_orders` (`member_id`);--> statement-breakpoint
CREATE TABLE `member_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`order_id` text NOT NULL,
	`amount_satang` integer NOT NULL,
	`paid_at` integer NOT NULL,
	`method` text,
	`status` text DEFAULT 'success' NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `member_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `member_payments_member_idx` ON `member_payments` (`member_id`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`classification_type` text NOT NULL,
	`org_size_tier_id` text,
	`business_name` text,
	`phone` text,
	`email` text,
	`membership_mode` text DEFAULT 'lifetime' NOT NULL,
	`start_date` text,
	`end_date` text,
	`notify_before_days` integer,
	`expiry_notified_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `members_status_idx` ON `members` (`status`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notes_user_idx` ON `notes` (`user_id`);--> statement-breakpoint
ALTER TABLE `company_config` ADD `membership_fees` text;--> statement-breakpoint
ALTER TABLE `company_config` ADD `member_org_size_tiers` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `member_id` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `users` ADD `classification_type` text;