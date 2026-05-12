/**
 * Next.js instrumentation hook — 서버 프로세스 시작 시 1회 호출.
 * - DEPLOY_MODE=server 이면 발송처리 자동 폴링을 시작한다.
 * - 종료 시그널(SIGINT/SIGTERM) 수신 시 Playwright 브라우저를 정리한다 (좀비 chromium 방지).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.DEPLOY_MODE === "server") {
    const { startDispatchPolling } = await import("@/lib/dispatch-worker");
    startDispatchPolling();
    console.log("[instrumentation] 서버 모드 — 발송처리 폴링 자동 시작");
  }

  registerShutdownHandlers();
}

let shutdownRegistered = false;

function registerShutdownHandlers(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`[instrumentation] ${signal} 수신 — graceful shutdown`);
    try {
      const { closeBrowser } = await import("@/lib/gs-delivery/browser");
      await closeBrowser();
    } catch (err) {
      console.error("[instrumentation] 브라우저 정리 실패:", err);
    }
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
