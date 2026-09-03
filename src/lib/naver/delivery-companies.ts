/**
 * 네이버 커머스 API 택배사 코드.
 *
 * 이 모듈은 의존성이 없다 (settings.ts ↔ naver/auth.ts 순환 참조 회피).
 */

/** 택배 유형별 택배사 코드 */
export const DELIVERY_COMPANY_CODES = {
  /** CJ대한통운 — GS편의점택배(국내택배)의 실제 배송사 */
  domestic: "CJGLS",
  /** 딜리박스 — GS편의점 내일배송의 실제 배송사 */
  nextDay: "JMNP",
} as const;

/**
 * 폐기된 내일배송 코드.
 *
 * 실제 코드를 확인하기 전 자리표시자로 넣어둔 값이라 네이버가 받아주지 않는다.
 * DB(settings)에 이 값이 남아 있으면 기본값으로 되돌린다 — 로컬·서버 DB가
 * 따로 있어 한쪽만 고치면 조용히 다시 실패한다.
 */
const RETIRED_NEXT_DAY_CODES: ReadonlySet<string> = new Set(["DELIVERBOX"]);

/** 저장된 내일배송 코드를 사용 가능한 값으로 정규화 */
export function normalizeNextDayDeliveryCode(stored: string | null): string {
  if (!stored || RETIRED_NEXT_DAY_CODES.has(stored)) {
    return DELIVERY_COMPANY_CODES.nextDay;
  }
  return stored;
}
