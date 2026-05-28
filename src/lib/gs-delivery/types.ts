/** 단건 예약 결과 */
export interface BookingResult {
  success: boolean;
  reservationNo?: string;
  error?: string;
  screenshotPath?: string;
}

/** 워커에 전달할 예약 작업 단위 (orderId 그룹 = 1건 택배) */
export interface BookingTask {
  /** DB row IDs — 같은 orderId의 모든 상품 (상태 일괄 변경에 사용) */
  orderDbIds: number[];
  /** 네이버 주문번호 (로깅용) */
  naverOrderId: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientAddressDetail: string | null;
  recipientZipCode: string;
  deliveryType: "domestic" | "nextDay";
  /** 물품 가액 (그룹 내 합계, 원 단위) */
  totalPrice: number;
  shippingMemo: string | null;
}

/** 방문택배 수령인 정보 */
export interface VisitPickupRecipient {
  /** DB row IDs — 해당 수령인(orderId 그룹)의 모든 상품 */
  orderDbIds: number[];
  /** 네이버 주문번호 (로깅용) */
  naverOrderId: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientAddressDetail: string | null;
  recipientZipCode: string;
  shippingMemo: string | null;
}

/** 방문택배 다량 접수 작업 (1 예약 = N명 수령인) */
export interface VisitPickupTask {
  /** 전체 DB row IDs (모든 수령인의 모든 상품) */
  allOrderDbIds: number[];
  /** 수령인 목록 (각각 1건의 택배) */
  recipients: VisitPickupRecipient[];
  /** 물품 가액 (택배 1건 기준, 원 단위) */
  unitPrice: number;
}

/**
 * 방문택배 상세페이지에서 추출한 수령인-운송장 매핑 1건.
 *
 * 매칭 키는 (zipCode, phoneLast4) 튜플 — 상세페이지 수신정보가 마스킹되어 있어도
 * 한 방문택배 내 N명 수령인 안에서는 충돌 확률이 사실상 0.
 */
export interface VisitRecipientLine {
  /** 우편번호 (5자리, 상세페이지의 `[XXXXX]` 추출) */
  zipCode: string;
  /** 전화번호 끝 4자리 (`010-****-NNNN` 마스킹 형식에서 추출) */
  phoneLast4: string;
  /** 운송장번호 (상세페이지에서는 unmasked로 노출) */
  trackingNo: string;
}

/** GS 예약list의 방문 행 1건 + 상세페이지 파싱 결과 */
export interface VisitDispatchInfo {
  /** GS 예약번호 (예: "12148215251") */
  reservationNo: string;
  /** 상세페이지의 수신정보 블록들 (1 예약 = N명 수령인) */
  recipients: VisitRecipientLine[];
}
