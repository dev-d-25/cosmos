"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export function MailToolbarButton({
  children,
  label,
  shortcut,
  onClick,
  variant = "ghost",
}: {
  children: ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  variant?: "ghost" | "destructive";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={variant}
            size="icon-xs"
            className="text-muted-foreground hover:bg-accent hover:text-foreground h-8 w-8 shrink-0"
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        <span>{label}</span>
        {shortcut && <Kbd className="ml-1">{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
