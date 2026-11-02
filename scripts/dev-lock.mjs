// Next dev lock(.next/dev/lock) 공용 유틸 — predev.mjs 와 dev-stop.mjs 가 같이 쓴다.
//
// lock 에는 포트와 .next 를 쥔 dev 서버(next dev 의 자식 프로세스) pid 가 적힌다.
// pid 는 재부팅 뒤 다른 프로그램에 재사용될 수 있으므로, "살아있다"만으로는
// 우리 dev 서버라고 단정하지 않고 실행 파일·작업 폴더까지 확인한다.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";

export const LOCK = ".next/dev/lock";

/** lock 내용. 없으면 null, 손상됐으면 빈 객체 */
export function readLock() {
  if (!existsSync(LOCK)) return null;
  try {
    return JSON.parse(readFileSync(LOCK, "utf8"));
  } catch {
    return {};
  }
}

export function removeLock() {
  rmSync(LOCK, { force: true });
}

export function isAlive(pid) {
  if (typeof pid !== "number") return false;
  try {
    process.kill(pid, 0); // 신호 0 = 존재 여부만 확인 (아무 영향 없음)
    return true;
  } catch (e) {
    return e.code === "EPERM"; // 존재하지만 시그널 권한 없음 → 살아있음으로 간주
  }
}

/**
 * pid 가 이 프로젝트 폴더에서 실행 중인 node 프로세스인지 확인.
 *   true  → 이 프로젝트의 dev 서버
 *   false → pid 가 다른 프로그램에 재사용됨
 *   null  → 확인 불가 (lsof 없음 등)
 */
export function isOwnDevServer(pid) {
  let out;
  try {
    // -Fcn: 실행 파일 이름(c)과 작업 폴더 경로(n)만 출력
    out = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fcn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    // lsof 는 대상 프로세스가 없으면 exit 1 → 우리 서버 아님
    return e.code === "ENOENT" ? null : false;
  }
  const lines = out.split("\n");
  const command = lines.find((l) => l.startsWith("c"))?.slice(1);
  const cwd = lines.find((l) => l.startsWith("n"))?.slice(1);
  if (command !== "node" || !cwd) return false;
  try {
    return realpathSync(cwd) === realpathSync(process.cwd());
  } catch {
    return false;
  }
}

/** lock 의 startedAt(ms) → "10/28 11:47" */
export function formatStartedAt(ms) {
  if (typeof ms !== "number") return "시각 모름";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
