import fs from "fs";
import path from "path";

import {
  GS_URLS,
  DOMESTIC_SELECTORS,
  VISIT_PICKUP_SELECTORS as VP,
  ACTION_DELAY_MS,
  PAGE_LOAD_TIMEOUT_MS,
} from "./selectors";

import type { Page } from "playwright";
import type { BookingResult, VisitPickupTask } from "./types";

const SCREENSHOTS_DIR = path.join(process.cwd(), "data", "screenshots");
const DEBUG_DIR = path.join(process.cwd(), "data", "debug");

/**
 * 전화번호 포맷팅 (automation.ts와 동일 로직).
 */
function formatPhone(raw: string): string {
  if (raw.includes("-")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11)
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 12)
    return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`;
  if (digits.length === 10 && digits.startsWith("02"))
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 10)
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return raw;
}

function sanitizeName(name: string): string {
  // "주문자(수령인)" 형식이면 수령인만 추출
  const parenMatch = name.match(/\(([^)]+)\)/);
  const extracted = parenMatch ? parenMatch[1] : name;
  return extracted.replace(/[^\uAC00-\uD7A3a-zA-Z0-9 ]/g, "").trim();
}

function sanitizeAddress(addr: string): string {
  return addr.replace(/[^\uAC00-\uD7A3a-zA-Z0-9 .,\-()\/\#]/g, "").trim();
}

/**
 * 방문택배 다량 접수 폼 자동 입력.
 * 여러 수령인 정보를 하나의 방문택배 예약 폼에 입력한다.
 * 예약하기 버튼은 클릭하지 않음 (사용자가 직접 결제).
 */
export async function bookVisitPickup(
  page: Page,
  task: VisitPickupTask
): Promise<BookingResult> {
  let currentStep = "";

  try {
    // 알럿(confirm/alert) 자동 수락 핸들러
    page.on("dialog", async (dialog) => {
      console.log(`[visit-pickup] 알럿 자동 수락: "${dialog.message()}"`);
      await dialog.accept();
    });

    // ── 1. 방문택배 페이지 이동 ──
    currentStep = "1. 방문택배 페이지 이동";
    console.log(`[visit-pickup] ${currentStep}: ${GS_URLS.VISIT_PICKUP}`);
    await page.goto(GS_URLS.VISIT_PICKUP, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    await page.waitForTimeout(ACTION_DELAY_MS * 2);
    console.log(`[visit-pickup] ${currentStep} ✓`);

    // ── 1-1. 주의사항 팝업 처리 → "인지하였습니다" 클릭 ──
    currentStep = "1-1. 주의사항 팝업 처리";
    console.log(`[visit-pickup] ${currentStep}`);
    for (let popupTry = 0; popupTry < 5; popupTry++) {
      await page.waitForTimeout(1000);
      const clicked = await page.evaluate(() => {
        const keywords = ["인지하였습니다", "오늘 하루 보지 않기", "동의합니다", "닫기"];
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
        console.log(`[visit-pickup] ${currentStep} — "${clicked}" 클릭 (#${popupTry + 1})`);
        await page.waitForTimeout(ACTION_DELAY_MS * 2);
      } else {
        console.log(
          `[visit-pickup] ${currentStep} — 팝업 ${popupTry === 0 ? "없음" : "모두 닫음"} ✓`
        );
        break;
      }
    }

    // 비로그인 상태 감지
    currentStep = "1-2. 로그인 상태 확인";
    const notLoggedIn = await page
      .evaluate(() => {
        const bodyText = document.body.innerText;
        return (
          bodyText.includes("비로그인") ||
          bodyText.includes("로그인이 필요") ||
          bodyText.includes("로그인 후 이용")
        );
      })
      .catch(() => false);
    if (notLoggedIn) {
      throw new Error(
        "GS택배 세션이 만료되었습니다. 로컬에서 다시 로그인하여 쿠키를 갱신해주세요."
      );
    }
    console.log(`[visit-pickup] ${currentStep} ✓`);

    // ── 2. 체크박스 → 알럿 확인 → "다량 접수" 카드 클릭 ──
    currentStep = "2. 체크박스 + 다량 접수 클릭";
    console.log(`[visit-pickup] ${currentStep}`);

    // "접수 수량 및 운임을 확인 하였습니다." 체크박스 클릭
    await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll("label")) as HTMLLabelElement[];
      for (const label of labels) {
        if (label.textContent?.includes("접수 수량 및 운임을 확인")) {
          label.click();
          return "label";
        }
      }
      // label이 없으면 체크박스 직접 찾기
      const checkboxes = Array.from(
        document.querySelectorAll("input[type='checkbox']")
      ) as HTMLInputElement[];
      for (const cb of checkboxes) {
        const parent = cb.closest("div, li, p, span, td");
        if (parent?.textContent?.includes("접수 수량 및 운임을 확인")) {
          cb.checked = true;
          cb.dispatchEvent(new Event("change", { bubbles: true }));
          return "checkbox";
        }
      }
      return null;
    });
    console.log(`[visit-pickup]   체크박스 클릭 ✓`);
    await page.waitForTimeout(ACTION_DELAY_MS);

    // div.execution_cjone_2 카드 클릭 → confirm 알럿은 page.on("dialog") 핸들러가 자동 수락
    await page.locator(".execution_cjone_2").click();
    console.log(`[visit-pickup]   "다량 접수" 클릭 ✓`);
    await page.waitForTimeout(ACTION_DELAY_MS * 3);

    // 폼 로드 대기
    await page
      .locator(DOMESTIC_SELECTORS.FORM)
      .waitFor({ state: "visible", timeout: PAGE_LOAD_TIMEOUT_MS });
    console.log(`[visit-pickup] ${currentStep} ✓`);

    // ── DEBUG: 폼 HTML 덤프 ──
    try {
      if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
      const formHtml = await page.evaluate(() => {
        const form = document.querySelector("#frm");
        return form?.innerHTML?.substring(0, 50000) ?? "form not found";
      });
      fs.writeFileSync(
        path.join(DEBUG_DIR, `visit-pickup-form-${Date.now()}.html`),
        formHtml,
        "utf-8"
      );
      console.log(`[visit-pickup] 🔍 폼 HTML 덤프 저장 완료`);
    } catch {
      console.log(`[visit-pickup] 🔍 폼 HTML 덤프 실패`);
    }

    // ── 3. 물품 정보 입력 ──
    currentStep = "3. 물품 정보 입력";
    console.log(`[visit-pickup] ${currentStep}`);

    const S = DOMESTIC_SELECTORS;

    // 품목선택: 잡화/서적 (08)
    await page.locator(S.PRODUCT_SELECT).selectOption("08");
    console.log(`[visit-pickup]   품목선택: 잡화/서적 (08) ✓`);
    await page.waitForTimeout(ACTION_DELAY_MS);

    // 동의 체크박스
    await page.waitForTimeout(ACTION_DELAY_MS * 2);
    await page.evaluate(() => {
      const cb = document.querySelector("#exemption_agree08") as HTMLInputElement | null;
      if (cb && !cb.checked) {
        const label = document.querySelector(
          "label[for='exemption_agree08']"
        ) as HTMLElement | null;
        if (label) {
          label.click();
        } else {
          cb.checked = true;
          cb.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      const hidden = document.querySelector("#exemption_agree") as HTMLInputElement | null;
      if (hidden) hidden.value = "Y";
    });
    console.log(`[visit-pickup]   동의 체크 ✓`);
    await page.waitForTimeout(ACTION_DELAY_MS);

    // 물품 가액 (1건 기준, 만원 올림)
    const priceInManWon = Math.ceil(task.unitPrice / 10000);
    await page.locator(S.PRODUCT_PRICE).fill(String(priceInManWon));
    console.log(`[visit-pickup]   물품 가액: ${priceInManWon}만원 ✓`);

    // 예약명: "리뷰어 발송" (고정)
    await page.locator(S.RESERVATION_NAME).fill("리뷰어 발송");
    console.log(`[visit-pickup]   예약명: 리뷰어 발송 ✓`);

    await page.waitForTimeout(ACTION_DELAY_MS);
    console.log(`[visit-pickup] ${currentStep} ✓`);

    // ── 4. 방문 희망일: 첫 번째 옵션 선택 ──
    currentStep = "4. 방문 희망일 선택";
    console.log(`[visit-pickup] ${currentStep}`);
    await page.evaluate(() => {
      // 라디오 버튼 방식
      const radios = Array.from(
        document.querySelectorAll("input[name='pickup_hope_date'], input[name='visit_date'], input[type='radio'][name*='date'], input[type='radio'][name*='hope']")
      ) as HTMLInputElement[];
      if (radios.length > 0) {
        radios[0].checked = true;
        radios[0].dispatchEvent(new Event("change", { bubbles: true }));
        // 연결된 label 클릭
        const label = document.querySelector(`label[for='${radios[0].id}']`) as HTMLElement | null;
        if (label) label.click();
        return "radio";
      }
      // select 방식 fallback
      const selects = Array.from(
        document.querySelectorAll("select")
      ) as HTMLSelectElement[];
      for (const sel of selects) {
        const parent = sel.closest("div, td, tr, li");
        if (parent?.textContent?.includes("방문") && parent?.textContent?.includes("희망")) {
          if (sel.options.length > 1) {
            sel.selectedIndex = 1; // 첫 번째 실제 옵션 (0은 placeholder일 수 있음)
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return "select";
          }
        }
      }
      return null;
    });
    console.log(`[visit-pickup] ${currentStep} ✓`);
    await page.waitForTimeout(ACTION_DELAY_MS);

    // ── 5. 택배 전달방식: "부재중으로 현관문 앞에 두겠습니다." ──
    currentStep = "5. 택배 전달방식 선택";
    console.log(`[visit-pickup] ${currentStep}`);
    await page.evaluate(() => {
      const keyword = "부재중으로 현관문 앞에 두겠습니다";
      // 라디오/체크박스 + label 방식
      const labels = Array.from(document.querySelectorAll("label")) as HTMLLabelElement[];
      for (const label of labels) {
        if (label.textContent?.includes(keyword)) {
          label.click();
          return "label";
        }
      }
      // select option 방식
      const selects = Array.from(document.querySelectorAll("select")) as HTMLSelectElement[];
      for (const sel of selects) {
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].textContent?.includes("부재중")) {
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return "select";
          }
        }
      }
      return null;
    });
    console.log(`[visit-pickup] ${currentStep} ✓`);
    await page.waitForTimeout(ACTION_DELAY_MS);

    // ── 6. 보내는 분: 주소록에서 "리커밋" 선택 ──
    currentStep = "6. 보내는 분 주소록 가져오기";
    console.log(`[visit-pickup] ${currentStep}`);
    await selectSenderFromAddressBook(page, S);
    console.log(`[visit-pickup] ${currentStep} ✓`);

    // ── 7. 받는 분 정보 입력 (N명) ──
    currentStep = "7. 받는 분 정보 입력";
    console.log(`[visit-pickup] ${currentStep}: ${task.recipients.length}명`);

    for (let i = 0; i < task.recipients.length; i++) {
      const recipient = task.recipients[i];
      console.log(
        `[visit-pickup]   [${i + 1}/${task.recipients.length}] ${recipient.recipientName}`
      );

      if (i === 0) {
        // 첫 번째 수령인: 기본 폼에 입력
        await fillRecipientForm(page, recipient, 0);

        // 박스 크기: "2kg 이하" + 버튼 → 1개
        await selectBoxSize(page, 0);
      } else if (i === 1) {
        // 두 번째 수령인: #btn_receiver_add 클릭 → alert는 전역 핸들러가 자동 수락
        console.log(`[visit-pickup]     #btn_receiver_add 클릭`);

        await page.locator(VP.RECEIVER_ADD_BTN).click();
        await page.waitForTimeout(ACTION_DELAY_MS * 3);

        await fillRecipientForm(page, recipient, i);
        await selectBoxSize(page, i);
      } else {
        // 세 번째 이후: .btn_receiver_plus 클릭
        console.log(`[visit-pickup]     .btn_receiver_plus 클릭`);

        // 가장 마지막에 표시된 + 버튼 클릭
        await page.evaluate(() => {
          const btns = Array.from(
            document.querySelectorAll(".muchPlusBtn.btn_receiver_plus, .btn_receiver_plus")
          ) as HTMLElement[];
          // 마지막 visible 버튼 클릭
          for (let j = btns.length - 1; j >= 0; j--) {
            if (btns[j].offsetParent !== null && btns[j].offsetWidth > 0) {
              btns[j].click();
              return;
            }
          }
        });
        await page.waitForTimeout(ACTION_DELAY_MS * 3);

        await fillRecipientForm(page, recipient, i);
        await selectBoxSize(page, i);
      }

      console.log(
        `[visit-pickup]   [${i + 1}/${task.recipients.length}] ${recipient.recipientName} ✓`
      );
    }

    console.log(`[visit-pickup] ${currentStep} ✓`);

    // ── 완료: 예약하기 버튼 클릭 안 함 ──
    console.log(`[visit-pickup] ✅ 폼 입력 완료 — ${task.recipients.length}명 수령인`);
    console.log(`[visit-pickup] 📋 브라우저에서 확인 후 "예약하기"를 클릭해주세요.`);

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "알 수 없는 오류";
    console.error(`[visit-pickup] ❌ 실패 — 단계: ${currentStep}`);
    console.error(`[visit-pickup] ❌ 원인: ${errorMsg}`);

    const screenshotPath = await saveScreenshot(page, task.allOrderDbIds[0]);
    console.error(`[visit-pickup] 📸 스크린샷 저장: ${screenshotPath}`);

    return {
      success: false,
      error: `[${currentStep}] ${errorMsg}`,
      screenshotPath,
    };
  }
}

