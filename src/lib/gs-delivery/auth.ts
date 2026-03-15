import {
  GS_URLS,
  LOGIN_SELECTORS,
  LOGIN_TIMEOUT_MS,
  ACTION_DELAY_MS,
} from "./selectors";

import type { Page } from "playwright";

/**
 * 현재 로그인 상태를 확인한다.
 * 국내택배 페이지에 접근하여 로그인 여부를 판별.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (!url.includes("cvsnet.co.kr")) {
      await page.goto(GS_URLS.DOMESTIC, { waitUntil: "domcontentloaded" });
    }

    return await page
      .locator(LOGIN_SELECTORS.LOGGED_IN_INDICATOR)
      .isVisible({ timeout: 3000 })
      .catch(() => false);
  } catch {
    return false;
  }
}

/**
 * cvsnet.co.kr에 로그인한다.
 *
 * 캡챠가 있을 경우 사용자가 headed 브라우저에서 직접 풀 때까지
 * 최대 LOGIN_TIMEOUT_MS(60초)간 대기.
 *
 * @throws 60초 내 로그인 미완료 시 에러
 */
export async function login(page: Page): Promise<void> {
  const username = process.env.GS_USERNAME;
  const password = process.env.GS_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "GS_USERNAME 또는 GS_PASSWORD가 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }

  await page.goto(GS_URLS.LOGIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(ACTION_DELAY_MS);

  // ID/PW 입력
  await page.locator(LOGIN_SELECTORS.USERNAME).fill(username);
  await page.locator(LOGIN_SELECTORS.PASSWORD).fill(password);
  await page.waitForTimeout(ACTION_DELAY_MS);

  // 로그인 버튼 클릭
  await page.locator(LOGIN_SELECTORS.SUBMIT).click();

  // 로그인 성공 대기 (캡챠 시 사용자 수동 개입 대기 포함)
  try {
    await page.waitForSelector(LOGIN_SELECTORS.LOGGED_IN_INDICATOR, {
      timeout: LOGIN_TIMEOUT_MS,
    });
  } catch {
    throw new Error(
      "로그인 실패: 60초 내에 로그인이 완료되지 않았습니다. " +
        "브라우저 창에서 캡챠를 확인하세요."
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
