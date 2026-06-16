"use client";

import type { ReactNode } from "react";
import Link from "next/link";

export function SidebarItem({
  active = false,
  badge,
  children,
  href,
}: {
  active?: boolean;
  badge?: ReactNode;
  children: ReactNode;
  href?: string;
}) {
  return (
    <Link
      href={href ?? "/mail"}
      className={[
        "text-sidebar-foreground hover:bg-sidebar-accent flex items-center gap-2.5 px-4 py-1.5 text-xs font-medium transition",
        active ? "bg-sidebar-accent text-sidebar-primary" : "",
      ].join(" ")}
    >
      {children}
      {badge ? (
        <span className="bg-primary text-primary-foreground ml-auto rounded-none px-2 py-0.5 text-[0.625rem] font-semibold">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
