import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { schoolFetch } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function StaffOwnerSelector({ value, onSelect }: { value: number | null | undefined; onSelect: (staff: any | null) => void }) {
  const [query, setQuery] = useState("");
  const { data = [], isFetching } = useQuery<any[]>({
    queryKey: ["/api/transport/staff-owner-search", query],
    queryFn: async () => {
      const response = await schoolFetch(`/api/transport/staff-owner-search?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error("Unable to search staff");
      return response.json();
    },
  });
  return <div className="space-y-2">
    <Label>Linked staff member</Label>
    <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, staff number, phone or email"/>
    <Select value={value ? String(value) : undefined} onValueChange={(selected) => onSelect(data.find((item) => item.id === Number(selected)) || null)}>
      <SelectTrigger><SelectValue placeholder={isFetching ? "Searching staff…" : "Select staff member"}/></SelectTrigger>
      <SelectContent>{data.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.firstName} {item.lastName} · {item.staffNo || "No staff number"} · {item.schoolName}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
}
