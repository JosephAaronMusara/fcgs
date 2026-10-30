import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

function positiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Keep the pool explicitly bounded because production can run several Node
 * workers against the same PostgreSQL instance. The default remains 10 for
 * single-worker/local deployments; the systemd multi-worker deployment sets a
 * lower per-worker ceiling so four workers cannot unexpectedly exhaust the DB.
 */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  application_name: process.env.FCGS_WORKER_ID || "fcgs-portal",
  max: positiveIntegerEnv("FCGS_DB_POOL_MAX", 10),
  idleTimeoutMillis: positiveIntegerEnv("FCGS_DB_POOL_IDLE_TIMEOUT_MS", 30_000),
  connectionTimeoutMillis: positiveIntegerEnv("FCGS_DB_POOL_CONNECT_TIMEOUT_MS", 10_000),
});

pool.on("error", (error) => {
  console.error("Unexpected idle PostgreSQL client error:", error);
});

export const db = drizzle(pool, { schema });
