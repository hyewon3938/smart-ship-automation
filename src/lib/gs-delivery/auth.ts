import fs from "fs";
import path from "path";

import {
  GS_URLS,
  LOGIN_SELECTORS,
  LOGIN_TIMEOUT_MS,
  ACTION_DELAY_MS,
} from "./selectors";
import { saveCookies } from "./browser";

import { getConfigValue } from "@/lib/settings";
import { syncCookiesToServer } from "@/lib/sync-to-server";

import type { Page } from "playwright";

/** 로그인 실패 시 사용하는 에러 — 재시도해도 해결 불가능한 경우 */
export class LoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoginError";
  }
}

/**
 * 현재 로그인 상태를 확인한다.
 * 국내택배 페이지에 접근하여 로그인 여부를 판별.
 * - 비로그인: "현재 비로그인 상태입니다" 텍스트 또는 로그인 폼 표시
 * - 로그인됨: 로그아웃 링크 표시 + 비로그인 텍스트 없음
 *
 * JS가 세션 상태를 반영할 시간을 준 뒤 비로그인 텍스트를 먼저 확인한다.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (!url.includes("cvsnet.co.kr")) {
      await page.goto(GS_URLS.DOMESTIC, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      // JS가 세션 상태를 확인할 시간을 준다 (Cloudflare 등 비동기 체크 대비)
      await page.waitForTimeout(2000);
    }

    // 비로그인 상태를 먼저 확인 (확실한 음성 지표 — JS 실행 후 나타남)
    const notLoggedIn = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      return (
        bodyText.includes("비로그인") ||
        bodyText.includes("로그인이 필요") ||
        bodyText.includes("로그인 후 이용")
      );
    }).catch(() => false);

    if (notLoggedIn) {
      console.log("[auth] 비로그인 상태 감지 — 세션 만료됨");
      return false;
    }

    // 로그아웃 링크가 보이면 로그인 상태
    return await page
      .locator(LOGIN_SELECTORS.LOGGED_IN_INDICATOR)
      .isVisible({ timeout: 3000 })
      .catch(() => false);
  } catch {
    return false;
  }
}

/** 로그인 완료를 확인하는 폴링 간격 */
const LOGIN_POLL_INTERVAL_MS = 3_000;

/** 로그인 완료를 기다리는 최대 시간 — 사용자가 캡챠를 직접 체크하는 시간을 포함한다 */
export const LOGIN_WAIT_MS = 120_000;

/**
 * 로그인이 완료될 때까지 폴링으로 기다린다.
 *
 * 셀렉터 하나가 나타나는 것으로 판정하면 비로그인 페이지에도 있는 요소를 보고
 * 성공으로 오판하므로, 주기적으로 로그인 상태를 다시 확인한다.
 * Turnstile 캡챠가 자동 통과되면 몇 초, 사용자가 직접 체크하면 그만큼 걸린다.
 *
 * @returns 로그인이 확인되면 true, 대기 시간을 넘기거나 창이 닫히면 false
 */
export async function waitForLogin(
  page: Page,
  maxWaitMs: number = LOGIN_WAIT_MS
): Promise<boolean> {
  let elapsed = 0;

  while (elapsed < maxWaitMs) {
    await page.waitForTimeout(LOGIN_POLL_INTERVAL_MS);
    elapsed += LOGIN_POLL_INTERVAL_MS;

    if (page.isClosed()) {
      console.warn("[auth] 브라우저 창이 닫혔습니다");
      return false;
    }

    const logoutVisible = await page
      .locator(LOGIN_SELECTORS.LOGGED_IN_INDICATOR)
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (logoutVisible) return true;

    const url = page.url();
    if (url.includes("reservation-inquiry") || url.includes("my-page")) {
      if (await isLoggedIn(page)) return true;
    }
  }

  return page.isClosed() ? false : isLoggedIn(page);
}

/**
 * cvsnet.co.kr에 로그인한다.
 *
 * Cloudflare Turnstile 캡챠가 있어 headed 브라우저에서
 * 사용자가 직접 캡챠를 통과해야 할 수 있다.
 *
 * 흐름:
 * 1. 로그인 페이지 이동
 * 2. ID/PW 입력
 * 3. Turnstile 캡챠 토큰 대기 (자동 통과 또는 사용자 수동)
 * 4. 로그인 버튼 클릭
 * 5. 로그인 성공(마이페이지 링크) 대기
 *
 * @throws 60초 내 로그인 미완료 시 에러
 */
