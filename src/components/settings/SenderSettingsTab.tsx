"use client";

import { useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateSettings } from "@/hooks/useSettings";
import type { SenderSettings } from "@/types";

interface Props {
  initial: SenderSettings;
}

export function SenderSettingsTab({ initial }: Props) {
  const [form, setForm] = useState<SenderSettings>(initial);

  const updateSettings = useUpdateSettings();

  const handleSave = () => {
    updateSettings.mutate(
      { sender: form },
      {
        onSuccess: () => toast.success("보내는 사람 정보가 저장되었습니다."),
        onError: (err) => toast.error(err.message),
      }
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="sender-name">이름</Label>
        <Input
          id="sender-name"
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="홍길동"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sender-phone">전화번호</Label>
        <Input
          id="sender-phone"
          value={form.phone}
          onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
          placeholder="010-1234-5678"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sender-zipcode">우편번호</Label>
        <Input
          id="sender-zipcode"
          value={form.zipcode}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, zipcode: e.target.value }))
          }
          placeholder="12345"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sender-address">주소</Label>
        <Input
          id="sender-address"
          value={form.address}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, address: e.target.value }))
          }
          placeholder="서울특별시 강남구 역삼동"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sender-address-detail">상세주소</Label>
        <Input
          id="sender-address-detail"
          value={form.addressDetail}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, addressDetail: e.target.value }))
          }
          placeholder="123호"
        />
      </div>
      <div className="pt-2">
        <Button onClick={handleSave} disabled={updateSettings.isPending}>
          {updateSettings.isPending ? "저장 중..." : "저장"}
        </Button>
      </div>
    </div>
  );
}
