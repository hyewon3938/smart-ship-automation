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
