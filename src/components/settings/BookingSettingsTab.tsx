"use client";

import { useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateSettings } from "@/hooks/useSettings";
import type { BookingDefaults } from "@/types";

const PRODUCT_TYPES = [
  { value: "01", label: "의류" },
  { value: "02", label: "식품" },
  { value: "03", label: "전자제품" },
  { value: "04", label: "화장품" },
  { value: "05", label: "스포츠/레저" },
  { value: "06", label: "가구/인테리어" },
  { value: "07", label: "도서" },
  { value: "08", label: "잡화/서적" },
  { value: "09", label: "기타" },
];

interface Props {
  initial: BookingDefaults;
}

export function BookingSettingsTab({ initial }: Props) {
  const [form, setForm] = useState<BookingDefaults>(initial);

  const updateSettings = useUpdateSettings();

  const handleSave = () => {
    updateSettings.mutate(
      { booking: form },
      {
        onSuccess: () => toast.success("택배 기본값이 저장되었습니다."),
        onError: (err) => toast.error(err.message),
      }
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="booking-product-type">기본 물품 유형</Label>
        <Select
          value={form.defaultProductType}
          onValueChange={(value) =>
            setForm((prev) => ({ ...prev, defaultProductType: value ?? prev.defaultProductType }))
          }
        >
          <SelectTrigger id="booking-product-type">
            <SelectValue placeholder="물품 유형 선택" />
          </SelectTrigger>
          <SelectContent>
            {PRODUCT_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="booking-price">기본 가격 (만원 단위)</Label>
        <Input
          id="booking-price"
          type="number"
          min="1"
          value={form.defaultPrice}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, defaultPrice: e.target.value }))
          }
          placeholder="1"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="booking-delivery-type">기본 택배 유형</Label>
        <Select
          value={form.defaultDeliveryType}
          onValueChange={(value) =>
            setForm((prev) => ({
              ...prev,
              defaultDeliveryType: value as "domestic" | "nextDay",
            }))
          }
        >
          <SelectTrigger id="booking-delivery-type">
            <SelectValue placeholder="택배 유형 선택" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="domestic">국내택배</SelectItem>
            <SelectItem value="nextDay">내일배송</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="pt-2">
        <Button onClick={handleSave} disabled={updateSettings.isPending}>
          {updateSettings.isPending ? "저장 중..." : "저장"}
        </Button>
      </div>
    </div>
  );
}
