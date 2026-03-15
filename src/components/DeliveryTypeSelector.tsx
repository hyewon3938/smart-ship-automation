"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { DeliveryType } from "@/types";

interface DeliveryTypeSelectorProps {
  value: DeliveryType;
  isNextDayEligible: boolean;
  /** pending이 아닌 주문은 변경 불가 */
  disabled?: boolean;
  onChange: (value: DeliveryType) => void;
}

export function DeliveryTypeSelector({
  value,
  isNextDayEligible,
  disabled = false,
  onChange,
}: DeliveryTypeSelectorProps) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as DeliveryType)}
      disabled={disabled}
    >
      <SelectTrigger className="w-28 h-7 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="domestic" className="text-xs">
          국내택배
        </SelectItem>
        <SelectItem
          value="nextDay"
          disabled={!isNextDayEligible}
          className="text-xs"
        >
          {isNextDayEligible ? "내일배송" : "내일배송 (불가 지역)"}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
