import { describe, it, expect, beforeEach, vi } from "vitest";

// DB 인메모리 store
const store: Record<string, string> = {};

// Drizzle ORM 체인 패턴 모킹
vi.mock("drizzle-orm", () => ({
  eq: (_field: unknown, value: string) => value, // eq는 key값을 그대로 반환 (where에서 사용)
}));

vi.mock("@/lib/db/schema", () => ({
  settings: { key: "key", value: "value", updatedAt: "updatedAt" },
}));

vi.mock("@/lib/db", () => {
  // where에 전달된 값(= key string)을 캡처
  let capturedKey = "";
  let capturedValues: Record<string, string> = {};

  const chain = {
    from: () => chain,
    where: (key: string) => { capturedKey = key; return chain; },
    get: () => {
      const value = store[capturedKey];
      return value !== undefined ? { key: capturedKey, value } : undefined;
    },
    set: (vals: Record<string, string>) => { capturedValues = vals; return chain; },
    run: () => {
      if (capturedValues.value !== undefined) {
        store[capturedKey] = capturedValues.value;
      }
      capturedValues = {};
    },
    values: (vals: { key: string; value: string }) => {
      capturedKey = vals.key;
      capturedValues = { value: vals.value };
      return chain;
    },
  };

  return {
    db: {
      select: () => chain,
      update: () => chain,
      insert: () => chain,
    },
  };
});

import {
  getConfigValue,
  getAllSettings,
  updateNaverSettings,
  updateGsSettings,
  getSetting,
  setSetting,
} from "@/lib/settings";

describe("getConfigValue", () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
  });

  it("DB 값이 있으면 DB 값을 반환한다", () => {
    setSetting("test.key", "dbValue");
    expect(getConfigValue("test.key", "TEST_KEY")).toBe("dbValue");
  });

  it("DB 값이 없으면 env 폴백을 반환한다", () => {
    process.env.TEST_FALLBACK = "envValue";
    expect(getConfigValue("missing.key", "TEST_FALLBACK")).toBe("envValue");
    delete process.env.TEST_FALLBACK;
  });

  it("DB 값도 env도 없으면 null을 반환한다", () => {
    expect(getConfigValue("missing.key", "MISSING_ENV_XYZ")).toBeNull();
  });
});

describe("getAllSettings 마스킹", () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
  });

  it("clientSecret은 마스킹하여 반환한다", () => {
    setSetting("naver.clientId", "myClientId");
    setSetting("naver.clientSecret", "verylongsecretvalue");
    const s = getAllSettings();
    expect(s.naver.clientId).toBe("myClientId");
    expect(s.naver.clientSecret).toBe("****alue");
    expect(s.naver.clientSecret).not.toContain("verylongsecret");
  });

  it("password는 마스킹하여 반환한다", () => {
    setSetting("gs.username", "user123");
    setSetting("gs.password", "mypassword");
    const s = getAllSettings();
    expect(s.gs.username).toBe("user123");
    expect(s.gs.password).toBe("****word");
  });

  it("비밀값이 4자 이하면 ****만 반환한다", () => {
    setSetting("naver.clientSecret", "abc");
    const s = getAllSettings();
    expect(s.naver.clientSecret).toBe("****");
  });

  it("비밀값이 없으면 빈 문자열을 반환한다", () => {
    const s = getAllSettings();
    expect(s.naver.clientSecret).toBe("");
  });
});

describe("updateNaverSettings 마스킹 값 유지", () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    setSetting("naver.clientSecret", "originalSecret");
  });

  it("마스킹 값(****)이면 기존 secret을 유지한다", () => {
    updateNaverSettings({ clientId: "newId", clientSecret: "****cret" });
    expect(getSetting("naver.clientSecret")).toBe("originalSecret");
  });

  it("새 값이면 secret을 업데이트한다", () => {
    updateNaverSettings({ clientId: "newId", clientSecret: "newSecret" });
    expect(getSetting("naver.clientSecret")).toBe("newSecret");
  });
});

describe("updateGsSettings 마스킹 값 유지", () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    setSetting("gs.password", "originalPassword");
  });

  it("마스킹 값(****)이면 기존 password를 유지한다", () => {
    updateGsSettings({ username: "user", password: "****word" });
    expect(getSetting("gs.password")).toBe("originalPassword");
  });

  it("새 값이면 password를 업데이트한다", () => {
    updateGsSettings({ username: "user", password: "newPass" });
    expect(getSetting("gs.password")).toBe("newPass");
  });
});
