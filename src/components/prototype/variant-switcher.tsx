"use client";

import { useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

const VARIANTS = ["A", "B", "C"] as const;
const VARIANT_NAMES: Record<string, string> = {
  A: "Current Layout",
  B: "Agent-First Shell",
  C: "Daily Brief + Widget",
};

/**
 * PROTOTYPE — Floating variant switcher bar.
 * Hidden in production. Delete this file when done.
 */
export function PrototypeSwitcher() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("variant") ?? "A";
  const idx = VARIANTS.indexOf(current as (typeof VARIANTS)[number]);

  const setVariant = useCallback(
    (v: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("variant", v);
      router.replace(`?${params.toString()}`);
    },
    [router, searchParams],
  );

  const prev = useCallback(() => {
    const next = idx <= 0 ? VARIANTS.length - 1 : idx - 1;
    setVariant(VARIANTS[next]!);
  }, [idx, setVariant]);

  const next = useCallback(() => {
    const next = idx >= VARIANTS.length - 1 ? 0 : idx + 1;
    setVariant(VARIANTS[next]!);
  }, [idx, setVariant]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next]);

  return (
    <div className="fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2">
      <div className="bg-background/95 flex items-center gap-3 rounded-full border px-4 py-2 shadow-2xl backdrop-blur">
        <button
          onClick={prev}
          className="bg-muted hover:bg-muted/80 rounded-full p-1 transition-colors"
          aria-label="Previous variant"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="min-w-[180px] text-center">
          <span className="text-muted-foreground mr-2 text-xs font-medium">
            {current}
          </span>
          <span className="text-sm font-semibold">
            {VARIANT_NAMES[current] ?? "Unknown"}
          </span>
        </div>

        <button
          onClick={next}
          className="bg-muted hover:bg-muted/80 rounded-full p-1 transition-colors"
          aria-label="Next variant"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <p className="text-muted-foreground mt-2 text-center text-[10px]">
        ← → arrow keys to switch &middot; PROTOTYPE — delete when done
      </p>
    </div>
  );
}
