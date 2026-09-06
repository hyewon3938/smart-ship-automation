/**
 * 런타임 데이터 마이그레이션.
 *
 * 스키마(테이블·컬럼)는 `drizzle-kit push`와 index.ts의 addColumnIfNotExists가
 * 맡는다. 여기서는 판별 기준이 바뀌었을 때 이미 저장된 행을 다시 계산한다.
 * 로컬·서버 DB가 따로 있어 각자 기동 시 한 번씩 돈다.
 */
import type BetterSqlite3 from "better-sqlite3";

import { isNextDayDeliveryEligible } from "@/lib/naver/regions";

/** 마이그레이션 완료 마커 키 */
const MIGRATION_KEY = "migration.nextDayNationwide";

/** 테이블 존재 여부 */
function hasTable(sqlite: BetterSqlite3.Database, name: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return row !== undefined;
}

/**
 * 내일배송 권역 전국 확대 반영 — 발송대기·실패 주문의 가능 여부를 다시 계산한다.
 *
 * 예약이 끝난 주문(booked·dispatched)은 건드리지 않는다. 이미 그 기준으로
 * 접수됐고, 지금 값을 바꾸면 실제 발송과 화면이 어긋난다.
 */
export function migrateNextDayNationwide(sqlite: BetterSqlite3.Database): void {
  // 테이블은 drizzle-kit push로 만든다 — 런타임에 스키마를 세우는 코드가 없어서
  // 새 DB 첫 기동 때는 아직 없을 수 있다. 그 경우 재계산할 주문도 없으므로
  // 조용히 건너뛴다. (PRAGMA와 달리 SELECT는 테이블이 없으면 예외를 던진다)
  if (!hasTable(sqlite, "settings") || !hasTable(sqlite, "orders")) return;

  const done = sqlite
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(MIGRATION_KEY) as { value: string } | undefined;
  if (done) return;

  const targets = sqlite
    .prepare(
      `SELECT id, recipient_address, recipient_address_detail, recipient_zip_code
         FROM orders
        WHERE status IN ('pending', 'failed')
          AND selected_delivery_type != 'visit'`,
    )
    .all() as Array<{
    id: number;
    recipient_address: string;
    recipient_address_detail: string | null;
    recipient_zip_code: string | null;
  }>;

  const update = sqlite.prepare(
    `UPDATE orders
        SET is_next_day_eligible = ?,
            selected_delivery_type = 'domestic',
            updated_at = ?
      WHERE id = ?`,
  );
  const now = new Date().toISOString();

  const run = sqlite.transaction(() => {
    for (const row of targets) {
      const fullAddress =
        `${row.recipient_address} ${row.recipient_address_detail ?? ""}`.trim();
      const eligible = isNextDayDeliveryEligible(
        fullAddress,
        row.recipient_zip_code,
      );
      update.run(eligible ? 1 : 0, now, row.id);
    }
    sqlite
      .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
      .run(MIGRATION_KEY, now, now);
  });

  run();

  if (targets.length > 0) {
    console.log(
      `[migration] 내일배송 전국 확대 반영 — 발송대기·실패 주문 ${targets.length}건 재계산`,
    );
  }
}
