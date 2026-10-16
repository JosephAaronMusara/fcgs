import { sql } from "drizzle-orm";

/**
 * gate_commands stores timestamp WITHOUT time zone values in UTC.
 *
 * Always use the database's UTC wall clock for command deadlines and leases.
 * A raw JS Date bound to SQL against a `timestamp` column can be formatted by
 * node-postgres using the Node process timezone; PostgreSQL then ignores the
 * supplied offset when coercing that value to `timestamp without time zone`.
 *
 * Do not change the application's other timestamp conventions here.
 */
export const GATE_UTC_NOW = sql`(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`;

/** Database-calculated UTC expiry; avoids a Node/DB timezone round-trip. */
export function gateUtcDeadlineAfterMs(milliseconds: number) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new Error("Gate command TTL must be a positive integer number of milliseconds");
  }
  return sql`(${GATE_UTC_NOW} + (${milliseconds} * INTERVAL '1 millisecond'))`;
}
