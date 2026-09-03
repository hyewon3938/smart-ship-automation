import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(async () => "token"),
  fetchProductOrderStates: vi.fn(),
}));

vi.mock("./auth", () => ({ getAccessToken: mocks.getAccessToken }));
vi.mock("./orders", () => ({
  fetchProductOrderStates: mocks.fetchProductOrderStates,
}));

import { dispatchOrders } from "./dispatch";

const REQ = {
  productOrderIds: ["po-1", "po-2"],
  deliveryCompanyCode: "JMNP",
  trackingNumber: "343500091641",
};

/** 네이버 상태 조회 응답 생성 */
function states(status: string) {
  return new Map(
    REQ.productOrderIds.map((id) => [
      id,
      {
        productOrderStatus: status,
        trackingNumber: REQ.trackingNumber,
        dispatchedAt: "2026-09-03T10:00:00+09:00",
      },
    ]),
  );
}

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    })),
  );
}

describe("dispatchOrders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  /** 대조 재시도 사이의 대기를 건너뛰며 결과를 받는다 */
  async function run() {
    const promise = dispatchOrders(REQ);
    await vi.runAllTimersAsync();
    return promise;
  }

  it("네이버 상태가 발송완료로 바뀐 것을 확인한 뒤에만 dispatched를 반환한다", async () => {
    respond(200, { data: { successProductOrderIds: REQ.productOrderIds } });
    mocks.fetchProductOrderStates.mockResolvedValue(states("DELIVERING"));

    await expect(run()).resolves.toEqual({ outcome: "dispatched" });
  });

  it("200이어도 네이버 상태가 발송 전 그대로면 failed로 판정한다", async () => {
    // 이전 구현이 성공으로 읽던 응답 — 실패 목록이 아는 필드명으로 오지 않는다
    respond(200, { data: {} });
    mocks.fetchProductOrderStates.mockResolvedValue(states("PAYED"));

    const result = await run();

    expect(result.outcome).toBe("failed");
    expect(result.error).toContain("JMNP");
    expect(result.error).toContain("PAYED");
  });

  it("200 응답의 failProductOrderInfos를 실패로 읽는다", async () => {
    respond(200, {
      data: {
        failProductOrderInfos: [
          { productOrderId: "po-1", message: "택배사 코드가 올바르지 않습니다" },
        ],
      },
    });

    const result = await run();

    expect(result.outcome).toBe("failed");
    expect(result.failProductOrderIds).toEqual(["po-1"]);
    expect(result.error).toContain("택배사 코드가 올바르지 않습니다");
    expect(mocks.fetchProductOrderStates).not.toHaveBeenCalled();
  });

  it("성공 목록에서 빠진 상품주문을 실패로 읽는다", async () => {
    respond(200, { data: { successProductOrderIds: ["po-1"] } });

    const result = await run();

    expect(result.outcome).toBe("failed");
    expect(result.failProductOrderIds).toEqual(["po-2"]);
  });

  it("네이버 상태 조회 자체가 실패하면 unverified — 완료로 기록하지 않는다", async () => {
    respond(200, { data: {} });
    mocks.fetchProductOrderStates.mockRejectedValue(new Error("조회 시간 초과"));

    const result = await run();

    expect(result.outcome).toBe("unverified");
    expect(result.error).toContain("조회 시간 초과");
  });

  it("반영이 늦어도 재시도 안에 확인되면 dispatched", async () => {
    respond(200, { data: {} });
    mocks.fetchProductOrderStates
      .mockResolvedValueOnce(states("PAYED"))
      .mockResolvedValue(states("DELIVERING"));

    await expect(run()).resolves.toEqual({ outcome: "dispatched" });
  });

  it("HTTP 에러는 failed로 반환한다", async () => {
    respond(400, { code: "101009", message: "처리권한이 없는 상품주문번호" });

    const result = await run();

    expect(result.outcome).toBe("failed");
    expect(result.error).toContain("400");
    expect(mocks.fetchProductOrderStates).not.toHaveBeenCalled();
  });
});
