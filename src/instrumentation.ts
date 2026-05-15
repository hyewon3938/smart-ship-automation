/**
 * Next.js instrumentation hook — 서버 프로세스 시작 시 1회 호출.
 * - DEPLOY_MODE=server 이면 발송처리 자동 폴링을 시작한다.
 *
 * Playwright 브라우저 SIGINT/SIGTERM 정리는 lib/gs-delivery/browser.ts에서
 * 최초 launch 시점에 자체 등록한다 (Edge runtime 빌드에서 playwright 트레이스 회피).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.DEPLOY_MODE === "server") {
    const { startDispatchPolling } = await import("@/lib/dispatch-worker");
    startDispatchPolling();
    console.log("[instrumentation] 서버 모드 — 발송처리 폴링 자동 시작");
  }
}
