"use client";

import { useState, useCallback } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Kbd } from "@/components/ui/kbd";
import { CommandIcon } from "lucide-react";

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["J"], description: "Next email" },
      { keys: ["K"], description: "Previous email" },
      { keys: ["Enter"], description: "Open email" },
      { keys: ["Esc"], description: "Close / Back" },
      { keys: ["G", "I"], description: "Go to Inbox" },
      { keys: ["G", "D"], description: "Go to Drafts" },
      { keys: ["G", "T"], description: "Go to Sent" },
      { keys: ["G", "A"], description: "Go to Archive" },
    ],
  },
  {
    title: "Actions",
    shortcuts: [
      { keys: ["E"], description: "Archive" },
      { keys: ["#"], description: "Delete" },
      { keys: ["S"], description: "Star" },
      { keys: ["U"], description: "Mark unread" },
      { keys: ["R"], description: "Reply" },
      { keys: ["A"], description: "Reply all" },
      { keys: ["F"], description: "Forward" },
      { keys: ["L"], description: "Add label" },
    ],
  },
  {
    title: "Search",
    shortcuts: [
      { keys: ["⌘", "K"], description: "Open search" },
      { keys: ["/"], description: "Focus search" },
    ],
  },
  {
    title: "Composing",
    shortcuts: [
      { keys: ["C"], description: "Compose new" },
      { keys: ["⌘", "Enter"], description: "Send email" },
      { keys: ["⌘", "Shift", "P"], description: "Pop out compose" },
    ],
  },
];

function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((key, i) => (
        <span key={i} className="flex items-center gap-1">
          <Kbd className="text-[0.65rem]">{key}</Kbd>
          {i < keys.length - 1 && (
            <span className="text-muted-foreground text-[0.6rem]">+</span>
          )}
        </span>
      ))}
    </span>
  );
}

export function ShortcutsHelp({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (value: boolean) => {
      if (isControlled) {
        controlledOnOpenChange?.(value);
      } else {
        setInternalOpen(value);
      }
    },
    [isControlled, controlledOnOpenChange],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button type="button" className="inline-flex items-center justify-center">
            {children}
          </button>
        }
      />
      <PopoverContent
        side="bottom"
        sideOffset={8}
        align="end"
        className="w-[420px] p-0"
      >
        <div className="border-border border-b px-4 py-2.5">
          <h3 className="text-sm font-semibold">Keyboard Shortcuts</h3>
        </div>
        <div className="max-h-[400px] overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-4">
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.title}>
                <h4 className="text-muted-foreground mb-2 text-[0.65rem] font-medium uppercase tracking-wider">
                  {group.title}
                </h4>
                <div className="space-y-1.5">
                  {group.shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.description}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="text-muted-foreground truncate">
                        {shortcut.description}
                      </span>
                      <ShortcutKeys keys={shortcut.keys} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
