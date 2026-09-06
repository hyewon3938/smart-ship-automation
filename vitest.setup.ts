import fs from "fs";
import os from "os";
import path from "path";

import { afterAll } from "vitest";

/**
 * `src/lib/db/index.ts` 는 import 되는 것만으로 SQLite 파일을 열고 ALTER TABLE 과
 * 데이터 마이그레이션을 실행한다. 테스트가 그 모듈을 (전이적으로라도) 로드하면
 * 개발용 `data/smart-ship.db` 에 스키마 패치와 데이터 변경이 들어간다.
 *
 * 그래서 모듈 그래프가 로드되기 전에 임시 DB 경로를 강제한다. setupFiles 는 테스트
 * 파일마다 실행되므로 파일 간에도 DB 가 섞이지 않는다.
 *
 * 이 임시 DB 는 테이블이 없는 빈 파일이다. 스키마는 `drizzle-kit push` 가 세우고
 * `drizzle/*.sql` 은 현재 스키마를 따라오지 못해서(예: recipient_address_detail),
 * 그 파일로 채우면 오히려 실제와 다른 스키마가 된다. 빈 DB 로 두면
 * `addColumnIfNotExists` 와 `migrateNextDayNationwide` 의 테이블 존재 검사가 걸려
 * 조용히 지나간다. DB 를 실제로 읽고 쓰는 테스트는 `migrations.test.ts` 처럼
 * `:memory:` DB 에 필요한 테이블을 직접 만들어 쓴다.
 */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "smart-ship-test-"));

process.env.SMART_SHIP_DB_PATH = path.join(tmpDir, "smart-ship.db");

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
