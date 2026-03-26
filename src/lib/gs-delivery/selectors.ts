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
  NEXT_DAY: "https://www.cvsnet.co.kr/reservation-inquiry/nextDay/nextIndex.do",
  VISIT_PICKUP: "https://www.cvsnet.co.kr/reservation-inquiry/visit/visitIndex.do",
  RESERVATION_LIST: "https://www.cvsnet.co.kr/my-page/reservation/list.do",
} as const;

// ── 예약 목록 조회 ──
// 실제 사이트 확인 완료 (2026-03-16)
// 컬럼 순서: 체크박스(1) | No(2) | 예약번호(3) | 구분(4) | 예약명(5) | 예약일(6) | 물품건수(7) | 운송장출력(8) | 예약상태(9) | 수정(10)
export const RESERVATION_LIST_SELECTORS = {
  /** 첫 번째 테이블의 tbody 행 */
  ROWS: "table:first-of-type tbody tr",
  /** 행 내 예약번호 셀 (3번째) */
  RESERVATION_NO_CELL: "td:nth-child(3)",
  /** 행 내 운송장번호 셀 (8번째 — "운송장출력" 컬럼) */
  TRACKING_NO_CELL: "td:nth-child(8)",
  /** 데이터 없을 때 표시되는 요소 */
  NO_DATA: ".no_data, td.no_data, tr.no_data",
} as const;

// ── 로그인 ──
export const LOGIN_SELECTORS = {
  USERNAME: "#memberId",
  PASSWORD: "#memberKey",
  SUBMIT: "#memberSubmit",
  /** 로그인 성공 시 상단에 '마이페이지' 링크가 나타남 (실제 URL: /my-page/...) */
  LOGGED_IN_INDICATOR: "a[href*='my-page']",
  /** Cloudflare Turnstile 캡챠 응답 토큰 */
  TURNSTILE_RESPONSE: "#memberToken",
} as const;

// ── 국내택배 예약 폼 ──
// RIRsvtnController.js 소스 기반 실제 셀렉터 (2026-03 확인)
export const DOMESTIC_SELECTORS = {
  /** 폼 태그 */
  FORM: "#frm",

  // 예약명 (placeholder="예약명" 이지만 id는 reserved_comments)
  RESERVATION_NAME: "#reserved_comments",

  // 물품 정보
  PRODUCT_SELECT: "#goods_kind", // 물품 종류 <select> (08=잡화/서적)
  PRODUCT_EXEMPTION: "#exemption_agree08", // 잡화/서적 선택 시 동의 체크박스
  PRODUCT_PRICE: "#goods_price", // 물품 가액 (만원 단위)

  // 보내는 분 — 주소록에서 선택하는 UI
  // "나의 주소록" 버튼 (data-addr-gb="01" data-trgt-addr="sender")
  SENDER_ADDRESSBOOK_BTN: "a[data-trgt-addr='sender']",
  // 주소록 레이어
  SENDER_ADDRESSBOOK_LAYER: "#layer_myAddrList",
  // 주소록 첫 항목 선택 버튼
  SENDER_ADDRESSBOOK_FIRST: "#div_myAddr .list:first-child a",

  // 보내는 분 — 직접 입력 필드 (주소록 선택 시 자동 채움)
  SENDER_NAME: "#real_sender_name",
  SENDER_PHONE: "#real_sender_telno",
  SENDER_ZIPCODE: "#real_sender_post_no",
  SENDER_ADDRESS: "#real_sender_addr",
  SENDER_ADDRESS_DETAIL: "#real_sender_detaddr",

  // 받는 분
  RECIPIENT_NAME: "#receiver_name",
  RECIPIENT_PHONE: "#receiver_telno",
  RECIPIENT_ZIPCODE: "#receiver_postno",
  RECIPIENT_ADDRESS: "#receiver_addr",
  RECIPIENT_ADDRESS_DETAIL: "#receiver_detail_addr",

  // 주의사항 팝업 (예약 페이지 첫 진입 시 표시)
  CAUTION_POPUP: ".layer_popup, .popup_wrap, [class*='caution'], [class*='notice']",
  CAUTION_CONFIRM: "a:has-text('오늘 하루 보지 않기'), button:has-text('오늘 하루 보지 않기'), a:has-text('인지하였습니다'), button:has-text('인지하였습니다'), a:has-text('닫기'), button:has-text('닫기')",

  // 배송 요청사항
  DELIVERY_MESSAGE: "#special_contents", // 배송 요청사항 (text input)

  // 제출 & 결과
  SUBMIT: "a.submit", // "예약하기" 버튼 (<a class="org submit">)
  CONFIRM_OK: ".btn_confirm, .popup_btn a, .layerPopup a", // 확인 팝업
  SUCCESS_INDICATOR: ".reservation-complete", // TODO: 완료 페이지 식별자 — 실제 확인 필요
  RESERVATION_NO: ".reservation-number", // TODO: 예약번호 텍스트 — 실제 확인 필요
} as const;

// ── 내일배송 예약 폼 ──
// 국내택배와 동일 구조. URL만 다름.
export const NEXT_DAY_SELECTORS = {
  ...DOMESTIC_SELECTORS,
} as const;

// ── 방문택배 예약 폼 ──
// 다량 접수: 1 예약 = N명 수령인
export const VISIT_PICKUP_SELECTORS = {
  /** 받는 분 추가 버튼 (첫 번째 → 두 번째, 타이틀 옆 + 아이콘) */
  RECEIVER_ADD_BTN: "#btn_receiver_add",
  /** 받는 분 추가 버튼 (세 번째 이후, 각 수령인 폼 하단) */
  RECEIVER_PLUS_BTN: ".btn_receiver_plus",
} as const;

// ── 타이밍 상수 ──

/** 로그인 성공 대기 (캡챠 수동 개입 포함) */
export const LOGIN_TIMEOUT_MS = 60_000;

/** 폼 액션 간 대기 */
export const ACTION_DELAY_MS = 500;

/** 페이지 로드 타임아웃 */
export const PAGE_LOAD_TIMEOUT_MS = 15_000;
