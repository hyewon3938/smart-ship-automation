/**
 * 운송장 스크래핑 허용 시간대 (KST).
 *
 * 하한이 8시인 이유: 스크래핑은 "처리할 booked 주문이 있을 때만" 돈다
 * (checkAndDispatch의 `reservationNos.length > 0 && isWithinScrapeWindow()` 조건).
 * 따라서 하한을 낮춰도 평소(11시 이후 예약)엔 아침에 처리할 주문이 없어
 * 스크래핑하지 않는다 → 사실상 11시부터 동작. 반면 아침 일찍 예약한 날은
 * 그 시각부터 폴링이 돌아 (1) 운송장을 일찍 잡고 (2) 2분 간격 요청이
 * GS 세션을 keep-alive 해서 idle 만료를 막는다.
 * → 날짜별 동적 윈도우 로직 없이 "아침 예약 날만 당겨지는" 효과를 얻는다.
 *
 * 서버(dispatch-worker)와 클라이언트(설정 탭 안내)가 공유하는 순수 상수/함수.
 * DB 접근이 없어 클라이언트 번들에 안전하게 포함된다.
 */
export const SCRAPE_START_HOUR = 8; // 오전 8시
export const SCRAPE_END_HOUR = 18; // 오후 6시

/** 현재 시간이 스크래핑 허용 시간대인지 확인 */
export function isWithinScrapeWindow(): boolean {
  const now = new Date();
  const kstHour = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }),
  ).getHours();
  return kstHour >= SCRAPE_START_HOUR && kstHour < SCRAPE_END_HOUR;
}
