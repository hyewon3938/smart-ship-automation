import fs from "fs";
import path from "path";

import {
  GS_URLS,
  DOMESTIC_SELECTORS,
  NEXT_DAY_SELECTORS,
  ACTION_DELAY_MS,
  PAGE_LOAD_TIMEOUT_MS,
} from "./selectors";

import type { Page } from "playwright";
import type { BookingResult, BookingTask } from "./types";

const SCREENSHOTS_DIR = path.join(process.cwd(), "data", "screenshots");

/**
 * 국내택배 예약 1건 실행
 */
export async function bookDomestic(
  page: Page,
  task: BookingTask
): Promise<BookingResult> {
  return fillAndSubmitForm(page, task, GS_URLS.DOMESTIC, DOMESTIC_SELECTORS);
}

/**
 * 내일배송 예약 1건 실행
 */
export async function bookNextDay(
  page: Page,
  task: BookingTask
): Promise<BookingResult> {
  return fillAndSubmitForm(page, task, GS_URLS.NEXT_DAY, NEXT_DAY_SELECTORS);
}

/**
 * 예약 폼 공통 로직.
 * 국내택배와 내일배송이 동일 구조이므로 URL과 셀렉터만 주입받는다.
 * 구조가 크게 다르면 이 함수를 분리한다.
 */
async function fillAndSubmitForm(
  page: Page,
  task: BookingTask,
  url: string,
  S: typeof DOMESTIC_SELECTORS
): Promise<BookingResult> {
  try {
    // ── 1. 예약 페이지 이동 ──
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    await page.waitForTimeout(ACTION_DELAY_MS);

    // ── 2. 물품 정보 ──
    // 물품선택: select 또는 radio 등 사이트 구조에 따라 조정
    // TODO: 실제 사이트 확인 후 selectOption / click 결정
    // await page.locator(S.PRODUCT_SELECT).selectOption("기타");
    await page.locator(S.PRODUCT_PRICE).fill(String(task.totalPrice));
    await page
      .locator(S.RESERVATION_NAME)
      .fill(`네이버-${task.recipientName}`);
    await page.waitForTimeout(ACTION_DELAY_MS);

    // ── 3. 보내는 분: 주소록에서 가져오기 ──
    await page.locator(S.SENDER_ADDRESSBOOK_BTN).click();
    await page.waitForTimeout(ACTION_DELAY_MS);

    // 주소록 팝업이 새 창(popup)인 경우:
    //   const popup = await page.waitForEvent("popup");
    //   await popup.locator(S.SENDER_ADDRESSBOOK_FIRST).click();
    //   await popup.close();
    //
    // 같은 페이지 내 모달인 경우:
    await page.locator(S.SENDER_ADDRESSBOOK_FIRST).click();
    await page.waitForTimeout(ACTION_DELAY_MS);
    // TODO: 실제 주소록 UI 구조 확인 후 popup vs modal 분기

    // ── 4. 받는 분 정보 ──
    await page.locator(S.RECIPIENT_NAME).fill(task.recipientName);
    await page
      .locator(S.RECIPIENT_PHONE)
      .fill(task.recipientPhone.replace(/-/g, ""));

    // 우편번호: 직접 입력 가능한 경우 fill, readonly면 검색 팝업 자동화 필요
    // TODO: 우편번호 필드가 readonly인지 확인
    await page.locator(S.RECIPIENT_ZIPCODE).fill(task.recipientZipCode);
    await page.locator(S.RECIPIENT_ADDRESS).fill(task.recipientAddress);
    if (task.recipientAddressDetail) {
      await page
        .locator(S.RECIPIENT_ADDRESS_DETAIL)
        .fill(task.recipientAddressDetail);
    }
    await page.waitForTimeout(ACTION_DELAY_MS);

    // ── 5. 제출 ──
    await page.locator(S.SUBMIT).click();

    // 확인 팝업이 뜨는 경우 (예: "예약하시겠습니까?")
    const confirmBtn = page.locator(S.CONFIRM_OK);
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // ── 6. 결과 확인 ──
    await page.waitForSelector(S.SUCCESS_INDICATOR, {
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });

    const reservationNo = await page
      .locator(S.RESERVATION_NO)
      .textContent()
      .then((t) => t?.trim() ?? "")
      .catch(() => "");

    return {
      success: true,
      reservationNo: reservationNo || undefined,
    };
  } catch (error) {
    const screenshotPath = await saveScreenshot(page, task.orderId);
    return {
      success: false,
      error: error instanceof Error ? error.message : "알 수 없는 오류",
      screenshotPath,
    };
  }
}

/**
 * 에러 시 스크린샷 저장.
 * 경로: data/screenshots/order-{id}-{timestamp}.png
 */
async function saveScreenshot(
  page: Page,
  orderId: number
): Promise<string> {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const filename = `order-${orderId}-${Date.now()}.png`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);

  await page.screenshot({ path: filepath, fullPage: true });
  return filepath;
}
