/**
 * Custom Drizzle-based helpers for the gmail `messages` entity.
 *
 * The corsair ORM exposes findByEntityId / upsertByEntityId / list / count
 * but lacks the bulk and label-aware variants we need for the mail pipeline:
 *
 *   • upsertManyByEntityIds  — atomic batch upsert (1 query, ON CONFLICT)
 *   • listByLabel            — SQL-level label filter using GIN index
 *   • countByLabel           — SQL-level label count using GIN index
 *
 * All helpers accept an explicit `accountId` because they bypass the corsair
 * `withTenant` plumbing and run directly against the shared Drizzle client.
 * Resolve accountId via `getAccountIdForTenant(tenantId)`.
 *
 * Required DB state:
 *   • UNIQUE INDEX idx_corsair_entities_tenant_type_entity
 *       ON corsair_entities (account_id, entity_type, entity_id)
 *   • GIN INDEX idx_corsair_entities_messages_labels
 *       ON corsair_entities USING GIN ((data->'labelIds'))
 *       WHERE entity_type = 'messages'
 *   See: scripts/migrate-mail-pipeline.sql
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { db } from "./index";
import { corsairAccounts, corsairEntities, corsairIntegrations } from "./schema";

const MESSAGE_ENTITY_TYPE = "messages";
const MESSAGE_VERSION = "v1" as const;

export interface RawMessageEntity {
  id: string;
  threadId?: string;
  labelIds?: string[];
  subject?: string | null;
  from?: string | null;
  to?: string | null;
  snippet?: string | null;
  internalDate?: string | number | null;
  payload?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface MailEntityRow {
  id: string;
  accountId: string;
  entityId: string;
  entityType: string;
  version: string;
  data: RawMessageEntity;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertItem {
  entityId: string;
  data: RawMessageEntity;
}

/**
 * Batch upsert using native PostgreSQL INSERT ... ON CONFLICT.
 * One round-trip regardless of N items.
 *
 * Relies on the unique index (account_id, entity_type, entity_id) for conflict
 * resolution. When a conflict occurs, the data column is replaced atomically.
 */
export async function upsertManyByEntityIds(
  accountId: string,
  items: UpsertItem[],
): Promise<MailEntityRow[]> {
  if (items.length === 0) return [];

  const now = new Date();
  const values = items.map((it) => ({
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    accountId,
    entityId: it.entityId,
    entityType: MESSAGE_ENTITY_TYPE,
    version: MESSAGE_VERSION,
    data: it.data as unknown as Record<string, unknown>,
  }));

  const inserted = await db
    .insert(corsairEntities)
    .values(values)
    .onConflictDoUpdate({
      target: [
        corsairEntities.accountId,
        corsairEntities.entityType,
        corsairEntities.entityId,
      ],
      set: {
        version: MESSAGE_VERSION,
        data: sql`excluded.data`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning();

  return inserted.map(parseRow);
}

/**
 * SQL-level filter by labelIds JSONB containment.
 * Uses the GIN index `idx_corsair_entities_messages_labels`.
 */
export async function listByLabel(
  accountId: string,
  labelIds: string[],
  options: {
    limit?: number;
    offset?: number;
    orderBy?: "created_at" | "internal_date";
  } = {},
): Promise<MailEntityRow[]> {
  const { limit = 50, offset = 0, orderBy = "created_at" } = options;
  const labelJson = JSON.stringify(labelIds);

  const orderExpr =
    orderBy === "internal_date"
      ? sql`(data->>'internalDate')::bigint DESC NULLS LAST`
      : sql`created_at DESC`;

  const rows = await db
    .select()
    .from(corsairEntities)
    .where(
      and(
        eq(corsairEntities.accountId, accountId),
        eq(corsairEntities.entityType, MESSAGE_ENTITY_TYPE),
        sql`${corsairEntities.data}->'labelIds' @> ${labelJson}::jsonb`,
      ),
    )
    .orderBy(orderExpr)
    .limit(limit)
    .offset(offset);

  return rows.map(parseRow);
}

/**
 * Count messages whose labelIds array contains ALL of the given labels.
 * Uses the GIN index for the containment check.
 */
export async function countByLabel(
  accountId: string,
  labelIds: string[],
): Promise<number> {
  const labelJson = JSON.stringify(labelIds);

  const row = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(corsairEntities)
    .where(
      and(
        eq(corsairEntities.accountId, accountId),
        eq(corsairEntities.entityType, MESSAGE_ENTITY_TYPE),
        sql`${corsairEntities.data}->'labelIds' @> ${labelJson}::jsonb`,
      ),
    );
  return row[0]?.count ?? 0;
}

/**
 * Resolve the account_id for a given tenant.
 * Mirrors corsair's internal mapping (tenant → integration account).
 */
export async function getAccountIdForTenant(
  tenantId: string,
): Promise<string | null> {
  const rows = await db
    .select({ accountId: corsairAccounts.id })
    .from(corsairAccounts)
    .innerJoin(
      corsairIntegrations,
      eq(corsairIntegrations.id, corsairAccounts.integrationId),
    )
    .where(
      and(
        eq(corsairAccounts.tenantId, tenantId),
        eq(corsairIntegrations.name, "gmail"),
      ),
    )
    .limit(1);
  return rows[0]?.accountId ?? null;
}

function parseRow(row: typeof corsairEntities.$inferSelect): MailEntityRow {
  return {
    id: row.id,
    accountId: row.accountId,
    entityId: row.entityId,
    entityType: row.entityType,
    version: row.version,
    data: row.data as RawMessageEntity,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
