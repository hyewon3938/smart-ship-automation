import { describe, it, expect } from "vitest";

import { isNextDayDeliveryEligible } from "./regions";

describe("isNextDayDeliveryEligible", () => {
  it("육지는 전국 어디든 가능", () => {
    expect(isNextDayDeliveryEligible("서울특별시 강남구 역삼동", "06234")).toBe(true);
    expect(isNextDayDeliveryEligible("부산광역시 해운대구 우동", "48094")).toBe(true);
    expect(isNextDayDeliveryEligible("강원특별자치도 속초시 조양동", "24825")).toBe(true);
    expect(isNextDayDeliveryEligible("전라남도 목포시 상동", "58697")).toBe(true);
  });

  it("예전에 막혀 있던 수도권 지역도 이제 가능", () => {
    expect(isNextDayDeliveryEligible("경기도 용인시 수지구", "16827")).toBe(true);
    expect(isNextDayDeliveryEligible("인천광역시 중구 운서동", "22382")).toBe(true);
  });

  it("제주는 우편번호로 걸러낸다", () => {
    expect(isNextDayDeliveryEligible("제주특별자치도 제주시 연동", "63122")).toBe(false);
    expect(isNextDayDeliveryEligible("제주특별자치도 서귀포시 중문동", "63535")).toBe(false);
  });

  it("우편번호가 없으면 제주를 주소로 걸러낸다", () => {
    expect(isNextDayDeliveryEligible("제주특별자치도 제주시 연동")).toBe(false);
    expect(isNextDayDeliveryEligible("제주특별자치도 서귀포시 중문동", "")).toBe(false);
  });

  it("우편번호가 있으면 주소에 '제주'가 들어가도 육지로 본다", () => {
    // 다른 지역의 도로명에 '제주'가 섞여도 우편번호가 우선한다
    expect(isNextDayDeliveryEligible("경기도 성남시 분당구 제주로 12", "13561")).toBe(true);
  });

  it("배로 들어가는 섬은 불가", () => {
    expect(isNextDayDeliveryEligible("경상북도 울릉군 울릉읍 도동리", "40201")).toBe(false);
    expect(isNextDayDeliveryEligible("인천광역시 옹진군 백령면 진촌리", "23103")).toBe(false);
    expect(isNextDayDeliveryEligible("전라남도 신안군 흑산면 예리", "58762")).toBe(false);
  });

  it("다리로 이어진 섬은 가능", () => {
    expect(isNextDayDeliveryEligible("인천광역시 강화군 강화읍 관청리", "23037")).toBe(true);
    expect(isNextDayDeliveryEligible("인천광역시 옹진군 영흥면 내리", "23139")).toBe(true);
    expect(isNextDayDeliveryEligible("경상남도 거제시 고현동", "53243")).toBe(true);
  });

  it("우편번호에 하이픈이 섞여도 인식한다", () => {
    expect(isNextDayDeliveryEligible("제주특별자치도 제주시 연동", "631-22")).toBe(false);
  });
});
