-- =====================================================================
-- mail_sync_state — per-account/per-view Gmail window cursor
-- =====================================================================
-- Tracks the Gmail `nextPageToken` for on-demand window backfill so the
-- mail list can walk the mailbox 500 messages at a time (bounded by
-- MAX_WINDOWS) without re-listing from the top on every page request.
--
-- Idempotent: safe to re-run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS "mail_sync_state" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL REFERENCES "corsair_accounts" ("id"),
  "view_key" text NOT NULL,
  "next_page_token" text,
  "window_index" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_mail_sync_state_account_view"
  ON "mail_sync_state" USING btree ("account_id", "view_key");
