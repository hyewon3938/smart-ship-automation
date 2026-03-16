import { newPage } from "./browser";
import { ensureLoggedIn } from "./auth";
import {
  GS_URLS,
  RESERVATION_LIST_SELECTORS as SEL,
  ACTION_DELAY_MS,
} from "./selectors";

export interface ReservationInfo {
  reservationNo: string;
  /** 운송장번호 — 아직 미배정이면 null */
  trackingNo: string | null;
}

/**
 * GS택배 예약조회 페이지에서 운송장번호를 스크래핑한다.
 *
 * @param targetReservationNos booked 상태 주문의 bookingReservationNo 목록
 * @returns 매칭된 예약번호와 운송장번호 쌍 (운송장번호 없으면 trackingNo=null)
 *
 * ⚠️ 셀렉터는 실제 사이트 DevTools로 확인 후 selectors.ts에서 교체할 것.
 */
export async function scrapeTrackingNumbers(
  targetReservationNos: string[]
): Promise<ReservationInfo[]> {
  if (targetReservationNos.length === 0) return [];

  // DB의 예약번호는 "1195-2684-971" 형식, 사이트는 "11952684971" (대시 없음)
  // 양방향 매핑 생성: 정규화된번호 → 원본번호
  const normalizeNo = (no: string) => no.replace(/-/g, "");
  const normalizedToOriginal = new Map<string, string>();
  for (const no of targetReservationNos) {
    normalizedToOriginal.set(normalizeNo(no), no);
  }

  const results: ReservationInfo[] = [];
  const page = await newPage();

  try {
    await ensureLoggedIn(page);
    await page.goto(GS_URLS.RESERVATION_LIST, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(ACTION_DELAY_MS * 2);

    // 데이터 없음 확인
    const noData = page.locator(SEL.NO_DATA).first();
    const noDataVisible = await noData.isVisible().catch(() => false);
    if (noDataVisible) {
      console.log("[scrape-tracking] 예약 목록이 비어있습니다");
      return [];
    }

    // 테이블 행 추출 (3번째 셀=예약번호, 8번째 셀=운송장번호)
    const rows = await page.locator(SEL.ROWS).all();
    console.log(`[scrape-tracking] 찾은 행 수: ${rows.length}, 대상: ${targetReservationNos.join(", ")}`);

    for (const row of rows) {
      const cells = await row.locator("td").all();
      if (cells.length < 8) continue;

      // 예약번호 (3번째 셀, index 2)
      const rawReservationNo = ((await cells[2].textContent()) ?? "").trim();
      // 운송장번호 (8번째 셀, index 7)
      // 셀 내용: "363172788124\n운송장 출력" 형태이므로 첫 번째 8자리+ 숫자 시퀀스 추출
      const rawTracking = ((await cells[7].textContent()) ?? "").trim();
      const trackingMatch = rawTracking.match(/\d{8,}/);
      const trackingNo = trackingMatch ? trackingMatch[0] : null;

      console.log(`[scrape-tracking] 예약번호="${rawReservationNo}", 운송장raw="${rawTracking.slice(0, 30)}", 추출="${trackingNo}"`);

      // 정규화 매핑으로 원본 예약번호 찾기
      const originalNo = normalizedToOriginal.get(rawReservationNo);
      if (originalNo) {
        results.push({ reservationNo: originalNo, trackingNo });
        console.log(`[scrape-tracking] ✅ 매칭: ${originalNo} → ${trackingNo ?? "미배정"}`);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  return results;
}
