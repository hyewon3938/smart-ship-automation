"use client";

import { useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTestNaver, useUpdateSettings } from "@/hooks/useSettings";
import type { NaverSettings } from "@/types";

interface Props {
  initial: NaverSettings;
}

export function NaverSettingsTab({ initial }: Props) {
  const [form, setForm] = useState<NaverSettings>(initial);

  const updateSettings = useUpdateSettings();
  const testNaver = useTestNaver();

  const handleSave = () => {
    updateSettings.mutate(
      { naver: form },
      {
        onSuccess: () => toast.success("네이버 API 설정이 저장되었습니다."),
        onError: (err) => toast.error(err.message),
      }
    );
  };

  const handleTest = () => {
    testNaver.mutate(undefined, {
      onSuccess: (data) => {
        if (data.success) {
          toast.success(data.message);
        } else {
          toast.error(data.message);
        }
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="naver-client-id">Client ID</Label>
        <Input
          id="naver-client-id"
          value={form.clientId}
          onChange={(e) => setForm((prev) => ({ ...prev, clientId: e.target.value }))}
          placeholder="네이버 커머스 API Client ID"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="naver-client-secret">Client Secret</Label>
        <Input
          id="naver-client-secret"
          type="password"
          value={form.clientSecret}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, clientSecret: e.target.value }))
          }
          placeholder="네이버 커머스 API Client Secret"
        />
      </div>
      <div className="flex gap-2 pt-2">
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={testNaver.isPending}
        >
          {testNaver.isPending ? "테스트 중..." : "연결 테스트"}
        </Button>
        <Button onClick={handleSave} disabled={updateSettings.isPending}>
          {updateSettings.isPending ? "저장 중..." : "저장"}
        </Button>
      </div>
    </div>
  );
}
