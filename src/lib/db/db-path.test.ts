import path from "path";

import { describe, expect, it, vi } from "vitest";

import { DB_PATH } from "@/lib/db";

/**
 * 회귀 방지: `@/lib/db`는 import 되는 것만으로 SQLite 파일을 열고 스키마 패치·데이터
 * 마이그레이션을 실행한다. 테스트가 그 대상을 실제 로컬 DB로 잡으면 개발용 데이터가
 * 조용히 바뀐다. 실제로 한 번 발생해서 이 테스트를 남긴다.
 */
describe("테스트 실행 시 DB 경로 격리", () => {
  const realDbPath = path.join(process.cwd(), "data", "smart-ship.db");

  it("실제 로컬 DB(data/smart-ship.db)를 열지 않는다", () => {
    expect(DB_PATH).not.toBe(realDbPath);
  });

  it("프로젝트의 data/ 디렉터리 밖을 가리킨다", () => {
    const dataDir = path.join(process.cwd(), "data") + path.sep;
    expect(path.resolve(DB_PATH).startsWith(dataDir)).toBe(false);
  });

  it("vitest.setup.ts가 지정한 임시 경로를 그대로 쓴다", () => {
    expect(DB_PATH).toBe(process.env.SMART_SHIP_DB_PATH);
  });

  it("SMART_SHIP_DB_PATH가 없으면 기본 경로로 물러서지 않고 실패한다", async () => {
    vi.resetModules();
    vi.stubEnv("SMART_SHIP_DB_PATH", "");
    try {
      await expect(import("@/lib/db")).rejects.toThrow(/SMART_SHIP_DB_PATH/);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
