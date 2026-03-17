import fs from "fs";
import path from "path";

import { GS_URLS } from "./selectors";

export interface ReservationInfo {
  reservationNo: string;
  /** 운송장번호 — 아직 미배정이면 null */
  trackingNo: string | null;
}

/** 쿠키 파일 경로 */
const COOKIES_PATH = path.join(process.cwd(), "data", "cookies.json");

/**
 * GS택배 예약조회 페이지에서 운송장번호를 스크래핑한다.
 *
 * Playwright 대신 HTTP fetch + 쿠키를 사용하여
 * 서버(headless) 환경에서도 Cloudflare 차단 없이 동작한다.
 *
 * @param targetReservationNos booked 상태 주문의 bookingReservationNo 목록
 * @returns 매칭된 예약번호와 운송장번호 쌍 (운송장번호 없으면 trackingNo=null)
 */
export async function scrapeTrackingNumbers(
  targetReservationNos: string[]
): Promise<ReservationInfo[]> {
  if (targetReservationNos.length === 0) return [];

  // 쿠키 파일 읽기
  const cookieHeader = loadCookieHeader();
  if (!cookieHeader) {
    throw new Error(
      "GS택배 쿠키가 없습니다. 로컬에서 로그인하여 쿠키를 동기화해주세요."
    );
  }

  // DB의 예약번호는 "1195-2684-971" 형식, 사이트는 "11952684971" (대시 없음)
  // 양방향 매핑 생성: 정규화된번호 → 원본번호
  const normalizeNo = (no: string) => no.replace(/-/g, "");
  const normalizedToOriginal = new Map<string, string>();
  for (const no of targetReservationNos) {
    normalizedToOriginal.set(normalizeNo(no), no);
  }

  // HTTP로 예약 목록 페이지 가져오기
  const res = await fetch(GS_URLS.RESERVATION_LIST, {
    headers: {
      Cookie: cookieHeader,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
      Referer: "https://www.cvsnet.co.kr/",
    },
    redirect: "manual",
  });

  // 302 리다이렉트 = 세션 만료
  if (res.status === 302 || res.status === 301) {
    throw new Error(
      "GS택배 쿠키가 만료되었습니다. 로컬에서 로그인하여 쿠키를 동기화해주세요."
    );
  }

  if (!res.ok) {
    throw new Error(`GS택배 페이지 요청 실패: ${res.status}`);
  }

  const html = await res.text();

  // 로그인 상태 확인
  if (html.includes("비로그인") || html.includes("로그인이 필요")) {
    throw new Error(
      "GS택배 쿠키가 만료되었습니다. 로컬에서 로그인하여 쿠키를 동기화해주세요."
    );
  }

  // HTML 테이블에서 예약번호 + 운송장번호 추출
  const results: ReservationInfo[] = [];

  // <tbody> 내 <tr> 행 추출
  const tbodyMatch = html.match(/<tbody[\s\S]*?<\/tbody>/);
  if (!tbodyMatch) {
    console.log("[scrape-tracking] 예약 목록 테이블을 찾을 수 없습니다");
    return [];
  }

  const tbody = tbodyMatch[0];
  const rowRegex = /<tr[\s\S]*?<\/tr>/g;
  let rowMatch: RegExpExecArray | null;
  let rowCount = 0;

  while ((rowMatch = rowRegex.exec(tbody)) !== null) {
    const row = rowMatch[0];
    // <td> 셀 추출
    const cells: string[] = [];
    const cellRegex = /<td[\s\S]*?<\/td>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(row)) !== null) {
      // HTML 태그 제거하고 텍스트만 추출
      const text = cellMatch[0]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      cells.push(text);
    }

    if (cells.length < 8) continue;
    rowCount++;

    // 예약번호 (3번째 셀, index 2)
    const rawReservationNo = cells[2].trim();
    // 운송장번호 (8번째 셀, index 7) — "363172788124 운송장 출력" 형태
    const trackingMatch = cells[7].match(/\d{8,}/);
    const trackingNo = trackingMatch ? trackingMatch[0] : null;

    // 정규화 매핑으로 원본 예약번호 찾기
    const originalNo = normalizedToOriginal.get(rawReservationNo);
    if (originalNo) {
      results.push({ reservationNo: originalNo, trackingNo });
      console.log(
        `[scrape-tracking] ✅ 매칭: ${originalNo} → ${trackingNo ?? "미배정"}`
      );
    }
  }

  console.log(
    `[scrape-tracking] HTTP 스크래핑 완료 — 행: ${rowCount}, 매칭: ${results.length}/${targetReservationNos.length}`
  );

  return results;
}

/**
 * 쿠키 파일에서 Cookie 헤더 문자열을 생성한다.
 */
function loadCookieHeader(): string | null {
  try {
    if (!fs.existsSync(COOKIES_PATH)) return null;
    const raw = fs.readFileSync(COOKIES_PATH, "utf-8");
    const cookies = JSON.parse(raw) as Array<{
      name: string;
      value: string;
    }>;
    if (!Array.isArray(cookies) || cookies.length === 0) return null;
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return null;
  }
}
