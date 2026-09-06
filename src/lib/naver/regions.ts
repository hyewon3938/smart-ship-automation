/**
 * 내일배송 가능 지역 판별.
 *
 * 2026-09 권역 확대로 전국이 열렸다. 이제 판별의 역할은 "어디가 되는가"가
 * 아니라 "어디가 안 되는가"다 — 제주와 배로 들어가는 섬만 걸러낸다.
 *
 * 이 판별은 UI 힌트다. 실제로 GS택배가 받아주는지는 예약 시점에만 확정된다.
 * 과하게 막으면 보낼 수 있는 곳을 고르지 못하게 되므로, 확실한 곳만 적는다.
 */

/** 제주특별자치도 우편번호 범위 (제주시·서귀포시 전역) */
const JEJU_ZIP_MIN = 63000;
const JEJU_ZIP_MAX = 63644;

/**
 * 제주 주소 키워드 — 우편번호가 비었거나 5자리 형식이 아닐 때의 보조 판정.
 * 추자도·우도 등 제주 부속 도서도 이 범위에 함께 걸린다.
 */
const JEJU_ADDRESS_KEYWORDS = ["제주특별자치도", "제주시", "서귀포시"];

/**
 * 배로 들어가는 지역의 주소 키워드.
 *
 * 완전한 목록이 아니다. 예약이 거절된 지역이 나오면 여기에 추가한다.
 * 반대로 다리로 이어져 육로 배송이 되는 곳(강화도·영흥도·거제도 등)은
 * 넣지 않는다.
 *
 * 군 단위로 적은 곳은 관할 전역이 섬인 곳이고, 나머지는 육지 지명과
 * 겹치지 않는 고유 섬 이름만 골랐다. 예를 들어 "삼산면"(여수 거문도)은
 * 해남·영암 등 육지에도 같은 이름이 있어 지명 대신 "거문도"로 적는다.
 */
const ISLAND_ADDRESS_KEYWORDS = [
  // 경북 울릉군 — 관할 전역이 섬
  "울릉군",
  // 전남 신안군 — 관할 전역이 섬
  "신안군",
  // 인천 옹진군 — 영흥면만 육로로 이어져 예외
  "백령면",
  "대청면",
  "연평면",
  "덕적면",
  "자월면",
  "북도면",
  // 고유 섬 이름
  "거문도",
  "홍도",
  "가거도",
  "욕지도",
  "사량도",
  "한산도",
];

/** 우편번호 문자열을 5자리 숫자로 정규화 (하이픈·공백 허용) */
function parseZipCode(zipCode: string | null | undefined): number | null {
  if (!zipCode) return null;
  const digits = zipCode.replace(/\D/g, "");
  if (digits.length !== 5) return null;
  return Number(digits);
}

/** 제주 여부 — 우편번호를 우선 보고, 없으면 주소 문자열로 판정 */
function isJeju(address: string, zipCode: string | null | undefined): boolean {
  const zip = parseZipCode(zipCode);
  if (zip !== null) {
    return zip >= JEJU_ZIP_MIN && zip <= JEJU_ZIP_MAX;
  }
  return JEJU_ADDRESS_KEYWORDS.some((keyword) => address.includes(keyword));
}

/** 배로 들어가는 지역 여부 */
function isIsland(address: string): boolean {
  return ISLAND_ADDRESS_KEYWORDS.some((keyword) => address.includes(keyword));
}

/**
 * 주소로 내일배송 가능 여부를 판별한다.
 *
 * @param address - 전체 주소 문자열 (예: "서울특별시 강남구 역삼동 123-4")
 * @param zipCode - 우편번호. 제주 판별의 1차 근거. 없으면 주소로 판정한다
 */
export function isNextDayDeliveryEligible(
  address: string,
  zipCode?: string | null,
): boolean {
  return !isJeju(address, zipCode) && !isIsland(address);
}
