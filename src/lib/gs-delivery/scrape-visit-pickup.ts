import fs from "fs";
import path from "path";

import { maskId } from "@/lib/log-mask";

import { GS_URLS } from "./selectors";
import type { VisitDispatchInfo, VisitRecipientLine } from "./types";

/** 쿠키 파일 경로 (scrape-tracking과 공유) */
const COOKIES_PATH = path.join(process.cwd(), "data", "cookies.json");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * GS 예약list에서 "구분=방문" 행을 찾고, 각 예약의 상세페이지에서
 * 수령인 매핑((우편번호, 전화 끝4, 운송장)을 추출한다.
 *
 * Playwright 대신 HTTP fetch + 쿠키를 사용 — 서버(headless) 환경에서도
 * Cloudflare 차단 없이 동작.
 *
 * @param knownReservationNos 이미 처리된 방문 예약번호 (재처리 방지용 제외 집합)
 * @returns 신규 발견된 방문 예약들의 매핑 정보 (이미 처리된 건은 제외)
 */
export async function scrapeVisitPickup(
  knownReservationNos: string[],
): Promise<VisitDispatchInfo[]> {
  const cookieHeader = loadCookieHeader();
  if (!cookieHeader) {
    throw new Error(
      "GS택배 쿠키가 없습니다. 로컬에서 로그인하여 쿠키를 동기화해주세요.",
    );
  }

  // 1. 예약list HTML fetch
  const listHtml = await fetchListPage(cookieHeader);

  // 2. 방문 행만 골라 예약번호 추출
  const candidateNos = extractVisitReservationNos(listHtml);
  if (candidateNos.length === 0) {
    console.log("[scrape-visit-pickup] 방문택배 행 없음");
    return [];
  }

  // 3. 알려진 예약번호 제외 (정규화 키 기준)
  const knownSet = new Set(knownReservationNos.map(normalizeNo));
  const targets = candidateNos.filter((no) => !knownSet.has(normalizeNo(no)));
  if (targets.length === 0) {
    console.log(
      `[scrape-visit-pickup] 방문택배 ${candidateNos.length}건 모두 처리됨`,
    );
    return [];
  }

  // 4. 각 신규 예약의 상세페이지 fetch + 파싱
  const results: VisitDispatchInfo[] = [];
  for (const reservationNo of targets) {
    try {
      const detailHtml = await fetchDetailPage(reservationNo, cookieHeader);
      const recipients = parseVisitDetailPage(detailHtml);
      if (recipients.length === 0) {
        console.warn(
          `[scrape-visit-pickup] ⚠️ 상세페이지 수령인 파싱 0건 — ${maskId(reservationNo)} (마스킹 포맷 변경 가능성)`,
        );
        continue;
      }
      results.push({ reservationNo, recipients });
      console.log(
        `[scrape-visit-pickup] ✅ ${maskId(reservationNo)} → 수령인 ${recipients.length}명`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      console.warn(
        `[scrape-visit-pickup] ⚠️ 상세페이지 fetch 실패 (${maskId(reservationNo)}): ${msg}`,
      );
    }
  }

  console.log(
    `[scrape-visit-pickup] 완료 — 방문행 ${candidateNos.length}건, 신규 ${targets.length}건, 파싱 성공 ${results.length}건`,
  );

  return results;
}

/**
 * 방문택배 상세페이지 HTML에서 수령인 줄을 모두 추출한다.
 *
 * `.delMInfo` 블록 단위로 슬라이스 → 블록 내에서:
 *  - 우편번호: `[XXXXX]` 패턴
 *  - 전화 끝4: `010-****-NNNN` 형식
 *  - 운송장: `<a class="num">XXXXXXXXXXXX</a>`
 *
 * 세 값이 모두 추출되어야 1건 추가 (한 항목이라도 빠지면 skip).
 *
 * 단위 테스트용으로 export.
 */
export function parseVisitDetailPage(html: string): VisitRecipientLine[] {
  const lines: VisitRecipientLine[] = [];

  // delMInfo 블록 시작 인덱스 모두 수집 → 슬라이스
  const blockStartRegex = /<div\b[^>]*\bclass\s*=\s*"[^"]*\bdelMInfo\b[^"]*"/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockStartRegex.exec(html)) !== null) {
    starts.push(m.index);
  }

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = starts[i + 1] ?? html.length;
    const block = html.slice(start, end);

    const zipMatch = block.match(/\[(\d{5})\]/);
    const phoneMatch = block.match(/010-\*+-(\d{4})/);
    const trackingMatch = block.match(
      /<a[^>]*class="num"[^>]*>\s*(\d{8,})\s*<\/a>/,
    );

    if (zipMatch && phoneMatch && trackingMatch) {
      lines.push({
        zipCode: zipMatch[1],
        phoneLast4: phoneMatch[1],
        trackingNo: trackingMatch[1],
      });
    }
  }

  return lines;
}

