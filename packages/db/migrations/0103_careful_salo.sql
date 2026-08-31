ALTER TABLE `domains` ADD `notify_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `domains` ADD `nameservers` text;--> statement-breakpoint
ALTER TABLE `domains` ADD `forwarding_url` text;--> statement-breakpoint
ALTER TABLE `domains` ADD `forwarding_type` text;--> statement-breakpoint
ALTER TABLE `domains` ADD `dns_records` text;--> statement-breakpoint
ALTER TABLE `domains` ADD `privacy_protection_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `domains` ADD `google_workspace_verified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `domains` ADD `google_workspace_notes` text;--> statement-breakpoint
ALTER TABLE `domains` ADD `ds_records` text;