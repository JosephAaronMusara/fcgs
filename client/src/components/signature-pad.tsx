import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function SignaturePad({
  value,
  onSave,
  disabled = false,
}: {
  value?: string | null;
  onSave: (dataUrl: string) => void | Promise<void>;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(Boolean(value));

  const fitCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const old = value && !hasInk ? value : canvas.toDataURL("image/png");
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (old && old !== "data:,") {
      const image = new Image();
      image.onload = () => ctx.drawImage(image, 0, 0, rect.width, rect.height);
      image.src = old;
    }
  };

  useEffect(() => {
    fitCanvas();
    const handler = () => fitCanvas();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!value) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const image = new Image();
    image.onload = () => {
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.drawImage(image, 0, 0, rect.width, rect.height);
      setHasInk(true);
    };
    image.src = value;
  }, [value]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const ctx = event.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(event);
    drawingRef.current = true;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    setHasInk(true);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || disabled) return;
    const ctx = event.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const end = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    setHasInk(false);
  };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return;
    await onSave(canvas.toDataURL("image/png"));
  };

  return (
    <div className="space-y-2">
      <div className="rounded-md border bg-white p-2">
        <canvas
          ref={canvasRef}
          className="h-36 w-full touch-none cursor-crosshair"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          aria-label="Signature pad"
        />
      </div>
      <p className="text-xs text-muted-foreground">Sign with a finger, stylus, mouse or touchpad. The saved specimen is reused only after password authorisation.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={clear} disabled={disabled}>Clear</Button>
        <Button type="button" onClick={() => void save()} disabled={disabled || !hasInk}>Save Signature</Button>
      </div>
    </div>
  );
}
