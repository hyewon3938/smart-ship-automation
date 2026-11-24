/** 네이버 커머스 API 공통 상수 — 주문 조회·발송처리·토큰 발급이 함께 쓴다 */

export const BASE_URL = "https://api.commerce.naver.com/external/v1";

/** 429(Rate limit) 응답 시 재시도 횟수 */
export const MAX_RETRIES = 3;

/** 지수 백오프 시작 간격 (ms) */
export const INITIAL_BACKOFF_MS = 1000;
