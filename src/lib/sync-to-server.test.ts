import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `@/lib/orders`는 better-sqlite3를 즉시 로드하므로 모킹해서 실제 DB를 배제한다.
 * `reconcileFromServer`는 이 두 함수만 동적 import로 사용한다.
 */
const getReconcilableOrderIds = vi.fn<() => string[]>();
const applyServerGroupState = vi.fn<() => "dispatched" | "tracking" | null>();

vi.mock("@/lib/orders", () => ({
  getReconcilableOrderIds: () => getReconcilableOrderIds(),
  applyServerGroupState: () => applyServerGroupState(),
}));

import { reconcileFromServer } from "@/lib/sync-to-server";

/** 청크 하나에 대한 정상 응답 (요청한 orderId를 그대로 dispatched로 돌려준다) */
function okResponse(orderIds: string[]) {
  return {
    ok: true,
    json: async () => ({
      states: orderIds.map((orderId) => ({
        orderId,
        status: "dispatched",
        dispatchStatus: "dispatched",
        trackingNumber: "1234",
        dispatchedAt: "2026-08-09T05:15:34.372Z",
      })),
    }),
    text: async () => "",
  };
}

function requestedOrderIds(call: unknown[]): string[] {
  const init = call[1] as { body: string };
  return (JSON.parse(init.body) as { orderIds: string[] }).orderIds;
}

describe("reconcileFromServer", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("DEPLOY_MODE", "local");
    vi.stubEnv("SERVER_URL", "https://example.test");
    vi.stubEnv("INTERNAL_API_KEY", "test-key");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    getReconcilableOrderIds.mockReset();
    applyServerGroupState.mockReset();
    applyServerGroupState.mockReturnValue("dispatched");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("대상이 없으면 서버를 호출하지 않는다", async () => {
    getReconcilableOrderIds.mockReturnValue([]);

    const result = await reconcileFromServer();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, checked: 0, dispatched: 0, tracked: 0 });
  });

  it("서버 상한(300건)을 넘으면 청크로 나눠 조회한다", async () => {
    // 2주 창을 걷어내면서 대상이 수백 건으로 늘 수 있다 — 한 번에 보내면 400이 된다.
    const targets = Array.from({ length: 700 }, (_, i) => `order-${i}`);
    getReconcilableOrderIds.mockReturnValue(targets);
    fetchMock.mockImplementation((_url: string, init: { body: string }) =>
      Promise.resolve(
        okResponse((JSON.parse(init.body) as { orderIds: string[] }).orderIds),
      ),
    );

    const result = await reconcileFromServer();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map((c) => requestedOrderIds(c).length);
    expect(sizes).toEqual([300, 300, 100]);
    // 청크가 겹치거나 빠지지 않는다
    expect(fetchMock.mock.calls.flatMap(requestedOrderIds)).toEqual(targets);
    expect(result).toEqual({
      ok: true,
      checked: 700,
      dispatched: 700,
      tracked: 0,
    });
  });

  it("중간 청크가 실패하면 ok=false지만 이미 반영한 건수는 보존한다", async () => {
    const targets = Array.from({ length: 400 }, (_, i) => `order-${i}`);
    getReconcilableOrderIds.mockReturnValue(targets);
    fetchMock
      .mockImplementationOnce((_url: string, init: { body: string }) =>
        Promise.resolve(
          okResponse(
            (JSON.parse(init.body) as { orderIds: string[] }).orderIds,
          ),
        ),
      )
      // 4xx는 재시도 없이 즉시 종료된다
      .mockImplementationOnce(() =>
        Promise.resolve({ ok: false, status: 400, text: async () => "bad" }),
      );

    const result = await reconcileFromServer();

    expect(result).toEqual({
      ok: false,
      checked: 400,
      dispatched: 300,
      tracked: 0,
    });
  });

  it("orderIds를 직접 넘기면 DB 조회 없이 그 그룹만 확인한다", async () => {
    fetchMock.mockImplementation((_url: string, init: { body: string }) =>
      Promise.resolve(
        okResponse((JSON.parse(init.body) as { orderIds: string[] }).orderIds),
      ),
    );

    const result = await reconcileFromServer(["order-1"]);

    expect(getReconcilableOrderIds).not.toHaveBeenCalled();
    expect(requestedOrderIds(fetchMock.mock.calls[0])).toEqual(["order-1"]);
    expect(result.dispatched).toBe(1);
  });
});
