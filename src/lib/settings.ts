import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import type {
  AllSettings,
  BookingDefaults,
  GsSettings,
  NaverSettings,
  SenderSettings,
} from "@/types";

/** 설정값 조회 */
export function getSetting(key: string): string | null {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

/** 설정값 저장 (upsert) */
export function setSetting(key: string, value: string): void {
  const existing = db.select().from(settings).where(eq(settings.key, key)).get();
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
      clientSecret: maskSecret(getConfigValue("naver.clientSecret", "NAVER_CLIENT_SECRET")),
    },
    gs: {
      username: getConfigValue("gs.username", "GS_USERNAME") ?? "",
      password: maskSecret(getConfigValue("gs.password", "GS_PASSWORD")),
    },
    sender: {
      name: getConfigValue("sender.name", "SENDER_NAME") ?? "",
      phone: getConfigValue("sender.phone", "SENDER_PHONE") ?? "",
      zipcode: getConfigValue("sender.zipcode", "SENDER_ZIPCODE") ?? "",
      address: getConfigValue("sender.address", "SENDER_ADDRESS") ?? "",
      addressDetail: getConfigValue("sender.addressDetail", "SENDER_ADDRESS_DETAIL") ?? "",
    },
    booking: {
      defaultProductType: getSetting("booking.defaultProductType") ?? "08",
      defaultPrice: getSetting("booking.defaultPrice") ?? "1",
      defaultDeliveryType:
        (getSetting("booking.defaultDeliveryType") as "domestic" | "nextDay") ?? "domestic",
    },
  };
}

/** 전체 설정 조회 (비밀값 포함, 내부용) */
export function getAllSettingsRaw(): AllSettings {
  return {
    naver: {
      clientId: getConfigValue("naver.clientId", "NAVER_CLIENT_ID") ?? "",
      clientSecret: getConfigValue("naver.clientSecret", "NAVER_CLIENT_SECRET") ?? "",
    },
    gs: {
      username: getConfigValue("gs.username", "GS_USERNAME") ?? "",
      password: getConfigValue("gs.password", "GS_PASSWORD") ?? "",
    },
    sender: {
      name: getConfigValue("sender.name", "SENDER_NAME") ?? "",
      phone: getConfigValue("sender.phone", "SENDER_PHONE") ?? "",
      zipcode: getConfigValue("sender.zipcode", "SENDER_ZIPCODE") ?? "",
      address: getConfigValue("sender.address", "SENDER_ADDRESS") ?? "",
      addressDetail: getConfigValue("sender.addressDetail", "SENDER_ADDRESS_DETAIL") ?? "",
    },
    booking: {
      defaultProductType: getSetting("booking.defaultProductType") ?? "08",
      defaultPrice: getSetting("booking.defaultPrice") ?? "1",
      defaultDeliveryType:
        (getSetting("booking.defaultDeliveryType") as "domestic" | "nextDay") ?? "domestic",
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
}

export function updateSenderSettings(data: SenderSettings): void {
  setSetting("sender.name", data.name);
  setSetting("sender.phone", data.phone);
  setSetting("sender.zipcode", data.zipcode);
  setSetting("sender.address", data.address);
  setSetting("sender.addressDetail", data.addressDetail);
}

export function updateBookingDefaults(data: BookingDefaults): void {
  setSetting("booking.defaultProductType", data.defaultProductType);
  setSetting("booking.defaultPrice", data.defaultPrice);
  setSetting("booking.defaultDeliveryType", data.defaultDeliveryType);
}
