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
