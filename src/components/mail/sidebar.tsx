"use client";

import { useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SidebarItem } from "./sidebar-item";
import { MAIL_LABELS } from "@/lib/mail/labels";
import { SquarePenIcon, StarIcon } from "lucide-react";
import type { MailLabel, MailProfile } from "@/server/mail/schemas";

const LABEL_ICONS: Record<string, ReactNode> = {
  INBOX: (
    <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
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
  IMPORTANT: (
    <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z" />
    </svg>
  ),
  UNREAD: (
    <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-10 7L2 7" />
    </svg>
  ),
  CATEGORY_PERSONAL: (
    <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  CATEGORY_SOCIAL: (
    <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  CATEGORY_UPDATES: (
    <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  CATEGORY_PROMOTIONS: (
    <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  ),
  CATEGORY_FORUMS: (
    <svg className="shrink-0 opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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
        if (def.id.startsWith("divider-")) {
          return <div key={def.id} className="bg-border mx-4 my-2 h-px" />;
        }
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
