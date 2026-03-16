"use client";

import { useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTestGs, useUpdateSettings } from "@/hooks/useSettings";
import type { GsSettings } from "@/types";

interface Props {
  initial: GsSettings;
}

export function GsSettingsTab({ initial }: Props) {
  const [form, setForm] = useState<GsSettings>(initial);

  const updateSettings = useUpdateSettings();
  const testGs = useTestGs();

  const handleSave = () => {
    updateSettings.mutate(
      { gs: form },
      {
        onSuccess: () => toast.success("GS택배 설정이 저장되었습니다."),
        onError: (err) => toast.error(err.message),
      }
    );
  };

  const handleTest = () => {
    testGs.mutate(undefined, {
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
        <Label htmlFor="gs-username">아이디</Label>
        <Input
          id="gs-username"
          value={form.username}
          onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
          placeholder="cvsnet.co.kr 아이디"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="gs-password">비밀번호</Label>
        <Input
          id="gs-password"
          type="password"
          value={form.password}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, password: e.target.value }))
          }
          placeholder="cvsnet.co.kr 비밀번호"
        />
      </div>
      <p className="text-sm text-muted-foreground">
        로그인 테스트 시 브라우저 창이 열립니다. 캡챠가 표시되면 직접 통과해주세요.
      </p>
      <div className="flex gap-2 pt-2">
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={testGs.isPending}
        >
          {testGs.isPending ? "테스트 중..." : "로그인 테스트"}
        </Button>
        <Button onClick={handleSave} disabled={updateSettings.isPending}>
          {updateSettings.isPending ? "저장 중..." : "저장"}
        </Button>
      </div>
    </div>
  );
}