/**
 * 보내는 분 주소록에서 "리커밋" 선택.
 * automation.ts의 동일 로직 재사용.
 */
async function selectSenderFromAddressBook(
  page: Page,
  S: typeof DOMESTIC_SELECTORS
): Promise<void> {
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
  console.log(`[visit-pickup]   "나의 주소록" 클릭 ✓`);
  await page.waitForTimeout(ACTION_DELAY_MS * 4);

  // 주소록에서 "리커밋" 항목 선택
  const addrSelected = await page.evaluate(() => {
    const layer = document.querySelector("#layer_myAddrList") || document.body;
    const rows = layer.querySelectorAll("tr, li, .list, [class*='addr']");

    for (const row of Array.from(rows)) {
      if (row.textContent?.includes("리커밋")) {
        const btn = row.querySelector("a, button") as HTMLElement | null;
        if (btn) {
          btn.click();
          return "리커밋";
        }
      }
    }

    for (const row of Array.from(rows)) {
      if (row.textContent?.includes("기본")) {
        const btn = row.querySelector("a, button") as HTMLElement | null;
        if (btn) {
          btn.click();
          return "기본 뱃지 항목";
        }
      }
    }

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
    console.log(`[visit-pickup]   주소록 "${addrSelected}" 선택 ✓`);
  }
  await page.waitForTimeout(ACTION_DELAY_MS * 2);

  // 검증
  const senderName = await page.evaluate(() => {
    const el = document.querySelector("#real_sender_name") as HTMLInputElement | null;
    return el?.value ?? "";
  });
  if (!senderName.includes("리커밋")) {
    console.warn(
      `[visit-pickup]   ⚠️ 보내는 분이 "${senderName}" — "리커밋"이 아님! 재시도...`
    );

    // 재시도: 주소록 다시 열기
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

    await page.evaluate(() => {
      const layer = document.querySelector("#layer_myAddrList") || document.body;
      const allElements = layer.querySelectorAll("*");
      for (const el of Array.from(allElements)) {
        const htmlEl = el as HTMLElement;
        if (
          htmlEl.textContent?.includes("리커밋") &&
          (htmlEl.tagName === "TR" || htmlEl.tagName === "LI" || htmlEl.tagName === "DIV")
        ) {
          const btn = htmlEl.querySelector("a, button") as HTMLElement | null;
          if (btn && btn.offsetParent !== null) {
            btn.click();
            return;
          }
        }
      }
    });
    await page.waitForTimeout(ACTION_DELAY_MS * 2);

    const finalSenderName = await page.evaluate(() => {
      const el = document.querySelector("#real_sender_name") as HTMLInputElement | null;
      return el?.value ?? "";
    });
    if (!finalSenderName.includes("리커밋")) {
      throw new Error(
        `보내는 분이 "${finalSenderName}"(으)로 설정됨. 주소록에서 "리커밋"을 찾을 수 없습니다.`
      );
    }
  }
  console.log(`[visit-pickup]   보내는 분 확인: "리커밋" ✓`);
}

/**
 * 수령인 폼에 배송 정보 입력.
 * index는 0-based (0=첫 번째 수령인 = 기본 폼, 1+=추가된 폼).
 */
async function fillRecipientForm(
  page: Page,
  recipient: VisitPickupTask["recipients"][number],
  index: number
): Promise<void> {
  // 방문택배 다량 접수 폼의 수령인 필드 ID 패턴:
  // 첫 번째: #receiver_name, #receiver_telno, #receiver_postno, #receiver_addr, #receiver_detail_addr
  // 두 번째+: 인덱스 붙은 ID 또는 동적 생성 — evaluate로 N번째 수령인 폼 찾아서 입력
  await page.evaluate(
    ({ name, phone, zip, addr, detail, idx }) => {
      // N번째 수령인 폼 영역 찾기 전략:
      // 1) id 패턴으로 찾기 (receiver_name, receiver_name2, receiver_name3...)
      // 2) name 패턴으로 찾기
      // 3) 순서 기반 fallback

      function getField(baseId: string, altNames: string[]): HTMLInputElement | null {
        // 첫 번째는 기본 ID
        if (idx === 0) {
          return document.querySelector(`#${baseId}`) as HTMLInputElement | null;
        }

        // 두 번째 이후: 다양한 ID 패턴 시도
        const suffixes = [String(idx + 1), `_${idx + 1}`, `${idx}`];
        for (const suffix of suffixes) {
          const el = document.querySelector(`#${baseId}${suffix}`) as HTMLInputElement | null;
          if (el) return el;
        }

        // name 속성으로 시도
        for (const altName of altNames) {
          const all = Array.from(
            document.querySelectorAll(`input[name='${altName}'], input[name*='${altName}']`)
          ) as HTMLInputElement[];
          if (all.length > idx) return all[idx];
        }

        // 마지막 fallback: 같은 class/구조의 N번째 요소
        const allWithId = Array.from(
          document.querySelectorAll(`[id^='${baseId}']`)
        ) as HTMLInputElement[];
        if (allWithId.length > idx) return allWithId[idx];

        return null;
      }

      // 우편번호 (readonly → JS 직접 설정)
      const zipEl = getField("receiver_postno", ["receiver_postno"]);
      if (zipEl) {
        zipEl.removeAttribute("readonly");
        zipEl.value = zip;
        zipEl.setAttribute("readonly", "readonly");
        zipEl.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // 주소 (readonly → JS 직접 설정)
      const addrEl = getField("receiver_addr", ["receiver_addr"]);
      if (addrEl) {
        addrEl.removeAttribute("readonly");
        addrEl.value = addr;
        addrEl.setAttribute("readonly", "readonly");
        addrEl.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // 상세주소
      if (detail) {
        const detailEl = getField("receiver_detail_addr", ["receiver_detail_addr"]);
        if (detailEl) {
          detailEl.value = detail;
          detailEl.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }

      // 이름
      const nameEl = getField("receiver_name", ["receiver_name"]);
      if (nameEl) {
        nameEl.value = name;
        nameEl.dispatchEvent(new Event("input", { bubbles: true }));
      }

      // 전화번호
      const phoneEl = getField("receiver_telno", ["receiver_telno"]);
      if (phoneEl) {
        phoneEl.value = phone;
        phoneEl.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    {
      name: sanitizeName(recipient.recipientName),
      phone: formatPhone(recipient.recipientPhone),
      zip: recipient.recipientZipCode,
      addr: sanitizeAddress(recipient.recipientAddress),
      detail: recipient.recipientAddressDetail
        ? sanitizeAddress(recipient.recipientAddressDetail)
        : "",
      idx: index,
    }
  );

  console.log(
    `[visit-pickup]     ${recipient.recipientName}: ${recipient.recipientZipCode} ${recipient.recipientAddress} ✓`
  );
  await page.waitForTimeout(ACTION_DELAY_MS);
}

/**
 * 박스 크기 선택: "2kg 이하" + 버튼 클릭 → 수량 1개.
 */
async function selectBoxSize(page: Page, recipientIndex: number): Promise<void> {
  // 각 수령인별 박스 크기 섹션에서 첫 번째 행(2kg 이하)의 + 버튼 클릭
  // onclick="visitCtrl.calculateFare(this, 'p')" 패턴의 a 태그
  await page.evaluate((idx) => {
    // 모든 "박스 크기 및 수량" 테이블 찾기 — 각 수령인마다 하나씩 있음
    const fareInfoSpans = Array.from(
      document.querySelectorAll("span.fareInfo")
    ) as HTMLElement[];

    // 수령인별로 그룹화: data-group-id 또는 순서로 구분
    // 첫 번째 수령인의 첫 번째 fareInfo가 2kg 이하
    // 각 수령인당 5개 사이즈(2kg, 5kg, 10kg, 15kg, 20kg)
    const SIZES_PER_RECIPIENT = 5;
    const targetSpanIndex = idx * SIZES_PER_RECIPIENT; // 각 수령인의 첫 번째(2kg) 스팬

    if (targetSpanIndex < fareInfoSpans.length) {
      const targetSpan = fareInfoSpans[targetSpanIndex];
      // 같은 행(tr/td)에 있는 + 버튼 찾기
      const row = targetSpan.closest("tr") || targetSpan.parentElement;
      if (row) {
        const plusBtn = row.querySelector(
          "a[onclick*=\"calculateFare\"][onclick*=\"'p'\"]"
        ) as HTMLElement | null;
        if (plusBtn) {
          plusBtn.click();
          return;
        }
      }
    }

    // fallback: idx번째 "2kg" 텍스트 근처의 + 버튼
    const rows = Array.from(document.querySelectorAll("tr")) as HTMLElement[];
    let found = 0;
    for (const row of rows) {
      if (row.textContent?.includes("2kg") && row.querySelector("a[onclick*=\"calculateFare\"]")) {
        if (found === idx) {
          const plusBtn = row.querySelector(
            "a[onclick*=\"calculateFare\"][onclick*=\"'p'\"]"
          ) as HTMLElement | null;
          if (plusBtn) {
            plusBtn.click();
            return;
          }
        }
        found++;
      }
    }
  }, recipientIndex);

  console.log(`[visit-pickup]     박스 크기: 2kg 이하 × 1 ✓`);
  await page.waitForTimeout(ACTION_DELAY_MS);
}

async function saveScreenshot(page: Page, orderId: number): Promise<string> {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
  const filename = `visit-pickup-${orderId}-${Date.now()}.png`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  return filepath;
}
