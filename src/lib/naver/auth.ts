import bcryptjs from "bcryptjs";

import { tokenResponseSchema } from "./types";

const TOKEN_URL = "https://api.commerce.naver.com/external/v1/oauth2/token";
const TOKEN_BUFFER_MS = 60_000; // 만료 1분 전 갱신

// 모듈 레벨 토큰 캐시
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * bcrypt 기반 client_secret_sign 생성
 * password = `${clientId}_${timestamp}`
 * hash = bcrypt(password, clientSecret) — clientSecret이 salt 역할
 * sign = base64Encode(hash)
 */
export function generateClientSecretSign(
  clientId: string,
  clientSecret: string,
  timestamp: number
): string {
  const password = `${clientId}_${timestamp}`;
  const hashed = bcryptjs.hashSync(password, clientSecret);
  return Buffer.from(hashed).toString("base64");
}

/**
 * OAuth 액세스 토큰 발급 (캐시된 토큰 재사용)
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt > now + TOKEN_BUFFER_MS) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET이 설정되지 않았습니다."
    );
  }

  const timestamp = now;
  const clientSecretSign = generateClientSecretSign(
    clientId,
    clientSecret,
    timestamp
  );

  const params = new URLSearchParams({
    client_id: clientId,
    timestamp: String(timestamp),
    client_secret_sign: clientSecretSign,
    grant_type: "client_credentials",
    type: "SELF",
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`토큰 발급 실패 (${response.status}): ${body}`);
  }

  const json = await response.json();
  const parsed = tokenResponseSchema.parse(json);

  // expires_in이 없으면 기본 24시간 (보수적 가정)
  const expiresInMs = (parsed.expires_in ?? 86400) * 1000;

  cachedToken = {
    accessToken: parsed.access_token,
    expiresAt: now + expiresInMs,
  };

  return cachedToken.accessToken;
}

/** 테스트용 캐시 리셋 */
export function _resetTokenCache(): void {
  cachedToken = null;
}
