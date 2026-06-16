"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initialsOf } from "@/lib/mail/format";

export function ProfileDropdown({ profile }: { profile: { emailAddress?: string; name?: string } | null }) {
  const email = profile?.emailAddress ?? "";
  const name = profile?.name ?? email.split("@")[0] ?? "User";
  const initials = initialsOf(name);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" />}>
        <Avatar size="sm">
          <AvatarFallback className="bg-muted text-muted-foreground text-xs font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="px-3">
          <div className="flex items-center gap-2 py-0.5">
            <Avatar size="sm" className="size-7">
              <AvatarFallback className="bg-muted text-[0.625rem] font-bold">
                {initialsOf(email)}
              </AvatarFallback>
            </Avatar>
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
