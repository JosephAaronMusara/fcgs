import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchableSelectOption {
  value: string;
  label: string;
  searchText?: string;
  disabled?: boolean;
}

interface BaseSearchableProps {
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  maxVisibleItems?: number;
  "data-testid"?: string;
}

const OPTION_ROW_HEIGHT = 36;


function isScrollableList(element: HTMLElement | null) {
  if (!element) return false;
  return element.scrollHeight > element.clientHeight + 1;
}

function useNaturalListScroll<T extends HTMLElement>() {
  const lastTouchYRef = React.useRef<number | null>(null);

  const onWheelCapture = React.useCallback((event: React.WheelEvent<T>) => {
    const element = event.currentTarget;
    if (!isScrollableList(element)) return;

    event.preventDefault();
    event.stopPropagation();
    element.scrollTop += event.deltaY;
  }, []);

  const onTouchStartCapture = React.useCallback((event: React.TouchEvent<T>) => {
    const element = event.currentTarget;
    if (!isScrollableList(element)) {
      lastTouchYRef.current = null;
      return;
    }

    lastTouchYRef.current = event.touches[0]?.clientY ?? null;
  }, []);

  const onTouchMoveCapture = React.useCallback((event: React.TouchEvent<T>) => {
    const element = event.currentTarget;
    const currentY = event.touches[0]?.clientY;

    if (!isScrollableList(element) || lastTouchYRef.current === null || currentY === undefined) return;

    const deltaY = lastTouchYRef.current - currentY;
    if (deltaY === 0) return;

    event.preventDefault();
    event.stopPropagation();
    element.scrollTop += deltaY;
    lastTouchYRef.current = currentY;
  }, []);

  const resetTouchScroll = React.useCallback(() => {
    lastTouchYRef.current = null;
  }, []);

  return {
    onWheelCapture,
    onTouchStartCapture,
    onTouchMoveCapture,
    onTouchEndCapture: resetTouchScroll,
    onTouchCancelCapture: resetTouchScroll,
  };
}

function filterOptions(options: SearchableSelectOption[], search: string) {
  const term = search.trim().toLowerCase();
  if (!term) return options;
  return options.filter((option) => {
    const haystack = `${option.label} ${option.searchText || ""}`.toLowerCase();
    return haystack.includes(term);
  });
}

function getFirstEnabledOption(options: SearchableSelectOption[]) {
  return options.find((option) => !option.disabled);
}

function useTypeahead(open: boolean) {
  const [search, setSearch] = React.useState("");

  const appendCharacter = React.useCallback((character: string) => {
    setSearch((current) => `${current}${character}`);
  }, []);

  const removeCharacter = React.useCallback(() => {
    setSearch((current) => current.slice(0, -1));
  }, []);

  const clearSearch = React.useCallback(() => {
    setSearch("");
  }, []);

  React.useEffect(() => {
    if (!open) clearSearch();
  }, [open, clearSearch]);

  return {
    search,
    appendCharacter,
    removeCharacter,
    clearSearch,
  };
}

interface TypeaheadListProps {
  maxVisibleItems: number;
  emptyText: string;
  children: React.ReactNode;
  isEmpty: boolean;
}

function TypeaheadList({ maxVisibleItems, emptyText, children, isEmpty }: TypeaheadListProps) {
  const scrollHandlers = useNaturalListScroll<HTMLDivElement>();

  return (
    <div
      className="overscroll-y-contain p-1 touch-pan-y"
      style={{
        maxHeight: Math.max(1, maxVisibleItems) * OPTION_ROW_HEIGHT + 8,
        overflowY: "auto",
        overscrollBehaviorY: "contain",
        WebkitOverflowScrolling: "touch",
        touchAction: "pan-y",
      } as React.CSSProperties}
      {...scrollHandlers}
    >
      {isEmpty ? (
        <div className="px-2 py-3 text-center text-sm text-muted-foreground">{emptyText}</div>
      ) : (
        children
      )}
    </div>
  );
}

export interface SearchableSelectProps extends BaseSearchableProps {
  value: string;
  onValueChange: (value: string) => void;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select option",
  emptyText = "No options found",
  disabled = false,
  className,
  triggerClassName,
  contentClassName,
  maxVisibleItems = 5,
  "data-testid": dataTestId,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const { search, appendCharacter, removeCharacter, clearSearch } = useTypeahead(open);

