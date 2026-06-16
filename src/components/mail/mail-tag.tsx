"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

export function MailTag({ children }: { children: ReactNode }) {
  return (
    <Badge
      variant="secondary"
      className="h-4 px-1.5 text-[0.55rem] font-semibold tracking-wide uppercase"
    >
      {children}
    </Badge>
  );
}
