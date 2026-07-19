import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// dispatch-worker가 top-level import하는 모듈을 모두 모킹하여
// 실제 DB(better-sqlite3)·네이버 API 로드를 방지한다.
const mocks = vi.hoisted(() => ({
  getBookedOrderGroups: vi.fn(),
  updateDispatchStatus: vi.fn(),
  addBookingLog: vi.fn(),
  dispatchOrders: vi.fn(),
  getNextDayDeliveryCode: vi.fn(() => "HDEXP"),
  scrapeTrackingNumbers: vi.fn(),
  updateTrackingNumbers: vi.fn(),
}));

vi.mock("@/lib/orders", () => ({
  getBookedOrderGroups: mocks.getBookedOrderGroups,
  updateDispatchStatus: mocks.updateDispatchStatus,
  addBookingLog: mocks.addBookingLog,
  // checkAndDispatch가 쓰는 나머지 (dispatchBookedGroups 테스트엔 미사용)
  applyVisitDispatchInfo: vi.fn(),
  getBookingVisitPickupGroups: vi.fn(() => []),
  getMatchedVisitReservationNos: vi.fn(() => []),
  getUncheckedDispatchedOrders: vi.fn(() => []),
  updateDeliveryStatus: vi.fn(),
  updateTrackingNumbers: mocks.updateTrackingNumbers,
}));

vi.mock("@/lib/naver/dispatch", () => ({
  dispatchOrders: mocks.dispatchOrders,
  DELIVERY_COMPANY_CODES: { domestic: "CJGLS" },
}));

vi.mock("@/lib/naver/orders", () => ({
  fetchDeliveryStatuses: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  getDispatchPollIntervalMs: vi.fn(() => 120_000),
  getNextDayDeliveryCode: mocks.getNextDayDeliveryCode,
  isDispatchAutoMode: vi.fn(() => true),
}));

vi.mock("@/lib/gs-delivery/scrape-tracking", () => ({
  scrapeTrackingNumbers: mocks.scrapeTrackingNumbers,
}));

vi.mock("@/lib/gs-delivery/scrape-visit-pickup", () => ({
  scrapeVisitPickup: vi.fn(),
}));

import { checkAndDispatch, dispatchBookedGroups } from "./dispatch-worker";

interface Group {
  orderId: string;
  firstDbId: number;
  bookingReservationNo: string | null;
  trackingNumber: string | null;
  dispatchStatus: string | null;
  deliveryType: string;
  productOrderIds: string[];
  bookedAt: string | null;
}

function group(overrides: Partial<Group> = {}): Group {
  return {
    orderId: "order-1",
    firstDbId: 1,
    bookingReservationNo: "1195-2684-971",
    trackingNumber: "363172788124",
    dispatchStatus: "pending_dispatch",
    deliveryType: "domestic",
    productOrderIds: ["po-1"],
    bookedAt: null,
    ...overrides,
  };
}

