/**
 * 일회성 스크립트: GS편의점택배 방문 예약 → 네이버 발송처리
 *
 * 흐름:
 *   1. GS 예약list 스크래핑 → 방문 row의 (reservationNo, recipients[zipCode, phoneLast4, trackingNo])
 *   2. 네이버 발송대기 주문 fetch
 *   3. (zipCode, phoneLast4) 매칭 → (productOrderId, trackingNo) 쌍 수집
 *   4. dry-run: 결과 출력만 / --apply: 네이버 dispatchOrders 호출
 *
 * 사용:
 *   npx tsx scripts/visit-pickup-once.ts            # dry-run
 *   npx tsx scripts/visit-pickup-once.ts --apply    # 실제 발송처리
 */

import fs from "fs";
import path from "path";

// .env.local 수동 로드 (dotenv 미설치). NEXT_PUBLIC_*가 아닌 값들도 로드되어야 네이버 토큰 발급 가능.
function loadEnv(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("[visit-pickup-once] .env.local 파일을 찾을 수 없음");
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    // 양쪽 따옴표 제거
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
loadEnv();

// 이후 import는 env 로드된 다음
 
import { scrapeVisitPickup } from "../src/lib/gs-delivery/scrape-visit-pickup";
import {
  DELIVERY_COMPANY_CODES,
  dispatchOrders,
} from "../src/lib/naver/dispatch";
import { fetchPendingOrders } from "../src/lib/naver/orders";
 

const DRY_RUN = !process.argv.includes("--apply");

interface MatchedDispatch {
  zipCode: string;
  phoneLast4: string;
  trackingNo: string;
  reservationNo: string;
  productOrderIds: string[];
  recipientName: string;
}

function getPhoneLast4(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const m = digits.match(/(\d{4})$/);
  return m ? m[1] : null;
}

function maskName(name: string): string {
  if (!name) return "";
  if (name.length <= 1) return name;
  return name[0] + "*".repeat(Math.max(0, name.length - 1));
}

async function main(): Promise<void> {
  console.log(
    `[visit-pickup-once] ${DRY_RUN ? "🔍 DRY-RUN" : "🚀 APPLY"} 모드`,
  );

  // 1. GS 예약list 스크래핑
  console.log("\n[1/4] GS 예약list 스크래핑...");
  const visitInfos = await scrapeVisitPickup([]);
  console.log(`방문 예약: ${visitInfos.length}건`);

  // 2. (zip, phoneLast4) → 운송장 인덱스
  const visitIndex = new Map<
    string,
    { reservationNo: string; trackingNo: string }
  >();
  let totalRecipients = 0;
  for (const info of visitInfos) {
    for (const r of info.recipients) {
      const key = `${r.zipCode}:${r.phoneLast4}`;
      // 같은 키가 여러 번 나오면 마지막 것이 덮어씀 (예외적, 보통 unique)
      visitIndex.set(key, {
        reservationNo: info.reservationNo,
        trackingNo: r.trackingNo,
      });
      totalRecipients++;
    }
  }
  console.log(
    `수령인 총 ${totalRecipients}건 (예약별: ${visitInfos.map((v) => v.recipients.length).join(", ")})`,
  );

  if (totalRecipients === 0) {
    console.log("\n→ GS에 방문 택배 수령인 없음. 종료.");
    return;
  }

  // 3. 네이버 발송대기 주문 조회
  console.log("\n[2/4] 네이버 발송대기 주문 조회...");
  const pendingOrders = await fetchPendingOrders();
  console.log(`발송대기: ${pendingOrders.length}건`);

  // 4. 매칭
  console.log("\n[3/4] (zip, phone 끝 4자리) 매칭...");
  const byKey = new Map<string, MatchedDispatch>();
  const matches: MatchedDispatch[] = [];

  for (const order of pendingOrders) {
    const zip = order.shippingAddress.zipCode?.trim();
    if (!zip || !/^\d{5}$/.test(zip)) continue;
    const phoneLast4 = getPhoneLast4(order.shippingAddress.tel1);
    if (!phoneLast4) continue;

    const key = `${zip}:${phoneLast4}`;
    const visit = visitIndex.get(key);
    if (!visit) continue;

    const existing = byKey.get(key);
    if (existing) {
      existing.productOrderIds.push(order.productOrderId);
    } else {
      const m: MatchedDispatch = {
        zipCode: zip,
        phoneLast4,
        trackingNo: visit.trackingNo,
        reservationNo: visit.reservationNo,
        productOrderIds: [order.productOrderId],
        recipientName: order.shippingAddress.name,
      };
      byKey.set(key, m);
      matches.push(m);
    }
  }

  const matchedProductOrderCount = matches.reduce(
    (s, m) => s + m.productOrderIds.length,
    0,
  );
  console.log(
    `매칭 성공: 수령인 ${matches.length}명 / productOrder ${matchedProductOrderCount}건`,
  );

  for (const m of matches) {
    console.log(
      `  → ${maskName(m.recipientName)} | [${m.zipCode}] | ****-${m.phoneLast4} | 운송장 ${m.trackingNo} | productOrder ${m.productOrderIds.length}개`,
    );
  }

  const unmatchedVisit = totalRecipients - matches.length;
  const unmatchedNaver = pendingOrders.length - matchedProductOrderCount;
  if (unmatchedVisit > 0) {
    console.log(
      `\n⚠️ GS에는 있지만 네이버 발송대기에 없는 수령인: ${unmatchedVisit}건`,
    );
  }
  if (unmatchedNaver > 0) {
    console.log(
      `(참고: 네이버 발송대기 중 방문 매칭 안 된 주문 ${unmatchedNaver}건 — 일반 택배일 가능성 큼)`,
    );
  }

  if (DRY_RUN) {
    console.log(
      "\n[4/4] DRY-RUN — 발송처리 안 함. 실제 실행:\n  npx tsx scripts/visit-pickup-once.ts --apply",
    );
    return;
  }

  if (matches.length === 0) {
    console.log("\n매칭된 건 없음 — 종료");
    return;
  }

  // 5. APPLY: 네이버 발송처리
  console.log("\n[4/4] 네이버 발송처리...");
  let successPO = 0;
  let failPO = 0;
  for (const m of matches) {
    const result = await dispatchOrders({
      productOrderIds: m.productOrderIds,
      deliveryCompanyCode: DELIVERY_COMPANY_CODES.domestic, // CJGLS
      trackingNumber: m.trackingNo,
    });
    if (result.success) {
      successPO += m.productOrderIds.length;
      console.log(
        `  ✅ ${maskName(m.recipientName)} (${m.trackingNo}) — productOrder ${m.productOrderIds.length}건`,
      );
    } else {
      failPO += m.productOrderIds.length;
      console.error(
        `  ❌ ${maskName(m.recipientName)} (${m.trackingNo}) — ${result.error ?? "알 수 없는 오류"}`,
      );
      if (result.failProductOrderIds?.length) {
        console.error(
          `     실패 productOrderIds: ${result.failProductOrderIds.join(", ")}`,
        );
      }
    }
  }
  console.log(
    `\n완료 — 성공 productOrder ${successPO}건, 실패 productOrder ${failPO}건`,
  );
  console.log(
    `(서버 DB는 다음 polling 사이클에 fetchDeliveryStatuses로 자동 sync됨)`,
  );
}

main().catch((err) => {
  console.error("[visit-pickup-once] 실패:", err);
  process.exit(1);
});
