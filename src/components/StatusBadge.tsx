import { Badge } from "@/components/ui/badge";

import type { OrderStatus } from "@/types";

const STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "대기",
    className: "bg-muted text-muted-foreground hover:bg-muted",
  },
  booking: {
    label: "예약중",
    className:
      "bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-900 dark:text-blue-300",
  },
  booked: {
    label: "완료",
    className:
      "bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900 dark:text-green-300",
  },
  failed: {
    label: "실패",
    className:
      "bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-900 dark:text-red-300",
  },
  skipped: {
    label: "건너뜀",
    className:
      "border border-muted-foreground/30 text-muted-foreground bg-transparent hover:bg-transparent",
  },
};

interface StatusBadgeProps {
  status: OrderStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return <Badge className={config.className}>{config.label}</Badge>;
}
