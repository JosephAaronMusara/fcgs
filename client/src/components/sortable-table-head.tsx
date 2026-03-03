import { TableHead } from "@/components/ui/table";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { SortConfig } from "@/hooks/use-table-sort";
import { cn } from "@/lib/utils";

interface SortableTableHeadProps {
  sortKey: string;
  sortConfig: SortConfig;
  onSort: (key: string) => void;
  className?: string;
  children: React.ReactNode;
}

export function SortableTableHead({ sortKey, sortConfig, onSort, className, children }: SortableTableHeadProps) {
  const isActive = sortConfig.key === sortKey && sortConfig.direction !== null;

  return (
    <TableHead
      className={cn("cursor-pointer select-none", className)}
      onClick={() => onSort(sortKey)}
      data-testid={`sort-${sortKey}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {isActive ? (
          sortConfig.direction === "asc" ? (
            <ArrowUp className="h-3 w-3 text-primary" />
          ) : (
            <ArrowDown className="h-3 w-3 text-primary" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
        )}
      </span>
    </TableHead>
  );
}
