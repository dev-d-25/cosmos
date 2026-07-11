"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initialsOf } from "@/lib/mail/format";

function ProfileAvatar({ src, alt, initials, className = "" }: { src?: string | null; alt: string; initials: string; className?: string }) {
  const proxySrc = src ? `/api/mail/avatar?url=${encodeURIComponent(src)}` : null;
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-full ${className}`}>
      {proxySrc ? (
        <img
          src={proxySrc}
          alt={alt}
          className="aspect-square size-full rounded-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
            const fb = (e.currentTarget as HTMLImageElement).nextElementSibling as HTMLElement | null;
            if (fb) fb.style.display = "flex";
          }}
        />
      ) : null}
      <div
        className="bg-muted text-muted-foreground flex size-full items-center justify-center rounded-full text-xs font-semibold"
        style={proxySrc ? { display: "none" } : undefined}
      >
        {initials}
      </div>
    </div>
  );
}

export function ProfileDropdown({ profile }: { profile: { emailAddress?: string; name?: string; picture?: string } | null }) {
  const email = profile?.emailAddress ?? "";
  const name = profile?.name ?? email.split("@")[0] ?? "User";
  const initials = initialsOf(name);
  const picture = profile?.picture;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" />}>
        <ProfileAvatar src={picture} alt={name} initials={initials} className="size-6" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="px-3">
          <div className="flex items-center gap-2 py-0.5">
            <ProfileAvatar src={picture} alt={name} initials={initialsOf(email)} className="size-7" />
            <div className="flex flex-col">
              <span className="text-xs font-semibold">{name}</span>
              <span className="text-muted-foreground text-[0.625rem]">
                {email}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Profile</DropdownMenuItem>
        <DropdownMenuItem>Settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
