const STORAGE_KEY = "cosmos:read-emails";
const BATCH_INTERVAL_MS = 5_000;

let pendingIds: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function getReadSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function persistSet(set: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

export function markAsReadLocally(id: string): void {
  const set = getReadSet();
  if (set.has(id)) return;
  set.add(id);
  persistSet(set);

  pendingIds.push(id);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPending();
    }, BATCH_INTERVAL_MS);
  }
}

export function isReadLocally(id: string): boolean {
  return getReadSet().has(id);
}

async function flushPending() {
  if (pendingIds.length === 0) return;
  const ids = pendingIds.splice(0, pendingIds.length);
  try {
    await fetch("/api/mail/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  } catch {
    // re-queue on failure
    pendingIds.unshift(...ids);
  }
}

export function flushReadEmails(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushPending();
}
