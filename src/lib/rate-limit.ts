/**
 * 단일 프로세스(PM2 1-인스턴스) 환경용 인메모리 슬라이딩 윈도우 레이트 리밋.
 */

interface Attempt {
  count: number;
  resetAt: number;
}

const attempts = new Map<string, Attempt>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec?: number;
}

export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (entry.count >= maxAttempts) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  entry.count += 1;
  return { allowed: true };
}

export function resetRateLimit(key: string): void {
  attempts.delete(key);
}

/**
 * 프록시 뒤 클라이언트 IP 추출. X-Forwarded-For 우선, 없으면 X-Real-IP.
 * 둘 다 없으면 "unknown" (로컬 개발 등).
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}