  const selectedOption = React.useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );
  const filteredOptions = React.useMemo(() => filterOptions(options, search), [options, search]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === "Escape") {
      if (search) {
        event.preventDefault();
        clearSearch();
      } else {
        setOpen(false);
      }
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      removeCharacter();
      return;
    }

    if (event.key === "Enter") {
      const firstEnabled = getFirstEnabledOption(filteredOptions);
      if (firstEnabled) {
        event.preventDefault();
        onValueChange(firstEnabled.value);
        clearSearch();
        setOpen(false);
      }
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      appendCharacter(event.key);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !selectedOption && "text-muted-foreground", triggerClassName, className)}
          data-testid={dataTestId}
        >
          <span className="truncate">{selectedOption?.label || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="start"
        sideOffset={4}
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => contentRef.current?.focus());
        }}
        onKeyDown={handleKeyDown}
        className={cn("w-[--radix-popover-trigger-width] p-0 outline-none", contentClassName)}
      >
        <TypeaheadList
          maxVisibleItems={maxVisibleItems}
          emptyText={emptyText}
          isEmpty={filteredOptions.length === 0}
        >
          {filteredOptions.map((option) => {
            const isSelected = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                className={cn(
                  "flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
                  isSelected && "bg-accent text-accent-foreground",
                )}
                onClick={() => {
                  onValueChange(option.value);
                  clearSearch();
                  setOpen(false);
                }}
              >
                <Check className={cn("h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            );
          })}
        </TypeaheadList>
      </PopoverContent>
    </Popover>
  );
}

export interface SearchableMultiSelectProps extends BaseSearchableProps {
  values: string[];
  onValuesChange: (values: string[]) => void;
  selectedSummary?: (count: number) => string;
}

export function SearchableMultiSelect({
  values,
  onValuesChange,
  options,
  placeholder = "Select options",
  emptyText = "No options found",
  disabled = false,
  className,
  triggerClassName,
  contentClassName,
  maxVisibleItems = 5,
  selectedSummary,
  "data-testid": dataTestId,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const { search, appendCharacter, removeCharacter, clearSearch } = useTypeahead(open);

  const selectedSet = React.useMemo(() => new Set(values), [values]);
  const optionMap = React.useMemo(() => new Map(options.map((option) => [option.value, option])), [options]);
  const filteredOptions = React.useMemo(() => filterOptions(options, search), [options, search]);

  const toggleValue = React.useCallback((nextValue: string) => {
    if (selectedSet.has(nextValue)) {
      onValuesChange(values.filter((item) => item !== nextValue));
    } else {
      onValuesChange([...values, nextValue]);
    }
  }, [onValuesChange, selectedSet, values]);

  const removeValue = (nextValue: string) => {
    onValuesChange(values.filter((item) => item !== nextValue));
  };

  const selectedLabels = values
    .map((nextValue) => optionMap.get(nextValue)?.label || nextValue)
    .filter(Boolean);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === "Escape") {
      if (search) {
        event.preventDefault();
        clearSearch();
      } else {
        setOpen(false);
      }
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      removeCharacter();
      return;
    }

    if (event.key === "Enter") {
      const firstEnabled = getFirstEnabledOption(filteredOptions);
      if (firstEnabled) {
        event.preventDefault();
        toggleValue(firstEnabled.value);
        clearSearch();
      }
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      appendCharacter(event.key);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("min-h-10 w-full justify-between px-2 py-1.5 font-normal", values.length === 0 && "text-muted-foreground", triggerClassName, className)}
          data-testid={dataTestId}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-left">
            {values.length === 0 ? (
              <span className="truncate px-1">{placeholder}</span>
            ) : selectedSummary ? (
              <span className="truncate px-1 text-foreground">{selectedSummary(values.length)}</span>
            ) : (
              selectedLabels.map((label, index) => {
                const nextValue = values[index];
                return (
                  <Badge key={nextValue} variant="secondary" className="max-w-[150px] gap-1 truncate">
                    <span className="truncate">{label}</span>
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={`Remove ${label}`}
                      className="rounded-sm hover:text-destructive"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        removeValue(nextValue);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </span>
                  </Badge>
                );
              })
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="start"
        sideOffset={4}
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => contentRef.current?.focus());
        }}
        onKeyDown={handleKeyDown}
        className={cn("w-[--radix-popover-trigger-width] p-0 outline-none", contentClassName)}
      >
        <TypeaheadList
          maxVisibleItems={maxVisibleItems}
          emptyText={emptyText}
          isEmpty={filteredOptions.length === 0}
        >
          {filteredOptions.map((option) => {
            const isSelected = selectedSet.has(option.value);
            return (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                className={cn(
                  "flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
                  isSelected && "bg-accent text-accent-foreground",
                )}
                onClick={() => {
                  toggleValue(option.value);
                  clearSearch();
                }}
              >
                <Check className={cn("h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            );
          })}
        </TypeaheadList>
      </PopoverContent>
    </Popover>
  );
}
