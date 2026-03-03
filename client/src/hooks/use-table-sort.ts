import { useState, useMemo, useCallback } from "react";

export type SortDirection = "asc" | "desc" | null;

export interface SortConfig {
  key: string;
  direction: SortDirection;
}

export function useTableSort<T>(data: T[] | undefined, defaultSort?: { key: string; direction: "asc" | "desc" }) {
  const [sortConfig, setSortConfig] = useState<SortConfig>(
    defaultSort ? { key: defaultSort.key, direction: defaultSort.direction } : { key: "", direction: null }
  );

  const requestSort = useCallback((key: string) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        if (prev.direction === "asc") return { key, direction: "desc" };
        if (prev.direction === "desc") return { key: "", direction: null };
        return { key, direction: "asc" };
      }
      return { key, direction: "asc" };
    });
  }, []);

  const sortedData = useMemo(() => {
    if (!data) return undefined;
    if (!sortConfig.key || !sortConfig.direction) return data;

    return [...data].sort((a: any, b: any) => {
      const aVal = getNestedValue(a, sortConfig.key);
      const bVal = getNestedValue(b, sortConfig.key);

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let comparison = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        comparison = aVal - bVal;
      } else if (aVal instanceof Date && bVal instanceof Date) {
        comparison = aVal.getTime() - bVal.getTime();
      } else {
        const aStr = String(aVal).toLowerCase();
        const bStr = String(bVal).toLowerCase();
        comparison = aStr.localeCompare(bStr);
      }

      return sortConfig.direction === "desc" ? -comparison : comparison;
    });
  }, [data, sortConfig]);

  return { sortedData, sortConfig, requestSort };
}

function getNestedValue(obj: any, path: string): any {
  return path.split(".").reduce((current, key) => current?.[key], obj);
}
