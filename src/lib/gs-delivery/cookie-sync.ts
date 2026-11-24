import fs from "fs";

import { syncCookiesToServer } from "@/lib/sync-to-server";

/**
 * 저장된 쿠키 파일을 읽어 서버에 동기화한다.
 * 실패해도 호출한 흐름을 막지 않도록 경고만 남긴다.
 *
 * @param cookiesPath 쿠키 파일 경로
 * @param logPrefix 경고 로그 접두어 (예: "[auth]")
 */
export async function syncSavedCookiesToServer(
  cookiesPath: string,
  logPrefix: string
): Promise<void> {
  try {
    if (!fs.existsSync(cookiesPath)) return;
    const raw = fs.readFileSync(cookiesPath, "utf-8");
    const cookies = JSON.parse(raw) as Array<Record<string, unknown>>;
    await syncCookiesToServer(cookies);
  } catch {
    console.warn(`${logPrefix} 쿠키 서버 동기화 실패 (무시)`);
  }
}
