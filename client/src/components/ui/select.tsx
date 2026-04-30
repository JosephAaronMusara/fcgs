"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const OPTION_ROW_HEIGHT = 36
const DEFAULT_VISIBLE_ITEMS = 5

interface SelectFilterContextValue {
  search: string
}

const SelectFilterContext = React.createContext<SelectFilterContextValue>({ search: "" })

function getNodeText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(getNodeText).join(" ")
  if (React.isValidElement(node)) return getNodeText((node.props as { children?: React.ReactNode }).children)
  return ""
}

function itemMatchesSearch(children: React.ReactNode, value: unknown, search: string) {
  const term = search.trim().toLowerCase()
  if (!term) return true

  const labelText = getNodeText(children)
  const haystack = `${labelText} ${typeof value === "string" || typeof value === "number" ? value : ""}`.toLowerCase()
  return haystack.includes(term)
}

function countMatchingItems(children: React.ReactNode, search: string): number {
  let count = 0

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return

    const props = child.props as { value?: unknown; children?: React.ReactNode }
    if (typeof props.value === "string" || typeof props.value === "number") {
      if (itemMatchesSearch(props.children, props.value, search)) count += 1
      return
    }

    if (props.children) {
      count += countMatchingItems(props.children, search)
    }
  })

  return count
}

function assignRefs<T>(node: T | null, ...refs: Array<React.ForwardedRef<T> | undefined>) {
  refs.forEach((nextRef) => {
    if (!nextRef) return
    if (typeof nextRef === "function") {
      nextRef(node)
    } else {
      nextRef.current = node
    }
  })
}


function isScrollableList(element: HTMLElement | null) {
  if (!element) return false
  return element.scrollHeight > element.clientHeight + 1
}

function useNaturalListScroll<T extends HTMLElement>() {
  const lastTouchYRef = React.useRef<number | null>(null)

  const onWheelCapture = React.useCallback((event: React.WheelEvent<T>) => {
    const element = event.currentTarget
    if (!isScrollableList(element)) return

    event.preventDefault()
    event.stopPropagation()
    element.scrollTop += event.deltaY
  }, [])

  const onTouchStartCapture = React.useCallback((event: React.TouchEvent<T>) => {
    const element = event.currentTarget
    if (!isScrollableList(element)) {
      lastTouchYRef.current = null
      return
    }

    lastTouchYRef.current = event.touches[0]?.clientY ?? null
  }, [])

  const onTouchMoveCapture = React.useCallback((event: React.TouchEvent<T>) => {
    const element = event.currentTarget
    const currentY = event.touches[0]?.clientY

    if (!isScrollableList(element) || lastTouchYRef.current === null || currentY === undefined) return

    const deltaY = lastTouchYRef.current - currentY
    if (deltaY === 0) return

    event.preventDefault()
    event.stopPropagation()
    element.scrollTop += deltaY
    lastTouchYRef.current = currentY
  }, [])

  const resetTouchScroll = React.useCallback(() => {
    lastTouchYRef.current = null
  }, [])

  return {
    onWheelCapture,
    onTouchStartCapture,
    onTouchMoveCapture,
    onTouchEndCapture: resetTouchScroll,
    onTouchCancelCapture: resetTouchScroll,
  }
}

function isTypingKey(event: React.KeyboardEvent) {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
}

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full min-w-0 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", onKeyDownCapture, ...props }, ref) => {
  const [search, setSearch] = React.useState("")
  const contentRef = React.useRef<React.ElementRef<typeof SelectPrimitive.Content> | null>(null)
  const activeSearch = search.trim().length > 0
  const matchingItemCount = React.useMemo(() => countMatchingItems(children, search), [children, search])
  const viewportScrollHandlers = useNaturalListScroll<HTMLDivElement>()

  React.useEffect(() => {
    if (!activeSearch) return

    const frame = requestAnimationFrame(() => {
      const firstVisibleItem = contentRef.current?.querySelector<HTMLElement>(
        "[data-select-searchable-item]:not([data-disabled])",
      )
      firstVisibleItem?.focus()
    })

    return () => cancelAnimationFrame(frame)
  }, [activeSearch, search])

  const handleKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDownCapture?.(event)
    if (event.defaultPrevented) return

    if (isTypingKey(event)) {
      event.preventDefault()
      event.stopPropagation()
      setSearch((current) => `${current}${event.key}`)
      return
    }

    if (event.key === "Backspace" && activeSearch) {
      event.preventDefault()
      event.stopPropagation()
      setSearch((current) => current.slice(0, -1))
      return
    }

    if (event.key === "Escape" && activeSearch) {
      event.preventDefault()
      event.stopPropagation()
      setSearch("")
    }
  }

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={(node) => {
          contentRef.current = node
          assignRefs(node, ref)
        }}
        className={cn(
          "relative z-50 max-h-[calc(100vh-1rem)] max-w-[calc(100vw-1rem)] min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        onKeyDownCapture={handleKeyDownCapture}
        {...props}
      >
        <SelectFilterContext.Provider value={{ search }}>
          <SelectScrollUpButton />
          <SelectPrimitive.Viewport
            className={cn(
              "overscroll-y-contain p-1 touch-pan-y",
              position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]"
            )}
            style={{
              maxHeight: OPTION_ROW_HEIGHT * DEFAULT_VISIBLE_ITEMS + 8,
              overflowY: "auto",
              overscrollBehaviorY: "contain",
              WebkitOverflowScrolling: "touch",
              touchAction: "pan-y",
            } as React.CSSProperties}
            {...viewportScrollHandlers}
          >
            {activeSearch && matchingItemCount === 0 ? (
              <div className="px-2 py-3 text-center text-sm text-muted-foreground">No options found</div>
            ) : (
              children
            )}
          </SelectPrimitive.Viewport>
          <SelectScrollDownButton />
        </SelectFilterContext.Provider>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
})
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, value, ...props }, ref) => {
  const { search } = React.useContext(SelectFilterContext)

  if (!itemMatchesSearch(children, value, search)) {
    return null
  }

  return (
    <SelectPrimitive.Item
      ref={ref}
      value={value}
      data-select-searchable-item=""
      className={cn(
        "relative flex min-h-9 w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>

      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
})
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
