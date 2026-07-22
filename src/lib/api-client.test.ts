import { afterEach, describe, expect, it, vi } from "vitest";

import { requestJson } from "./api-client";

/** requestJson 이 사용하는 Response 필드만 duck-typing 으로 흉내 낸다. */
function mockFetch(res: {
  ok?: boolean;
  status?: number;
  redirected?: boolean;
  url?: string;
  body?: string;
}) {
  const full = {
    ok: true,
    status: 200,
    redirected: false,
    url: "http://localhost:3000/api/x",
    body: "",
    ...res,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: full.ok,
      status: full.status,
      redirected: full.redirected,
      url: full.url,
      text: async () => full.body,
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestJson", () => {
  it("정상 JSON 응답을 파싱해 반환한다", async () => {
    mockFetch({ body: JSON.stringify({ message: "ok", count: 3 }) });
    await expect(requestJson("/api/x")).resolves.toEqual({
      message: "ok",
      count: 3,
    });
  });

  it("plain-text 500 응답에도 SyntaxError 대신 읽을 수 있는 에러를 던진다", async () => {
    // 재현했던 버그: 서버가 'Internal Server Error' 텍스트를 반환 → 기존엔
    // res.json() 이 "Unexpected token 'I'..." SyntaxError 를 던졌다.
    mockFetch({ ok: false, status: 500, body: "Internal Server Error" });
    await expect(requestJson("/api/x")).rejects.toThrow("서버 오류 (HTTP 500)");
  });

  it("에러 JSON 의 error 필드를 사용자 메시지로 사용한다", async () => {
    mockFetch({
      ok: false,
      status: 400,
      body: JSON.stringify({ error: "예약할 주문 ID 목록이 필요합니다" }),
    });
    await expect(requestJson("/api/x")).rejects.toThrow(
      "예약할 주문 ID 목록이 필요합니다",
    );
  });

  it("error 필드가 없으면 message 필드를 메시지로 사용한다 (연결 테스트 실패 등)", async () => {
    mockFetch({
      ok: false,
      status: 400,
      body: JSON.stringify({ success: false, message: "네이버 인증 실패" }),
    });
    await expect(requestJson("/api/x")).rejects.toThrow("네이버 인증 실패");
  });

  it("/login 리다이렉트(세션 만료)를 감지해 안내 메시지를 던진다", async () => {
    mockFetch({
      redirected: true,
      url: "http://localhost:3000/login",
      body: "<!DOCTYPE html>",
    });
    await expect(requestJson("/api/x")).rejects.toThrow("세션이 만료");
  });

  it("네트워크 단절(fetch reject) 시 연결 실패 메시지를 던진다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(requestJson("/api/x")).rejects.toThrow(
      "서버에 연결할 수 없습니다",
    );
  });
});
