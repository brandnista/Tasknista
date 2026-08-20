ALTER TABLE `estimate_extra_costs` ADD `category` text DEFAULT 'opex' NOT NULL;--> statement-breakpoint
ALTER TABLE `estimate_extra_costs` ADD `net_cost_satang` integer;--> statement-breakpoint
ALTER TABLE `estimate_extra_costs` ADD `quotation_satang` integer;--> statement-breakpoint
UPDATE `estimate_extra_costs` SET `net_cost_satang` = `amount_satang`;