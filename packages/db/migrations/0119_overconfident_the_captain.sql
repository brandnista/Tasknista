ALTER TABLE `users` ADD `vault_pin_failed_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `vault_pin_locked_until` integer;