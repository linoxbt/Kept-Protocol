"use client";
import { useEffect, useRef } from "react";

/**
 * Hero background: a field of thin vertical ticks, one per "block", rippling slowly. A few ticks
 * light up in the accent colour — evidence events. Pauses off-screen; static under reduced motion.
 */
export function BlockField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let visible = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const gap = 18;
    const seed = (i: number, j: number) => {
      const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const cols = Math.ceil(w / gap) + 1;
      const rows = Math.ceil(h / 34) + 1;
      const cx = w / 2;
      const cy = h * 0.42;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = i * gap;
          const y = j * 34;
          const d = Math.hypot(x - cx, (y - cy) * 1.6);
          const wave = Math.sin(d / 46 - t / 1400);
          const len = 6 + Math.max(0, wave) * 18;
          const r = seed(i, j);
          const fade = Math.min(1, d / (Math.min(w, h) * 0.55));
          const accent = r > 0.985 && wave > 0.6;
          ctx.strokeStyle = accent ? "rgba(47,107,255,0.95)" : `rgba(150,160,175,${(0.08 + Math.max(0, wave) * 0.22) * fade})`;
          ctx.lineWidth = accent ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(x + 0.5, y);
          ctx.lineTo(x + 0.5, y + len);
          ctx.stroke();
        }
      }
    };
    // ~30 fps, and the loop stops entirely while the canvas is off-screen or the tab is hidden.
    let last = 0;
    const loop = (t: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      if (t - last >= 33) {
        draw(t);
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!reduce && !raf && visible && !document.hidden) raf = requestAnimationFrame(loop);
    };
    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) draw(0);
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      start();
    });
    io.observe(canvas);
    document.addEventListener("visibilitychange", start);
    if (reduce) draw(0);
    else start();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", start);
    };
  }, []);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full" aria-hidden="true" />;
}
