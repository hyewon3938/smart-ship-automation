// `npm run dev:stop` — lock 에 적힌 dev 서버를 종료한다.
//
// 배경: 터미널 창이 종료 신호 없이 닫히면 next dev 의 자식 프로세스가 부모 없이
// 남아 포트와 lock 을 계속 쥔다. 이 프로세스는 SIGTERM 을 받으면 포트부터 닫고
// 남은 정리 단계에서 멈출 수 있는데, 평소 100ms 뒤 SIGKILL 해 주던 부모가 없어서
// 프로세스가 계속 남고 predev 가드가 새 실행을 막는다.
//
// 순서: SIGTERM → 일정 시간 안에 안 끝나면 SIGKILL → lock 제거 → 포트 확인.
// pid 가 이 프로젝트의 dev 서버인지 확인되지 않으면 아무것도 종료하지 않는다.
import { createServer } from "node:net";

import {
  formatStartedAt,
  isAlive,
  isOwnDevServer,
  readLock,
  removeLock,
} from "./dev-lock.mjs";

const TERM_TIMEOUT_MS = 5000;
const KILL_TIMEOUT_MS = 2000;

const lock = readLock();
if (!lock) {
  console.log("실행 중인 dev 서버가 없습니다.");
  process.exit(0);
}

const { pid, port, startedAt } = lock;

if (!isAlive(pid)) {
  removeLock();
  console.log(`이미 종료된 dev 서버(pid ${pid ?? "모름"})의 lock 을 지웠습니다.`);
  process.exit(0);
}

const own = isOwnDevServer(pid);
if (own === false) {
  removeLock();
  console.log(
    `pid ${pid} 는 이 프로젝트의 dev 서버가 아니라 종료하지 않았습니다. 남은 lock 만 지웠습니다.`,
  );
  process.exit(0);
}
if (own === null) {
  console.error(
    `✖ pid ${pid} 가 이 프로젝트의 dev 서버인지 확인할 수 없어 종료하지 않았습니다 (lsof 없음).\n` +
      `  직접 확인한 뒤 kill ${pid} 로 종료하세요.`,
  );
  process.exit(1);
}

console.log(
  `dev 서버를 종료합니다 (pid ${pid}, 포트 ${port ?? "모름"}, ${formatStartedAt(startedAt)} 시작).`,
);

process.kill(pid, "SIGTERM");
if (!(await waitForExit(pid, TERM_TIMEOUT_MS))) {
  console.log(`${TERM_TIMEOUT_MS / 1000}초 안에 끝나지 않아 강제 종료합니다.`);
  process.kill(pid, "SIGKILL");
  if (!(await waitForExit(pid, KILL_TIMEOUT_MS))) {
    console.error(`✖ pid ${pid} 를 강제 종료하지 못했습니다.`);
    process.exit(1);
  }
}

// 정상 종료면 Next 가 lock 을 지우지만, SIGKILL 이면 남는다
if (readLock()?.pid === pid) removeLock();

if (typeof port === "number" && !(await isPortFree(port))) {
  console.warn(
    `⚠ dev 서버는 종료했지만 포트 ${port} 를 다른 프로세스가 쓰고 있습니다.\n` +
      `  lsof -nP -iTCP:${port} -sTCP:LISTEN 로 확인하세요.`,
  );
} else {
  console.log("✓ 종료했습니다. npm run dev 로 다시 실행하세요.");
}

function waitForExit(p, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (!isAlive(p)) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(tick, 100);
    };
    tick();
  });
}

function isPortFree(p) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(p, () => server.close(() => resolve(true)));
  });
}
