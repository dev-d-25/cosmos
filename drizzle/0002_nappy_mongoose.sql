-- Just add the new columns. Legacy row fixup is handled by the
-- scripts/migrate-legacy-assistants.mjs script which is more reliable
-- than complex JSON manipulation in SQL.
ALTER TABLE "chat_message" ADD COLUMN "incomplete" boolean DEFAULT false NOT NULL;
ALTER TABLE "chat_message" ADD COLUMN "finish_reason" text;