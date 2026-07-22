/**
 * 클라이언트 → 내부 API 요청 공용 헬퍼.
 *
 * 서버가 정상 JSON 이 아닌 응답을 돌려줘도 절대 `SyntaxError` 를 던지지 않고
 * 사람이 읽을 수 있는 `Error` 로 변환한다. 다음 비정상 응답을 모두 흡수한다:
 *  - 런타임/프록시 오류로 인한 plain-text `Internal Server Error` (500)
 *  - 세션 만료로 인한 `/login` 리다이렉트 (프록시 인증 가드)
 *  - 네트워크 단절 (fetch 자체가 reject)
 *
 * 이로써 "Unexpected token 'I', "Internal S"... is not valid JSON" 같은
 * 정체불명 메시지가 사용자에게 노출되는 것을 막는다.
 */
export async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    throw new Error("서버에 연결할 수 없습니다. 네트워크 상태를 확인해주세요.");
  }

  // 프록시 인증 가드가 세션 만료/부재 시 /login 으로 리다이렉트한 경우.
  // (fetch 는 기본적으로 리다이렉트를 따라가므로 res.redirected 로 감지)
  if (res.redirected) {
    try {
      if (new URL(res.url).pathname.startsWith("/login")) {
        throw new Error("세션이 만료되었습니다. 다시 로그인해주세요.");
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("세션이")) throw e;
      // URL 파싱 실패는 무시하고 아래 일반 처리로
    }
  }

  // 본문을 텍스트로 먼저 읽고 JSON 파싱은 안전하게 시도 (실패해도 throw 하지 않음)
  const raw = await res.text();
  let data: unknown = undefined;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    // 서버가 담아준 사람용 메시지를 우선 사용한다.
    // 대부분 라우트는 { error }, 일부(설정 연결 테스트 등)는 { message } 로 준다.
    const serverMessage =
      data && typeof data === "object"
        ? ((data as Record<string, unknown>).error ??
          (data as Record<string, unknown>).message)
        : undefined;
    throw new Error(
      serverMessage ? String(serverMessage) : `서버 오류 (HTTP ${res.status})`,
    );
  }

  return data as T;
}
