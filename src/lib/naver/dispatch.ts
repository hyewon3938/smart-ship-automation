import { getAccessToken } from "./auth";

const BASE_URL = "https://api.commerce.naver.com/external/v1";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/** 택배사 코드 매핑 */
export const DELIVERY_COMPANY_CODES = {
  domestic: "CJGLS",    // CJ대한통운 (GS편의점택배 실제 배송사)
  nextDay: "CJGLS",     // CJ대한통운 (내일배송도 동일)
} as const;

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

export interface DispatchResult {
  success: boolean;
  /** 실패한 productOrderId 목록 (부분 실패 시) */
  failProductOrderIds?: string[];
  error?: string;
}

/**
 * 네이버 커머스 API 발송처리.
 * POST /v1/pay-order/seller/product-orders/dispatch
 *
 * @note dispatchProductOrders 배열 내 정확한 필드명은
 *       네이버 API 공식 문서(apicenter.commerce.naver.com) 확인 필요.
 *       첫 테스트에서 400/422 에러 시 아래 필드명을 조정할 것.
 */
export async function dispatchOrders(req: DispatchRequest): Promise<DispatchResult> {
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
      }
    );

    if (response.status === 429) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    const result = await response.json().catch(() => ({}));

    if (response.ok) {
      const failIds: string[] = result?.data?.failProductOrderIds ?? [];
      return {
        success: failIds.length === 0,
        failProductOrderIds: failIds.length > 0 ? failIds : undefined,
      };
    }

    return {
      success: false,
      error: `API 에러 (${response.status}): ${JSON.stringify(result).slice(0, 500)}`,
    };
  }

  return { success: false, error: "429 재시도 한도 초과" };
}
