"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { groupOrdersByOrderId } from "@/lib/groupOrders";

import type { DeliveryType, Order, OrderGroup } from "@/types";

interface OrderTableProps {
  orders: Order[];
  selectedIds: Set<number>;
  onSelectedChange: (ids: Set<number>) => void;
  onDeliveryTypeChange: (id: number, type: DeliveryType) => void;
}

const MAX_ADDRESS_LENGTH = 40;
const TOTAL_COLUMNS = 8;

const DELIVERY_TYPE_LABELS: Record<string, string> = {
  domestic: "국내택배",
  nextDay: "내일배송",
};

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
}

function formatPrice(price: number | null | undefined): string {
  if (price == null) return "-";
  return `₩${price.toLocaleString("ko-KR")}`;
}

/** 그룹 내 택배유형 요약 라벨 */
function getGroupDeliveryLabel(orders: Order[]): string {
  const types = new Set(orders.map((o) => o.selectedDeliveryType));
  if (types.size === 1) {
    return DELIVERY_TYPE_LABELS[orders[0].selectedDeliveryType] ?? orders[0].selectedDeliveryType;
  }
  return "혼합";
}

/** 그룹 내 상태 요약 (우선순위 기반) */
function getGroupStatus(orders: Order[]): Order["status"] {
  const statuses = new Set(orders.map((o) => o.status));
  if (statuses.size === 1) return orders[0].status;
  if (statuses.has("booking")) return "booking";
  if (statuses.has("failed")) return "failed";
  if (statuses.has("pending")) return "pending";
  if (statuses.has("booked")) return "booked";
  return "skipped";
}

