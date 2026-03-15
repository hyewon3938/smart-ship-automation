CREATE TABLE `booking_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer,
	`action` text NOT NULL,
	`detail` text,
	`screenshot_path` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` text NOT NULL,
	`product_order_id` text NOT NULL,
	`order_date` text NOT NULL,
	`product_name` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`option_info` text,
	`total_price` integer,
	`recipient_name` text NOT NULL,
	`recipient_phone` text NOT NULL,
	`recipient_address` text NOT NULL,
	`recipient_zip_code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`is_next_day_eligible` integer DEFAULT false NOT NULL,
	`selected_delivery_type` text DEFAULT 'domestic' NOT NULL,
	`booking_result` text,
	`booking_reservation_no` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_product_order_id_unique` ON `orders` (`product_order_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
