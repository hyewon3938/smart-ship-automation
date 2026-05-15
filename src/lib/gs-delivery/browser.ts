import fs from "fs";
import path from "path";

import { chromium } from "playwright";

import type { Browser, BrowserContext, Page } from "playwright";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** 쿠키 저장 경로 — 로그인 세션 재사용용 */
const COOKIES_PATH = path.join(process.cwd(), "data", "cookies.json");

/** Idle 타임아웃 — 큐 비고 N분간 신규 작업 없으면 브라우저 자동 종료 */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** 서버 모드 여부 — DEPLOY_MODE=server 이면 headless */
const isServerMode = () => process.env.DEPLOY_MODE === "server";

/**
 * Playwright 브라우저 인스턴스 (싱글턴).
 * - 로컬(기본): headed 모드 (캡챠 수동 처리 가능)
 * - 서버(DEPLOY_MODE=server): headless 모드 (쿠키 재사용)
 */
export async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;

  registerShutdownHandlers();

  browser = await chromium.launch({
    headless: isServerMode(),
    args: [
      "--disable-blink-features=AutomationControlled",
      // 서버(Linux VM)에서 headless 실행 시 필요
      ...(isServerMode()
        ? [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
          ]
        : []),
    ],
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
 * 이전에 저장된 쿠키가 있으면 자동 복원.
 */
export async function getContext(): Promise<BrowserContext> {
  if (context) return context;

  const b = await getBrowser();
  context = await b.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
  });

  // 저장된 쿠키 복원 (로그인 세션 재사용)
  await restoreCookies(context);

  return context;
}

/** 새 페이지(탭) 생성. 각 예약 작업마다 열고 완료 후 닫는다. */
export async function newPage(): Promise<Page> {
  const ctx = await getContext();
  return ctx.newPage();
}

/** 현재 컨텍스트의 쿠키를 파일에 저장 */
export async function saveCookies(): Promise<void> {
  if (!context) return;
  try {
    const cookies = await context.cookies();
    const dir = path.dirname(COOKIES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
    console.log(`[browser] 쿠키 저장 완료 (${cookies.length}개)`);
  } catch {
    console.warn("[browser] 쿠키 저장 실패");
  }
}

/** 저장된 쿠키를 컨텍스트에 복원 */
async function restoreCookies(ctx: BrowserContext): Promise<void> {
  try {
    if (!fs.existsSync(COOKIES_PATH)) return;
    const raw = fs.readFileSync(COOKIES_PATH, "utf-8");
    const cookies = JSON.parse(raw);
    if (Array.isArray(cookies) && cookies.length > 0) {
      await ctx.addCookies(cookies);
      console.log(`[browser] 쿠키 복원 완료 (${cookies.length}개)`);
    }
  } catch {
    console.warn("[browser] 쿠키 복원 실패 — 새 세션으로 시작");
  }
}

/**
 * Idle 종료 타이머 시작. 이미 예약된 타이머가 있으면 재설정.
 * worker.ts에서 큐 처리 완료 시 호출.
 */
export function scheduleIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    console.log(
      `[browser] ${IDLE_TIMEOUT_MS / 1000 / 60}분간 idle — 자동 종료`,
    );
    void closeBrowser();
  }, IDLE_TIMEOUT_MS);
}

/**
 * Idle 종료 타이머 취소.
 * worker.ts에서 신규 작업 enqueue 시 호출.
 */
export function cancelIdleShutdown(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

let shutdownRegistered = false;

function registerShutdownHandlers(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`[browser] ${signal} 수신 — graceful shutdown`);
    try {
      await closeBrowser();
    } catch (err) {
      console.error("[browser] 브라우저 정리 실패:", err);
    }
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

/** 브라우저 + 컨텍스트 전체 정리 (쿠키 저장 후 종료) */
export async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  await saveCookies();
  if (context) {
    await context.close().catch(() => {});
    context = null;
  }
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
