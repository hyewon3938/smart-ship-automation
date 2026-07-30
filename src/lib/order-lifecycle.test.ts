import { describe, expect, it } from "vitest";

import {
  aggregateGroupState,
  findDeleteBlocker,
  needsServerCheckBeforeDelete,
  resolveServerStateSync,
  type OrderGroupState,
} from "./order-lifecycle";

describe("findDeleteBlocker", () => {
  it("대기·예약완료·실패·건너뜀은 삭제 허용", () => {
    expect(findDeleteBlocker(["pending"])).toBeNull();
    expect(findDeleteBlocker(["booked", "booked"])).toBeNull();
    expect(findDeleteBlocker(["failed"])).toBeNull();
    expect(findDeleteBlocker(["skipped"])).toBeNull();
    expect(findDeleteBlocker(["pending", "failed"])).toBeNull();
  });

  it("예약 진행 중이면 차단 (워커가 row를 잡고 있음)", () => {
    expect(findDeleteBlocker(["booking"])).toContain("예약이 진행 중");
    // 그룹 일부라도 booking 이면 차단
    expect(findDeleteBlocker(["booked", "booking"])).toContain(
      "예약이 진행 중",
    );
  });

  it("발송완료면 차단 (복구 불가)", () => {
    expect(findDeleteBlocker(["dispatched"])).toContain("발송완료");
    expect(findDeleteBlocker(["booked", "dispatched"])).toContain("발송완료");
  });

  it("존재하지 않는 그룹이면 차단", () => {
    expect(findDeleteBlocker([])).toContain("찾을 수 없습니다");
  });

  it("알 수 없는 상태는 차단", () => {
    expect(findDeleteBlocker(["weird"])).toContain("삭제할 수 없는 상태");
  });
});

describe("needsServerCheckBeforeDelete", () => {
  it("서버로 전송된 적 있는 상태만 확인 필요", () => {
    expect(needsServerCheckBeforeDelete(["booked"])).toBe(true);
    expect(needsServerCheckBeforeDelete(["failed"])).toBe(true);
  });

  it("대기 상태는 서버에 없으므로 확인 불필요", () => {
    expect(needsServerCheckBeforeDelete(["pending"])).toBe(false);
    expect(needsServerCheckBeforeDelete(["pending", "pending"])).toBe(false);
  });
});

describe("aggregateGroupState", () => {
  it("빈 그룹은 null", () => {
    expect(aggregateGroupState([])).toBeNull();
  });

  it("전 row 발송완료일 때만 dispatched", () => {
    const state = aggregateGroupState([
      {
        status: "dispatched",
        dispatchStatus: "dispatched",
        trackingNumber: "1234",
        dispatchedAt: "2026-07-30T03:44:56Z",
      },
      {
        status: "dispatched",
        dispatchStatus: "dispatched",
        trackingNumber: "1234",
        dispatchedAt: "2026-07-30T03:44:57Z",
      },
    ]);
    expect(state?.status).toBe("dispatched");
    // 가장 늦은 발송시각 채택
    expect(state?.dispatchedAt).toBe("2026-07-30T03:44:57Z");
  });

  it("부분 발송은 dispatched로 올리지 않는다", () => {
    const state = aggregateGroupState([
      {
        status: "dispatched",
        dispatchStatus: "dispatched",
        trackingNumber: "1234",
      },
      { status: "booked", dispatchStatus: null, trackingNumber: "1234" },
    ]);
    expect(state?.status).toBe("booked");
  });

  it("운송장·발송상태는 값이 있는 첫 row에서 가져온다", () => {
    const state = aggregateGroupState([
      { status: "booked", dispatchStatus: null, trackingNumber: null },
      {
        status: "booked",
        dispatchStatus: "pending_dispatch",
        trackingNumber: "9999",
      },
    ]);
    expect(state?.trackingNumber).toBe("9999");
    expect(state?.dispatchStatus).toBe("pending_dispatch");
  });
});

const localBooked: OrderGroupState = {
  status: "booked",
  dispatchStatus: null,
  trackingNumber: null,
  dispatchedAt: null,
};

describe("resolveServerStateSync", () => {
  it("서버 발송완료 → 로컬도 발송완료 + 운송장 회수", () => {
    const patch = resolveServerStateSync(localBooked, {
      status: "dispatched",
      dispatchStatus: "dispatched",
      trackingNumber: "6070123456",
      dispatchedAt: "2026-07-30T03:44:56Z",
    });
    expect(patch).toEqual({
      status: "dispatched",
      dispatchStatus: "dispatched",
      trackingNumber: "6070123456",
      dispatchedAt: "2026-07-30T03:44:56Z",
      reason: "dispatched",
    });
  });

  it("사용자가 실패로 옮겨둔 건도 서버 발송완료로 정정", () => {
    const patch = resolveServerStateSync(
      { ...localBooked, status: "failed" },
      {
        status: "dispatched",
        dispatchStatus: "dispatched",
        trackingNumber: "6070123456",
        dispatchedAt: "2026-07-28T04:00:54Z",
      },
    );
    expect(patch?.reason).toBe("dispatched");
    expect(patch?.status).toBe("dispatched");
  });

  it("이미 로컬도 발송완료 + 운송장 있으면 변경 없음", () => {
    const patch = resolveServerStateSync(
      {
        status: "dispatched",
        dispatchStatus: "dispatched",
        trackingNumber: "6070123456",
        dispatchedAt: "2026-07-30T03:44:56Z",
      },
      {
        status: "dispatched",
        dispatchStatus: "dispatched",
        trackingNumber: "6070123456",
        dispatchedAt: "2026-07-30T03:44:56Z",
      },
    );
    expect(patch).toBeNull();
  });

  it("로컬 dispatched인데 운송장이 비어 있으면 운송장만 채운다", () => {
    const patch = resolveServerStateSync(
      {
        status: "dispatched",
        dispatchStatus: "dispatched",
        trackingNumber: null,
        dispatchedAt: "2026-07-30T03:44:56Z",
      },
      {
        status: "dispatched",
        dispatchStatus: "dispatched",
        trackingNumber: "6070123456",
        dispatchedAt: "2026-07-30T03:44:56Z",
      },
    );
    expect(patch?.trackingNumber).toBe("6070123456");
  });

  it("서버가 운송장만 잡은 단계 → 예약완료 + 운송장 반영", () => {
    const patch = resolveServerStateSync(localBooked, {
      status: "booked",
      dispatchStatus: null,
      trackingNumber: "6070123456",
      dispatchedAt: null,
    });
    expect(patch).toEqual({
      status: "booked",
      dispatchStatus: "pending_dispatch",
      trackingNumber: "6070123456",
      reason: "tracking",
    });
  });

  it("서버 발송 실패도 운송장·상태를 그대로 반영", () => {
    const patch = resolveServerStateSync(localBooked, {
      status: "booked",
      dispatchStatus: "dispatch_failed",
      trackingNumber: "6070123456",
      dispatchedAt: null,
    });
    expect(patch?.dispatchStatus).toBe("dispatch_failed");
    expect(patch?.reason).toBe("tracking");
  });

  it("운송장·발송상태가 동일하면 변경 없음", () => {
    const same: OrderGroupState = {
      status: "booked",
      dispatchStatus: "pending_dispatch",
      trackingNumber: "6070123456",
      dispatchedAt: null,
    };
    expect(resolveServerStateSync(same, same)).toBeNull();
  });

  it("서버가 아직 아무것도 못 잡았으면 로컬을 건드리지 않는다", () => {
    expect(resolveServerStateSync(localBooked, localBooked)).toBeNull();
  });
});
