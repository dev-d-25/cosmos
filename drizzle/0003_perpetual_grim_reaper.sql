CREATE TABLE IF NOT EXISTS "mail_sync_state" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"view_key" text NOT NULL,
	"next_page_token" text,
	"window_index" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_corsair_entities_tenant_type_entity";--> statement-breakpoint
ALTER TABLE "mail_sync_state" ADD CONSTRAINT "mail_sync_state_account_id_corsair_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."corsair_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_mail_sync_state_account_view" ON "mail_sync_state" USING btree ("account_id","view_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_corsair_entities_tenant_type_entity" ON "corsair_entities" USING btree ("account_id","entity_type","entity_id");