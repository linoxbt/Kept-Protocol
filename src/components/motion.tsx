"use client";
import { useEffect, useRef, useState } from "react";

/** Fades content up when it enters the viewport. Disabled by prefers-reduced-motion in CSS. */
export function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("in");
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** Counts up to a number once, when visible. */
/**
 * A number that counts up when it scrolls into view. The real value is rendered on the server (so
 * crawlers, no-JS visitors and a failed script never see 0); the count-up only happens for numbers
 * that start off-screen, so a visible number never flashes back to zero.
 */
export function Ticker({ value, className = "" }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const r = el.getBoundingClientRect();
    const visible = r.top < window.innerHeight && r.bottom > 0;
    if (visible || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    raf = requestAnimationFrame(() => setShown(0));
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / 1100);
        setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);
  return (
    <span ref={ref} className={className}>
      {shown.toLocaleString("en-US")}
    </span>
  );
}