// ─── 내부 유틸 ───

/** 예약list HTML 가져오기 (scrape-tracking과 같은 패턴) */
async function fetchListPage(cookieHeader: string): Promise<string> {
  const res = await fetch(GS_URLS.RESERVATION_LIST, {
    headers: {
      Cookie: cookieHeader,
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
      Referer: "https://www.cvsnet.co.kr/",
    },
    redirect: "manual",
  });

  if (res.status === 302 || res.status === 301) {
    throw new Error(
      "GS택배 쿠키가 만료되었습니다. 로컬에서 로그인하여 쿠키를 동기화해주세요.",
    );
  }
  if (!res.ok) {
    throw new Error(`GS택배 예약list 요청 실패: ${res.status}`);
  }

  const html = await res.text();
  if (html.includes("비로그인") || html.includes("로그인이 필요")) {
    throw new Error(
      "GS택배 쿠키가 만료되었습니다. 로컬에서 로그인하여 쿠키를 동기화해주세요.",
    );
  }
  return html;
}

/**
 * 방문택배 상세페이지 fetch.
 * `commonCtrl.setViewPage('detailsKey', '<no>', '...view.do')` 는 보통
 * form-encoded POST 호출 → POST로 시도. 실패 시 호출자가 다음 폴링에서 재시도.
 */
async function fetchDetailPage(
  reservationNo: string,
  cookieHeader: string,
): Promise<string> {
  const body = new URLSearchParams({ detailsKey: reservationNo });
  const res = await fetch(GS_URLS.VISIT_DETAIL, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9",
      Referer: GS_URLS.RESERVATION_LIST,
    },
    body: body.toString(),
    redirect: "manual",
  });

  if (res.status === 302 || res.status === 301) {
    throw new Error("쿠키 만료 또는 권한 없음");
  }
  if (!res.ok) {
    throw new Error(`상세페이지 응답: ${res.status}`);
  }
  return res.text();
}

/**
 * 예약list HTML에서 4번째 셀(구분)이 "방문"인 행의 예약번호(3번째 셀)를 추출.
 * 단위 테스트용으로 export.
 */
export function extractVisitReservationNos(html: string): string[] {
  const tbodyMatch = html.match(/<tbody[\s\S]*?<\/tbody>/);
  if (!tbodyMatch) return [];

  const tbody = tbodyMatch[0];
  const rowRegex = /<tr[\s\S]*?<\/tr>/g;
  const nos: string[] = [];
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(tbody)) !== null) {
    const row = rowMatch[0];
    const cells: string[] = [];
    const cellRegex = /<td[\s\S]*?<\/td>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(row)) !== null) {
      const text = cellMatch[0]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      cells.push(text);
    }

    if (cells.length < 4) continue;
    if (cells[3] !== "방문") continue;

    const no = cells[2].trim();
    if (no) nos.push(no);
  }

  return nos;
}

function loadCookieHeader(): string | null {
  try {
    if (!fs.existsSync(COOKIES_PATH)) return null;
    const raw = fs.readFileSync(COOKIES_PATH, "utf-8");
    const cookies = JSON.parse(raw) as Array<{ name: string; value: string }>;
    if (!Array.isArray(cookies) || cookies.length === 0) return null;
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return null;
  }
}

function normalizeNo(no: string): string {
  return no.replace(/-/g, "");
}
