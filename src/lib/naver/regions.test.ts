import { describe, it, expect } from "vitest";

import { isNextDayDeliveryEligible } from "./regions";

describe("isNextDayDeliveryEligible", () => {
  it("서울 전체 지역은 가능", () => {
    expect(isNextDayDeliveryEligible("서울특별시 강남구 역삼동")).toBe(true);
    expect(isNextDayDeliveryEligible("서울특별시 노원구 상계동")).toBe(true);
  });

  it("인천 지정 구만 가능", () => {
    expect(isNextDayDeliveryEligible("인천광역시 부평구 부평동")).toBe(true);
    expect(isNextDayDeliveryEligible("인천광역시 연수구 연수동")).toBe(true);
  });

  it("인천 미지정 구는 불가", () => {
    expect(isNextDayDeliveryEligible("인천광역시 중구 운서동")).toBe(false);
    expect(isNextDayDeliveryEligible("인천광역시 서구 검단동")).toBe(false);
  });

  it("경기 지정 시만 가능", () => {
    expect(isNextDayDeliveryEligible("경기도 성남시 분당구 서현동")).toBe(true);
    expect(isNextDayDeliveryEligible("경기도 수원시 영통구")).toBe(true);
    expect(isNextDayDeliveryEligible("경기도 고양시 일산동구")).toBe(true);
  });

  it("경기 미지정 시는 불가", () => {
    expect(isNextDayDeliveryEligible("경기도 용인시 수지구")).toBe(false);
    expect(isNextDayDeliveryEligible("경기도 파주시 운정동")).toBe(false);
  });

  it("기타 지역은 불가", () => {
    expect(isNextDayDeliveryEligible("부산광역시 해운대구")).toBe(false);
    expect(isNextDayDeliveryEligible("대전광역시 유성구")).toBe(false);
  });
});
