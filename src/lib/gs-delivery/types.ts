/** 단건 예약 결과 */
export interface BookingResult {
  success: boolean;
  reservationNo?: string;
  error?: string;
  screenshotPath?: string;
}

/** 워커에 전달할 예약 작업 단위 */
export interface BookingTask {
  orderId: number;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientAddressDetail: string | null;
  recipientZipCode: string;
  deliveryType: "domestic" | "nextDay";
  productName: string;
  totalPrice: number;
  quantity: number;
  shippingMemo: string | null;
}
