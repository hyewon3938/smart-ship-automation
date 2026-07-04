import { GS_SCRAPE_HEADERS, loadCookieHeader } from "./scrape-tracking";
import { GS_URLS } from "./selectors";

/**
 * GS택배 세션이 실제로 살아있는지 확인한다.
 *
 * `checkCookieValidity()`는 쿠키 **파일 나이**만 검사하므로, 파일은 신선한데
 * 세션이 idle로 죽은 경우(예: 저녁에 폴링이 없어 keep-alive가 끊긴 상태)를
 * "유효"로 오판한다. 이 함수는 예약조회 페이지를 실제 fetch하여
 * 200(살아있음) / 302(만료)로 세션 상태를 실측한다.
 *
 * 버튼 클릭 시(on-demand)에만 호출되므로 봇 감지 부담이 낮다.
 *
 * @returns 세션이 살아있으면 true, 만료·쿠키 없음·네트워크 오류면 false
 */
export async function probeGsSession(): Promise<boolean> {
  const cookieHeader = loadCookieHeader();
  if (!cookieHeader) return false;

  try {
    const res = await fetch(GS_URLS.RESERVATION_LIST, {
      headers: { Cookie: cookieHeader, ...GS_SCRAPE_HEADERS },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
