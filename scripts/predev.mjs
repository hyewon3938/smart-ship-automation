// dev 서버 이중 실행 방지 가드.
//
// 배경: 예전 dev 스크립트는 매 실행마다 `rm -f .next/dev/lock` 로 Next 의 다중
// 인스턴스 방지 lock 을 지웠다. 그래서 `npm run dev` 를 두 번 돌리면 서버 2개가
// 같은 `.next` 빌드 캐시를 공유·오염시켜 모든 API 가 500/hang 나는 사고가 있었다.
//
// 이 스크립트는 lock 을 맹목적으로 지우지 않고, "그 lock 을 쥔 프로세스가 정말
// 이 프로젝트의 dev 서버로 살아있는지" 확인한다:
//   - 살아있으면  → 두 번째 실행을 막는다 (기존 서버 정보와 dev:stop 안내, exit 1)
//   - 죽어있거나 pid 가 다른 프로그램에 재사용됐으면 → stale lock 이므로 지우고 진행
//   - lock 없음   → 그냥 진행 (exit 0)
import {
  formatStartedAt,
  isAlive,
  isOwnDevServer,
  readLock,
  removeLock,
} from "./dev-lock.mjs";

const lock = readLock();
if (!lock) {
  process.exit(0);
}

const { pid, appUrl, startedAt } = lock;

// 확인 불가(null)는 안전하게 살아있는 우리 서버로 취급
if (isAlive(pid) && isOwnDevServer(pid) !== false) {
  console.error(
    `\n✖ 이미 dev 서버가 실행 중입니다 (pid ${pid}, ${appUrl ?? "주소 모름"}, ${formatStartedAt(startedAt)} 시작).\n` +
      `  그 서버를 그대로 쓰거나 npm run dev:stop 으로 종료한 뒤 다시 실행하세요 — dev 서버는 반드시 하나만.\n` +
      `  (두 개가 같은 .next 를 공유하면 모든 API 가 500/hang 납니다.)\n`,
  );
  process.exit(1);
}

// 여기까지 왔으면 lock 을 쥔 dev 서버가 없는 상태(stale) → 안전하게 제거
removeLock();
process.exit(0);
