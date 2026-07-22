import * as React from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";

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

function useSearchState(open: boolean) {
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return { search, setSearch };
}

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef: React.RefObject<HTMLInputElement>;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

function SearchField({ value, onChange, placeholder, inputRef, onKeyDown }: SearchFieldProps) {
  return (
    <div
      className="border-b p-2"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          autoFocus
          type="search"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-9 text-base text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2 sm:h-9 sm:text-sm"
          data-testid="input-search-dropdown-options"
        />
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange("");
              inputRef.current?.focus({ preventScroll: true });
            }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
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

function focusFirstVisibleOption(content: HTMLDivElement | null) {
  content?.querySelector<HTMLButtonElement>("[data-searchable-option]:not(:disabled)")?.focus();
}

function focusAdjacentOption(current: HTMLButtonElement, direction: 1 | -1, input: HTMLInputElement | null) {
  const container = current.closest<HTMLElement>("[data-searchable-options]");
  if (!container) return;
  const options = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-searchable-option]:not(:disabled)"));
  const index = options.indexOf(current);
  const next = options[index + direction];
  if (next) next.focus();
  else if (direction < 0) input?.focus({ preventScroll: true });
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
  searchPlaceholder = "Search options…",
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
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { search, setSearch } = useSearchState(open);

  const selectedOption = React.useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );
  const filteredOptions = React.useMemo(() => filterOptions(options, search), [options, search]);

  const selectFirstMatch = React.useCallback(() => {
    const firstEnabled = getFirstEnabledOption(filteredOptions);
    if (!firstEnabled) return;
    onValueChange(firstEnabled.value);
    setSearch("");
    setOpen(false);
  }, [filteredOptions, onValueChange, setSearch]);

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();

    if (event.key === "Escape") {
      event.preventDefault();
      if (search) setSearch("");
      else setOpen(false);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      selectFirstMatch();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusFirstVisibleOption(contentRef.current);
    }
  };

  const handleContentKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key.length === 1) {
      event.preventDefault();
      setSearch((current) => `${current}${event.key}`);
      inputRef.current?.focus({ preventScroll: true });
      return;
    }

    if (event.key === "Backspace" && search) {
      event.preventDefault();
      setSearch((current) => current.slice(0, -1));
      inputRef.current?.focus({ preventScroll: true });
      return;
    }

    if (event.key === "Escape" && search) {
      event.preventDefault();
      setSearch("");
      inputRef.current?.focus({ preventScroll: true });
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
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus({ preventScroll: true });
        }}
        onKeyDown={handleContentKeyDown}
        className={cn("w-[--radix-popover-trigger-width] p-0 outline-none", contentClassName)}
      >
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={searchPlaceholder}
          inputRef={inputRef}
          onKeyDown={handleInputKeyDown}
        />
        <div data-searchable-options="">
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
                  data-searchable-option=""
                  disabled={option.disabled}
                  className={cn(
                    "flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
                    isSelected && "bg-accent text-accent-foreground",
                  )}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      focusAdjacentOption(event.currentTarget, 1, inputRef.current);
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      focusAdjacentOption(event.currentTarget, -1, inputRef.current);
                    }
                  }}
                  onClick={() => {
                    onValueChange(option.value);
                    setSearch("");
                    setOpen(false);
                  }}
                >
                  <Check className={cn("h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </button>
              );
            })}
          </TypeaheadList>
        </div>
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
  searchPlaceholder = "Search options…",
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
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { search, setSearch } = useSearchState(open);

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

  const selectFirstMatch = React.useCallback(() => {
    const firstEnabled = getFirstEnabledOption(filteredOptions);
    if (!firstEnabled) return;
    toggleValue(firstEnabled.value);
    setSearch("");
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, [filteredOptions, setSearch, toggleValue]);

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();

    if (event.key === "Escape") {
      event.preventDefault();
      if (search) setSearch("");
      else setOpen(false);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      selectFirstMatch();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusFirstVisibleOption(contentRef.current);
    }
  };

  const handleContentKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key.length === 1) {
      event.preventDefault();
      setSearch((current) => `${current}${event.key}`);
      inputRef.current?.focus({ preventScroll: true });
      return;
    }

    if (event.key === "Backspace" && search) {
      event.preventDefault();
      setSearch((current) => current.slice(0, -1));
      inputRef.current?.focus({ preventScroll: true });
      return;
    }

    if (event.key === "Escape" && search) {
      event.preventDefault();
      setSearch("");
      inputRef.current?.focus({ preventScroll: true });
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
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus({ preventScroll: true });
        }}
        onKeyDown={handleContentKeyDown}
        className={cn("w-[--radix-popover-trigger-width] p-0 outline-none", contentClassName)}
      >
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={searchPlaceholder}
          inputRef={inputRef}
          onKeyDown={handleInputKeyDown}
        />
        <div data-searchable-options="">
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
                  data-searchable-option=""
                  disabled={option.disabled}
                  className={cn(
                    "flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
                    isSelected && "bg-accent text-accent-foreground",
                  )}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      focusAdjacentOption(event.currentTarget, 1, inputRef.current);
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      focusAdjacentOption(event.currentTarget, -1, inputRef.current);
                    }
                  }}
                  onClick={() => {
                    toggleValue(option.value);
                    setSearch("");
                    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
                  }}
                >
                  <Check className={cn("h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </button>
              );
            })}
          </TypeaheadList>
        </div>
      </PopoverContent>
    </Popover>
  );
}
