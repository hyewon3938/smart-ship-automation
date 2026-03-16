/**
 * 로컬 → 서버 동기화 유틸리티.
 *
 * DEPLOY_MODE=local(기본)이고 SERVER_URL + INTERNAL_API_KEY가 설정된 경우에만 동작.
 * 미설정 시 모든 함수는 즉시 false를 반환하여 기존 로컬 전용 동작을 유지한다.
 */

const getServerUrl = () => process.env.SERVER_URL;
const getApiKey = () => process.env.INTERNAL_API_KEY;

function canSync(): boolean {
  return (
    process.env.DEPLOY_MODE !== "server" &&
    !!getServerUrl() &&
    !!getApiKey()
  );
}

async function postToServer(endpoint: string, data: unknown): Promise<boolean> {
  if (!canSync()) return false;

  const url = `${getServerUrl()}${endpoint}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": getApiKey()!,
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[sync] 서버 동기화 실패 (${endpoint}): ${res.status} ${text.slice(0, 100)}`
      );
      return false;
    }

    console.log(`[sync] 서버 동기화 성공: ${endpoint}`);
    return true;
  } catch (err) {
    console.warn(
      `[sync] 서버 연결 실패 (${endpoint}):`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/** GS택배 예약 결과를 서버 DB에 동기화 */
export async function syncBookingResult(data: {
  orderId: string;
  status: "booked" | "failed";
  bookingResult?: string;
  bookingReservationNo?: string;
  error?: string;
}): Promise<boolean> {
  return postToServer("/api/internal/booking-result", data);
}

/** GS택배 로그인 쿠키를 서버에 동기화 (서버의 headless 스크래핑에 사용) */
export async function syncCookiesToServer(
  cookies: Array<Record<string, unknown>>
): Promise<boolean> {
  return postToServer("/api/internal/cookies", { cookies });
}
