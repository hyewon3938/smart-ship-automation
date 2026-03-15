import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: text("order_id").notNull(),
  productOrderId: text("product_order_id").notNull().unique(),
  orderDate: text("order_date").notNull(),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  optionInfo: text("option_info"),
  totalPrice: integer("total_price"),
  recipientName: text("recipient_name").notNull(),
  recipientPhone: text("recipient_phone").notNull(),
  recipientAddress: text("recipient_address").notNull(),
  recipientZipCode: text("recipient_zip_code").notNull(),
  status: text("status", {
    enum: ["pending", "booking", "booked", "failed", "skipped"],
  })
    .notNull()
    .default("pending"),
  isNextDayEligible: integer("is_next_day_eligible", { mode: "boolean" })
    .notNull()
    .default(false),
  selectedDeliveryType: text("selected_delivery_type", {
    enum: ["domestic", "nextDay"],
  })
    .notNull()
    .default("domestic"),
  bookingResult: text("booking_result"),
  bookingReservationNo: text("booking_reservation_no"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const bookingLogs = sqliteTable("booking_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").references(() => orders.id),
  action: text("action").notNull(),
  detail: text("detail"),
  screenshotPath: text("screenshot_path"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
