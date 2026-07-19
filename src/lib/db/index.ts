import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
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
const DB_PATH = process.env.SMART_SHIP_DB_PATH
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

export const db = drizzle(sqlite, { schema });
