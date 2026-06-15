import { NextResponse } from "next/server";
import { corsair } from "@/server/corsair";
import { getSessionTenantId } from "@/server/auth";

interface ContactSuggestion {
  email: string;
  name?: string;
}

// Simple in-memory cache for suggestions (per-tenant)
const suggestionsCache = new Map<string, { data: ContactSuggestion[]; at: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(request: Request) {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ suggestions: [] });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.toLowerCase() || "";

  if (!query || query.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  // Check cache
  const cached = suggestionsCache.get(tenantId);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    const filtered = cached.data.filter(
      (s) =>
        s.email.toLowerCase().includes(query) ||
        s.name?.toLowerCase().includes(query),
    );
    return NextResponse.json({ suggestions: filtered.slice(0, 8) });
  }

  try {
    const client = corsair.withTenant(tenantId);

    // Search sent messages for email addresses
    const result = await client.gmail.api.messages.list({
      userId: "me",
      q: "in:sent",
      maxResults: 50,
    });

    const messageIds = (result.messages ?? [])
      .map((m) => m.id)
      .filter((id): id is string => !!id);

    if (messageIds.length === 0) {
      return NextResponse.json({ suggestions: [] });
    }

    // Fetch headers from sent messages to extract recipients
    const contacts = new Map<string, ContactSuggestion>();

    // Sample a subset to avoid too many API calls
    const sampleIds = messageIds.slice(0, 20);

    await Promise.allSettled(
      sampleIds.map(async (id) => {
        try {
          const msg = await client.gmail.api.messages.get({
            id,
            format: "metadata",
            metadataHeaders: ["To", "Cc", "From"],
          });

          const payload = (msg as { payload?: { headers?: Array<{ name?: string; value?: string }> } }).payload;
          const headers = payload?.headers || [];

          for (const header of headers) {
            if (header.name?.toLowerCase() === "to" || header.name?.toLowerCase() === "cc") {
              const value = header.value || "";
              // Parse "Name <email>" format
              const matches = value.matchAll(/(?:"?([^"<]*)"?\s*)?<([^>]+)>/g);
              for (const match of matches) {
                const name = match[1]?.trim();
                const email = match[2]?.trim();
                if (email && email.includes("@") && !contacts.has(email.toLowerCase())) {
                  contacts.set(email.toLowerCase(), { email, name: name || undefined });
                }
              }
            }
          }
        } catch {
          // Skip failed fetches
        }
      }),
    );

    const allContacts = Array.from(contacts.values());

    // Cache the results
    suggestionsCache.set(tenantId, { data: allContacts, at: Date.now() });

    // Filter by query
    const filtered = allContacts.filter(
      (s) =>
        s.email.toLowerCase().includes(query) ||
        s.name?.toLowerCase().includes(query),
    );

    return NextResponse.json({ suggestions: filtered.slice(0, 8) });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
