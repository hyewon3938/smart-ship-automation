import { beforeEach, describe, expect, it, vi } from "vitest";

// dispatch-worker가 top-level import하는 모듈을 모두 모킹하여
// 실제 DB(better-sqlite3)·네이버 API 로드를 방지한다.
const mocks = vi.hoisted(() => ({
  getBookedOrderGroups: vi.fn(),
  updateDispatchStatus: vi.fn(),
  addBookingLog: vi.fn(),
  dispatchOrders: vi.fn(),
  getNextDayDeliveryCode: vi.fn(() => "HDEXP"),
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
  updateTrackingNumbers: vi.fn(),
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
  scrapeTrackingNumbers: vi.fn(),
}));

vi.mock("@/lib/gs-delivery/scrape-visit-pickup", () => ({
  scrapeVisitPickup: vi.fn(),
}));

import { dispatchBookedGroups } from "./dispatch-worker";

interface Group {
  orderId: string;
  firstDbId: number;
  bookingReservationNo: string | null;
  trackingNumber: string | null;
  dispatchStatus: string | null;
  deliveryType: string;
  productOrderIds: string[];
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