export async function login(page: Page): Promise<void> {
  const username = getConfigValue("gs.username", "GS_USERNAME");
  const password = getConfigValue("gs.password", "GS_PASSWORD");

  if (!username || !password) {
    throw new Error(
      "GS_USERNAME 또는 GS_PASSWORD가 설정되지 않았습니다. 설정 페이지 또는 .env.local을 확인하세요."
    );
  }

  await page.goto(GS_URLS.LOGIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(ACTION_DELAY_MS);

  // ID/PW 입력
  await page.locator(LOGIN_SELECTORS.USERNAME).fill(username);
  await page.locator(LOGIN_SELECTORS.PASSWORD).fill(password);
  await page.waitForTimeout(ACTION_DELAY_MS);

  // Turnstile 캡챠 토큰 대기 (자동 완료되거나 사용자가 수동으로 체크)
  console.log("[auth] Turnstile 캡챠 대기 중... (자동 통과 또는 브라우저에서 직접 체크)");
  const tokenReady = await page
    .waitForFunction(
      (selector) => {
        const el = document.querySelector(selector) as HTMLInputElement | null;
        return el && el.value.length > 0;
      },
      LOGIN_SELECTORS.TURNSTILE_RESPONSE,
      { timeout: LOGIN_TIMEOUT_MS }
    )
    .then(() => true)
    .catch(() => false);
  console.log(
    tokenReady
      ? "[auth] Turnstile 캡챠 토큰 확인 완료"
      : "[auth] Turnstile 토큰 대기 타임아웃 — 로그인 버튼 클릭 시도"
  );

  await page.waitForTimeout(ACTION_DELAY_MS);

  // 로그인 버튼 클릭. 사용자가 먼저 눌러 페이지가 넘어갔으면 버튼이 없으므로 넘어간다
  await page
    .locator(LOGIN_SELECTORS.SUBMIT)
    .click({ timeout: 5_000 })
    .catch(() => {
      console.log("[auth] 로그인 버튼 클릭 생략 — 페이지가 이미 넘어간 상태");
    });

  // 로그인 완료 대기 — 캡챠를 사용자가 직접 처리하는 시간을 포함해 폴링한다
  const verified = await waitForLogin(page);
  if (!verified) {
    const bodyText = await page
      .evaluate(() => document.body.innerText.substring(0, 300))
      .catch(() => "");
    console.error("[auth] 로그인 검증 실패 — 세션이 유효하지 않음");
    throw new LoginError(
      `로그인이 완료되지 않았습니다 (${LOGIN_WAIT_MS / 1000}초 대기). ` +
        "브라우저 창에서 Turnstile 캡챠를 체크하고 로그인 버튼을 눌러주세요.\n" +
        `페이지 내용: ${bodyText}`
    );
  }

  console.log("[auth] 로그인 성공 (검증 완료)");
  await saveCookies();
  void syncCookiesAfterLogin();
}

/** 로그인 성공 후 저장된 쿠키를 서버에 동기화 */
async function syncCookiesAfterLogin(): Promise<void> {
  const cookiesPath = path.join(process.cwd(), "data", "cookies.json");
  try {
    if (!fs.existsSync(cookiesPath)) return;
    const raw = fs.readFileSync(cookiesPath, "utf-8");
    const cookies = JSON.parse(raw) as Array<Record<string, unknown>>;
    await syncCookiesToServer(cookies);
  } catch {
    console.warn("[auth] 쿠키 서버 동기화 실패 (무시)");
  }
}

/**
 * 로그인 상태를 보장한다. 미로그인 시 로그인 시도.
 *
 * 서버 모드에서는 로그인을 시도하지 않는다.
 * 서버에서는 Turnstile CAPTCHA를 통과할 수 없으므로,
 * 로컬에서 동기화된 쿠키만 사용한다. 쿠키 만료 시 에러를 던져 폴링을 스킵한다.
 */
export async function ensureLoggedIn(page: Page): Promise<void> {
  const loggedIn = await isLoggedIn(page);
  if (!loggedIn) {
    if (process.env.DEPLOY_MODE === "server") {
      throw new LoginError(
        "GS택배 쿠키가 만료되었습니다. 로컬에서 로그인하여 쿠키를 동기화해주세요."
      );
    }
    await login(page);
  }
}
