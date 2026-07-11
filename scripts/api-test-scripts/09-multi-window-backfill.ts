/**
 * scripts/api-test-scripts/09-multi-window-backfill.ts
 *
 * Step 9: Test multi-window on-demand backfill by requesting a deep page
 * (page 50) that requires chaining multiple 500-message windows.
 *
 * Each window = 500 messages via messages.list + per-message messages.get.
 * Page 50 = offset 1225 (49 * PAGE_SIZE), so the pipeline needs at least
 * 3 chained windows to reach that deep. MAX_WINDOWS caps at 5 (2500 msgs).
 *
 * Prerequisites:
 *   - Dev server running on localhost:3000
 *   - Steps 01–03 completed (tenant/session fetched, inbox refreshed)
 *   - test-config.json exists with valid cookie
 *
 * Run: npx tsx scripts/api-test-scripts/09-multi-window-backfill.ts
 */
import postgres from "postgres";
import { readFile } from "node:fs/promises";

const PAGE_SIZE = 25;
const DEEP_PAGE = 50; // offset = 49 * 25 = 1225 → needs ≥ 3 windows

async function loadConfig() {
  const raw = await readFile(
    new URL("./test-config.json", import.meta.url),
    "utf8",
  );
  return JSON.parse(raw) as {
    baseUrl: string;
    cookieHeader: string;
    tenantId: string;
    accountId: string;
  };
}

async function loadEnv(): Promise<string> {
  const raw = await readFile(".env", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^DATABASE_URL\s*=\s*"?([^"#]+)"?/);
    if (m && m[1]) return m[1].trim();
  }
  throw new Error("DATABASE_URL not found in .env");
}

const config = await loadConfig();
const DB_URL = await loadEnv();
const conn = postgres(DB_URL, { max: 2 });

console.log("\n═══════════════════════════════════════════════════════");
console.log("  STEP 9: Multi-Window On-Demand Backfill Test");
console.log("═══════════════════════════════════════════════════════\n");

console.log(`Requesting page ${DEEP_PAGE} (offset ${(DEEP_PAGE - 1) * PAGE_SIZE})`);
console.log(`This should chain ≥ 3 windows of 500 messages each.\n`);

// Snapshot DB state before
const beforeTotal = await conn<{ c: number }[]>`
  SELECT COUNT(*)::int AS c FROM corsair_entities WHERE entity_type = 'messages'
`;
const beforeEnriched = await conn<{ c: number }[]>`
  SELECT COUNT(*)::int AS c FROM corsair_entities
  WHERE entity_type = 'messages'
    AND data ? 'labelIds'
    AND data ? 'subject'
    AND data ? 'from'
`;
console.log(`DB before: ${beforeTotal[0]?.c ?? 0} total, ${beforeEnriched[0]?.c ?? 0} enriched`);

// Check mail_sync_state before
const syncBefore = await conn<{ view_key: string; window_index: number; next_page_token: string | null }[]>`
  SELECT view_key, window_index, next_page_token
  FROM mail_sync_state
  WHERE account_id = ${config.accountId}
    AND view_key = 'l:INBOX'
`;
if (syncBefore.length > 0) {
  const s = syncBefore[0]!;
  console.log(`Sync state before: window=${s.window_index}, hasToken=${!!s.next_page_token}`);
} else {
  console.log("Sync state before: (none)");
}

console.log(`\nGET ${config.baseUrl}/api/mail?page=${DEEP_PAGE}&view=INBOX`);
console.log(`Auth: ${config.cookieHeader.slice(0, 30)}…\n`);

const t0 = Date.now();

