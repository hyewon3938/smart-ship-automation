"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUpdateDispatchSettings } from "@/hooks/useDispatch";
import type { DispatchSettings } from "@/types";

interface Props {
  initial: DispatchSettings;
}

export function DispatchSettingsTab({ initial }: Props) {
  const [form, setForm] = useState<DispatchSettings>(initial);
  const updateSettings = useUpdateDispatchSettings();

  function handleSave() {
    updateSettings.mutate(form, {
      onSuccess: () => toast.success("발송처리 설정이 저장되었습니다."),
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label htmlFor="dispatch-auto-mode">자동 발송처리</Label>
          <p className="text-xs text-muted-foreground">
            운송장번호 감지 시 즉시 네이버 발송처리 (OFF = 수동 승인)
          </p>
        </div>
        <Switch
          id="dispatch-auto-mode"
          checked={form.autoMode}
          onCheckedChange={(checked) =>
            setForm((prev) => ({ ...prev, autoMode: checked }))
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dispatch-poll-interval">폴링 간격 (분)</Label>
        <Input
          id="dispatch-poll-interval"
          type="number"
          min="1"
          max="60"
          value={form.pollIntervalMin}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, pollIntervalMin: Number(e.target.value) }))
          }
        />
        <p className="text-xs text-muted-foreground">
          GS택배 예약조회에서 운송장번호를 확인하는 주기
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="dispatch-nextday-code">내일배송 택배사 코드</Label>
        <Input
          id="dispatch-nextday-code"
          value={form.nextDayDeliveryCode}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, nextDayDeliveryCode: e.target.value }))
          }
          placeholder="DELIVERBOX"
        />
        <p className="text-xs text-muted-foreground">
          딜리박스 택배사 코드 (네이버 API 기준). 첫 발송처리 후 오류가 나면 조정하세요.
        </p>
      </div>
      <div className="pt-2">
        <Button onClick={handleSave} disabled={updateSettings.isPending}>
          {updateSettings.isPending ? "저장 중..." : "저장"}
        </Button>
      </div>
    </div>
  );
}
