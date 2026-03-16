"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
/** Playwright 뷰포트 크기 (서버의 login-session.ts와 동일하게 유지) */
const LOGIN_VIEWPORT = { width: 1280, height: 800 } as const;

interface GsLoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoginSuccess: () => void;
}

type Status = "idle" | "starting" | "ready" | "clicking" | "success" | "error";

export function GsLoginModal({
  open,
  onOpenChange,
  onLoginSuccess,
}: GsLoginModalProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 세션 시작
  const startSession = useCallback(async () => {
    setStatus("starting");
    setMessage("서버에서 로그인 페이지를 여는 중...");
    setScreenshot(null);

    try {
      const res = await fetch("/api/gs-login", { method: "POST" });
      const data = await res.json();

      if (!data.success) {
        setStatus("error");
        setMessage(data.message || "세션 시작 실패");
        return;
      }

      if (data.loggedIn) {
        setStatus("success");
        setMessage("이미 로그인되어 있습니다!");
        setScreenshot(data.screenshot || null);
        onLoginSuccess();
        return;
      }

      setStatus("ready");
      setMessage("아래 화면에서 CAPTCHA를 클릭해주세요.");
      setScreenshot(data.screenshot || null);
    } catch {
      setStatus("error");
      setMessage("서버 연결에 실패했습니다.");
    }
  }, [onLoginSuccess]);

  // 모달 열릴 때 자동 시작
  useEffect(() => {
    if (open && status === "idle") {
      void startSession();
    }
  }, [open, status, startSession]);

  // 스크린샷 자동 갱신 (3초마다 — ready/clicking 상태일 때만)
  useEffect(() => {
    if (!open || (status !== "ready" && status !== "clicking")) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/gs-login/screenshot");
        if (!res.ok) return;
        const data = await res.json();
        if (data.screenshot) setScreenshot(data.screenshot);
        if (data.loggedIn) {
          setStatus("success");
          setMessage("로그인 성공! 쿠키가 저장되었습니다.");
          onLoginSuccess();
        }
      } catch {
        // 무시 — 네트워크 일시 오류
      }
    }, 3000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [open, status, onLoginSuccess]);

  // 스크린샷 클릭 → 좌표 전달
  async function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (status !== "ready" || !imgRef.current) return;

    const rect = imgRef.current.getBoundingClientRect();
    const scaleX = LOGIN_VIEWPORT.width / rect.width;
    const scaleY = LOGIN_VIEWPORT.height / rect.height;

    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    setStatus("clicking");
    setMessage("클릭 처리 중...");

    try {
      const res = await fetch("/api/gs-login/click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y }),
      });
      const data = await res.json();

      if (data.screenshot) setScreenshot(data.screenshot);

      if (data.loggedIn) {
        setStatus("success");
        setMessage("로그인 성공! 쿠키가 저장되었습니다.");
        onLoginSuccess();
      } else {
        setStatus("ready");
        setMessage("CAPTCHA를 클릭해주세요. (변화가 없으면 다시 클릭)");
      }
    } catch {
      setStatus("ready");
      setMessage("클릭 전달 실패. 다시 시도해주세요.");
    }
  }

  // 모달 닫기
  function handleClose() {
    // 세션 정리
    void fetch("/api/gs-login", { method: "DELETE" }).catch(() => {});
    setStatus("idle");
    setMessage("");
    setScreenshot(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>GS택배 원격 로그인</DialogTitle>
          <DialogDescription>
            {status === "starting" && "서버에서 로그인 페이지를 여는 중입니다..."}
            {status === "ready" && "아래 화면에서 CAPTCHA 체크박스를 클릭해주세요."}
            {status === "clicking" && "클릭 처리 중..."}
            {status === "success" && "로그인이 완료되었습니다!"}
            {status === "error" && "오류가 발생했습니다."}
          </DialogDescription>
        </DialogHeader>

        {/* 스크린샷 뷰어 */}
        {screenshot && (
          <div className="relative border rounded-lg overflow-hidden bg-gray-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={`data:image/jpeg;base64,${screenshot}`}
              alt="GS택배 로그인 페이지"
              className={`w-full h-auto ${
                status === "ready" ? "cursor-crosshair" : "cursor-default"
              }`}
              onClick={handleImageClick}
              draggable={false}
            />
            {status === "clicking" && (
              <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                <span className="text-white text-sm bg-black/60 px-3 py-1 rounded">
                  처리 중...
                </span>
              </div>
            )}
          </div>
        )}

        {/* 상태 메시지 */}
        {message && (
          <p
            className={`text-sm ${
              status === "success"
                ? "text-green-600"
                : status === "error"
                  ? "text-destructive"
                  : "text-muted-foreground"
            }`}
          >
            {message}
          </p>
        )}

        {/* 버튼 */}
        <div className="flex justify-end gap-2">
          {status === "starting" && (
            <Button disabled>
              <span className="animate-spin mr-2">&#8987;</span>
              준비 중...
            </Button>
          )}

          {status === "ready" && (
            <>
              <Button variant="outline" size="sm" onClick={startSession}>
                새로고침
              </Button>
              <Button variant="outline" onClick={handleClose}>
                닫기
              </Button>
            </>
          )}

          {status === "success" && (
            <Button onClick={handleClose}>확인</Button>
          )}

          {status === "error" && (
            <>
              <Button variant="outline" onClick={startSession}>
                다시 시도
              </Button>
              <Button variant="outline" onClick={handleClose}>
                닫기
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
