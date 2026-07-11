"use client";

import { useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SidebarItem } from "./sidebar-item";
import { MAIL_LABELS } from "@/lib/mail/labels";
import { SquarePenIcon, StarIcon, BotIcon } from "lucide-react";
import type { MailLabel, MailProfile } from "@/server/mail/schemas";

const LABEL_ICONS: Record<string, ReactNode> = {
  INBOX: (
    <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  ),
  IMPORTANT: (
    <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z" />
    </svg>
  ),
  STARRED: <StarIcon size={14} className="shrink-0 opacity-70" />,
  SENT: (
    <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  DRAFT: <SquarePenIcon size={14} className="shrink-0 opacity-70" />,
  ARCHIVE: (
    <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  ),
  SPAM: (
    <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
};

export function MailSidebar({
  labels,
  activeLabel,
  profile,
  onCompose,
}: {
  labels: MailLabel[];
  activeLabel: string;
  profile: MailProfile | null;
  onCompose: () => void;
}) {
  const labelMap = useMemo(() => {
    const m = new Map<string, MailLabel>();
    for (const l of labels) m.set(l.id, l);
    return m;
  }, [labels]);

  return (
    <aside className="border-sidebar-border bg-sidebar flex h-full flex-col gap-0 overflow-y-auto border-r p-0">
      <div className="px-3 py-3">
        <Button
          onClick={onCompose}
          className="bg-primary text-primary-foreground hover:bg-primary/90 w-full justify-start gap-2 rounded-md px-4 py-2 text-sm font-medium shadow-sm"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          Compose
        </Button>
      </div>

      <div className="bg-border mx-4 mb-2 h-px" />

      {MAIL_LABELS.map((def) => {
        const label = def.gmailLabel ? labelMap.get(def.gmailLabel) : undefined;
        const unread = label?.messagesUnread;
        return (
          <SidebarItem
            key={def.id}
            active={activeLabel === def.id}
            href={`/mail?label=${def.id}`}
            badge={unread && unread > 0 ? unread.toString() : undefined}
          >
            {LABEL_ICONS[def.id]}
            {def.name}
          </SidebarItem>
        );
      })}

      <div className="bg-border mx-4 my-2 h-px" />

      <SidebarItem
        active={activeLabel === "AGENT"}
        href="/agent"
      >
        <BotIcon size={14} className="shrink-0 opacity-70" />
        Agent
      </SidebarItem>

      {(() => {
        const userLabels = labels.filter((l) => l.type === "user");
        if (userLabels.length === 0) return null;
        return (
          <>
            <div className="bg-border mx-4 my-2 h-px" />
            <div className="text-muted-foreground flex items-center justify-between px-4 pt-2 pb-1 text-[0.55rem] font-bold tracking-[0.16em] uppercase">
              Labels
            </div>
            {userLabels.map((label) => (
              <SidebarItem
                key={label.id}
                active={activeLabel === label.id}
                href={`/mail?label=${label.id}`}
                badge={label.messagesUnread > 0 ? label.messagesUnread.toString() : undefined}
              >
                <span className="bg-primary size-2" />
                {label.name}
              </SidebarItem>
            ))}
          </>
        );
      })()}
    </aside>
  );
}
