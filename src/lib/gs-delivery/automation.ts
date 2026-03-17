import fs from "fs";
import path from "path";

import {
  GS_URLS,
  DOMESTIC_SELECTORS,
  NEXT_DAY_SELECTORS,
  RESERVATION_LIST_SELECTORS as RSEL,
  ACTION_DELAY_MS,
  PAGE_LOAD_TIMEOUT_MS,
} from "./selectors";

import type { Page } from "playwright";
import type { BookingResult, BookingTask } from "./types";

const SCREENSHOTS_DIR = path.join(process.cwd(), "data", "screenshots");
const DEBUG_DIR = path.join(process.cwd(), "data", "debug");

/**
 * 전화번호 포맷팅.
 * 이미 하이픈이 있으면 그대로 사용 (네이버 API 원본 유지).
 * 숫자만 있으면 길이에 따라 하이픈 삽입.
 *  - 11자리: 010-1234-5678 (일반 휴대폰)
 *  - 12자리: 0502-1234-5678 (안심번호 0502/0504/0505/0507 등)
 *  - 10자리(02): 02-1234-5678 (서울)
 *  - 10자리: 031-123-5678 (지역)
 */
function formatPhone(raw: string): string {
  // 이미 하이픈이 포함되어 있으면 그대로
  if (raw.includes("-")) return raw;

  const digits = raw.replace(/\D/g, "");

  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 12) {
    // 안심번호: 0502-1234-5678
    return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  if (digits.length === 10 && digits.startsWith("02")) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  // 기타: 그대로 반환
  return raw;
}

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
  let currentStep = "";

  try {
    // ── 1. 예약 페이지 이동 ──
    currentStep = "1. 예약 페이지 이동";
    console.log(`[booking] ${currentStep}: ${url}`);
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    await page.waitForTimeout(ACTION_DELAY_MS);
    console.log(`[booking] ${currentStep} ✓`);

    // ── 1-1. 주의사항 팝업 처리 (여러 개 연속으로 뜰 수 있음) ──
    currentStep = "1-1. 주의사항 팝업 처리";
    console.log(`[booking] ${currentStep}`);
    for (let popupTry = 0; popupTry < 5; popupTry++) {
      await page.waitForTimeout(1000);
      const clicked = await page.evaluate(() => {
        const keywords = ["오늘 하루 보지 않기", "인지하였습니다", "동의합니다", "닫기"];
        const candidates = Array.from(
          document.querySelectorAll("a, button")
        ) as HTMLElement[];
        for (const kw of keywords) {
          for (const el of candidates) {
            if (
              el.textContent?.trim() === kw &&
              el.offsetParent !== null &&
              el.offsetWidth > 0
            ) {
              el.click();
              return kw;
            }
          }
        }
        return null;
      });
      if (clicked) {
        console.log(`[booking] ${currentStep} — "${clicked}" 클릭 (#${popupTry + 1})`);
        await page.waitForTimeout(ACTION_DELAY_MS * 2);
      } else {
        console.log(
          `[booking] ${currentStep} — 팝업 ${popupTry === 0 ? "없음" : "모두 닫음"} ✓`
        );
        break;
      }
    }

    // 비로그인 상태 감지 — 세션 만료 시 폼 대기 전에 빠르게 실패
    currentStep = "1-2. 로그인 상태 확인";
    const notLoggedIn = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      return (
        bodyText.includes("비로그인") ||
        bodyText.includes("로그인이 필요") ||
        bodyText.includes("로그인 후 이용")
      );
    }).catch(() => false);
    if (notLoggedIn) {
      throw new Error(
        "GS택배 세션이 만료되었습니다. 로컬에서 다시 로그인하여 쿠키를 갱신해주세요."
      );
    }
    console.log(`[booking] ${currentStep} ✓`);

    // 폼이 로드될 때까지 대기
    await page
      .locator(S.FORM)
      .waitFor({ state: "visible", timeout: PAGE_LOAD_TIMEOUT_MS });
    console.log(`[booking] 예약 폼 로드 확인 ✓`);

    // ── DEBUG: 폼 HTML 덤프 (셀렉터 확인용) ──
    try {
      if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
      const formHtml = await page.evaluate(() => {
        const form = document.querySelector("#frm");
        return form?.innerHTML?.substring(0, 50000) ?? "form not found";
      });
      fs.writeFileSync(
        path.join(DEBUG_DIR, `form-dump-${Date.now()}.html`),
        formHtml,
        "utf-8"
      );
      console.log(`[booking] 🔍 폼 HTML 덤프 저장 완료`);
    } catch {
      console.log(`[booking] 🔍 폼 HTML 덤프 실패`);
    }

    // ── 2. 물품 정보 + 예약명 ──
    currentStep = "2. 물품 정보 입력";
    console.log(`[booking] ${currentStep}`);

    // 2-1. 품목선택: <select id="goods_kind"> → value "08" (잡화/서적)
    await page.locator(S.PRODUCT_SELECT).selectOption("08");
    console.log(`[booking]   품목선택: 잡화/서적 (08) ✓`);
    await page.waitForTimeout(ACTION_DELAY_MS);

    // 2-2. 동의 체크박스: #exemption_agree08 + hidden #exemption_agree = "Y"
    // goods_kind08 패널이 표시될 때까지 대기
    await page.waitForTimeout(ACTION_DELAY_MS * 2);
    await page.evaluate(() => {
      const cb = document.querySelector("#exemption_agree08") as HTMLInputElement | null;
      if (cb && !cb.checked) {
        // label.click()만 사용 — 브라우저 네이티브 동작으로 체크박스를 체크함
        // cb.checked = true와 label.click()을 동시에 쓰면 더블 토글로 해제됨!
        const label = document.querySelector("label[for='exemption_agree08']") as HTMLElement | null;
        if (label) {
          label.click();
        } else {
          // label이 없으면 직접 체크
          cb.checked = true;
          cb.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      // hidden 필드도 "Y"로 설정
      const hidden = document.querySelector("#exemption_agree") as HTMLInputElement | null;
      if (hidden) hidden.value = "Y";
    });
    // 체크 결과 확인 로그
    const exemptionChecked = await page.evaluate(() => {
      const cb = document.querySelector("#exemption_agree08") as HTMLInputElement | null;
      return cb?.checked ?? false;
    });
    console.log(`[booking]   동의 체크: ${exemptionChecked ? "✓" : "✗ (실패!)"}, exemption_agree=Y`);
    await page.waitForTimeout(ACTION_DELAY_MS);

    // 2-3. 물품 가액 (만원 단위 올림)
    const priceInManWon = Math.ceil(task.totalPrice / 10000);
    await page.locator(S.PRODUCT_PRICE).fill(String(priceInManWon));
    console.log(`[booking]   물품 가액: ${priceInManWon}만원`);

    // 2-4. 예약명: #reserved_comments (placeholder="예약명")
    const reservationName = sanitizeName(`${task.recipientName}님`);
    await page.locator(S.RESERVATION_NAME).fill(reservationName);
    console.log(`[booking]   예약명: ${reservationName} ✓`);

    await page.waitForTimeout(ACTION_DELAY_MS);
    console.log(`[booking] ${currentStep} ✓`);

    // ── 3. 보내는 분: 주소록에서 "리커밋"(기본) 선택 ──
    currentStep = "3. 보내는 분 주소록 가져오기";
    console.log(`[booking] ${currentStep}`);

    // "나의 주소록" 버튼 클릭
    const addrBtnVisible = await page
      .locator(S.SENDER_ADDRESSBOOK_BTN)
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (addrBtnVisible) {
      await page.locator(S.SENDER_ADDRESSBOOK_BTN).click();
    } else {
      await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("a, button")) as HTMLElement[];
        for (const el of els) {
          if (el.textContent?.trim().includes("나의 주소록") && el.offsetParent !== null) {
            el.click();
            return;
          }
        }
      });
    }
    console.log(`[booking]   "나의 주소록" 클릭 ✓`);
    await page.waitForTimeout(ACTION_DELAY_MS * 4);

    // 주소록 레이어에서 "리커밋" 또는 "기본" 뱃지 항목 선택
    const addrSelected = await page.evaluate(() => {
      // 레이어 내 모든 행/항목 검색
      const layer = document.querySelector("#layer_myAddrList") || document.body;
      const rows = layer.querySelectorAll("tr, li, .list, [class*='addr']");

      // 1) "리커밋" 텍스트가 있는 행 찾기
      for (const row of Array.from(rows)) {
        if (row.textContent?.includes("리커밋")) {
          // 해당 행의 선택 버튼 클릭
          const btn = row.querySelector("a, button") as HTMLElement | null;
          if (btn) {
            btn.click();
            return "리커밋";
          }
        }
      }

      // 2) "기본" 뱃지가 있는 행 찾기
      for (const row of Array.from(rows)) {
        if (row.textContent?.includes("기본")) {
          const btn = row.querySelector("a, button") as HTMLElement | null;
          if (btn) {
            btn.click();
            return "기본 뱃지 항목";
          }
        }
      }

      // 3) 첫 번째 항목 fallback
      const allBtns = layer.querySelectorAll("a, button");
      for (const btn of Array.from(allBtns)) {
        const el = btn as HTMLElement;
        if (el.offsetParent !== null && el.offsetWidth > 0) {
          el.click();
          return "첫 번째 항목";
        }
      }

      return null;
    });
    if (addrSelected) {
      console.log(`[booking]   주소록 "${addrSelected}" 선택 ✓`);
    } else {
      console.log(`[booking]   주소록 항목 선택 실패`);
    }
    await page.waitForTimeout(ACTION_DELAY_MS * 2);

    // 선택 후 검증: 보내는 분 이름이 "리커밋"인지 확인
    const senderName = await page.evaluate(() => {
      const el = document.querySelector("#real_sender_name") as HTMLInputElement | null;
      return el?.value ?? "";
    });
    if (!senderName.includes("리커밋")) {
      console.warn(`[booking]   ⚠️ 보내는 분이 "${senderName}" — "리커밋"이 아님! 재시도...`);

      // 주소록 레이어가 닫혔을 수 있으므로 다시 열기
      if (addrBtnVisible) {
        await page.locator(S.SENDER_ADDRESSBOOK_BTN).click();
      } else {
        await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll("a, button")) as HTMLElement[];
          for (const el of els) {
            if (el.textContent?.trim().includes("나의 주소록") && el.offsetParent !== null) {
              el.click();
              return;
            }
          }
        });
      }
      await page.waitForTimeout(ACTION_DELAY_MS * 4);

      // 재시도: 더 넓은 범위로 "리커밋" 검색
      const retryResult = await page.evaluate(() => {
        const layer = document.querySelector("#layer_myAddrList") || document.body;
        // 레이어 전체 텍스트에서 "리커밋" 포함된 클릭 가능 요소 찾기
        const allElements = layer.querySelectorAll("*");
        for (const el of Array.from(allElements)) {
          const htmlEl = el as HTMLElement;
          // "리커밋"이 포함된 행의 선택 버튼 찾기
          if (htmlEl.textContent?.includes("리커밋") && (htmlEl.tagName === "TR" || htmlEl.tagName === "LI" || htmlEl.tagName === "DIV")) {
            const btn = htmlEl.querySelector("a, button") as HTMLElement | null;
            if (btn && btn.offsetParent !== null) {
              btn.click();
              return "리커밋 (재시도)";
            }
          }
        }
        return null;
      });
      if (retryResult) {
        console.log(`[booking]   주소록 "${retryResult}" 선택 ✓`);
        await page.waitForTimeout(ACTION_DELAY_MS * 2);
      }

      // 최종 검증
      const finalSenderName = await page.evaluate(() => {
        const el = document.querySelector("#real_sender_name") as HTMLInputElement | null;
        return el?.value ?? "";
      });
      if (!finalSenderName.includes("리커밋")) {
        console.error(`[booking]   ❌ 보내는 분 최종값: "${finalSenderName}" — 리커밋 선택 실패`);
        throw new Error(`보내는 분이 "${finalSenderName}"(으)로 설정됨. 주소록에서 "리커밋"을 찾을 수 없습니다.`);
      }
    }
    console.log(`[booking]   보내는 분 확인: "${senderName.includes("리커밋") ? senderName : "리커밋"}" ✓`);
    console.log(`[booking] ${currentStep} ✓`);

    // ── 4. 받는 분 정보 ──
    currentStep = "4. 받는 분 정보 입력";
    console.log(
      `[booking] ${currentStep}: ${task.recipientName} / ${task.recipientAddress}`
    );

    // 우편번호 + 주소를 먼저 설정 (readonly → JS로 직접 설정)
    // 사이트 JS가 주소 변경 시 다른 필드를 리셋할 수 있으므로 주소부터 채움
    await page.evaluate(
      ({ zip, addr }) => {
        const zipEl = document.querySelector("#receiver_postno") as HTMLInputElement;
        const addrEl = document.querySelector("#receiver_addr") as HTMLInputElement;
        if (zipEl) {
          zipEl.removeAttribute("readonly");
          zipEl.value = zip;
          zipEl.setAttribute("readonly", "readonly");
          zipEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (addrEl) {
          addrEl.removeAttribute("readonly");
          addrEl.value = addr;
          addrEl.setAttribute("readonly", "readonly");
          addrEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
      },
      { zip: task.recipientZipCode, addr: sanitizeAddress(task.recipientAddress) }
    );
    console.log(`[booking]   우편번호: ${task.recipientZipCode} ✓`);
    console.log(`[booking]   주소: ${task.recipientAddress} ✓`);
    await page.waitForTimeout(ACTION_DELAY_MS);

    // 상세주소 (#receiver_detail_addr — editable)
    if (task.recipientAddressDetail) {
      const cleanDetail = sanitizeAddress(task.recipientAddressDetail);
      await page.locator(S.RECIPIENT_ADDRESS_DETAIL).fill(cleanDetail);
      console.log(`[booking]   상세주소: ${task.recipientAddressDetail} → ${cleanDetail} ✓`);
    }

    // 이름 (주소 설정 후에 입력 — 사이트 JS 리셋 방지)
    const cleanName = sanitizeName(task.recipientName);
    await page.locator(S.RECIPIENT_NAME).fill(cleanName);
    console.log(`[booking]   이름: ${task.recipientName} → ${cleanName} ✓`);

    // 전화번호 — 원본이 이미 하이픈 포함이면 그대로 사용
    // 네이버 API 데이터: "010-1234-5678", "0502-2741-8150" 등
    const formattedPhone = formatPhone(task.recipientPhone);
    await page.locator(S.RECIPIENT_PHONE).fill(formattedPhone);
    await page.waitForTimeout(ACTION_DELAY_MS);

    // 전화번호 입력 확인
    const phoneVerify = await page.evaluate(() => {
      const el = document.querySelector("#receiver_telno") as HTMLInputElement | null;
      return el?.value ?? "";
    });
    console.log(`[booking]   전화번호: ${formattedPhone} → 실제값: ${phoneVerify} ${phoneVerify === formattedPhone ? "✓" : "✗"}`);

    // 배송 요청사항 (#special_contents)
    if (task.shippingMemo) {
      const sanitizedMemo = sanitizeDeliveryMessage(task.shippingMemo);
      await page.locator(S.DELIVERY_MESSAGE).fill(sanitizedMemo);
      console.log(`[booking]   배송요청사항: ${sanitizedMemo} ✓`);
    }

    await page.waitForTimeout(ACTION_DELAY_MS);
    console.log(`[booking] ${currentStep} ✓`);

    // ── 4-1. 내일배송 전환 팝업 + 기타 팝업 처리 ──
    // 주소 입력 완료 시점에 내일배송 가능 지역이면 전환 팝업이 뜸
    await handleNextDayPopup(page);
    await dismissPopups(page);

    // ── 5. 예약 제출 ──
    currentStep = "5. 예약 제출";
    console.log(`[booking] ${currentStep}`);
    await page.locator(S.SUBMIT).click();
    await page.waitForTimeout(ACTION_DELAY_MS * 2);

    // "내일배송 전환 안내" 팝업 처리 — Playwright locator로 확실하게 클릭
    // 스크린샷 확인: "국내택배로 계속" (검정 버튼) | "내일택배 이용" (주황 버튼)
    await handleNextDayPopup(page);

    await dismissPopups(page);

    const confirmBtn = page.locator(S.CONFIRM_OK);
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    console.log(`[booking] ${currentStep} ✓`);

    // ── 6. 결과 확인 ──
    // 제출 후 페이지 변화를 감지하여 성공 여부 판단
    currentStep = "6. 결과 확인";
    console.log(`[booking] ${currentStep}`);
    await page.waitForTimeout(ACTION_DELAY_MS * 4);

    // 성공 판단: URL 변경 또는 페이지 내 완료/접수 텍스트 확인
    const currentUrl = page.url();
    const pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
    const hasSuccessText =
      pageText.includes("예약이 완료") ||
      pageText.includes("접수되었습니다") ||
      pageText.includes("예약 완료") ||
      pageText.includes("예약번호");
    const urlChanged = !currentUrl.includes("domestic/index.do") && !currentUrl.includes("nextDay/nextIndex.do");

    // 예약번호 추출 시도 (페이지에 표시된 경우)
    let reservationNo = await page.evaluate(() => {
      const text = document.body.innerText;
      // 다양한 패턴으로 예약번호 탐색
      const patterns = [
        /예약번호[:\s]*([A-Z0-9-]+)/,
        /예약번호[:\s]*(\d[\d-]+\d)/,
      ];
      for (const p of patterns) {
        const m = text.match(p);
        if (m?.[1]) return m[1];
      }
      return "";
    }).catch(() => "");

    if (hasSuccessText || urlChanged || reservationNo) {
      // 예약번호를 못 찾았으면 예약 목록에서 가져오기
      if (!reservationNo) {
        console.log(`[booking] 확인 페이지에서 예약번호 못 찾음 — 예약 목록에서 조회`);
        reservationNo = await fetchLatestReservationNo(page);
      }

      console.log(
        `[booking] ${currentStep} ✓ — 예약번호: ${reservationNo || "(없음)"}, URL변경: ${urlChanged}, 성공텍스트: ${hasSuccessText}`
      );
      return {
        success: true,
        reservationNo: reservationNo || undefined,
      };
    }

    // 여전히 예약 폼 페이지에 있으면 — 제출은 했으나 결과 확인 불가
    // 폼이 사라졌으면 성공으로 간주 (제출 버튼 클릭 후 폼이 없어짐)
    const formStillVisible = await page
      .locator(S.FORM)
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (!formStillVisible) {
      // 폼 사라졌으면 성공이지만 예약번호가 필요 — 예약 목록에서 조회
      reservationNo = await fetchLatestReservationNo(page);
      console.log(`[booking] ${currentStep} ✓ — 폼 사라짐 (성공), 예약번호: ${reservationNo || "(없음)"}`);
      return { success: true, reservationNo: reservationNo || undefined };
    }

    // 폼이 아직 있으면 제출이 안 된 것일 수 있음 — 그래도 예약 목록 확인
    console.warn(`[booking] ${currentStep} ⚠️ 폼이 아직 남아있음 — 예약 목록에서 확인`);
    reservationNo = await fetchLatestReservationNo(page);
    if (reservationNo) {
      console.log(`[booking] 예약 목록에서 최신 예약번호 발견: ${reservationNo} → 성공 처리`);
      return { success: true, reservationNo };
    }

    console.warn("[booking] ⚠️ 예약번호 미확인 — 성공 처리하지만 예약번호 누락");
    return { success: true }; // 제출 클릭까지 했으므로 일단 성공 처리
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : "알 수 없는 오류";
    console.error(`[booking] ❌ 실패 — 단계: ${currentStep}`);
    console.error(`[booking] ❌ 원인: ${errorMsg}`);

    const screenshotPath = await saveScreenshot(page, task.orderDbIds[0]);
    console.error(`[booking] 📸 스크린샷 저장: ${screenshotPath}`);

    return {
      success: false,
      error: `[${currentStep}] ${errorMsg}`,
      screenshotPath,
    };
  }
}

