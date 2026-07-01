"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { getGmailParamsForView } from "@/lib/mail/labels";

function parsePageParam(raw: string | null | undefined): number {
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function parseLabelParam(
  raw: string | null | undefined,
  fallback: string,
): string {
  return raw && raw.length > 0 ? raw : fallback;
}

export function useMailNav({ initialLabel }: { initialLabel: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeLabel = parseLabelParam(searchParams.get("label"), initialLabel);
  const selectedId = searchParams.get("id") ?? null;
  const searchQuery = searchParams.get("q") ?? "";
  const page = parsePageParam(searchParams.get("page"));

  const gmailParams = useMemo(
    () =>
      searchQuery
        ? { query: searchQuery }
        : getGmailParamsForView(activeLabel),
    [activeLabel, searchQuery],
  );

  const buildUrl = useCallback(
    (updates: Record<string, string | null>): string => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value == null || value === "") params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams],
  );

  const navigate = useCallback(
    (updates: Record<string, string | null>) => {
      router.replace(buildUrl(updates), { scroll: false });
    },
    [router, buildUrl],
  );

  return {
    activeLabel,
    selectedId,
    page,
    searchQuery,
    gmailParams,
    navigate,
    buildUrl,
  };
}