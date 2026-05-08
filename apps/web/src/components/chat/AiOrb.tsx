import { useRef, useEffect } from "react";

interface AiOrbProps { size?: number; className?: string; }

export function AiOrb({ size = 44, className = "" }: AiOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const start = performance.now();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const maxR = size * 0.44;

    function draw(time: number) {
      if (!ctx || size < 4) return;
      const t = (time - start) / 1000;
      ctx.clearRect(0, 0, size, size);

      const pulse = 1 + 0.15 * Math.sin(t * 2.2);
      const radius = Math.max(0, size * 0.22 * pulse);

      for (let layer = 5; layer >= 0; layer--) {
        const r = Math.max(0, radius + layer * (maxR - radius) / 6);
        const alpha = 0.04 + layer * 0.027;
        const grad = ctx.createRadialGradient(cx, cy, Math.max(0, radius * 0.3), cx, cy, r);
        grad.addColorStop(0, "rgba(0,154,255," + alpha.toFixed(3) + ")");
        grad.addColorStop(1, "rgba(0,100,220,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      core.addColorStop(0, "rgba(120,208,255,0.9)");
      core.addColorStop(0.5, "rgba(0,138,230,0.5)");
      core.addColorStop(1, "rgba(0,64,152,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      for (let ring = 0; ring < 2; ring++) {
        const phase = (t * 0.75 + ring * 2.6) % 2.8;
        const rr = Math.max(0, radius + 2 + phase * 9);
        if (rr < maxR) {
          const ralpha = 0.22 * (1 - phase / 2.8);
          ctx.strokeStyle = "rgba(100,188,255," + ralpha.toFixed(3) + ")";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      const sradius = radius * 0.25;
      const sX = cx + radius * 0.35;
      const sY = cy - radius * 0.28;
      if (sradius > 1) {
        const spec = ctx.createRadialGradient(sX, sY, 0, sX, sY, sradius);
        spec.addColorStop(0, "rgba(255,255,255,0.32)");
        spec.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = spec;
        ctx.beginPath();
        ctx.arc(sX, sY, sradius, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    }

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}