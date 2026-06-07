import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import type {
  AllSettings,
  BookingDefaults,
  DispatchSettings,
  GsSettings,
  NaverSettings,
} from "@/types";

/** 설정값 조회 */
export function getSetting(key: string): string | null {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

/** 설정값 저장 (upsert) */
export function setSetting(key: string, value: string): void {
  const existing = db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  if (existing) {
    db.update(settings)
      .set({ value, updatedAt: new Date().toISOString() })
      .where(eq(settings.key, key))
      .run();
  } else {
    db.insert(settings).values({ key, value }).run();
  }
}

/** DB → env 폴백 설정 읽기 */
export function getConfigValue(dbKey: string, envKey: string): string | null {
  return getSetting(dbKey) ?? process.env[envKey] ?? null;
}

/** 비밀값 마스킹 (마지막 4자만 표시) */
function maskSecret(value: string | null): string {
  if (!value || value.length <= 4) return value ? "****" : "";
  return "****" + value.slice(-4);
}

/** 전체 설정 조회 (비밀값 마스킹) */
export function getAllSettings(): AllSettings {
  return {
    naver: {
      clientId: getConfigValue("naver.clientId", "NAVER_CLIENT_ID") ?? "",
      clientSecret: maskSecret(
        getConfigValue("naver.clientSecret", "NAVER_CLIENT_SECRET"),
      ),
    },
    gs: {
      username: getConfigValue("gs.username", "GS_USERNAME") ?? "",
      password: maskSecret(getConfigValue("gs.password", "GS_PASSWORD")),
      // env 폴백은 기존 SENDER_NAME 재활용 (본인 .env.local에 이미 있을 수 있음 → 무변화)
      senderName: getConfigValue("gs.senderName", "SENDER_NAME") ?? "",
    },
    booking: {
      defaultProductType: getSetting("booking.defaultProductType") ?? "08",
      defaultPrice: getSetting("booking.defaultPrice") ?? "1",
      defaultDeliveryType:
        (getSetting("booking.defaultDeliveryType") as "domestic" | "nextDay") ??
        "domestic",
      visitReservationName:
        getConfigValue(
          "booking.visitReservationName",
          "VISIT_RESERVATION_NAME",
        ) ?? "방문택배 발송",
    },
    dispatch: {
      autoMode: getSetting("dispatch.autoMode") === "true",
      pollIntervalMin: Number(getSetting("dispatch.pollIntervalMin") ?? "5"),
      nextDayDeliveryCode:
        getSetting("dispatch.nextDayDeliveryCode") ?? "DELIVERBOX",
    },
  };
}

/** 전체 설정 조회 (비밀값 포함, 내부용) */
export function getAllSettingsRaw(): AllSettings {
  return {
    naver: {
      clientId: getConfigValue("naver.clientId", "NAVER_CLIENT_ID") ?? "",
      clientSecret:
        getConfigValue("naver.clientSecret", "NAVER_CLIENT_SECRET") ?? "",
    },
    gs: {
      username: getConfigValue("gs.username", "GS_USERNAME") ?? "",
      password: getConfigValue("gs.password", "GS_PASSWORD") ?? "",
      senderName: getConfigValue("gs.senderName", "SENDER_NAME") ?? "",
    },
    booking: {
      defaultProductType: getSetting("booking.defaultProductType") ?? "08",
      defaultPrice: getSetting("booking.defaultPrice") ?? "1",
      defaultDeliveryType:
        (getSetting("booking.defaultDeliveryType") as "domestic" | "nextDay") ??
        "domestic",
      visitReservationName:
        getConfigValue(
          "booking.visitReservationName",
          "VISIT_RESERVATION_NAME",
        ) ?? "방문택배 발송",
    },
    dispatch: {
      autoMode: getSetting("dispatch.autoMode") === "true",
      pollIntervalMin: Number(getSetting("dispatch.pollIntervalMin") ?? "5"),
      nextDayDeliveryCode:
        getSetting("dispatch.nextDayDeliveryCode") ?? "DELIVERBOX",
    },
  };
}

/** 카테고리별 설정 업데이트. 마스킹 값("****")이면 건너뜀 */
export function updateNaverSettings(data: NaverSettings): void {
  if (data.clientId) setSetting("naver.clientId", data.clientId);
  if (data.clientSecret && !data.clientSecret.startsWith("****")) {
    setSetting("naver.clientSecret", data.clientSecret);
  }
}

export function updateGsSettings(data: GsSettings): void {
  if (data.username) setSetting("gs.username", data.username);
  if (data.password && !data.password.startsWith("****")) {
    setSetting("gs.password", data.password);
  }
  setSetting("gs.senderName", data.senderName);
}

export function updateBookingDefaults(data: BookingDefaults): void {
  setSetting("booking.defaultProductType", data.defaultProductType);
  setSetting("booking.defaultPrice", data.defaultPrice);
  setSetting("booking.defaultDeliveryType", data.defaultDeliveryType);
  setSetting("booking.visitReservationName", data.visitReservationName);
}

export function updateDispatchSettings(data: DispatchSettings): void {
  setSetting("dispatch.autoMode", String(data.autoMode));
  setSetting("dispatch.pollIntervalMin", String(data.pollIntervalMin));
  setSetting("dispatch.nextDayDeliveryCode", data.nextDayDeliveryCode);
}

/** 발송 자동모드 여부 조회 */
export function isDispatchAutoMode(): boolean {
  return getSetting("dispatch.autoMode") === "true";
}

/** 폴링 인터벌(ms) 조회 */
export function getDispatchPollIntervalMs(): number {
  const min = Number(getSetting("dispatch.pollIntervalMin") ?? "5");
  return min * 60 * 1000;
}

/** 내일배송 택배사 코드 조회 */
export function getNextDayDeliveryCode(): string {
  return getSetting("dispatch.nextDayDeliveryCode") ?? "DELIVERBOX";
}

/** GS 주소록에서 선택할 발송인 이름 조회. 미설정이면 빈 문자열 → 호출부에서 안내 후 중단 */
export function getSenderAddressBookName(): string {
  return getConfigValue("gs.senderName", "SENDER_NAME") ?? "";
}

/** 방문택배 예약명 조회 (기본 "방문택배 발송") */
export function getVisitReservationName(): string {
  return (
    getConfigValue("booking.visitReservationName", "VISIT_RESERVATION_NAME") ??
    "방문택배 발송"
  );
}

/** 예약 품목 유형 코드 조회 (기본 08 잡화/서적) */
export function getProductTypeCode(): string {
  return getSetting("booking.defaultProductType") ?? "08";
}
