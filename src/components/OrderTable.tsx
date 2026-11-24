"use client";

import { useMemo, useState } from "react";

import { BookingLogDialog } from "@/components/BookingLogDialog";
import { GroupRows } from "@/components/order-table/GroupRows";
import { SELECTABLE_STATUSES } from "@/components/order-table/orderGroupUtils";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { groupOrdersByOrderId } from "@/lib/groupOrders";

import type { DeliveryType, Order, OrderGroup, OrderStatus } from "@/types";

interface OrderTableProps {
  orders: Order[];
  selectedIds: Set<number>;
  onSelectedChange: (ids: Set<number>) => void;
  onGroupDeliveryTypeChange: (orderId: string, type: DeliveryType) => void;
  onGroupStatusChange: (orderId: string, status: OrderStatus) => void;
  /**
   * 지정 시 그룹별 삭제 버튼 표시 (로컬 모드 전용).
   * booking/dispatched 상태 그룹에는 버튼이 나오지 않는다.
   */
  onGroupDelete?: (group: OrderGroup) => void;
  /** false로 설정하면 체크박스 컬럼 숨김 (서버 모드) */
  selectable?: boolean;
}

export function OrderTable({
  orders,
  selectedIds,
  onSelectedChange,
  onGroupDeliveryTypeChange,
  onGroupStatusChange,
  onGroupDelete,
  selectable = true,
}: OrderTableProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [logDialogOrderId, setLogDialogOrderId] = useState<number | null>(null);
  const [logDialogNaverOrderId, setLogDialogNaverOrderId] = useState("");

  const groups = useMemo(() => groupOrdersByOrderId(orders), [orders]);

  // 전체 선택 로직 (pending 또는 failed 주문 = 예약 가능 대상)
  const selectableOrders = orders.filter((o) =>
    SELECTABLE_STATUSES.has(o.status),
  );
  const allSelectableSelected =
    selectableOrders.length > 0 &&
    selectableOrders.every((o) => selectedIds.has(o.id));
  const someSelectableSelected =
    selectableOrders.some((o) => selectedIds.has(o.id)) &&
    !allSelectableSelected;

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
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelectableSelected}
                    indeterminate={someSelectableSelected}
                    onCheckedChange={handleSelectAll}
                    disabled={selectableOrders.length === 0}
                    aria-label="전체 선택"
                  />
                </TableHead>
              )}
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
              const selectableInGroup = group.orders.filter((o) =>
                SELECTABLE_STATUSES.has(o.status),
              );
              const allGroupPendingSelected =
                selectableInGroup.length > 0 &&
                selectableInGroup.every((o) => selectedIds.has(o.id));
              const someGroupPendingSelected =
                selectableInGroup.some((o) => selectedIds.has(o.id)) &&
                !allGroupPendingSelected;
              const fullAddress =
                `${group.recipientAddress} ${group.recipientAddressDetail ?? ""}`.trim();

              return (
                <GroupRows
                  key={group.orderId}
                  group={group}
                  isExpanded={isExpanded}
                  allGroupPendingSelected={allGroupPendingSelected}
                  someGroupPendingSelected={someGroupPendingSelected}
                  hasSelectable={selectableInGroup.length > 0}
                  fullAddress={fullAddress}
                  selectable={selectable}
                  onToggle={() => handleToggleGroup(group.orderId)}
                  onGroupCheck={(checked) =>
                    handleGroupCheckChange(group, checked)
                  }
                  onGroupDeliveryTypeChange={onGroupDeliveryTypeChange}
                  onGroupStatusChange={onGroupStatusChange}
                  onGroupDelete={onGroupDelete}
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
        onOpenChange={(open) => {
          if (!open) setLogDialogOrderId(null);
        }}
      />
    </>
  );
}
