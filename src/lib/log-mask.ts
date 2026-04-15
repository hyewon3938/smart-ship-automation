/**
 * 로그 출력 시 민감 식별자를 마스킹.
 * 프로덕션에서만 마스킹하고, 개발 환경에서는 원본을 그대로 반환한다.
 */

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * 주문번호/예약번호 등 ID 마스킹.
 * 앞 4자리와 끝 4자리만 노출하고 가운데를 `***`로 가린다.
 * 길이가 9자 미만이면 가운데 한 글자만 노출.
 */
export function maskId(id: string | null | undefined): string {
  if (!id) return "";
  if (!isProd()) return id;
  if (id.length <= 8) {
    if (id.length <= 2) return "*".repeat(id.length);
    return `${id.slice(0, 1)}${"*".repeat(id.length - 2)}${id.slice(-1)}`;
  }
  return `${id.slice(0, 4)}***${id.slice(-4)}`;
}

/** 이름 마스킹: 첫 글자만 노출, 나머지는 `*` */
export function maskName(name: string | null | undefined): string {
  if (!name) return "";
  if (!isProd()) return name;
  if (name.length <= 1) return name;
  return `${name.slice(0, 1)}${"*".repeat(name.length - 1)}`;
}

/** 전화번호 마스킹: 가운데 4자리만 가림 (010-****-5678) */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  if (!isProd()) return phone;
  return phone.replace(
    /(\d{2,3})[\s-]?\d{3,4}[\s-]?(\d{4})/,
    "$1-****-$2"
  );
}
