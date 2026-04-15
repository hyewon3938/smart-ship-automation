import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { maskId, maskName, maskPhone } from "./log-mask";

describe("log-mask (production)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maskId: 9자 이상은 앞 4 + *** + 뒤 4", () => {
    expect(maskId("2024020112345678")).toBe("2024***5678");
    expect(maskId("123456789")).toBe("1234***6789");
  });

  it("maskId: 짧은 ID는 첫/끝 글자만 노출", () => {
    expect(maskId("abc12345")).toBe("a******5");
    expect(maskId("abc")).toBe("a*c");
    expect(maskId("ab")).toBe("**");
    expect(maskId("a")).toBe("*");
  });

  it("maskId: 빈 값 처리", () => {
    expect(maskId(null)).toBe("");
    expect(maskId(undefined)).toBe("");
    expect(maskId("")).toBe("");
  });

  it("maskName: 첫 글자만 노출", () => {
    expect(maskName("홍길동")).toBe("홍**");
    expect(maskName("김")).toBe("김");
    expect(maskName("Alice")).toBe("A****");
  });

  it("maskPhone: 가운데 자리 마스킹", () => {
    expect(maskPhone("010-1234-5678")).toBe("010-****-5678");
    expect(maskPhone("01012345678")).toBe("010-****-5678");
    expect(maskPhone("010 1234 5678")).toBe("010-****-5678");
  });
});

describe("log-mask (development)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("개발 환경에서는 원본 그대로 반환", () => {
    expect(maskId("2024020112345678")).toBe("2024020112345678");
    expect(maskName("홍길동")).toBe("홍길동");
    expect(maskPhone("010-1234-5678")).toBe("010-1234-5678");
  });
});
