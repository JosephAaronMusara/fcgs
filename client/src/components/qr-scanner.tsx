import { useState, useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, Keyboard } from "lucide-react";

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
  description = "Point your camera at a QR code or enter it manually",
}: QrScannerDialogProps) {
  const [mode, setMode] = useState<"camera" | "manual">("manual");
  const [manualCode, setManualCode] = useState("");
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<string>("qr-reader-" + Date.now());

  useEffect(() => {
    if (!open) {
      stopScanner();
      setManualCode("");
      setError("");
      setMode("manual");
      setScanning(false);
    }
  }, [open]);

  useEffect(() => {
    if (mode === "camera" && open) {
      startScanner();
    } else {
      stopScanner();
    }
    return () => {
      stopScanner();
    };
  }, [mode, open]);

  const startScanner = async () => {
    try {
      setError("");
      setScanning(true);
      const html5QrCode = new Html5Qrcode(containerRef.current);
      scannerRef.current = html5QrCode;
      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          stopScanner();
          onScan(decodedText);
          onOpenChange(false);
        },
        () => {}
      );
    } catch (err) {
      setError("Could not access camera. Please use manual entry instead.");
      setScanning(false);
    }
  };

  const stopScanner = () => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
      scannerRef.current.clear();
      scannerRef.current = null;
    }
    setScanning(false);
  };

  const handleManualSubmit = () => {
    const code = manualCode.trim();
    if (!code) {
      setError("Please enter a QR code");
      return;
    }
    onScan(code);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant={mode === "camera" ? "default" : "outline"}
              onClick={() => setMode("camera")}
              className="flex-1"
              data-testid="button-qr-camera"
            >
              <Camera className="w-4 h-4 mr-2" /> Camera
            </Button>
            <Button
              variant={mode === "manual" ? "default" : "outline"}
              onClick={() => setMode("manual")}
              className="flex-1"
              data-testid="button-qr-manual"
            >
              <Keyboard className="w-4 h-4 mr-2" /> Manual
            </Button>
          </div>

          {mode === "camera" ? (
            <div className="space-y-2">
              <div
                id={containerRef.current}
                className="w-full min-h-[250px] bg-muted rounded-md overflow-hidden"
              />
              {scanning && (
                <p className="text-sm text-muted-foreground text-center">
                  Scanning... point camera at QR code
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="manual-qr">QR Code Value</Label>
                <Input
                  id="manual-qr"
                  placeholder="Enter or paste QR code..."
                  value={manualCode}
                  onChange={(e) => {
                    setManualCode(e.target.value);
                    setError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleManualSubmit();
                  }}
                  data-testid="input-qr-manual"
                />
              </div>
              <Button
                onClick={handleManualSubmit}
                className="w-full"
                data-testid="button-qr-submit"
              >
                Submit
              </Button>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive" data-testid="text-qr-error">
              {error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
