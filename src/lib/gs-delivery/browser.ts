import { chromium } from "playwright";

import type { Browser, BrowserContext, Page } from "playwright";

let browser: Browser | null = null;
let context: BrowserContext | null = null;

/**
 * Playwright 브라우저 인스턴스 (싱글턴, headed 모드).
 * 이미 열려 있으면 재사용, 닫혔으면 새로 시작.
 */
export async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;

  browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  browser.on("disconnected", () => {
    browser = null;
    context = null;
  });

  return browser;
}

/**
 * BrowserContext (로그인 세션 유지용).
 * 하나의 컨텍스트를 재활용하여 쿠키/세션 유지.
 */
export async function getContext(): Promise<BrowserContext> {
  if (context) return context;

  const b = await getBrowser();
  context = await b.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
  });

  return context;
}

/** 새 페이지(탭) 생성. 각 예약 작업마다 열고 완료 후 닫는다. */
export async function newPage(): Promise<Page> {
  const ctx = await getContext();
  return ctx.newPage();
}

/** 브라우저 + 컨텍스트 전체 정리 */
export async function closeBrowser(): Promise<void> {
  if (context) {
    await context.close().catch(() => {});
    context = null;
  }
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
