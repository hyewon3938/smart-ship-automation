import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";

import { migrateNextDayNationwide } from "./migrations";

function freshDb() {
  return new Database(":memory:");
}

function withTables(db: InstanceType<typeof Database>) {
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_address TEXT NOT NULL,
      recipient_address_detail TEXT,
      recipient_zip_code TEXT NOT NULL,
      status TEXT NOT NULL,
      is_next_day_eligible INTEGER NOT NULL DEFAULT 0,
      selected_delivery_type TEXT NOT NULL DEFAULT 'domestic',
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

describe("migrateNextDayNationwide", () => {
  it("테이블이 없으면 예외 없이 건너뛴다", () => {
    const db = freshDb();
    expect(() => migrateNextDayNationwide(db)).not.toThrow();
  });

  it("발송대기 주문을 새 기준으로 재계산한다", () => {
    const db = withTables(freshDb());
    const ins = db.prepare(
      `INSERT INTO orders (recipient_address, recipient_address_detail, recipient_zip_code, status, is_next_day_eligible, selected_delivery_type, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    ins.run("부산광역시 해운대구 우동", "101동", "48094", "pending", 0, "domestic", "x");
    ins.run("제주특별자치도 제주시 연동", null, "63122", "pending", 1, "nextDay", "x");
    ins.run("서울특별시 강남구 역삼동", null, "06234", "booked", 0, "nextDay", "x");
    ins.run("서울특별시 강남구 역삼동", null, "06234", "pending", 0, "visit", "x");

    migrateNextDayNationwide(db);

    const rows = db
      .prepare("SELECT id, is_next_day_eligible, selected_delivery_type FROM orders ORDER BY id")
      .all() as Array<{ id: number; is_next_day_eligible: number; selected_delivery_type: string }>;

    expect(rows[0]).toMatchObject({ is_next_day_eligible: 1, selected_delivery_type: "domestic" });
    expect(rows[1]).toMatchObject({ is_next_day_eligible: 0, selected_delivery_type: "domestic" });
    // 예약 완료 건은 그대로
    expect(rows[2]).toMatchObject({ is_next_day_eligible: 0, selected_delivery_type: "nextDay" });
    // 방문수령은 그대로
    expect(rows[3]).toMatchObject({ selected_delivery_type: "visit" });
  });

  it("두 번째 기동에서는 다시 돌지 않는다", () => {
    const db = withTables(freshDb());
    db.prepare(
      `INSERT INTO orders (recipient_address, recipient_zip_code, status, is_next_day_eligible, selected_delivery_type, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("부산광역시 해운대구 우동", "48094", "pending", 0, "domestic", "x");

    migrateNextDayNationwide(db);
    db.prepare("UPDATE orders SET selected_delivery_type = 'nextDay' WHERE id = 1").run();
    migrateNextDayNationwide(db);

    const row = db.prepare("SELECT selected_delivery_type FROM orders WHERE id = 1").get() as {
      selected_delivery_type: string;
    };
    expect(row.selected_delivery_type).toBe("nextDay");
  });
});
