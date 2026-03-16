import {
  GS_URLS,
  LOGIN_SELECTORS,
  LOGIN_TIMEOUT_MS,
  ACTION_DELAY_MS,
} from "./selectors";
import { saveCookies } from "./browser";

import { getConfigValue } from "@/lib/settings";

import type { Page } from "playwright";

/**
 * 현재 로그인 상태를 확인한다.
 * 국내택배 페이지에 접근하여 로그인 여부를 판별.
 * - 비로그인: "현재 비로그인 상태입니다" 텍스트 표시
 * - 로그인됨: "마이페이지" 링크 표시
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (!url.includes("cvsnet.co.kr")) {
      await page.goto(GS_URLS.DOMESTIC, { waitUntil: "domcontentloaded" });
    }

    // "마이페이지" 링크 또는 "로그아웃" 링크가 보이면 로그인 상태
    const [myPageVisible, logoutVisible] = await Promise.all([
      page
        .locator(LOGIN_SELECTORS.LOGGED_IN_INDICATOR)
        .isVisible({ timeout: 3000 })
        .catch(() => false),
      page
        .locator("a:has-text('로그아웃')")
        .isVisible({ timeout: 3000 })
        .catch(() => false),
    ]);
    return myPageVisible || logoutVisible;
  } catch {
    return false;
  }
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
  try {
    await page.waitForFunction(
      (selector) => {
        const el = document.querySelector(selector) as HTMLInputElement | null;
        return el && el.value.length > 0;
      },
      LOGIN_SELECTORS.TURNSTILE_RESPONSE,
      { timeout: LOGIN_TIMEOUT_MS }
    );
    console.log("[auth] Turnstile 캡챠 토큰 확인 완료");
  } catch {
    console.warn("[auth] Turnstile 토큰 대기 타임아웃 — 로그인 버튼 클릭 시도");
  }

  await page.waitForTimeout(ACTION_DELAY_MS);

  // 로그인 버튼 클릭
  await page.locator(LOGIN_SELECTORS.SUBMIT).click();

  // 로그인 성공 대기
  try {
    // 방법 1: 마이페이지 링크 등장 (a[href*='my-page'])
    // 방법 2: 국내택배 예약 페이지로 리다이렉트
    // 방법 3: "로그아웃" 텍스트 등장 (가장 확실한 신호)
    await Promise.race([
      page.waitForSelector(LOGIN_SELECTORS.LOGGED_IN_INDICATOR, {
        timeout: LOGIN_TIMEOUT_MS,
      }),
      page.waitForURL("**/reservation-inquiry/**", {
        timeout: LOGIN_TIMEOUT_MS,
      }),
      page.waitForSelector("a:has-text('로그아웃')", {
        timeout: LOGIN_TIMEOUT_MS,
      }),
    ]);
    console.log("[auth] 로그인 성공");

    // 로그인 쿠키 저장 → 다음 실행 시 재사용
    await saveCookies();
  } catch {
    // 로그인 실패 원인 확인
    const bodyText = await page.evaluate(() =>
      document.body.innerText.substring(0, 300)
    );
    throw new Error(
      "로그인 실패: 60초 내에 로그인이 완료되지 않았습니다. " +
        "브라우저 창에서 캡챠를 확인하세요.\n" +
        `페이지 내용: ${bodyText}`
    );
  }
}

/**
 * 로그인 상태를 보장한다. 미로그인 시 로그인 시도.
 */
export async function ensureLoggedIn(page: Page): Promise<void> {
  const loggedIn = await isLoggedIn(page);
  if (!loggedIn) {
    await login(page);
  }
}
