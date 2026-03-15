/**
 * 내일배송 가능 지역 판별
 * - 서울: 전체
 * - 인천: 계양/남동/부평/연수구
 * - 경기: 고양/광명/군포/부천/성남/수원/안산/안양시
 */

const NEXT_DAY_ELIGIBLE_AREAS: Record<string, string[] | "ALL"> = {
  서울: "ALL",
  인천: ["계양구", "남동구", "부평구", "연수구"],
  경기: [
    "고양시",
    "광명시",
    "군포시",
    "부천시",
    "성남시",
    "수원시",
    "안산시",
    "안양시",
  ],
};

/**
 * 주소 문자열에서 내일배송 가능 여부를 판별한다.
 * @param address - 전체 주소 문자열 (예: "서울특별시 강남구 역삼동 123-4")
 */
export function isNextDayDeliveryEligible(address: string): boolean {
  for (const [region, districts] of Object.entries(NEXT_DAY_ELIGIBLE_AREAS)) {
    if (!address.includes(region)) continue;

    if (districts === "ALL") return true;

    return districts.some((district) => address.includes(district));
  }

  return false;
}