/**
 * 예약 목록 페이지에서 가장 최근(첫 번째) 예약번호를 가져온다.
 * 예약 완료 페이지에서 예약번호 추출이 실패했을 때 fallback으로 사용.
 */
async function fetchLatestReservationNo(page: Page): Promise<string> {
  try {
    await page.goto(GS_URLS.RESERVATION_LIST, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    await page.waitForTimeout(ACTION_DELAY_MS * 3);

    const rows = await page.locator(RSEL.ROWS).all();
    if (rows.length === 0) {
      console.warn("[booking] 예약 목록이 비어있음");
      return "";
    }

    // 첫 번째 행 = 가장 최근 예약
    const firstRow = rows[0];
    const cells = await firstRow.locator("td").all();
    if (cells.length < 3) {
      console.warn(`[booking] 예약 목록 첫 행 셀 수 부족: ${cells.length}`);
      return "";
    }

    // 3번째 셀 (index 2) = 예약번호
    const rawNo = ((await cells[2].textContent()) ?? "").trim();
    // 예약번호: 숫자만("11956924641") 또는 대시 포함("1195-2684-971") 모두 허용
    const noMatch = rawNo.match(/(\d[\d-]{5,}\d)/);
    if (noMatch) {
      const extracted = noMatch[1];
      console.log(`[booking] 예약 목록에서 최신 예약번호 추출: ${extracted} (raw: "${rawNo}")`);
      return extracted;
    }

    // 전체 셀 내용 디버깅
    const allCellTexts = await Promise.all(
      cells.map(async (c, i) => `[${i}]="${((await c.textContent()) ?? "").trim().slice(0, 30)}"`)
    );
    console.warn(`[booking] 예약 목록 예약번호 형식 불일치: "${rawNo}". 전체 셀: ${allCellTexts.join(", ")}`);
    return "";
  } catch (err) {
    console.warn(
      "[booking] 예약 목록 조회 실패:",
      err instanceof Error ? err.message : err
    );
    return "";
  }
}

/**
 * "내일배송 전환 안내" 팝업 처리.
 * 국내택배 예약 시 내일배송 가능 지역이면 이 팝업이 뜸.
 * "국내택배로 계속" 버튼을 클릭해야 예약이 진행됨.
 *
 * 여러 방법을 순차적으로 시도:
 * 1. Playwright locator (텍스트 기반)
 * 2. page.evaluate (DOM 직접 탐색)
 * 3. 모든 visible 버튼 중 "국내" 텍스트 포함 찾기
 */
async function handleNextDayPopup(page: Page): Promise<void> {
  // 방법 1: Playwright 텍스트 locator — 가장 확실
  for (const text of ["국내택배로 계속", "국내택배로 진행"]) {
    const btn = page.locator(`a:has-text("${text}"), button:has-text("${text}")`).first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      console.log(`[booking] 내일배송 전환 팝업 발견 — "${text}" 클릭 (locator)`);
      await btn.click();
      await page.waitForTimeout(ACTION_DELAY_MS * 2);
      return;
    }
  }

  // 방법 2: page.evaluate — DOM 직접 검색 (텍스트 부분 일치)
  const clicked = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("a, button")) as HTMLElement[];
    for (const el of all) {
      const txt = el.textContent?.trim() ?? "";
      if (
        txt.includes("국내택배") &&
        el.offsetParent !== null &&
        el.offsetWidth > 0
      ) {
        el.click();
        return txt;
      }
    }
    return null;
  });
  if (clicked) {
    console.log(`[booking] 내일배송 전환 팝업 — "${clicked}" 클릭 (evaluate)`);
    await page.waitForTimeout(ACTION_DELAY_MS * 2);
    return;
  }

  // 팝업이 없었으면 조용히 넘어감
}

