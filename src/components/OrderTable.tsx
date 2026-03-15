"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeliveryTypeSelector } from "@/components/DeliveryTypeSelector";
import { StatusBadge } from "@/components/StatusBadge";

import type { DeliveryType, Order } from "@/types";

interface OrderTableProps {
  orders: Order[];
  selectedIds: Set<number>;
  onSelectedChange: (ids: Set<number>) => void;
  onDeliveryTypeChange: (id: number, type: DeliveryType) => void;
}

const MAX_ADDRESS_LENGTH = 40;

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
}

function formatPrice(price: number | null | undefined): string {
  if (price == null) return "-";
  return `₩${price.toLocaleString("ko-KR")}`;
}

export function OrderTable({
  orders,
  selectedIds,
  onSelectedChange,
  onDeliveryTypeChange,
}: OrderTableProps) {
  const pendingOrders = orders.filter((o) => o.status === "pending");
  const allPendingSelected =
    pendingOrders.length > 0 &&
    pendingOrders.every((o) => selectedIds.has(o.id));
  const somePendingSelected =
    pendingOrders.some((o) => selectedIds.has(o.id)) && !allPendingSelected;

  function handleSelectAll(checked: boolean) {
    if (checked) {
      onSelectedChange(new Set(pendingOrders.map((o) => o.id)));
    } else {
      onSelectedChange(new Set());
    }
  }

  function handleSelectRow(id: number, checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
    onSelectedChange(next);
  }

  if (orders.length === 0) {
    return (
      <div className="border rounded-lg p-12 text-center text-muted-foreground text-sm">
        주문이 없습니다
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allPendingSelected}
                indeterminate={somePendingSelected}
                onCheckedChange={handleSelectAll}
                disabled={pendingOrders.length === 0}
                aria-label="전체 선택"
              />
            </TableHead>
            <TableHead>상품</TableHead>
            <TableHead className="w-16 text-center">수량</TableHead>
            <TableHead className="w-24 text-right">금액</TableHead>
            <TableHead className="w-32">수령인</TableHead>
            <TableHead>배송지</TableHead>
            <TableHead className="w-32">택배유형</TableHead>
            <TableHead className="w-20">상태</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => {
            const isPending = order.status === "pending";
            const isSelected = selectedIds.has(order.id);

            return (
              <TableRow
                key={order.id}
                data-state={isSelected ? "selected" : undefined}
                className={isSelected ? "bg-muted/50" : undefined}
              >
                <TableCell>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked) =>
                      handleSelectRow(order.id, !!checked)
                    }
                    disabled={!isPending}
                    aria-label={`${order.recipientName} 선택`}
                  />
                </TableCell>
                <TableCell>
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium leading-snug">
                      {order.productName}
                    </p>
                    {order.optionInfo && (
                      <p className="text-xs text-muted-foreground">
                        옵션: {order.optionInfo}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-center text-sm">
                  {order.quantity}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {formatPrice(order.totalPrice)}
                </TableCell>
                <TableCell>
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{order.recipientName}</p>
                    <p className="text-xs text-muted-foreground">
                      {order.recipientPhone}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-0.5">
                    <p className="text-sm">
                      {truncate(
                        `${order.recipientAddress} ${order.recipientAddressDetail ?? ""}`.trim(),
                        MAX_ADDRESS_LENGTH
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {order.recipientZipCode}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <DeliveryTypeSelector
                    value={order.selectedDeliveryType as DeliveryType}
                    isNextDayEligible={order.isNextDayEligible}
                    disabled={!isPending}
                    onChange={(type) => onDeliveryTypeChange(order.id, type)}
                  />
                </TableCell>
                <TableCell>
                  <StatusBadge status={order.status} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
