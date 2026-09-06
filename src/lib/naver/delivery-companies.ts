/**
 * 네이버 커머스 API 택배사 코드.
 *
 * 이 모듈은 의존성이 없다 (settings.ts ↔ naver/auth.ts 순환 참조 회피).
 */

/** 택배 유형별 택배사 코드 */
export const DELIVERY_COMPANY_CODES = {
  /** CJ대한통운 — GS편의점택배(국내택배)의 실제 배송사 */
  domestic: "CJGLS",
  /**
   * CJ대한통운 — 내일배송의 실제 배송사.
   *
   * 2026-09 배송사 변경으로 국내택배와 같은 값이 됐다. 값이 같아도 상수는
   * 나눠 둔다 — 내일배송 쪽은 설정으로 덮어쓸 수 있는 값이고, 다시 갈라질
   * 여지가 있다.
   */
  nextDay: "CJGLS",
} as const;

/**
 * 폐기된 내일배송 코드.
 *
 * DB(settings)에 이 값들이 남아 있으면 기본값으로 되돌린다. 로컬·서버 DB가
 * 따로 있어 한쪽만 고치면 조용히 옛 코드로 계속 발송된다.
 *
 * - DELIVERBOX: 실제 코드를 확인하기 전 넣어둔 자리표시자. 네이버가 거절한다.
 * - JMNP: 딜리박스. 2026-09 배송사 변경 전까지 쓰던 값. 네이버가 받아주기
 *   때문에 남아 있어도 에러가 나지 않고, 구매자에게 추적되지 않는 운송장이
 *   전달되는 것으로만 드러난다.
 */
const RETIRED_NEXT_DAY_CODES: ReadonlySet<string> = new Set([
  "DELIVERBOX",
  "JMNP",
]);

/** 저장된 내일배송 코드를 사용 가능한 값으로 정규화 */
export function normalizeNextDayDeliveryCode(stored: string | null): string {
  if (!stored || RETIRED_NEXT_DAY_CODES.has(stored)) {
    return DELIVERY_COMPANY_CODES.nextDay;
  }
  return stored;
}
