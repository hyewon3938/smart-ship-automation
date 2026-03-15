import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const SKELETON_ROWS = 5;

export function OrderTableSkeleton() {
  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>상품</TableHead>
            <TableHead className="w-16">수량</TableHead>
            <TableHead className="w-24">금액</TableHead>
            <TableHead className="w-32">수령인</TableHead>
            <TableHead>배송지</TableHead>
            <TableHead className="w-32">택배유형</TableHead>
            <TableHead className="w-20">상태</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-4" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-40" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-8" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-40" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-7 w-28" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-12" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
