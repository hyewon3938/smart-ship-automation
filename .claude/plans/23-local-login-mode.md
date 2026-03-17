# refactor(gs-login): 원격 스크린샷 로그인 제거 → 로컬 직접 로그인 전환

## 이슈
- 번호: #23
- 브랜치: refactor/23-local-login-mode

## 개요
서버 원격 스크린샷 CAPTCHA 방식이 불안정하므로 제거. 로컬 Playwright headed 브라우저에서 사용자가 직접 CAPTCHA를 처리하는 방식으로 전환. 추가로 국내택배 예약 시 "내일택배 전환" 팝업 처리 추가.

## 변경 파일 목록
| 파일 | 변경 유형 | 설명 |
|------|----------|------|
| `src/components/GsLoginModal.tsx` | **삭제** | 원격 스크린샷 로그인 UI 제거 |
| `src/app/api/gs-login/route.ts` | **수정** | POST: startSession → 로컬 직접 로그인 호출로 변경 |
| `src/app/api/gs-login/screenshot/` | **삭제** | 원격 스크린샷 API 제거 |
| `src/app/api/gs-login/click/` | **삭제** | 원격 클릭 전달 API 제거 |
| `src/app/api/gs-login/status/route.ts` | 유지 | 쿠키 유효성 확인 (변경 없음) |
| `src/lib/gs-delivery/login-session.ts` | **대폭 수정** | 원격 세션 로직 제거, 로컬 직접 로그인 함수로 교체 |
| `src/components/Dashboard.tsx` | **수정** | GsLoginModal → 간단한 로그인 버튼 (API 호출만) |
| `src/lib/gs-delivery/automation.ts` | **수정** | "내일택배 전환" 팝업 처리 추가 |

## 구현 상세

### 1. `login-session.ts` — 원격 세션 제거 + 로컬 직접 로그인

원격 세션 관련 코드(`activePage`, `sessionTimeout`, `startSession`, `getScreenshot`, `forwardClick`, `closeSession`, `checkIfLoggedIn`, `handleLoginSuccess`, `resetSessionTimer`, `LOGIN_VIEWPORT`) 모두 제거.

새 함수 추가:

```typescript
/**
 * 로컬 직접 로그인.
 * Playwright headed 브라우저에서 로그인 페이지를 열고,
 * ID/PW 자동 입력 후 사용자가 직접 CAPTCHA를 처리할 때까지 대기.
 * 로그인 성공 시 쿠키 저장 + 서버 동기화.
 */
export async function loginDirect(): Promise<{
  success: boolean;
  message: string;
}> {
  const username = getConfigValue("gs.username", "GS_USERNAME");
  const password = getConfigValue("gs.password", "GS_PASSWORD");

  if (!username || !password) {
    return { success: false, message: "GS택배 아이디/비밀번호가 설정되지 않았습니다." };
  }

  const page = await newPage();
  try {
    // 이미 로그인 상태인지 확인
    if (await isLoggedIn(page)) {
      await saveCookies();
      return { success: true, message: "이미 로그인되어 있습니다." };
    }

    // 로그인 페이지 이동 + ID/PW 자동 입력
    await page.goto(GS_URLS.LOGIN, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForTimeout(ACTION_DELAY_MS);
    await page.locator(LOGIN_SELECTORS.USERNAME).fill(username);
    await page.locator(LOGIN_SELECTORS.PASSWORD).fill(password);

    console.log("[login-direct] 로그인 페이지 열림 — 브라우저에서 CAPTCHA 처리 대기...");

    // 로그인 성공까지 최대 120초 대기 (3초 간격 폴링)
    const maxWait = 120_000;
    const interval = 3_000;
    let elapsed = 0;

    while (elapsed < maxWait) {
      await page.waitForTimeout(interval);
      elapsed += interval;

      if (page.isClosed()) {
        return { success: false, message: "브라우저가 닫혔습니다." };
      }

      // URL이 바뀌거나 로그아웃 버튼이 보이면 로그인 성공
      const url = page.url();
      if (url.includes("reservation-inquiry") || url.includes("my-page")) {
        break;
      }
      const logoutVisible = await page
        .locator("a:has-text('로그아웃')")
        .isVisible({ timeout: 1000 })
        .catch(() => false);
      if (logoutVisible) break;
    }

    // 최종 로그인 확인
    if (await isLoggedIn(page)) {
      await saveCookies();
      void syncCookiesAfterSave();
      console.log("[login-direct] 로그인 성공 — 쿠키 저장 완료");
      return { success: true, message: "로그인 성공! 쿠키가 저장되었습니다." };
    }

    return { success: false, message: "로그인 시간이 초과되었습니다. 다시 시도해주세요." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    return { success: false, message: `로그인 실패: ${msg}` };
  } finally {
    await page.close().catch(() => {});
  }
}
```

