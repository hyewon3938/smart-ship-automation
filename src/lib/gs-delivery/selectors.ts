/**
 * GS택배(cvsnet.co.kr) URL 및 CSS 셀렉터
 *
 * ⚠️ 구현 시 실제 사이트 DevTools로 확인하여 교체할 것
 * 사이트 UI 변경 시 이 파일만 수정하면 됨
 */

// ── URL ──
export const GS_URLS = {
  LOGIN: "https://www.cvsnet.co.kr/member/login/index.do",
  DOMESTIC: "https://www.cvsnet.co.kr/reservation-inquiry/domestic/index.do",
  // TODO: 내일배송 URL은 사이트에서 정확한 경로 확인
  NEXT_DAY: "https://www.cvsnet.co.kr/reservation-inquiry/nextday/index.do",
} as const;

// ── 로그인 ──
export const LOGIN_SELECTORS = {
  USERNAME: "#id", // TODO: 실제 셀렉터 확인
  PASSWORD: "#pw", // TODO: 실제 셀렉터 확인
  SUBMIT: ".btn-login", // TODO: 실제 셀렉터 확인
  LOGGED_IN_INDICATOR: ".user-info", // TODO: 로그인 후 나타나는 요소
} as const;

// ── 국내택배 예약 폼 ──
export const DOMESTIC_SELECTORS = {
  // 물품 정보
  PRODUCT_SELECT: "#productType", // TODO: 물품선택 드롭다운
  PRODUCT_PRICE: "#productPrice", // TODO: 물품가액
  RESERVATION_NAME: "#reservationName", // TODO: 예약명

  // 보내는 분 (주소록)
  SENDER_ADDRESSBOOK_BTN: ".btn-address-book", // TODO: "주소록에서 가져오기" 버튼
  SENDER_ADDRESSBOOK_FIRST: ".address-list .item:first-child", // TODO: 주소록 첫 항목

  // 받는 분
  RECIPIENT_NAME: "#recipientName", // TODO: 이름
  RECIPIENT_PHONE: "#recipientPhone", // TODO: 전화번호
  RECIPIENT_ZIPCODE: "#recipientZip", // TODO: 우편번호
  RECIPIENT_ADDRESS: "#recipientAddr", // TODO: 기본주소
  RECIPIENT_ADDRESS_DETAIL: "#recipientAddrDetail", // TODO: 상세주소
  ZIPCODE_SEARCH_BTN: ".btn-zipcode", // TODO: 우편번호 검색 버튼

  // 제출 & 결과
  SUBMIT: ".btn-submit", // TODO: 예약 신청 버튼
  CONFIRM_OK: ".btn-confirm", // TODO: 확인 팝업 OK 버튼 (있을 경우)
  SUCCESS_INDICATOR: ".reservation-complete", // TODO: 완료 페이지 식별자
  RESERVATION_NO: ".reservation-number", // TODO: 예약번호 텍스트 위치
} as const;

// ── 내일배송 예약 폼 ──
// 국내택배와 동일 구조일 가능성 높음. 다르면 개별 오버라이드
export const NEXT_DAY_SELECTORS = {
  ...DOMESTIC_SELECTORS,
  // TODO: 내일배송 전용 필드가 있으면 여기에 오버라이드
} as const;

// ── 타이밍 상수 ──

/** 로그인 성공 대기 (캡챠 수동 개입 포함) */
export const LOGIN_TIMEOUT_MS = 60_000;

/** 폼 액션 간 대기 */
export const ACTION_DELAY_MS = 500;

/** 페이지 로드 타임아웃 */
export const PAGE_LOAD_TIMEOUT_MS = 15_000;
