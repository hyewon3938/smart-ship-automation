/**
 * GS택배 원격 로그인 세션.
 *
 * 서버의 Playwright 브라우저를 원격 조작하여 로그인:
 * 1. startSession(): 로그인 페이지 열기 + ID/PW 자동 입력 → 스크린샷 반환
 * 2. getScreenshot(): 현재 페이지 스크린샷
 * 3. forwardClick(x, y): 클릭 좌표 전달 → 스크린샷 + 로그인 상태 반환
 * 4. closeSession(): 세션 정리
 *
 * 클라이언트는 스크린샷을 보여주고, 유저가 CAPTCHA를 클릭하면
 * 좌표를 서버로 전달하여 Playwright에서 대신 클릭한다.
 */

import fs from "fs";
import path from "path";

import { newPage, saveCookies } from "./browser";
import { isLoggedIn } from "./auth";
import { GS_URLS, LOGIN_SELECTORS, ACTION_DELAY_MS } from "./selectors";
import { getConfigValue } from "@/lib/settings";
import { syncCookiesToServer } from "@/lib/sync-to-server";

import type { Page } from "playwright";

const COOKIES_PATH = path.join(process.cwd(), "data", "cookies.json");

/** Playwright 뷰포트 크기 (스크린샷 좌표 매핑용) */
export const LOGIN_VIEWPORT = { width: 1280, height: 800 } as const;

/** 활성 로그인 세션 (동시 1개만 허용) */
let activePage: Page | null = null;
let sessionTimeout: ReturnType<typeof setTimeout> | null = null;

/** 세션 최대 유지 시간 (3분) */
const SESSION_TTL_MS = 3 * 60 * 1000;

// ── 공개 API ──

/** 쿠키 파일 기반 유효성 간이 확인 (24시간 이내면 유효) */
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
    return { valid: ageHours < 24, lastSyncAt: stat.mtime.toISOString() };
  } catch {
    return { valid: false, lastSyncAt: null };
  }
}

/** 로그인 세션 활성 여부 */
export function hasActiveSession(): boolean {
  return activePage !== null && !activePage.isClosed();
}

/**
 * 원격 로그인 세션 시작.
 * Playwright로 로그인 페이지를 열고, ID/PW를 자동 입력한 뒤 스크린샷을 반환한다.
 */
