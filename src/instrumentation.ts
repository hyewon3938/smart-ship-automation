/**
 * Next.js instrumentation hook — 서버 프로세스 시작 시 1회 호출.
 * DEPLOY_MODE=server일 때만 발송처리 자동 폴링을 시작한다.
 * 로컬(DEPLOY_MODE=local 또는 미설정) 에서는 폴링을 시작하지 않는다.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DEPLOY_MODE !== "server") return;

  const { startDispatchPolling } = await import("@/lib/dispatch-worker");
  startDispatchPolling();
  console.log("[instrumentation] 서버 모드 — 발송처리 폴링 자동 시작");
}
