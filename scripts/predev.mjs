// dev 서버 이중 실행 방지 가드.
//
// 배경: 예전 dev 스크립트는 매 실행마다 `rm -f .next/dev/lock` 로 Next 의 다중
// 인스턴스 방지 lock 을 지웠다. 그래서 `npm run dev` 를 두 번 돌리면 서버 2개가
// 같은 `.next` 빌드 캐시를 공유·오염시켜 모든 API 가 500/hang 나는 사고가 있었다.
//
// 이 스크립트는 lock 을 맹목적으로 지우지 않고, "그 lock 을 쥔 프로세스가 정말
// 살아있는지" 확인한다:
//   - 살아있으면  → 두 번째 실행을 막는다 (기존 서버를 쓰라고 안내, exit 1)
//   - 죽어있으면  → stale lock 이므로 지우고 정상 진행 (exit 0)
//   - lock 없음   → 그냥 진행 (exit 0)
import { existsSync, readFileSync, rmSync } from "node:fs";

const LOCK = ".next/dev/lock";

if (!existsSync(LOCK)) {
  process.exit(0);
}

let pid;
try {
  pid = JSON.parse(readFileSync(LOCK, "utf8")).pid;
} catch {
  pid = undefined; // 손상된 lock → stale 취급
}

function isAlive(p) {
  if (typeof p !== "number") return false;
  try {
    process.kill(p, 0); // 신호 0 = 존재 여부만 확인 (아무 영향 없음)
    return true;
  } catch (e) {
    return e.code === "EPERM"; // 존재하지만 시그널 권한 없음 → 살아있음으로 간주
  }
}

if (isAlive(pid)) {
  console.error(
    `\n✖ 이미 dev 서버가 실행 중입니다 (pid ${pid}).\n` +
      `  기존 창을 쓰거나 종료 후 다시 실행하세요 — dev 서버는 반드시 하나만.\n` +
      `  (두 개가 같은 .next 를 공유하면 모든 API 가 500/hang 납니다.)\n`,
  );
  process.exit(1);
}

// 여기까지 왔으면 lock 을 쥔 프로세스가 죽은 상태(stale) → 안전하게 제거
rmSync(LOCK, { force: true });
process.exit(0);
