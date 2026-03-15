import { describe, it, expect } from "vitest";

import { generateClientSecretSign } from "./auth";

describe("generateClientSecretSign", () => {
  it("동일 입력에 대해 일관된 서명을 생성한다", () => {
    // bcrypt는 salt가 동일하면 동일 결과
    const clientId = "test_client_id";
    const clientSecret = "$2a$04$YourSaltValueHere22characters";
    const timestamp = 1700000000000;

    const sign1 = generateClientSecretSign(clientId, clientSecret, timestamp);
    const sign2 = generateClientSecretSign(clientId, clientSecret, timestamp);

    expect(sign1).toBe(sign2);
  });

  it("base64 인코딩된 문자열을 반환한다", () => {
    const clientId = "test_client_id";
    const clientSecret = "$2a$04$YourSaltValueHere22characters";
    const timestamp = 1700000000000;

    const sign = generateClientSecretSign(clientId, clientSecret, timestamp);

    expect(() => Buffer.from(sign, "base64")).not.toThrow();
    expect(sign.length).toBeGreaterThan(0);
  });

  it("다른 timestamp면 다른 서명을 생성한다", () => {
    const clientId = "test_client_id";
    const clientSecret = "$2a$04$YourSaltValueHere22characters";

    const sign1 = generateClientSecretSign(clientId, clientSecret, 1700000000000);
    const sign2 = generateClientSecretSign(clientId, clientSecret, 1700000001000);

    expect(sign1).not.toBe(sign2);
  });
});
