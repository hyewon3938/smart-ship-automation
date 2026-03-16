"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { BookingLogDialog } from "@/components/BookingLogDialog";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { getGroupStatus, groupOrdersByOrderId } from "@/lib/groupOrders";

import type { DeliveryType, Order, OrderGroup, OrderStatus } from "@/types";

interface OrderTableProps {
  orders: Order[];
  selectedIds: Set<number>;
  onSelectedChange: (ids: Set<number>) => void;
  onGroupDeliveryTypeChange: (orderId: string, type: DeliveryType) => void;
  onGroupStatusChange: (orderId: string, status: OrderStatus) => void;
}

const MAX_ADDRESS_LENGTH = 40;

const DELIVERY_TYPE_LABELS: Record<string, string> = {
  domestic: "국내택배",
  nextDay: "내일배송",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  booking: "예약중",
  booked: "완료",
  failed: "실패",
  skipped: "건너뜀",
};

/** 체크박스 선택 가능한 상태 (pending + failed = 재시도 가능) */
const SELECTABLE_STATUSES = new Set(["pending", "failed"]);

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
}

function formatPrice(price: number | null | undefined): string {
  if (price == null) return "-";
  return `₩${price.toLocaleString("ko-KR")}`;
}

/** 그룹 내 택배유형 값 (셀렉터용) */
function getGroupDeliveryType(orders: Order[]): DeliveryType {
  const types = new Set(orders.map((o) => o.selectedDeliveryType));
  if (types.size === 1) return orders[0].selectedDeliveryType as DeliveryType;
  return "domestic"; // 혼합 시 기본값
}

/** 그룹 내 총 가격 */
function getGroupTotalPrice(orders: Order[]): number {
  return orders.reduce((sum, o) => sum + (o.totalPrice ?? 0), 0);
}


export function OrderTable({
  orders,
  selectedIds,
  onSelectedChange,
  onGroupDeliveryTypeChange,
  onGroupStatusChange,
}: OrderTableProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [logDialogOrderId, setLogDialogOrderId] = useState<number | null>(null);
  const [logDialogNaverOrderId, setLogDialogNaverOrderId] = useState("");

  const groups = useMemo(() => groupOrdersByOrderId(orders), [orders]);

  // 전체 선택 로직 (pending 또는 failed 주문 = 예약 가능 대상)
  const selectableOrders = orders.filter((o) => SELECTABLE_STATUSES.has(o.status));
  const allSelectableSelected =
    selectableOrders.length > 0 &&
    selectableOrders.every((o) => selectedIds.has(o.id));
  const someSelectableSelected =
    selectableOrders.some((o) => selectedIds.has(o.id)) && !allSelectableSelected;

  function handleSelectAll(checked: boolean) {
    if (checked) {
      onSelectedChange(new Set(selectableOrders.map((o) => o.id)));
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
    const selectableIds = group.orders
      .filter((o) => SELECTABLE_STATUSES.has(o.status))
      .map((o) => o.id);

    const next = new Set(selectedIds);
    if (checked) {
      selectableIds.forEach((id) => next.add(id));
    } else {
      selectableIds.forEach((id) => next.delete(id));
    }
    onSelectedChange(next);
  }

  function handleViewLogs(firstDbId: number, naverOrderId: string) {
    setLogDialogOrderId(firstDbId);
    setLogDialogNaverOrderId(naverOrderId);
  }

  if (orders.length === 0) {
    return (
      <div className="border rounded-lg p-12 text-center text-muted-foreground text-sm">
        주문이 없습니다
      </div>
    );
  }

  return (
    <>
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelectableSelected}
                indeterminate={someSelectableSelected}
                onCheckedChange={handleSelectAll}
                disabled={selectableOrders.length === 0}
                aria-label="전체 선택"
              />
            </TableHead>
            <TableHead className="w-8" />
            <TableHead className="w-24 min-w-[96px]">수령인</TableHead>
            <TableHead>배송지</TableHead>
            <TableHead className="w-28">택배유형</TableHead>
            <TableHead className="w-20">내일배송</TableHead>
            <TableHead className="w-28 text-right">상품/금액</TableHead>
            <TableHead className="w-24">상태</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => {
            const isExpanded = expandedGroups.has(group.orderId);
            const selectableInGroup = group.orders.filter(
              (o) => SELECTABLE_STATUSES.has(o.status)
            );
            const allGroupPendingSelected =
              selectableInGroup.length > 0 &&
              selectableInGroup.every((o) => selectedIds.has(o.id));
            const someGroupPendingSelected =
              selectableInGroup.some((o) => selectedIds.has(o.id)) &&
              !allGroupPendingSelected;
            const fullAddress = `${group.recipientAddress} ${group.recipientAddressDetail ?? ""}`.trim();

            return (
              <GroupRows
                key={group.orderId}
                group={group}
                isExpanded={isExpanded}
                allGroupPendingSelected={allGroupPendingSelected}
                someGroupPendingSelected={someGroupPendingSelected}
                hasSelectable={selectableInGroup.length > 0}
                fullAddress={fullAddress}
                onToggle={() => handleToggleGroup(group.orderId)}
                onGroupCheck={(checked) =>
                  handleGroupCheckChange(group, checked)
                }
                onGroupDeliveryTypeChange={onGroupDeliveryTypeChange}
                onGroupStatusChange={onGroupStatusChange}
                onViewLogs={handleViewLogs}
              />
            );
          })}
        </TableBody>
      </Table>
    </div>
    <BookingLogDialog
      orderId={logDialogOrderId}
      naverOrderId={logDialogNaverOrderId}
      open={logDialogOrderId !== null}
      onOpenChange={(open) => { if (!open) setLogDialogOrderId(null); }}
    />
    </>
  );
}

