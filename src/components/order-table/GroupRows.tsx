"use client";

import { ChevronDown, ChevronRight, ScrollText, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { getGroupStatus } from "@/lib/groupOrders";

import {
  DELIVERY_TYPE_LABELS,
  NON_EDITABLE_BADGE_STATUSES,
  SELECTABLE_STATUSES,
  formatPickupDate,
  formatPrice,
  getGroupDeliveryStatus,
  getGroupDeliveryType,
  getGroupPickupDate,
  getGroupTotalPrice,
} from "./orderGroupUtils";

import type { DeliveryType, OrderGroup, OrderStatus } from "@/types";

/** 그룹 헤더 + 펼침 시 상품 행들 */
interface GroupRowsProps {
  group: OrderGroup;
  isExpanded: boolean;
  allGroupPendingSelected: boolean;
  someGroupPendingSelected: boolean;
  hasSelectable: boolean;
  fullAddress: string;
  selectable: boolean;
  onToggle: () => void;
  onGroupCheck: (checked: boolean) => void;
  onGroupDeliveryTypeChange: (orderId: string, type: DeliveryType) => void;
  onGroupStatusChange: (orderId: string, status: OrderStatus) => void;
  onGroupDelete?: (group: OrderGroup) => void;
  onViewLogs: (firstDbId: number, naverOrderId: string) => void;
}

export function GroupRows({
  group,
  isExpanded,
  allGroupPendingSelected,
  someGroupPendingSelected,
  hasSelectable,
  fullAddress,
  selectable,
  onToggle,
  onGroupCheck,
  onGroupDeliveryTypeChange,
  onGroupStatusChange,
  onGroupDelete,
  onViewLogs,
}: GroupRowsProps) {
  const groupStatus = getGroupStatus(group.orders);
  const groupDeliveryType = getGroupDeliveryType(group.orders);
  const totalPrice = getGroupTotalPrice(group.orders);
  const groupDeliveryStatus = getGroupDeliveryStatus(group.orders);
  const groupPickupDate = getGroupPickupDate(group.orders);
  const isEditable = SELECTABLE_STATUSES.has(groupStatus); // pending or failed
  // 예약 진행 중(booking)에는 Playwright가 그 row를 쓰고 있고,
  // 발송완료(dispatched)는 이미 배송이 시작돼 되돌릴 수 없다 → 삭제 불가
  const canDelete =
    !!onGroupDelete &&
    groupStatus !== "booking" &&
    groupStatus !== "dispatched";

  return (
    <>
      {/* 그룹 헤더 행 */}
      <TableRow
        className={`${
          allGroupPendingSelected ? "bg-muted/50" : ""
        } cursor-pointer`}
        onClick={onToggle}
      >
        {selectable && (
          <TableCell onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={allGroupPendingSelected}
              indeterminate={someGroupPendingSelected}
              onCheckedChange={onGroupCheck}
              disabled={!hasSelectable}
              aria-label={`${group.recipientName} 그룹 선택`}
            />
          </TableCell>
        )}
        <TableCell className="px-1">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell>
          <div className="space-y-0.5 min-w-0">
            <p className="text-sm font-medium truncate">
              {group.recipientName}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {group.recipientPhone}
            </p>
          </div>
        </TableCell>
        <TableCell>
          <div className="space-y-0.5">
            <p className="text-sm break-words">{fullAddress}</p>
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
                <span
                  data-slot="select-value"
                  className="flex flex-1 text-left"
                >
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
                  {group.isNextDayEligible
                    ? "내일배송"
                    : "내일배송 (불가 지역)"}
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
          <div className="flex items-center gap-1">
            {NON_EDITABLE_BADGE_STATUSES.has(groupStatus) ? (
              <div className="flex flex-col gap-0.5">
                <StatusBadge status={groupStatus as OrderStatus} />
                {groupStatus === "dispatched" &&
                  groupDeliveryStatus === "delivering" && (
                    <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-900 dark:text-blue-300 text-[10px] px-1.5 py-0 w-fit">
                      배송중
                    </Badge>
                  )}
                {groupStatus === "dispatched" && groupPickupDate && (
                  <span className="text-[10px] text-muted-foreground">
                    집화 {formatPickupDate(groupPickupDate)}
                  </span>
                )}
              </div>
            ) : !selectable && groupStatus === "booked" ? (
              /* 서버 모드 booked: 운송장 상태 + 수동 발송완료 */
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">
                  운송장 대기중
                </span>
                <Select
                  value={groupStatus}
                  onValueChange={(v) =>
                    onGroupStatusChange(group.orderId, v as OrderStatus)
                  }
                >
                  <SelectTrigger className="w-24 h-6 text-[11px]">
                    <span
                      data-slot="select-value"
                      className="flex flex-1 text-left"
                    >
                      상태 변경
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dispatched" className="text-xs">
                      발송완료
                    </SelectItem>
                    <SelectItem value="booked" className="text-xs">
                      예약완료
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <Select
                value={groupStatus}
                onValueChange={(v) =>
                  onGroupStatusChange(group.orderId, v as OrderStatus)
                }
              >
                <SelectTrigger className="w-20 h-7 text-xs">
                  <span
                    data-slot="select-value"
                    className="flex flex-1 text-left"
                  >
                    {groupStatus === "pending"
                      ? "대기"
                      : groupStatus === "booked"
                        ? "완료"
                        : "실패"}
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
            <button
              title="예약 로그 보기"
              className="p-1 text-muted-foreground hover:text-foreground rounded"
              onClick={(e) => {
                e.stopPropagation();
                onViewLogs(group.orders[0].id, group.orderId);
              }}
            >
              <ScrollText className="h-3.5 w-3.5" />
            </button>
            {canDelete && (
              <button
                title="주문 삭제 (목록에서만 제거)"
                aria-label={`${group.recipientName} 주문 삭제`}
                className="p-1 text-muted-foreground hover:text-destructive rounded"
                onClick={(e) => {
                  e.stopPropagation();
                  onGroupDelete!(group);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </TableCell>
      </TableRow>

      {/* 펼친 상태 — 상품 리스트 */}
      {isExpanded &&
        group.orders.map((order) => (
          <TableRow key={order.id} className="border-0 bg-muted/10">
            {selectable && <TableCell />}
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
