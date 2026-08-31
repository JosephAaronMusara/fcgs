import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { schoolFetch } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";

export default function StaffOwnerSelector({ value, displayValue, onSelect }: { value: number | null | undefined; displayValue?: string; onSelect: (staff: any | null) => void }) {
  const [query, setQuery] = useState(displayValue || "");
  const [open, setOpen] = useState(false);
  const { data = [], isFetching } = useQuery<any[]>({
    queryKey: ["/api/transport/staff-owner-search", query],
    queryFn: async () => {
      const response = await schoolFetch(`/api/transport/staff-owner-search?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error("Unable to search staff");
      return response.json();
    },
  });
  const choices = useMemo(() => data.slice(0, 20), [data]);
  return <div className="relative">
    <Input
      value={query}
      onFocus={() => setOpen(true)}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); if (value) onSelect(null); }}
      placeholder={isFetching ? "Searching staff…" : "Search name, staff number, phone or email"}
    />
    {open && <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
      {choices.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">{isFetching ? "Searching…" : "No staff members found"}</div>}
      {choices.map((item) => <button key={item.id} type="button" className="block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent" onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(`${item.firstName} ${item.lastName}`); setOpen(false); onSelect(item); }}>
        <span className="block font-medium">{item.firstName} {item.lastName}</span>
        <span className="block text-xs text-muted-foreground">{item.staffNo || "No staff number"} · {item.schoolName}{item.phone ? ` · ${item.phone}` : ""}</span>
      </button>)}
    </div>}
  </div>;
}