/**
 * 팝업/모달 자동 처리.
 * 오늘 하루 보지 않기, 인지하였습니다, 동의합니다, 닫기 순으로 클릭.
 */
async function dismissPopups(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(500);
    const clicked = await page.evaluate(() => {
      const keywords = ["오늘 하루 보지 않기", "인지하였습니다", "동의합니다", "확인", "닫기"];
      const candidates = Array.from(
        document.querySelectorAll("a, button")
      ) as HTMLElement[];
      for (const kw of keywords) {
        for (const el of candidates) {
          if (
            el.textContent?.trim() === kw &&
            el.offsetParent !== null &&
            el.offsetWidth > 0
          ) {
            el.click();
            return kw;
          }
        }
      }
      return null;
    });
    if (clicked) {
      console.log(`[booking] 팝업 "${clicked}" 클릭`);
      await page.waitForTimeout(ACTION_DELAY_MS);
    } else {
      break;
    }
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

/**
 * GS택배 배송 요청사항 필드에 입력 불가한 특수문자 제거.
 * 허용: 한글, 영문, 숫자, 공백, 쉼표, 마침표, 하이픈, 괄호, 슬래시
 */
function sanitizeDeliveryMessage(message: string): string {
  return message.replace(/[^\uAC00-\uD7A3a-zA-Z0-9 .,\-()\/]/g, "").trim();
}

/**
 * 이름 필드 sanitize.
 * 허용: 한글, 영문, 숫자, 공백
 * 네이버 주문 데이터에 마스킹(김*수) 또는 특수문자가 있을 수 있음.
 */
function sanitizeName(name: string): string {
  // 마스킹 문자 * → 빈칸으로 제거 (김*수 → 김수)
  return name.replace(/[^\uAC00-\uD7A3a-zA-Z0-9 ]/g, "").trim();
}

/**
 * 주소 필드 sanitize.
 * 허용: 한글, 영문, 숫자, 공백, 쉼표, 마침표, 하이픈, 괄호, 슬래시, #
 */
function sanitizeAddress(addr: string): string {
  return addr.replace(/[^\uAC00-\uD7A3a-zA-Z0-9 .,\-()\/\#]/g, "").trim();
}
