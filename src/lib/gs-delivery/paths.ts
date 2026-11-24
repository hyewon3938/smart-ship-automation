import path from "path";

/** 쿠키 저장 경로 — 로그인 세션 재사용과 서버 스크래핑이 함께 쓴다 */
export const COOKIES_PATH = path.join(process.cwd(), "data", "cookies.json");

/** 예약 실패 시 스크린샷 저장 폴더 */
export const SCREENSHOTS_DIR = path.join(process.cwd(), "data", "screenshots");

/** 폼을 찾지 못했을 때 HTML 덤프 저장 폴더 */
export const DEBUG_DIR = path.join(process.cwd(), "data", "debug");