유지할 함수: `checkCookieValidity()`, `getCookieFileTime()`, `syncCookiesAfterSave()`

### 2. `gs-login/route.ts` — 단순화

```typescript
import { NextResponse } from "next/server";
import { loginDirect } from "@/lib/gs-delivery/login-session";

/** POST /api/gs-login — 로컬 직접 로그인 실행 */
export async function POST() {
  const result = await loginDirect();
  return NextResponse.json(result);
}
```

DELETE 핸들러 제거 (세션 관리 없음).

### 3. `Dashboard.tsx` — GsLoginModal 제거

- `GsLoginModal` import 및 컴포넌트 제거
- 로그인 버튼 클릭 시 `POST /api/gs-login` 호출 → 토스트로 결과 표시
- 로딩 상태 추가 (로그인 진행 중 표시)

```typescript
const [isLoggingIn, setIsLoggingIn] = useState(false);

async function handleGsLogin() {
  setIsLoggingIn(true);
  toast.info("브라우저에서 GS택배 로그인을 진행합니다. CAPTCHA를 처리해주세요.");
  try {
    const res = await fetch("/api/gs-login", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      toast.success(data.message);
      cookieStatusQuery.refetch();
    } else {
      toast.error(data.message);
    }
  } catch {
    toast.error("로그인 요청 실패");
  } finally {
    setIsLoggingIn(false);
  }
}
```

헤더 버튼:
```tsx
<button
  onClick={handleGsLogin}
  disabled={isLoggingIn}
  className={`text-sm hover:text-foreground ${
    isLoggingIn ? "animate-pulse" : isCookieExpired ? "text-orange-600 font-medium" : "text-muted-foreground"
  }`}
>
  {isLoggingIn ? "로그인 중..." : `GS로그인${isCookieExpired ? " (만료)" : ""}`}
</button>
```

배너의 로그인 버튼도 동일하게 `handleGsLogin()` 호출.

### 4. 삭제할 파일들

- `src/components/GsLoginModal.tsx`
- `src/app/api/gs-login/screenshot/route.ts`
- `src/app/api/gs-login/click/route.ts`

### 5. `automation.ts` — "내일택배 전환" 팝업 처리

제출 후 팝업 처리 단계에 "국내택배로 계속" 버튼 클릭 추가:

```typescript
// ── 5. 제출 ──
currentStep = "5. 예약 제출";
await page.locator(S.SUBMIT).click();

// 제출 후 팝업 처리 (내일택배 전환 확인, 파손면책 동의 등)
await page.waitForTimeout(ACTION_DELAY_MS * 2);

// "내일택배 전환" 팝업 — "국내택배로 계속" 클릭
const domesticContinueClicked = await page.evaluate(() => {
  const keywords = ["국내택배로 계속", "국내택배로 진행", "국내택배 계속"];
  const candidates = Array.from(document.querySelectorAll("a, button")) as HTMLElement[];
  for (const kw of keywords) {
    for (const el of candidates) {
      if (
        el.textContent?.trim().includes(kw) &&
        el.offsetParent !== null &&
        el.offsetWidth > 0
      ) {
        el.click();
        return kw;
      }
    }
  }
  return null;
});
if (domesticContinueClicked) {
  console.log(`[booking] 내일택배 전환 팝업 — "${domesticContinueClicked}" 클릭 ✓`);
  await page.waitForTimeout(ACTION_DELAY_MS * 2);
}

await dismissPopups(page);
```

## 커밋 계획
1. `refactor(gs-login): 원격 스크린샷 로그인 제거, 로컬 직접 로그인으로 전환` — login-session.ts, gs-login API, GsLoginModal 삭제, Dashboard 수정
2. `fix(gs-delivery): 국내택배 예약 시 내일택배 전환 팝업 처리` — automation.ts

## 체크리스트
- [ ] 프로젝트 컨벤션 규칙 준수
- [ ] 민감 정보 하드코딩 없음
- [ ] 타입 안전성 확인
- [ ] 에러 핸들링 포함
- [ ] `docs/project-history.md` 업데이트
