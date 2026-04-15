import { join, sep } from "path";
import { describe, expect, it } from "vitest";

import { resolveScreenshotPath } from "./route";

const DIR = join(process.cwd(), "data", "screenshots");

describe("resolveScreenshotPath", () => {
  it("허용된 png 파일명은 절대 경로를 반환", () => {
    expect(resolveScreenshotPath("foo.png")).toBe(join(DIR, "foo.png"));
  });

  it("허용된 jpg/jpeg도 통과", () => {
    expect(resolveScreenshotPath("a.jpg")).toBe(join(DIR, "a.jpg"));
    expect(resolveScreenshotPath("b.jpeg")).toBe(join(DIR, "b.jpeg"));
  });

  it("대문자 확장자도 허용", () => {
    expect(resolveScreenshotPath("foo.PNG")).toBe(join(DIR, "foo.PNG"));
  });

  it("디렉토리 상위 이동(..)은 차단", () => {
    expect(resolveScreenshotPath("../secret.png")).toBeNull();
    expect(resolveScreenshotPath("..")).toBeNull();
  });

  it("슬래시/백슬래시 포함 파일명은 차단", () => {
    expect(resolveScreenshotPath("sub/foo.png")).toBeNull();
    expect(resolveScreenshotPath("sub\\foo.png")).toBeNull();
  });

  it("널 바이트 차단", () => {
    expect(resolveScreenshotPath("foo\0.png")).toBeNull();
  });

  it("확장자 화이트리스트 외 거부", () => {
    expect(resolveScreenshotPath("foo.txt")).toBeNull();
    expect(resolveScreenshotPath("foo.exe")).toBeNull();
    expect(resolveScreenshotPath("foo")).toBeNull();
  });

  it("빈 문자열 거부", () => {
    expect(resolveScreenshotPath("")).toBeNull();
  });

  it("절대 경로 입력은 prefix 검증에서 차단", () => {
    expect(resolveScreenshotPath("/etc/passwd.png")).toBeNull();
  });

  it("결과 경로는 SCREENSHOTS_DIR prefix 하위에 위치", () => {
    const result = resolveScreenshotPath("foo.png");
    expect(result).not.toBeNull();
    expect(result!.startsWith(DIR + sep)).toBe(true);
  });
});
