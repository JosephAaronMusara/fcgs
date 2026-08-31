import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type ServiceLocationDraft = {
  name: string;
  address: string;
  landmark: string;
  latitude: number | null;
  longitude: number | null;
  privacyClass: "private_household" | "shared_household" | "public_common";
  instructions: string;
};

export const emptyServiceLocation = (privacyClass: ServiceLocationDraft["privacyClass"] = "private_household"): ServiceLocationDraft => ({
  name: "",
  address: "",
  landmark: "",
  latitude: null,
  longitude: null,
  privacyClass,
  instructions: "",
});

type SavedPoint = ServiceLocationDraft & { id: number; pointType?: string; isActive?: boolean; originSchoolName?: string | null };

type Props = {
  title: string;
  description?: string;
  value: ServiceLocationDraft;
  onChange: (value: ServiceLocationDraft) => void;
  required?: boolean;
  savedPoints?: SavedPoint[];
  selectedPointId?: number | null;
  onSelectedPointIdChange?: (id: number | null) => void;
  suggestionRadiusMeters?: number;
  selectorLabel?: string;
};

export default function ServiceLocationEditor({
  title,
  description,
  value,
  onChange,
  required = false,
  savedPoints = [],
  selectedPointId = null,
  onSelectedPointIdChange,
  suggestionRadiusMeters = 50,
  selectorLabel = "Pick-Up/Drop-Off Point",
}: Props) {
  const [nearby, setNearby] = useState<SavedPoint[]>([]);
  const set = <K extends keyof ServiceLocationDraft>(key: K, next: ServiceLocationDraft[K]) => {
    onSelectedPointIdChange?.(null);
    onChange({ ...value, [key]: next });
  };
  const activeSaved = useMemo(() => savedPoints.filter((point) => point.isActive !== false), [savedPoints]);

  const useSavedPoint = (point: SavedPoint) => {
    onSelectedPointIdChange?.(point.id);
    onChange({
      name: point.name || "",
      address: point.address || "",
      landmark: point.landmark || "",
      latitude: point.latitude == null ? null : Number(point.latitude),
      longitude: point.longitude == null ? null : Number(point.longitude),
      privacyClass: point.privacyClass || "public_common",
      instructions: point.instructions || "",
    });
    setNearby([]);
  };

  const mapPick = (latitude: number, longitude: number) => {
    onSelectedPointIdChange?.(null);
    onChange({ ...value, latitude, longitude });
    const candidates = activeSaved.filter((point) => point.privacyClass === "public_common" && point.latitude != null && point.longitude != null && haversineMeters(latitude, longitude, Number(point.latitude), Number(point.longitude)) <= suggestionRadiusMeters);
    if (candidates.length) setNearby(candidates);
  };

  return <div className="space-y-3">
    <div>
      <div className="font-medium">{title}</div>
      {description && <div className="text-xs text-muted-foreground">{description}</div>}
    </div>

    <MiniMapPicker latitude={value.latitude} longitude={value.longitude} onPick={mapPick}/>

    <div className="grid gap-3 md:grid-cols-3">
      <Field label={selectorLabel}>
        <SearchableSelect
          value={selectedPointId ? String(selectedPointId) : ""}
          onValueChange={(next) => {
            if (!next) { onSelectedPointIdChange?.(null); return; }
            const point = activeSaved.find((row) => Number(row.id) === Number(next));
            if (point) useSavedPoint(point);
          }}
          options={activeSaved.map((point) => ({ value: String(point.id), label: `${point.name}${point.originSchoolName ? ` · ${point.originSchoolName}` : ""}` }))}
          placeholder="Search saved points"
          searchPlaceholder="Search Pick-Up/Drop-Off Points…"
          emptyText="No saved points found"
        />
      </Field>
      <Field label="Latitude"><Input type="number" step="0.0000001" min={-90} max={90} value={value.latitude ?? ""} onChange={(event) => set("latitude", event.target.value === "" ? null : Number(event.target.value))}/></Field>
      <Field label="Longitude"><Input type="number" step="0.0000001" min={-180} max={180} value={value.longitude ?? ""} onChange={(event) => set("longitude", event.target.value === "" ? null : Number(event.target.value))}/></Field>
    </div>

    <div className="grid gap-3 md:grid-cols-3">
      <Field label="Location Name"><Input value={value.name} onChange={(event) => set("name", event.target.value)} placeholder="Home gate / shops / landmark" required={required}/></Field>
      <Field label="Landmark Description"><Input value={value.landmark} onChange={(event) => set("landmark", event.target.value)} placeholder="Opposite the clinic / blue gate"/></Field>
      <Field label="Privacy Level"><Select value={value.privacyClass} onValueChange={(next) => set("privacyClass", next as ServiceLocationDraft["privacyClass"])}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="private_household">Private Household</SelectItem><SelectItem value="shared_household">Shared Household</SelectItem><SelectItem value="public_common">Public/Common Stop</SelectItem></SelectContent></Select></Field>
    </div>

    <Field label="Address"><Input value={value.address} onChange={(event) => set("address", event.target.value)} placeholder="Street / suburb / area"/></Field>
    <Field label="Driver / Access / Safety Instructions"><Textarea value={value.instructions} onChange={(event) => set("instructions", event.target.value)} placeholder="Gate, access, waiting point, road side or safety instructions"/></Field>

    <Dialog open={nearby.length > 0} onOpenChange={(open) => !open && setNearby([])}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nearby saved Pick-Up/Drop-Off Points</DialogTitle>
          <DialogDescription>The spot selected on the map is within {suggestionRadiusMeters} metres of saved Public/Common Stops. Select the most convenient existing point, or close this message to keep the new spot.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {nearby.map((point) => <Button key={point.id} variant="outline" className="h-auto w-full justify-start py-3 text-left" onClick={() => useSavedPoint(point)}><span><span className="block font-medium">{point.name}</span><span className="block text-xs text-muted-foreground">{point.address || point.landmark || `${Number(point.latitude).toFixed(5)}, ${Number(point.longitude).toFixed(5)}`}</span></span></Button>)}
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}

function MiniMapPicker({ latitude, longitude, onPick }: { latitude: number | null; longitude: number | null; onPick: (lat: number, lng: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const onPickRef = useRef(onPick);
  useEffect(() => { onPickRef.current = onPick; }, [onPick]);
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current).setView([latitude ?? -17.8292, longitude ?? 31.0522], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
    map.on("click", (event) => onPickRef.current(event.latlng.lat, event.latlng.lng));
    mapRef.current = map;
    window.setTimeout(() => map.invalidateSize(), 0);
    return () => { map.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || latitude == null || longitude == null) return;
    markerRef.current?.remove();
    markerRef.current = L.circleMarker([latitude, longitude], { radius: 8, fillOpacity: 1, weight: 2 }).addTo(map);
    map.panTo([latitude, longitude]);
  }, [latitude, longitude]);
  return <div><div ref={ref} className="h-56 rounded-md border bg-muted"/><p className="mt-1 text-xs text-muted-foreground">Click the map to set the exact point. Nearby Public/Common Stops will be suggested automatically.</p></div>;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radius = 6371000;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}