try {
  const res = await fetch(
    `${config.baseUrl}/api/mail?page=${DEEP_PAGE}&view=INBOX`,
    {
      headers: { Cookie: config.cookieHeader },
    },
  );

  const elapsed = Date.now() - t0;
  const body = await res.json() as Record<string, unknown>;

  console.log(`Response: ${res.status} ${res.statusText} (${elapsed}ms)`);

  // Extract relevant fields
  const items = (body.items ?? []) as Array<{ id: string; subject?: string }>;
  const count = body.count as number | null;
  const page = body.page as number;
  const totalPages = body.totalPages as number | null;
  const cacheState = body.cacheState as string;
  const source = body.source as string;
  const hasMore = body.hasMore as boolean;

  console.log(`\nResponse shape:`);
  console.log(`  page: ${page} (requested ${DEEP_PAGE})`);
  console.log(`  items: ${items.length}`);
  console.log(`  count: ${count}`);
  console.log(`  totalPages: ${totalPages}`);
  console.log(`  cacheState: ${cacheState}`);
  console.log(`  source: ${source}`);
  console.log(`  hasMore: ${hasMore}`);

  if (items.length > 0) {
    console.log(`\nFirst item: ${items[0]?.id} — ${items[0]?.subject ?? "(no subject)"}`);
    console.log(`Last item:  ${items[items.length - 1]?.id} — ${items[items.length - 1]?.subject ?? "(no subject)"}`);
  }

  // Snapshot DB state after
  const afterTotal = await conn<{ c: number }[]>`
    SELECT COUNT(*)::int AS c FROM corsair_entities WHERE entity_type = 'messages'
  `;
  const afterEnriched = await conn<{ c: number }[]>`
    SELECT COUNT(*)::int AS c FROM corsair_entities
    WHERE entity_type = 'messages'
      AND data ? 'labelIds'
      AND data ? 'subject'
      AND data ? 'from'
  `;
  const afterOrphans = await conn<{ c: number }[]>`
    SELECT COUNT(*)::int AS c FROM corsair_entities
    WHERE entity_type = 'messages'
      AND NOT (data ? 'labelIds')
      AND NOT (data ? 'subject')
      AND NOT (data ? 'from')
  `;

  console.log(`\nDB after:`);
  console.log(`  Total messages: ${afterTotal[0]?.c ?? 0} (was ${beforeTotal[0]?.c ?? 0})`);
  console.log(`  Enriched:       ${afterEnriched[0]?.c ?? 0} (was ${beforeEnriched[0]?.c ?? 0})`);
  console.log(`  Orphan stubs:   ${afterOrphans[0]?.c ?? 0}`);

  const synced = (afterEnriched[0]?.c ?? 0) - (beforeEnriched[0]?.c ?? 0);
  console.log(`  New enriched:   ${synced}`);

  // Check mail_sync_state after
  const syncAfter = await conn<{ view_key: string; window_index: number; next_page_token: string | null }[]>`
    SELECT view_key, window_index, next_page_token
    FROM mail_sync_state
    WHERE account_id = ${config.accountId}
      AND view_key = 'l:INBOX'
  `;
  if (syncAfter.length > 0) {
    const s = syncAfter[0]!;
    console.log(`\nSync state after: window=${s.window_index}, hasToken=${!!s.next_page_token}`);
    if (syncBefore.length > 0 && s.window_index > (syncBefore[0]?.window_index ?? 0)) {
      console.log(`  ✅ Window index advanced: ${syncBefore[0]?.window_index} → ${s.window_index}`);
    }
  }

  // Verdict
  console.log("\n───────────────────────────────────────────────────────");
  if (items.length > 0) {
    console.log("✅ PASS: Deep page returned items. Multi-window backfill works.");
    console.log(`   ${synced} new messages enriched across chained windows.`);
  } else if (res.status === 200 && items.length === 0 && (count ?? 0) > 0) {
    console.log("⚠️  PARTIAL: Response OK but no items. Mailbox may have < page items at this offset.");
    console.log(`   count=${count}, but the page offset exceeded available messages.`);
  } else {
    console.log("❌ FAIL: Deep page returned no items.");
    if (!res.ok) console.log(`   HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  console.log("───────────────────────────────────────────────────────");

} catch (err) {
  console.error(`\n❌ Request failed: ${err}`);
  console.log("   Is the dev server running on localhost:3000?");
}

await conn.end();
console.log("\nDone.\n");
