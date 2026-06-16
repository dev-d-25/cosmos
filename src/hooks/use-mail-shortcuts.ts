"use client";

import { useEffect, useRef } from "react";

export interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
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

interface UseMailShortcutsOpts {
  items: Array<{ id: string }>;
  selectedId: string | null;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  onOpen: (id: string) => void;
  onClose: () => void;
  onMailAction: (action: string, id: string) => void;
  composeOpen: boolean;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
}

export function useMailShortcuts({
  items,
  selectedId,
  setSelectedId,
  onOpen,
  onClose,
  onMailAction,
  composeOpen,
  shortcutsOpen,
  setShortcutsOpen,
}: UseMailShortcutsOpts) {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onMailActionRef = useRef(onMailAction);
  onMailActionRef.current = onMailAction;
  const composeOpenRef = useRef(composeOpen);
  composeOpenRef.current = composeOpen;
  const shortcutsOpenRef = useRef(shortcutsOpen);
  shortcutsOpenRef.current = shortcutsOpen;
  const setShortcutsOpenRef = useRef(setShortcutsOpen);
  setShortcutsOpenRef.current = setShortcutsOpen;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (composeOpenRef.current) return;
      const currentItems = itemsRef.current;
      if (!currentItems.length) return;

      const currentSelectedId = selectedIdRef.current;

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedId((current) => {
          const idx = current ? currentItems.findIndex((i) => i.id === current) : -1;
          const next = currentItems[Math.min(currentItems.length - 1, idx + 1)];
          return next?.id ?? current;
        });
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedId((current) => {
          if (!current) return currentItems[currentItems.length - 1]?.id ?? null;
          const idx = currentItems.findIndex((i) => i.id === current);
          const next = currentItems[Math.max(0, idx - 1)];
          return next?.id ?? current;
        });
      } else if (event.key === "Enter" || event.key === "o") {
        if (currentSelectedId) {
          event.preventDefault();
          onOpenRef.current(currentSelectedId);
        }
      } else if (event.key === "Escape") {
        if (currentSelectedId) {
          event.preventDefault();
          onCloseRef.current();
        }
      } else if (event.key === "e" && currentSelectedId) {
        event.preventDefault();
        onMailActionRef.current("archive", currentSelectedId);
      } else if (event.key === "#" && currentSelectedId) {
        event.preventDefault();
        onMailActionRef.current("trash", currentSelectedId);
      } else if (event.key === "s" && currentSelectedId) {
        event.preventDefault();
        onMailActionRef.current("star", currentSelectedId);
      } else if (event.key === "u" && currentSelectedId) {
        event.preventDefault();
        onMailActionRef.current("markUnread", currentSelectedId);
      } else if (event.key === "r" && currentSelectedId) {
        event.preventDefault();
      } else if (event.key === "f" && currentSelectedId) {
        event.preventDefault();
      } else if (event.key === "l" && currentSelectedId) {
        event.preventDefault();
      } else if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpenRef.current(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelectedId]);
}
