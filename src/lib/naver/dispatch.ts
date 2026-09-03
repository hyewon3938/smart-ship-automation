import { resolveNaverGroupDispatch } from "@/lib/order-lifecycle";

import type { NaverItemState } from "@/lib/order-lifecycle";

import { getAccessToken } from "./auth";
import { DELIVERY_COMPANY_CODES } from "./delivery-companies";
import { fetchProductOrderStates } from "./orders";

const BASE_URL = "https://api.commerce.naver.com/external/v1";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/** 발송처리 직후 네이버에 반영되기까지의 지연을 감안한 대조 재시도 */
const VERIFY_ATTEMPTS = 3;
const VERIFY_DELAY_MS = 2000;

export { DELIVERY_COMPANY_CODES };

interface DispatchItem {
  productOrderId: string;
  deliveryMethod: string;
  deliveryCompanyCode: string;
  trackingNumber: string;
  dispatchDate: string;
}

interface DispatchRequest {
  productOrderIds: string[];
  deliveryCompanyCode: string;
  trackingNumber: string;
}

/**
 * 발송처리 결과.
 *
 * - `dispatched`: 네이버 원천에서 발송완료를 확인함
 * - `failed`: 발송되지 않은 것이 확실함 → 사용자에게 실패로 알림
 * - `unverified`: 요청은 보냈으나 반영 여부를 확인하지 못함 → 완료로 기록하지 않고 재시도
 */
export type DispatchOutcome = "dispatched" | "failed" | "unverified";

export interface DispatchResult {
  outcome: DispatchOutcome;
  /** 실패한 productOrderId 목록 (부분 실패 시) */
  failProductOrderIds?: string[];
  error?: string;
}

/**
 * 200 OK 응답에서 실패 항목을 추출한다.
 *
 * 네이버는 요청 자체가 유효해도 개별 상품주문 처리에 실패하면 그 사실을 본문에
 * 담아 200으로 돌려준다. 필드명을 하나만 보고 있으면(`failProductOrderIds`만
 * 확인하던 이전 구현) 실패가 통째로 성공으로 읽히므로 알려진 형태를 모두 훑는다.
 */
function extractFailures(
  data: unknown,
  requestedIds: string[],
): { ids: string[]; messages: string[] } {
  const ids = new Set<string>();
  const messages: string[] = [];
  if (!data || typeof data !== "object") return { ids: [], messages };

  const record = data as Record<string, unknown>;

  for (const key of ["failProductOrderIds", "failedProductOrderIds"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const id of value) if (typeof id === "string") ids.add(id);
    }
  }

  for (const key of ["failProductOrderInfos", "failProductOrders"]) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const info = item as Record<string, unknown>;
      if (typeof info.productOrderId === "string") ids.add(info.productOrderId);
      const message = info.message ?? info.code;
      if (typeof message === "string") messages.push(message);
    }
  }

  // 성공 목록만 오는 형태 — 요청했는데 성공 목록에 없으면 실패로 본다
  const success = record.successProductOrderIds;
  if (Array.isArray(success)) {
    const succeeded = new Set(success.filter((s) => typeof s === "string"));
    for (const id of requestedIds) if (!succeeded.has(id)) ids.add(id);
  }

  return { ids: [...ids], messages };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 네이버 원천 대조 — 발송처리가 실제로 반영됐는지 확인한다.
 *
 * 응답 본문을 믿지 않고 상품주문 상태를 다시 조회한다. 발송처리의 최종 원천은
 * 네이버이고(ADR-0006), 응답 해석이 틀리면 "발송했다고 기록했지만 실제로는
 * 발송대기"라는 가장 나쁜 실패(사용자가 알아채기 전까지 조용함)가 되기 때문이다.
 * ADR-0006이 읽기 경로(역동기화)에 적용한 원칙을 쓰기 경로에도 그대로 적용한다.
 */
async function verifyDispatched(
  productOrderIds: string[],
): Promise<{ outcome: "dispatched" | "failed" | "unverified"; detail: string }> {
  let lastDetail = "네이버 상태 조회 실패";

  for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt++) {
    await sleep(VERIFY_DELAY_MS);

    let states: Map<string, NaverItemState>;
    try {
      states = await fetchProductOrderStates(productOrderIds);
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : "네이버 상태 조회 실패";
      continue;
    }

    const items = productOrderIds
      .map((id) => states.get(id))
      .filter((s): s is NaverItemState => !!s);

    if (items.length < productOrderIds.length) {
      lastDetail = `네이버가 상품주문 ${productOrderIds.length}건 중 ${items.length}건만 반환`;
      continue;
    }

    if (resolveNaverGroupDispatch(items)) {
      return { outcome: "dispatched", detail: "네이버 발송완료 확인" };
    }

    // 마지막 시도까지 발송 전 상태로 남아 있으면 "반영되지 않음"이 확정된다
    lastDetail = `네이버 상태가 발송 전 그대로 (${items
      .map((i) => i.productOrderStatus)
      .join(", ")})`;
    if (attempt === VERIFY_ATTEMPTS - 1) {
      return { outcome: "failed", detail: lastDetail };
    }
  }

  return { outcome: "unverified", detail: lastDetail };
}

/**
 * 네이버 커머스 API 발송처리.
 * POST /v1/pay-order/seller/product-orders/dispatch
 *
 * 요청을 보낸 뒤 네이버 상품주문 상태를 다시 조회해 실제 반영을 확인한 뒤에만
 * `dispatched`를 반환한다.
 */
export async function dispatchOrders(
  req: DispatchRequest,
): Promise<DispatchResult> {
  const token = await getAccessToken();

  const dispatchDate = new Date().toISOString();

  const items: DispatchItem[] = req.productOrderIds.map((id) => ({
    productOrderId: id,
    deliveryMethod: "DELIVERY",
    deliveryCompanyCode: req.deliveryCompanyCode,
    trackingNumber: req.trackingNumber,
    dispatchDate,
  }));

  const body = JSON.stringify({ dispatchProductOrders: items });

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(
      `${BASE_URL}/pay-order/seller/product-orders/dispatch`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body,
      },
    );

    if (response.status === 429) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      await sleep(backoff);
      continue;
    }

    const raw = await response.text();
    const result: unknown = raw ? safeParse(raw) : {};

    if (!response.ok) {
      return {
        outcome: "failed",
        error: `API 에러 (${response.status}): ${raw.slice(0, 500)}`,
      };
    }

    const data = (result as { data?: unknown })?.data;
    const failures = extractFailures(data, req.productOrderIds);
    if (failures.ids.length > 0) {
      return {
        outcome: "failed",
        failProductOrderIds: failures.ids,
        error: `네이버가 상품주문 ${failures.ids.length}건을 거절 (택배사 코드: ${req.deliveryCompanyCode})${
          failures.messages.length > 0
            ? ` — ${failures.messages.join(", ").slice(0, 300)}`
            : ` — 응답: ${raw.slice(0, 300)}`
        }`,
      };
    }

    const verified = await verifyDispatched(req.productOrderIds);
    if (verified.outcome === "dispatched") return { outcome: "dispatched" };

    return {
      outcome: verified.outcome,
      error: `발송처리가 네이버에 반영되지 않음 (택배사 코드: ${req.deliveryCompanyCode}) — ${verified.detail}`,
    };
  }

  return { outcome: "failed", error: "429 재시도 한도 초과" };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
