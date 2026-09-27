CREATE TABLE `booking_secondary_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`blocked_start_at` integer NOT NULL,
	`blocked_end_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_secondary_resources_booking_resource_uq` ON `booking_secondary_resources` (`booking_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `booking_secondary_resources_resource_blocked_idx` ON `booking_secondary_resources` (`resource_id`,`blocked_start_at`);--> statement-breakpoint
CREATE TABLE `service_secondary_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`service_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_secondary_resources_service_resource_uq` ON `service_secondary_resources` (`service_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `service_secondary_resources_resource_idx` ON `service_secondary_resources` (`resource_id`);