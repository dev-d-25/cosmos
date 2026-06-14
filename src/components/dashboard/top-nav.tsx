"use client";

import { useState } from "react";
import {
  ChevronDown,
  Mail,
  Calendar,
  Bot,
  Search,
  Settings,
  Grid3X3,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type User = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

const modes = [
  { id: "mail", label: "Mail", icon: Mail },
  { id: "calendar", label: "Calendar", icon: Calendar },
  { id: "agent", label: "Agent", icon: Bot },
] as const;

type ModeId = (typeof modes)[number]["id"];

interface TopNavProps {
  user: User;
}

export function TopNav({ user }: TopNavProps) {
  const [activeMode, setActiveMode] = useState<ModeId>("mail");

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border bg-background px-4 gap-4">
      {/* Left: Account Switcher */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button className="flex items-center gap-2 px-2 py-1.5 h-auto font-normal rounded-md hover:bg-muted transition-colors" />
          }
        >
          <div className="flex size-6 items-center justify-center rounded-sm bg-[#EA4335]">
            <Mail className="size-3.5 text-white" />
          </div>
          <span className="text-sm font-medium">Personal Gmail</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem>
            <div className="flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-sm bg-[#EA4335]">
                <Mail className="size-3.5 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{user.name || "Personal Gmail"}</span>
                <span className="text-xs text-muted-foreground">{user.email}</span>
              </div>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Center: Mode Tabs */}
      <nav className="flex items-center gap-1 mx-auto">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const isActive = activeMode === mode.id;
          return (
            <button
              key={mode.id}
              onClick={() => setActiveMode(mode.id)}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors rounded-md",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/70"
              )}
            >
              <Icon className="size-4" />
              {mode.label}
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Right: Search + Actions */}
      <div className="flex items-center gap-2">
        {/* Search Box */}
        <button className="flex items-center gap-2 h-9 px-3 rounded-lg bg-muted/50 text-muted-foreground hover:bg-muted transition-colors min-w-[280px]">
          <Search className="size-4 shrink-0" />
          <span className="text-sm flex-1 text-left">
            Search mail, events, people, or ask AI...
          </span>
          <kbd className="pointer-events-none hidden select-none items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:flex">
            <span className="text-xs">⌘</span>K
          </kbd>
        </button>

        {/* Synced Status */}
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CheckCircle2 className="size-3.5 text-green-500 fill-green-500/20" />
          <span>Synced</span>
        </div>

        {/* Actions */}
        <Button variant="ghost" size="icon" className="size-9">
          <Grid3X3 className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="size-9">
          <Settings className="size-4" />
        </Button>
      </div>
    </header>
  );
}
