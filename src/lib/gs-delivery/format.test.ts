import { describe, expect, it } from "vitest";

import {
  formatPhone,
  sanitizeAddress,
  sanitizeDeliveryMessage,
  sanitizeName,
  sanitizeParenName,
} from "./format";

// 기대값은 통합 전 automation.ts·visit-pickup.ts 구현을 실행한 결과로 고정했다.

describe("formatPhone", () => {
  it.each([
    ["01012345678", "010-1234-5678"],
    ["050212345678", "0502-1234-5678"],
    ["0212345678", "02-1234-5678"],
    ["0311235678", "031-123-5678"],
  ])("숫자만 있으면 길이에 맞춰 하이픈을 넣는다: %s", (raw, expected) => {
    expect(formatPhone(raw)).toBe(expected);
  });

  it.each([["010-1234-5678"], ["0502-1234-5678"]])(
    "하이픈이 이미 있으면 그대로 둔다: %s",
    (raw) => {
      expect(formatPhone(raw)).toBe(raw);
    }
  );

  it.each([
    ["010 1234 5678", "010-1234-5678"],
    ["010.1234.5678", "010-1234-5678"],
    ["(02)12345678", "02-1234-5678"],
    ["+821012345678", "8210-1234-5678"],
  ])("하이픈 외 구분자는 숫자만 남겨 자릿수로 판단한다: %s", (raw, expected) => {
    expect(formatPhone(raw)).toBe(expected);
  });

  it.each([["021234567"], ["15881234"], ["1234567890123"], [""]])(
    "10·11·12자리가 아니면 원본을 그대로 돌려준다: %s",
    (raw) => {
      expect(formatPhone(raw)).toBe(raw);
    }
  );
});

describe("sanitizeName", () => {
  it.each([
    ["홍길동", "홍길동"],
    ["김*수", "김수"],
    ["홍길동님", "홍길동님"],
    ["홍 길동 ", "홍 길동"],
    [" John Smith-Lee ", "John SmithLee"],
    ["홍길동🙂", "홍길동"],
    ["Kim_01", "Kim01"],
    ["", ""],
  ])("한글·영문·숫자·공백만 남긴다: %s", (name, expected) => {
    expect(sanitizeName(name)).toBe(expected);
  });

  it.each([
    ["주문자(수령인)", "주문자수령인"],
    ["김철수(이영희)", "김철수이영희"],
    ["a(b)(c)", "abc"],
    ["이름(", "이름"],
  ])("괄호는 기호만 지우고 안팎 글자를 모두 남긴다: %s", (name, expected) => {
    expect(sanitizeName(name)).toBe(expected);
  });
});

describe("sanitizeParenName", () => {
  it.each([
    ["주문자(수령인)", "수령인"],
    ["김철수(이영희)", "이영희"],
    ["(이영희)", "이영희"],
    ["김(이*희)", "이희"],
    ["a(b)(c)", "b"],
  ])("괄호가 있으면 첫 괄호 안만 남긴다: %s", (name, expected) => {
    expect(sanitizeParenName(name)).toBe(expected);
  });

  it.each([
    ["홍길동", "홍길동"],
    ["김*수", "김수"],
    ["홍길동()", "홍길동"],
    ["이름(", "이름"],
    ["김철수（이영희）", "김철수이영희"],
    [" John Smith-Lee ", "John SmithLee"],
    ["", ""],
  ])("짝이 맞는 반각 괄호가 없으면 sanitizeName과 같다: %s", (name, expected) => {
    expect(sanitizeParenName(name)).toBe(expected);
    expect(sanitizeName(name)).toBe(expected);
  });
});

describe("sanitizeAddress", () => {
  it.each([
    [
      "서울특별시 강남구 테헤란로 123, 4층 (역삼동)",
      "서울특별시 강남구 테헤란로 123, 4층 (역삼동)",
    ],
    ["경기도 성남시 분당구 판교역로 235 #101", "경기도 성남시 분당구 판교역로 235 #101"],
    ["A동 101호 / B-2", "A동 101호 / B-2"],
    ["서울시 종로구 [청운동] 1-1번지!", "서울시 종로구 청운동 1-1번지"],
    ["101동·202호", "101동202호"],
    ["  공백  앞뒤  ", "공백  앞뒤"],
    ['주소 "따옴표" & 앰퍼샌드 @ 100%', "주소 따옴표  앰퍼샌드  100"],
    ["", ""],
  ])("허용 문자만 남기고 #은 보존한다: %s", (addr, expected) => {
    expect(sanitizeAddress(addr)).toBe(expected);
  });
});

describe("sanitizeDeliveryMessage", () => {
  it.each([
    ["부재 시 경비실(1층)에 맡겨주세요.", "부재 시 경비실(1층)에 맡겨주세요."],
    ["문앞에 놓아주세요~ 감사합니다 :)", "문앞에 놓아주세요 감사합니다 )"],
    ["A동 101호 / B-2", "A동 101호 / B-2"],
    ["서울시 종로구 [청운동] 1-1번지!", "서울시 종로구 청운동 1-1번지"],
    ["  공백  앞뒤  ", "공백  앞뒤"],
    ["", ""],
  ])("허용 문자만 남긴다: %s", (message, expected) => {
    expect(sanitizeDeliveryMessage(message)).toBe(expected);
  });

  it("주소와 달리 #도 지운다", () => {
    const raw = "경기도 성남시 분당구 판교역로 235 #101";
    expect(sanitizeDeliveryMessage(raw)).toBe("경기도 성남시 분당구 판교역로 235 101");
  });
});