export async function startSession(): Promise<{
  success: boolean;
  message: string;
  screenshot?: string; // base64 JPEG
  loggedIn?: boolean;
}> {
  // 이미 활성 세션이 있으면 정리
  if (hasActiveSession()) {
    await closeSession();
  }

  const username = getConfigValue("gs.username", "GS_USERNAME");
  const password = getConfigValue("gs.password", "GS_PASSWORD");

  if (!username || !password) {
    return {
      success: false,
      message: "GS택배 아이디/비밀번호가 설정되지 않았습니다. 설정 페이지를 확인하세요.",
    };
  }

  try {
    activePage = await newPage();

    // 이미 로그인 상태인지 먼저 확인
    if (await isLoggedIn(activePage)) {
      await saveCookies();
      const screenshot = await takeScreenshot();
      await closeSession();
      return {
        success: true,
        message: "이미 로그인되어 있습니다.",
        screenshot,
        loggedIn: true,
      };
    }

    // 로그인 페이지 이동
    await activePage.goto(GS_URLS.LOGIN, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await activePage.waitForTimeout(ACTION_DELAY_MS);

    // ID/PW 자동 입력
    await activePage.locator(LOGIN_SELECTORS.USERNAME).fill(username);
    await activePage.locator(LOGIN_SELECTORS.PASSWORD).fill(password);
    await activePage.waitForTimeout(1000); // Turnstile 로딩 대기

    console.log("[login-session] 로그인 페이지 열림 — CAPTCHA 스크린샷 전달");

    // 세션 TTL 타이머 시작
    resetSessionTimer();

    const screenshot = await takeScreenshot();
    return {
      success: true,
      message: "로그인 페이지가 준비되었습니다. CAPTCHA를 클릭해주세요.",
      screenshot,
      loggedIn: false,
    };
  } catch (e) {
    await closeSession();
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    return { success: false, message: `로그인 세션 시작 실패: ${msg}` };
  }
}

/** 현재 페이지의 스크린샷을 base64로 반환 */
export async function getScreenshot(): Promise<{
  success: boolean;
  screenshot?: string;
  loggedIn?: boolean;
  message?: string;
}> {
  if (!hasActiveSession()) {
    return { success: false, message: "활성 로그인 세션이 없습니다." };
  }

  try {
    const loggedIn = await checkIfLoggedIn();
    if (loggedIn) {
      await handleLoginSuccess();
      const screenshot = await takeScreenshot();
      return { success: true, screenshot, loggedIn: true };
    }

    const screenshot = await takeScreenshot();
    return { success: true, screenshot, loggedIn: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "스크린샷 실패";
    return { success: false, message: msg };
  }
}

/**
 * 클릭 좌표를 Playwright 페이지에 전달.
 * 클릭 후 2초 대기 → 스크린샷 + 로그인 상태 확인.
 */
export async function forwardClick(
  x: number,
  y: number
): Promise<{
  success: boolean;
  screenshot?: string;
  loggedIn?: boolean;
  message?: string;
}> {
  if (!hasActiveSession() || !activePage) {
    return { success: false, message: "활성 로그인 세션이 없습니다." };
  }

  try {
    resetSessionTimer();

    console.log(`[login-session] 클릭 전달: (${x}, ${y})`);
    await activePage.mouse.click(x, y);

    // 클릭 후 페이지 변화 대기
    await activePage.waitForTimeout(2000);

    // 로그인 성공 여부 확인
    const loggedIn = await checkIfLoggedIn();
    if (loggedIn) {
      await handleLoginSuccess();
    }

    const screenshot = await takeScreenshot();
    return { success: true, screenshot, loggedIn };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "클릭 처리 실패";
    return { success: false, message: msg };
  }
}

/** 로그인 세션 종료 */
export async function closeSession(): Promise<void> {
  if (sessionTimeout) {
    clearTimeout(sessionTimeout);
    sessionTimeout = null;
  }
  if (activePage && !activePage.isClosed()) {
    await activePage.close().catch(() => {});
  }
  activePage = null;
  console.log("[login-session] 세션 종료");
}

// ── 내부 유틸 ──

async function takeScreenshot(): Promise<string> {
  if (!activePage || activePage.isClosed()) throw new Error("페이지 없음");
  const buffer = await activePage.screenshot({ type: "jpeg", quality: 70 });
  return buffer.toString("base64");
}

/** 페이지 텍스트 기반 간이 로그인 체크 (isLoggedIn보다 가벼움) */
async function checkIfLoggedIn(): Promise<boolean> {
  if (!activePage || activePage.isClosed()) return false;

  try {
    // URL이 로그인 페이지가 아니면 로그인 성공일 가능성 높음
    const url = activePage.url();
    if (url.includes("reservation-inquiry") || url.includes("my-page")) {
      return true;
    }

    // "로그아웃" 링크 존재 확인
    const logoutVisible = await activePage
      .locator("a:has-text('로그아웃')")
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    return logoutVisible;
  } catch {
    return false;
  }
}

/** 로그인 성공 처리: 쿠키 저장 + 서버 동기화 */
async function handleLoginSuccess(): Promise<void> {
  console.log("[login-session] 로그인 성공 감지 — 쿠키 저장");
  await saveCookies();
  void syncCookiesAfterSave();
}

/** 세션 TTL 타이머 리셋 (클릭할 때마다 갱신) */
function resetSessionTimer(): void {
  if (sessionTimeout) clearTimeout(sessionTimeout);
  sessionTimeout = setTimeout(() => {
    console.log("[login-session] 세션 TTL 만료 — 자동 종료");
    void closeSession();
  }, SESSION_TTL_MS);
}

/** 저장된 쿠키를 서버에 동기화 */
async function syncCookiesAfterSave(): Promise<void> {
  try {
    if (!fs.existsSync(COOKIES_PATH)) return;
    const raw = fs.readFileSync(COOKIES_PATH, "utf-8");
    const cookies = JSON.parse(raw) as Array<Record<string, unknown>>;
    await syncCookiesToServer(cookies);
  } catch {
    console.warn("[login-session] 쿠키 서버 동기화 실패 (무시)");
  }
}
