import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkRateLimit, getClientIp, resetRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("윈도우 내 최대 시도 횟수까지는 허용", () => {
    const key = `k1-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true);
    }
  });

  it("초과 시 차단 + retryAfterSec 제공", () => {
    const key = `k2-${Math.random()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 60_000);
    const result = checkRateLimit(key, 3, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  it("윈도우 경과 후 카운터 리셋", () => {
    const key = `k3-${Math.random()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 60_000);
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true);
  });

  it("resetRateLimit 호출 시 카운터 초기화", () => {
    const key = `k4-${Math.random()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 60_000);
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(false);

    resetRateLimit(key);
    expect(checkRateLimit(key, 3, 60_000).allowed).toBe(true);
  });

  it("다른 키는 독립적으로 카운트됨", () => {
    const k1 = `k5a-${Math.random()}`;
    const k2 = `k5b-${Math.random()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(k1, 3, 60_000);
    expect(checkRateLimit(k1, 3, 60_000).allowed).toBe(false);
    expect(checkRateLimit(k2, 3, 60_000).allowed).toBe(true);
  });
});

describe("getClientIp", () => {
  it("X-Forwarded-For 첫 번째 IP 추출", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("203.0.113.1");
  });

  it("X-Forwarded-For 없으면 X-Real-IP 사용", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "203.0.113.2" },
    });
    expect(getClientIp(req)).toBe("203.0.113.2");
  });

  it("헤더 없으면 unknown", () => {
    const req = new Request("http://localhost");
    expect(getClientIp(req)).toBe("unknown");
  });
});
