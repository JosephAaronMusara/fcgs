import { useState, useEffect, useRef, useId } from "react";
import { Html5Qrcode } from "html5-qrcode";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface QrScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (qrCode: string) => void;
  title?: string;
  description?: string;
}

export function QrScannerDialog({
  open,
  onOpenChange,
  onScan,
  title = "Scan QR Code",
  description = "Point your camera at a QR code",
}: QrScannerDialogProps) {
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const reactId = useId();
  const containerId = `qr-reader-${reactId.replace(/:/g, "")}`;

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {}
      try {
        await scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
  };

  const startScanner = async () => {
    try {
      setError("");
      setScanning(true);

      const target = document.getElementById(containerId);
      if (!target) {
        throw new Error(`HTML Element with id=${containerId} not found`);
      }

      const html5QrCode = new Html5Qrcode(containerId);
      scannerRef.current = html5QrCode;

      const cameras = await Html5Qrcode.getCameras();

      if (!cameras || cameras.length === 0) {
        throw new Error("No camera found on this device.");
      }

      const preferredCamera =
        cameras.find((camera) => /back|rear|environment/i.test(camera.label || "")) ||
        cameras[0];

      await html5QrCode.start(
        preferredCamera.id,
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          await stopScanner();
          onScan(decodedText);
          onOpenChange(false);
        },
        () => {}
      );
    } catch (err: any) {
      console.error("QR scanner start error:", err);
      setError(String(err?.message || err || "Could not access camera."));
      setScanning(false);
    }
  };

  useEffect(() => {
    if (!open) {
      stopScanner();
      setError("");
      setScanning(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const timer = window.setTimeout(() => {
      startScanner();
    }, 150);

    return () => {
      window.clearTimeout(timer);
      stopScanner();
    };
  }, [open, containerId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div
            id={containerId}
            className="w-full min-h-[250px] bg-muted rounded-md overflow-hidden"
          />

          {scanning && (
            <p
              className="text-sm text-muted-foreground text-center"
              data-testid="text-qr-scanning"
            >
              Scanning... point camera at QR code
            </p>
          )}

          {error && (
            <p
              className="text-sm text-destructive text-center"
              data-testid="text-qr-error"
            >
              {error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}