import { readFileSync } from "fs";
import { resolve } from "path";

import bcryptjs from "bcryptjs";

import { getConfigValue, getSetting } from "@/lib/settings";

import { tokenResponseSchema } from "./types";

const TOKEN_URL = "https://api.commerce.naver.com/external/v1/oauth2/token";
const TOKEN_BUFFER_MS = 60_000; // 만료 1분 전 갱신

// 모듈 레벨 토큰 캐시
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * .env.local에서 raw 값 직접 읽기.
 * Next.js의 dotenv-expand가 bcrypt salt 내 '$' 기호를
 * 쉘 변수로 치환하는 문제를 우회한다.
 */
function readRawEnv(key: string): string | undefined {
  try {
    const content = readFileSync(
      resolve(process.cwd(), ".env.local"),
      "utf8",
    );
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (trimmed.slice(0, eqIdx).trim() !== key) continue;
      let val = trimmed.slice(eqIdx + 1).trim();
      // 따옴표 제거
      if (
        (val.startsWith("'") && val.endsWith("'")) ||
        (val.startsWith('"') && val.endsWith('"'))
      ) {
        val = val.slice(1, -1);
      }
      // \$ 이스케이프 처리 (사용자가 이스케이프한 경우 대응)
      val = val.replace(/\\\$/g, "$");
      return val;
    }
  } catch {
    // 파일 없으면 process.env 폴백
  }
  return undefined;
}

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

  const clientId = getConfigValue("naver.clientId", "NAVER_CLIENT_ID");
  // clientSecret은 bcrypt salt($) 포함이므로 DB값 우선, 없으면 raw env 읽기
  const clientSecret =
    getSetting("naver.clientSecret") ??
    readRawEnv("NAVER_CLIENT_SECRET") ??
    process.env.NAVER_CLIENT_SECRET;
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
