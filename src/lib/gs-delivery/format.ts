/**
 * GS택배 예약 폼 입력값 가공 함수.
 * 국내택배·내일배송(automation.ts)과 방문택배(visit-pickup.ts)가 함께 쓴다.
 */

/**
 * 전화번호 포맷팅.
 * 이미 하이픈이 있으면 그대로 사용 (네이버 API 원본 유지).
 * 숫자만 있으면 길이에 따라 하이픈 삽입.
 *  - 11자리: 010-1234-5678 (일반 휴대폰)
 *  - 12자리: 0502-1234-5678 (안심번호 0502/0504/0505/0507 등)
 *  - 10자리(02): 02-1234-5678 (서울)
 *  - 10자리: 031-123-5678 (지역)
 */
export function formatPhone(raw: string): string {
  // 이미 하이픈이 포함되어 있으면 그대로
  if (raw.includes("-")) return raw;

  const digits = raw.replace(/\D/g, "");

  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 12) {
    // 안심번호: 0502-1234-5678
    return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  if (digits.length === 10 && digits.startsWith("02")) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  // 기타: 그대로 반환
  return raw;
}

/**
 * GS택배 배송 요청사항 필드에 입력 불가한 특수문자 제거.
 * 허용: 한글, 영문, 숫자, 공백, 쉼표, 마침표, 하이픈, 괄호, 슬래시
 */
export function sanitizeDeliveryMessage(message: string): string {
  return message.replace(/[^\uAC00-\uD7A3a-zA-Z0-9 .,\-()\/]/g, "").trim();
}

/**
 * 이름 필드 sanitize (국내택배·내일배송 폼).
 * 허용: 한글, 영문, 숫자, 공백
 * 네이버 주문 데이터에 마스킹(김*수) 또는 특수문자가 있을 수 있음.
 */
export function sanitizeName(name: string): string {
  // 마스킹 문자 * → 빈칸으로 제거 (김*수 → 김수)
  return name.replace(/[^\uAC00-\uD7A3a-zA-Z0-9 ]/g, "").trim();
}

/**
 * 이름 필드 sanitize (방문택배 폼).
 * sanitizeName과 달리 괄호가 있으면 첫 괄호 안의 이름만 남긴다.
 */
export function sanitizeParenName(name: string): string {
  // "주문자(수령인)" 형식이면 수령인만 추출
  const parenMatch = name.match(/\(([^)]+)\)/);
  const extracted = parenMatch ? parenMatch[1] : name;
  return extracted.replace(/[^\uAC00-\uD7A3a-zA-Z0-9 ]/g, "").trim();
}

/**
 * 주소 필드 sanitize.
 * 허용: 한글, 영문, 숫자, 공백, 쉼표, 마침표, 하이픈, 괄호, 슬래시, #
 */
export function sanitizeAddress(addr: string): string {
  return addr.replace(/[^\uAC00-\uD7A3a-zA-Z0-9 .,\-()\/\#]/g, "").trim();
}
