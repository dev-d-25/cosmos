"use client";

import { cn } from "@/lib/utils";

interface ShimmerProps {
  children: React.ReactNode;
  className?: string;
  duration?: number;
}

export function Shimmer({ children, className, duration = 2 }: ShimmerProps) {
  return (
    <span
      className={cn(
        "bg-gradient-to-r from-foreground/60 via-foreground to-foreground/60 bg-[length:200%_100%] bg-clip-text text-transparent",
        className,
      )}
      style={{
        animation: `shimmer ${duration}s linear infinite`,
      }}
    >
      {children}
    </span>
  );
}