/** 그룹 헤더 + 펼침 시 상품 행들 */
interface GroupRowsProps {
  group: OrderGroup;
  isExpanded: boolean;
  allGroupPendingSelected: boolean;
  someGroupPendingSelected: boolean;
  hasSelectable: boolean;
  fullAddress: string;
  onToggle: () => void;
  onGroupCheck: (checked: boolean) => void;
  onGroupDeliveryTypeChange: (orderId: string, type: DeliveryType) => void;
  onGroupStatusChange: (orderId: string, status: OrderStatus) => void;
  onViewLogs: (firstDbId: number, naverOrderId: string) => void;
}

function GroupRows({
  group,
  isExpanded,
  allGroupPendingSelected,
  someGroupPendingSelected,
  hasSelectable,
  fullAddress,
  onToggle,
  onGroupCheck,
  onGroupDeliveryTypeChange,
  onGroupStatusChange,
  onViewLogs,
}: GroupRowsProps) {
  const groupStatus = getGroupStatus(group.orders);
  const groupDeliveryType = getGroupDeliveryType(group.orders);
  const totalPrice = getGroupTotalPrice(group.orders);
  const isEditable = SELECTABLE_STATUSES.has(groupStatus); // pending or failed

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
            disabled={!hasSelectable}
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
          <div className="space-y-0.5 min-w-0">
            <p className="text-sm font-medium truncate">{group.recipientName}</p>
            <p className="text-xs text-muted-foreground truncate">
              {group.recipientPhone}
            </p>
            <button
              className="text-xs text-blue-500 underline hover:text-blue-700 truncate block max-w-full"
              onClick={(e) => {
                e.stopPropagation();
                onViewLogs(group.orders[0].id, group.orderId);
              }}
            >
              {group.orderId}
            </button>
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
            {group.shippingMemo && (
              <p className="text-xs text-blue-600 dark:text-blue-400 truncate max-w-[300px]">
                💬 {group.shippingMemo}
              </p>
            )}
          </div>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          {isEditable ? (
            <Select
              value={groupDeliveryType}
              onValueChange={(v) =>
                onGroupDeliveryTypeChange(group.orderId, v as DeliveryType)
              }
            >
              <SelectTrigger className="w-28 h-7 text-xs">
                <span data-slot="select-value" className="flex flex-1 text-left">
                  {DELIVERY_TYPE_LABELS[groupDeliveryType]}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="domestic" className="text-xs">
                  국내택배
                </SelectItem>
                <SelectItem
                  value="nextDay"
                  disabled={!group.isNextDayEligible}
                  className="text-xs"
                >
                  {group.isNextDayEligible ? "내일배송" : "내일배송 (불가 지역)"}
                </SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <span className="text-sm">
              {DELIVERY_TYPE_LABELS[groupDeliveryType] ?? groupDeliveryType}
            </span>
          )}
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
        <TableCell className="text-right">
          <div className="space-y-0.5">
            <p className="text-sm">{group.orders.length}건</p>
            <p className="text-xs text-muted-foreground">
              {formatPrice(totalPrice)}
            </p>
          </div>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          {groupStatus === "booking" ? (
            <StatusBadge status={groupStatus} />
          ) : (
            <Select
              value={groupStatus}
              onValueChange={(v) =>
                onGroupStatusChange(group.orderId, v as OrderStatus)
              }
            >
              <SelectTrigger className="w-20 h-7 text-xs">
                <span data-slot="select-value" className="flex flex-1 text-left">
                  {STATUS_LABELS[groupStatus]}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending" className="text-xs">
                  대기
                </SelectItem>
                <SelectItem value="booked" className="text-xs">
                  완료
                </SelectItem>
                <SelectItem value="failed" className="text-xs">
                  실패
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </TableCell>
      </TableRow>

      {/* 펼친 상태 — 상품 리스트 */}
      {isExpanded &&
        group.orders.map((order) => (
            <TableRow
              key={order.id}
              className="border-0 bg-muted/10"
            >
              <TableCell />
              <TableCell />
              <TableCell colSpan={3}>
                <div className="space-y-0.5 pl-2">
                  <p className="text-sm leading-snug">{order.productName}</p>
                  {order.optionInfo && (
                    <p className="text-xs text-muted-foreground">
                      옵션: {order.optionInfo}
                    </p>
                  )}
                </div>
              </TableCell>
              <TableCell />
              <TableCell className="text-right text-sm">
                {order.quantity} × {formatPrice(order.totalPrice)}
              </TableCell>
              <TableCell />
            </TableRow>
          ))}
    </>
  );
}
