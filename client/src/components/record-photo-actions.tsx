import { useRef, useState } from "react";
import { Camera, Download, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, schoolFetch } from "@/lib/queryClient";

export type RecordPhotoEntity = "students" | "staff" | "parents" | "users";

type Props = {
  entity: RecordPhotoEntity;
  recordId: number;
  firstName?: string | null;
  lastName?: string | null;
  recordNumber?: string | null;
  photo?: string | null;
  initials: string;
  canManage: boolean;
  className?: string;
  imageClassName?: string;
  onPhotoUpdated?: (photo: string) => void;
};

function safeDownloadBase(parts: Array<string | null | undefined>) {
  return parts
    .filter(Boolean)
    .join("_")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "profile_photo";
}

export function RecordPhotoActions({
  entity,
  recordId,
  firstName,
  lastName,
  recordNumber,
  photo,
  initials,
  canManage,
  className = "h-10 w-10",
  imageClassName = "h-full w-full object-cover",
  onPhotoUpdated,
}: Props) {
  const { toast } = useToast();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const upload = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Choose an image file", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      const body = new FormData();
      body.append("photo", file);
      const response = await schoolFetch(`/api/${entity}/${recordId}/photo`, { method: "POST", body });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || "Photo upload failed");
      onPhotoUpdated?.(payload.photo);
      await queryClient.invalidateQueries({ queryKey: [`/api/${entity}`] });
      setIsOpen(false);
      toast({ title: "Photo updated" });
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Photo upload failed", variant: "destructive" });
    } finally {
      setIsUploading(false);
      if (galleryRef.current) galleryRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  };

  const download = async () => {
    if (!photo) return;
    setIsDownloading(true);
    try {
      const response = await schoolFetch(`/api/${entity}/${recordId}/photo/download`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || "Photo download failed");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const quotedName = disposition.match(/filename="([^"]+)"/i)?.[1];
      const fallback = `${safeDownloadBase([firstName, lastName, recordNumber])}.jpg`;
      const fileName = encodedName ? decodeURIComponent(encodedName) : quotedName || fallback;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setIsOpen(false);
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Photo download failed", variant: "destructive" });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div
      className={`group relative shrink-0 overflow-hidden rounded-full bg-muted text-sm font-medium ${className}`}
      onClick={(event) => {
        event.stopPropagation();
        setIsOpen((open) => !open);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen((open) => !open);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Photo actions for ${firstName || "record"} ${lastName || ""}`.trim()}
      data-testid={`photo-actions-${entity}-${recordId}`}
    >
      {photo ? (
        <img src={photo} alt={`${firstName || ""} ${lastName || ""}`.trim()} className={imageClassName} />
      ) : (
        <span className="flex h-full w-full items-center justify-center">{initials}</span>
      )}

      <div
        className={`absolute inset-0 flex items-center justify-center gap-1 bg-black/55 p-1 transition-opacity ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        {canManage && (
          <>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-7 w-7 bg-white/85"
              disabled={isUploading}
              onClick={() => galleryRef.current?.click()}
              title={photo ? "Change photo" : "Upload photo"}
              aria-label={photo ? "Change photo" : "Upload photo"}
            >
              {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-7 w-7 bg-white/85 sm:hidden"
              disabled={isUploading}
              onClick={() => cameraRef.current?.click()}
              title="Take photo"
              aria-label="Take photo"
            >
              <Camera className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        {photo && (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-7 w-7 bg-white/85"
            disabled={isDownloading}
            onClick={download}
            title="Download photo"
            aria-label="Download photo"
          >
            {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>

      <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={(event) => upload(event.target.files?.[0])} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => upload(event.target.files?.[0])} />
    </div>
  );
}
