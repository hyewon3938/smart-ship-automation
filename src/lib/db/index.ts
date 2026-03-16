import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "smart-ship.db");

// data 디렉토리 자동 생성
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

// 컬럼 존재 여부 확인 후 없으면 추가 (ALTER TABLE은 한 번에 하나씩)
function addColumnIfNotExists(table: string, column: string, definition: string) {
  const cols = sqlite
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    sqlite.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

addColumnIfNotExists("orders", "tracking_number", "TEXT");
addColumnIfNotExists("orders", "dispatch_status", "TEXT");
addColumnIfNotExists("orders", "dispatched_at", "TEXT");

export const db = drizzle(sqlite, { schema });
