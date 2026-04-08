import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface InfiniteYearPickerProps {
  value?: string | number | null;
  onValueChange: (value: string) => void;
  placeholder?: string;
  minYear?: number;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  dataTestId?: string;
}

const ITEM_HEIGHT = 36;
const VISIBLE_ITEMS = 5;
const LOAD_CHUNK = 50;

export function InfiniteYearPicker({
  value,
  onValueChange,
  placeholder = "Select year",
  minYear = 2000,
  className,
  contentClassName,
  disabled,
  dataTestId,
}: InfiniteYearPickerProps) {
  const selectedYear = Number(value);
  const currentYear = new Date().getFullYear();
  const initialMaxYear = useMemo(() => {
    const baseline = Number.isFinite(selectedYear) ? selectedYear : currentYear;
    return Math.max(baseline + 10, currentYear + 10, minYear + LOAD_CHUNK);
  }, [currentYear, minYear, selectedYear]);

  const [isOpen, setIsOpen] = useState(false);
  const [maxYear, setMaxYear] = useState(initialMaxYear);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialMaxYear > maxYear) {
      setMaxYear(initialMaxYear);
    }
  }, [initialMaxYear, maxYear]);

  const years = useMemo(() => {
    const items: number[] = [];
    for (let year = minYear; year <= maxYear; year += 1) {
      items.push(year);
    }
    return items;
  }, [maxYear, minYear]);

  useEffect(() => {
    if (!isOpen || !viewportRef.current) return;

    const targetYear = Number.isFinite(selectedYear) ? selectedYear : currentYear;
    if (targetYear >= maxYear - 5) {
      setMaxYear(targetYear + LOAD_CHUNK);
      return;
    }

    const index = Math.max(0, targetYear - minYear);
    const top = Math.max(0, index * ITEM_HEIGHT - Math.floor((VISIBLE_ITEMS - 1) * ITEM_HEIGHT * 0.5));
    viewportRef.current.scrollTop = top;
  }, [isOpen, selectedYear, currentYear, minYear, maxYear]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const threshold = ITEM_HEIGHT * 3;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < threshold) {
      setMaxYear((prev) => prev + LOAD_CHUNK);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={isOpen}
          disabled={disabled}
          data-testid={dataTestId}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate text-left">{value ? String(value) : placeholder}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-[var(--radix-popover-trigger-width)] p-0", contentClassName)} align="start">
        <div ref={viewportRef} className="max-h-[180px] overflow-y-auto p-1" onScroll={handleScroll}>
          {years.map((year) => {
            const isSelected = String(year) === String(value);
            return (
              <button
                key={year}
                type="button"
                className={cn(
                  "flex h-9 w-full items-center rounded-sm px-3 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                  isSelected && "bg-accent text-accent-foreground",
                )}
                onClick={() => {
                  onValueChange(String(year));
                  setIsOpen(false);
                }}
              >
                <span className="flex-1">{year}</span>
                {isSelected ? <Check className="h-4 w-4 shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