describe("dispatchBookedGroups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dispatchOrders.mockResolvedValue({ success: true });
    mocks.getNextDayDeliveryCode.mockReturnValue("HDEXP");
  });

  it("운송장 있고 pending인 그룹을 발송하고 dispatched로 표시한다", async () => {
    mocks.getBookedOrderGroups.mockReturnValue([group({ orderId: "A" })]);

    const result = await dispatchBookedGroups();

    expect(result.dispatched).toEqual(["A"]);
    expect(result.failed).toEqual([]);
    expect(mocks.updateDispatchStatus).toHaveBeenCalledWith("A", "dispatched");
    expect(mocks.dispatchOrders).toHaveBeenCalledWith({
      productOrderIds: ["po-1"],
      deliveryCompanyCode: "CJGLS",
      trackingNumber: "363172788124",
    });
  });

  it("운송장 없는 그룹은 발송하지 않는다", async () => {
    mocks.getBookedOrderGroups.mockReturnValue([
      group({ trackingNumber: null }),
    ]);

    const result = await dispatchBookedGroups();

    expect(result.dispatched).toEqual([]);
    expect(mocks.dispatchOrders).not.toHaveBeenCalled();
  });

  it("이미 dispatched된 그룹은 재발송하지 않는다 (이중발송 방지)", async () => {
    mocks.getBookedOrderGroups.mockReturnValue([
      group({ orderId: "A", dispatchStatus: "dispatched" }),
    ]);

    const result = await dispatchBookedGroups();

    expect(result.dispatched).toEqual([]);
    expect(mocks.dispatchOrders).not.toHaveBeenCalled();
  });

  it("orderIds 인자로 지정한 주문만 발송한다", async () => {
    mocks.getBookedOrderGroups.mockReturnValue([
      group({ orderId: "A" }),
      group({ orderId: "B", firstDbId: 2 }),
    ]);

    const result = await dispatchBookedGroups(["B"]);

    expect(result.dispatched).toEqual(["B"]);
    expect(mocks.dispatchOrders).toHaveBeenCalledTimes(1);
  });

  it("nextDay 그룹은 내일배송 택배사 코드로 발송한다", async () => {
    mocks.getBookedOrderGroups.mockReturnValue([
      group({ orderId: "A", deliveryType: "nextDay" }),
    ]);

    await dispatchBookedGroups();

    expect(mocks.dispatchOrders).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryCompanyCode: "HDEXP" }),
    );
  });

  it("발송 실패 시 failed에 담고 dispatch_failed로 표시한다", async () => {
    mocks.getBookedOrderGroups.mockReturnValue([group({ orderId: "A" })]);
    mocks.dispatchOrders.mockResolvedValue({
      success: false,
      error: "네이버 거절",
    });

    const result = await dispatchBookedGroups();

    expect(result.dispatched).toEqual([]);
    expect(result.failed).toEqual([{ orderId: "A", error: "네이버 거절" }]);
    expect(mocks.updateDispatchStatus).toHaveBeenCalledWith(
      "A",
      "dispatch_failed",
    );
  });
});

describe("checkAndDispatch — 운송장 스크래핑 시간 게이트 (예약 후 1시간 하이브리드)", () => {
  // UTC 기준 시각 → KST(+9) 변환
  const KST_DAWN_3AM = new Date("2026-07-19T18:00:00Z"); // KST 07-20 03:00 (윈도우 밖)
  const KST_NOON = new Date("2026-07-19T03:00:00Z"); // KST 07-19 12:00 (윈도우 안)

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.dispatchOrders.mockResolvedValue({ success: true });
    mocks.scrapeTrackingNumbers.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("윈도우 밖(새벽)이라도 예약 후 1시간 이내 그룹이 있으면 스크래핑한다", async () => {
    vi.setSystemTime(KST_DAWN_3AM);
    const justBooked = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10분 전
    mocks.getBookedOrderGroups.mockReturnValue([
      group({ orderId: "A", trackingNumber: null, bookedAt: justBooked }),
    ]);

    await checkAndDispatch();

    expect(mocks.scrapeTrackingNumbers).toHaveBeenCalledOnce();
  });

  it("윈도우 밖(새벽)이고 예약 후 1시간이 지났으면 스크래핑하지 않는다", async () => {
    vi.setSystemTime(KST_DAWN_3AM);
    const oldBooked = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2시간 전
    mocks.getBookedOrderGroups.mockReturnValue([
      group({ orderId: "A", trackingNumber: null, bookedAt: oldBooked }),
    ]);

    await checkAndDispatch();

    expect(mocks.scrapeTrackingNumbers).not.toHaveBeenCalled();
  });

  it("윈도우 안(낮)이면 예약 시각과 무관하게 스크래핑한다 (기존 동작 유지)", async () => {
    vi.setSystemTime(KST_NOON);
    const oldBooked = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // 5시간 전
    mocks.getBookedOrderGroups.mockReturnValue([
      group({ orderId: "A", trackingNumber: null, bookedAt: oldBooked }),
    ]);

    await checkAndDispatch();

    expect(mocks.scrapeTrackingNumbers).toHaveBeenCalledOnce();
  });

  it("윈도우 밖 + bookedAt 없는(레거시) 그룹만 있으면 스크래핑하지 않는다", async () => {
    vi.setSystemTime(KST_DAWN_3AM);
    mocks.getBookedOrderGroups.mockReturnValue([
      group({ orderId: "A", trackingNumber: null, bookedAt: null }),
    ]);

    await checkAndDispatch();

    expect(mocks.scrapeTrackingNumbers).not.toHaveBeenCalled();
  });
});
