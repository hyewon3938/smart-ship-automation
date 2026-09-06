import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { migrateNextDayNationwide } from "./migrations";
import path from "path";
import fs from "fs";

// DB 경로 결정 우선순위:
// 1. SMART_SHIP_DB_PATH env (절대경로) — Next.js standalone 의 process.chdir 영향 회피용
// 2. process.cwd() + data/smart-ship.db — 로컬 개발 기본값
//
// 배경: Next.js standalone 의 server.js 가 시작 시 process.chdir(__dirname) 으로
// cwd 를 .next/standalone 로 바꿔버려서, PM2 의 cwd 설정을 덮어씀.
// process.cwd() 만 사용하면 standalone 모드에서 .next/standalone/data 에 별도 DB 가
// 생성되어 프로젝트 루트의 data 와 분리되는 문제가 발생함.
//
// 테스트 실행(VITEST)에서는 기본값으로 물러서지 않고 즉시 실패한다.
// 이 모듈은 import 되는 것만으로 ALTER TABLE 과 데이터 마이그레이션을 실행하므로,
// 기본값을 허용하면 테스트가 개발자의 실제 DB 를 고쳐버린다. (vitest.setup.ts 참고)
if (process.env.VITEST && !process.env.SMART_SHIP_DB_PATH) {
  throw new Error(
    "테스트에서 SMART_SHIP_DB_PATH 없이 DB 를 열려고 했습니다. " +
      "vitest.config.mts 의 setupFiles(vitest.setup.ts) 설정을 확인하세요.",
  );
}

export const DB_PATH = process.env.SMART_SHIP_DB_PATH
  ? process.env.SMART_SHIP_DB_PATH
  : path.join(process.cwd(), "data", "smart-ship.db");

// data 디렉토리 자동 생성
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

// 컬럼 존재 여부 확인 후 없으면 추가 (ALTER TABLE은 한 번에 하나씩)
function addColumnIfNotExists(
  table: string,
  column: string,
  definition: string,
) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  // 테이블 자체가 없으면 PRAGMA는 빈 배열을 주지만 ALTER TABLE은 예외를 던진다.
  // 스키마는 drizzle-kit push로 세우므로 새 DB 첫 기동에는 아직 없을 수 있다
  if (cols.length === 0) return;
  if (!cols.some((c) => c.name === column)) {
    sqlite
      .prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
      .run();
  }
}

addColumnIfNotExists("orders", "tracking_number", "TEXT");
addColumnIfNotExists("orders", "dispatch_status", "TEXT");
addColumnIfNotExists("orders", "dispatched_at", "TEXT");
addColumnIfNotExists("orders", "booked_at", "TEXT");

// 컬럼 추가 이후에 실행 — 재계산이 읽는 컬럼이 모두 있어야 한다
migrateNextDayNationwide(sqlite);

export const db = drizzle(sqlite, { schema });