export function OrderTable({
  orders,
  selectedIds,
  onSelectedChange,
  onDeliveryTypeChange,
}: OrderTableProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const groups = useMemo(() => groupOrdersByOrderId(orders), [orders]);

  // 전체 선택 로직 (pending 주문만)
  const allPendingOrders = orders.filter((o) => o.status === "pending");
  const allPendingSelected =
    allPendingOrders.length > 0 &&
    allPendingOrders.every((o) => selectedIds.has(o.id));
  const somePendingSelected =
    allPendingOrders.some((o) => selectedIds.has(o.id)) && !allPendingSelected;

  function handleSelectAll(checked: boolean) {
    if (checked) {
      onSelectedChange(new Set(allPendingOrders.map((o) => o.id)));
    } else {
      onSelectedChange(new Set());
    }
  }

  function handleToggleGroup(orderId: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }

  function handleGroupCheckChange(group: OrderGroup, checked: boolean) {
    const pendingIds = group.orders
      .filter((o) => o.status === "pending")
      .map((o) => o.id);

    const next = new Set(selectedIds);
    if (checked) {
      pendingIds.forEach((id) => next.add(id));
    } else {
      pendingIds.forEach((id) => next.delete(id));
    }
    onSelectedChange(next);
  }

  function handleRowCheckChange(id: number, checked: boolean) {
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
                disabled={allPendingOrders.length === 0}
                aria-label="전체 선택"
              />
            </TableHead>
            <TableHead className="w-8" />
            <TableHead className="w-32">수령인</TableHead>
            <TableHead>배송지</TableHead>
            <TableHead className="w-24">택배유형</TableHead>
            <TableHead className="w-20">내일배송</TableHead>
            <TableHead className="w-16 text-center">상품수</TableHead>
            <TableHead className="w-20">상태</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => {
            const isExpanded = expandedGroups.has(group.orderId);
            const pendingInGroup = group.orders.filter(
              (o) => o.status === "pending"
            );
            const allGroupPendingSelected =
              pendingInGroup.length > 0 &&
              pendingInGroup.every((o) => selectedIds.has(o.id));
            const someGroupPendingSelected =
              pendingInGroup.some((o) => selectedIds.has(o.id)) &&
              !allGroupPendingSelected;
            const fullAddress = `${group.recipientAddress} ${group.recipientAddressDetail ?? ""}`.trim();

            return (
              <GroupRows
                key={group.orderId}
                group={group}
                isExpanded={isExpanded}
                allGroupPendingSelected={allGroupPendingSelected}
                someGroupPendingSelected={someGroupPendingSelected}
                hasPending={pendingInGroup.length > 0}
                fullAddress={fullAddress}
                selectedIds={selectedIds}
                onToggle={() => handleToggleGroup(group.orderId)}
                onGroupCheck={(checked) =>
                  handleGroupCheckChange(group, checked)
                }
                onRowCheck={handleRowCheckChange}
                onDeliveryTypeChange={onDeliveryTypeChange}
              />
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** 그룹 헤더 + 펼침 시 상품 행들 */
interface GroupRowsProps {
  group: OrderGroup;
  isExpanded: boolean;
  allGroupPendingSelected: boolean;
  someGroupPendingSelected: boolean;
  hasPending: boolean;
  fullAddress: string;
  selectedIds: Set<number>;
  onToggle: () => void;
  onGroupCheck: (checked: boolean) => void;
  onRowCheck: (id: number, checked: boolean) => void;
  onDeliveryTypeChange: (id: number, type: DeliveryType) => void;
}

function GroupRows({
  group,
  isExpanded,
  allGroupPendingSelected,
  someGroupPendingSelected,
  hasPending,
  fullAddress,
  selectedIds,
  onToggle,
  onGroupCheck,
  onRowCheck,
  onDeliveryTypeChange,
}: GroupRowsProps) {
  const groupStatus = getGroupStatus(group.orders);
  const deliveryLabel = getGroupDeliveryLabel(group.orders);

  return (
    <>
      {/* 그룹 헤더 행 */}
      <TableRow
        className={`${
          allGroupPendingSelected ? "bg-muted/50" : ""
        } cursor-pointer`}
        onClick={onToggle}
      >
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={allGroupPendingSelected}
            indeterminate={someGroupPendingSelected}
            onCheckedChange={onGroupCheck}
            disabled={!hasPending}
            aria-label={`${group.recipientName} 그룹 선택`}
          />
        </TableCell>
        <TableCell className="px-1">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell>
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{group.recipientName}</p>
            <p className="text-xs text-muted-foreground">
              {group.recipientPhone}
            </p>
          </div>
        </TableCell>
        <TableCell>
          <div className="space-y-0.5">
            <p className="text-sm">
              {truncate(fullAddress, MAX_ADDRESS_LENGTH)}
            </p>
            <p className="text-xs text-muted-foreground">
              {group.recipientZipCode}
            </p>
          </div>
        </TableCell>
        <TableCell>
          <span className="text-sm">{deliveryLabel}</span>
        </TableCell>
        <TableCell>
          {group.isNextDayEligible ? (
            <Badge className="bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900 dark:text-green-300">
              가능
            </Badge>
          ) : (
            <Badge className="bg-muted text-muted-foreground hover:bg-muted">
              불가
            </Badge>
          )}
        </TableCell>
        <TableCell className="text-center text-sm">
          {group.orders.length}건
        </TableCell>
        <TableCell>
          <StatusBadge status={groupStatus} />
        </TableCell>
      </TableRow>

      {/* 배송메모 행 (있을 때만) */}
      {group.shippingMemo && (
        <TableRow className="border-0 hover:bg-transparent">
          <TableCell colSpan={TOTAL_COLUMNS} className="pt-0 pb-2 pl-20">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground/70">배송메모:</span>{" "}
              {group.shippingMemo}
            </p>
          </TableCell>
        </TableRow>
      )}

      {/* 펼친 상태 — 상품 리스트 */}
      {isExpanded &&
        group.orders.map((order) => {
          const isPending = order.status === "pending";
          const isSelected = selectedIds.has(order.id);

          return (
            <TableRow
              key={order.id}
              className={`${isSelected ? "bg-muted/30" : ""} border-0`}
            >
              <TableCell className="pl-6" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) =>
                    onRowCheck(order.id, !!checked)
                  }
                  disabled={!isPending}
                  aria-label={`${order.productName} 선택`}
                />
              </TableCell>
              <TableCell />
              <TableCell colSpan={2}>
                <div className="space-y-0.5 pl-2">
                  <p className="text-sm leading-snug">{order.productName}</p>
                  {order.optionInfo && (
                    <p className="text-xs text-muted-foreground">
                      옵션: {order.optionInfo}
                    </p>
                  )}
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
              <TableCell className="text-center text-sm">
                {order.quantity}
              </TableCell>
              <TableCell className="text-right text-sm">
                {formatPrice(order.totalPrice)}
              </TableCell>
              <TableCell>
                <StatusBadge status={order.status} />
              </TableCell>
            </TableRow>
          );
        })}
    </>
  );
}
