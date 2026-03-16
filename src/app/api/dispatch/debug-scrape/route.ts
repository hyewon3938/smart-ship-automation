import { NextResponse } from "next/server";
import { newPage } from "@/lib/gs-delivery/browser";
import { ensureLoggedIn } from "@/lib/gs-delivery/auth";
import { GS_URLS, ACTION_DELAY_MS } from "@/lib/gs-delivery/selectors";

/** GET /api/dispatch/debug-scrape — 예약조회 페이지 HTML 구조 덤프 (디버그용) */
export async function GET() {
  const page = await newPage();
  try {
    await ensureLoggedIn(page);
    await page.goto(GS_URLS.RESERVATION_LIST, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(ACTION_DELAY_MS * 4);

    // 페이지 제목과 테이블 관련 HTML 추출
    const title = await page.title();
    const url = page.url();

    // 모든 테이블의 HTML 추출
    const tables = await page.evaluate(() => {
      const tbls = Array.from(document.querySelectorAll("table"));
      return tbls.map((t, i) => ({
        index: i,
        id: t.id,
        className: t.className,
        rowCount: t.rows.length,
        // 처음 3개 행만
        rows: Array.from(t.rows).slice(0, 5).map((row) => ({
          cells: Array.from(row.cells).map((cell) => ({
            text: cell.textContent?.trim().slice(0, 50),
            className: cell.className,
          })),
        })),
      }));
    });

    // tbody tr 카운트
    const rowCounts = await page.evaluate(() => {
      const selectors = [
        ".list_table tbody tr",
        "table.tbl_list tbody tr",
        "tbody tr",
        "tr",
      ];
      return selectors.map((sel) => ({
        selector: sel,
        count: document.querySelectorAll(sel).length,
      }));
    });

    return NextResponse.json({ title, url, tables, rowCounts });
  } finally {
    await page.close().catch(() => {});
  }
}
