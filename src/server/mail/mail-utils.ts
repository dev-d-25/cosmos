export function describeError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as {
      status?: number;
      code?: number | string;
      message?: string;
    };
    if (e.status) return `HTTP ${e.status}`;
    if (e.code != null) return `code ${e.code}`;
    if (e.message) return e.message.slice(0, 200);
  }
  return String(err).slice(0, 200);
}
