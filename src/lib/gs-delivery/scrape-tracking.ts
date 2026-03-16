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

  const targetSet = new Set(targetReservationNos);
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
      return [];
    }

    // 테이블 행 추출
    const rows = await page.locator(SEL.ROWS).all();

    for (const row of rows) {
      const cells = await row.locator("td").all();
      if (cells.length < 2) continue;

      const reservationNo = ((await cells[0].textContent()) ?? "").trim();
      const rawTracking = ((await cells[1].textContent()) ?? "").trim();
      // 숫자만 있으면 운송장번호로 판단, 그 외 빈칸/대시 등은 null
      const trackingNo = /^\d{8,}$/.test(rawTracking) ? rawTracking : null;

      if (targetSet.has(reservationNo)) {
        results.push({ reservationNo, trackingNo });
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  return results;
}
