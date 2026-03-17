/**
 * GS택배 로컬 직접 로그인.
 *
 * Playwright headed 브라우저에서 로그인 페이지를 열고 ID/PW를 자동 입력한다.
 * 사용자가 로컬 브라우저 창에서 CAPTCHA를 직접 처리하면 로그인 성공을 감지한다.
 * 성공 시 쿠키를 저장하고 서버에 동기화한다.
 */

import fs from "fs";
import path from "path";

import { newPage, saveCookies } from "./browser";
import { isLoggedIn } from "./auth";
import { GS_URLS, LOGIN_SELECTORS, ACTION_DELAY_MS } from "./selectors";
import { getConfigValue } from "@/lib/settings";
import { syncCookiesToServer } from "@/lib/sync-to-server";

/** 쿠키 최대 유효 시간 (시간) */
const COOKIE_MAX_AGE_HOURS = 24;

const COOKIES_PATH = path.join(process.cwd(), "data", "cookies.json");

// ── 공개 API ──

/**
 * GS택배 로그인 유효성 간이 확인.
 * 쿠키 파일 존재 여부 + 수정 시간 기반 (24시간 이내면 유효).
 * Playwright를 열지 않으므로 브라우저 창이 뜨지 않음.
 */
export function checkCookieValidity(): {
  valid: boolean;
  lastSyncAt: string | null;
} {
  try {
    if (!fs.existsSync(COOKIES_PATH)) {
      return { valid: false, lastSyncAt: null };
    }
    const stat = fs.statSync(COOKIES_PATH);
    const ageHours = (Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60);
    return { valid: ageHours < COOKIE_MAX_AGE_HOURS, lastSyncAt: stat.mtime.toISOString() };
  } catch {
    return { valid: false, lastSyncAt: null };
  }
}

/**
 * 로컬 직접 로그인.
 * Playwright headed 브라우저에서 로그인 페이지를 열고,
 * ID/PW 자동 입력 후 사용자가 직접 CAPTCHA를 처리할 때까지 최대 120초 대기.
 * 로그인 성공 시 쿠키 저장 + 서버 동기화.
 */
export async function loginDirect(): Promise<{
  success: boolean;
  message: string;
}> {
  const username = getConfigValue("gs.username", "GS_USERNAME");
  const password = getConfigValue("gs.password", "GS_PASSWORD");

  if (!username || !password) {
    return {
      success: false,
      message: "GS택배 아이디/비밀번호가 설정되지 않았습니다. 설정 페이지를 확인하세요.",
    };
  }

  const page = await newPage();
  try {
    // 이미 로그인 상태인지 확인
    if (await isLoggedIn(page)) {
      await saveCookies();
      return { success: true, message: "이미 로그인되어 있습니다." };
    }

    // 로그인 페이지 이동 + ID/PW 자동 입력
    await page.goto(GS_URLS.LOGIN, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await page.waitForTimeout(ACTION_DELAY_MS);
    await page.locator(LOGIN_SELECTORS.USERNAME).fill(username);
    await page.locator(LOGIN_SELECTORS.PASSWORD).fill(password);

    console.log("[login-direct] 로그인 페이지 열림 — 브라우저에서 CAPTCHA 처리 대기 (최대 120초)...");

    // 로그인 성공까지 최대 120초 대기 (3초 간격 폴링)
    const maxWait = 120_000;
    const interval = 3_000;
    let elapsed = 0;

    while (elapsed < maxWait) {
      await page.waitForTimeout(interval);
      elapsed += interval;

      if (page.isClosed()) {
        return { success: false, message: "브라우저 창이 닫혔습니다." };
      }

      // URL이 바뀌거나 로그아웃 버튼이 보이면 로그인 성공
      const url = page.url();
      if (url.includes("reservation-inquiry") || url.includes("my-page")) {
        break;
      }
      const logoutVisible = await page
        .locator("a:has-text('로그아웃')")
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (logoutVisible) break;
    }

    // 최종 로그인 확인
    if (await isLoggedIn(page)) {
      await saveCookies();
      void syncCookiesAfterSave();
      console.log("[login-direct] 로그인 성공 — 쿠키 저장 완료");
      return { success: true, message: "로그인 성공! 쿠키가 저장되었습니다." };
    }

    return {
      success: false,
      message: "로그인 시간이 초과되었습니다 (120초). 다시 시도해주세요.",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    console.error(`[login-direct] 오류: ${msg}`);
    return { success: false, message: `로그인 실패: ${msg}` };
  } finally {
    await page.close().catch(() => {});
  }
}

// ── 내부 유틸 ──

/** 쿠키 파일 수정 시간 반환 (없으면 null) */
function getCookieFileTime(): string | null {
  try {
    if (!fs.existsSync(COOKIES_PATH)) return null;
    const stat = fs.statSync(COOKIES_PATH);
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

/** 저장된 쿠키를 서버에 동기화 */
async function syncCookiesAfterSave(): Promise<void> {
  try {
    if (!fs.existsSync(COOKIES_PATH)) return;
    const raw = fs.readFileSync(COOKIES_PATH, "utf-8");
    const cookies = JSON.parse(raw) as Array<Record<string, unknown>>;
    await syncCookiesToServer(cookies);
  } catch {
    console.warn("[login-direct] 쿠키 서버 동기화 실패 (무시)");
  }
}
