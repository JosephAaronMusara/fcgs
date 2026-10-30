import type { PoolClient } from "pg";
import { pool } from "./db";

const FCGS_ADVISORY_LOCK_NAMESPACE = 1178814291;

export const FCGS_LOCK_KEYS = {
  rbacBaseline: 1,
  transportCompliance: 2,
  schoolTerminationCleanup: 3,
  accessControlScheduler: 4,
  academicReportCacheCleanup: 5,
} as const;

async function acquireLock(client: PoolClient, key: number, wait: boolean): Promise<boolean> {
  if (wait) {
    await client.query("SELECT pg_advisory_lock($1, $2)", [FCGS_ADVISORY_LOCK_NAMESPACE, key]);
    return true;
  }
  const result = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1, $2) AS locked",
    [FCGS_ADVISORY_LOCK_NAMESPACE, key],
  );
  return result.rows[0]?.locked === true;
}

/**
 * Runs a critical section under a PostgreSQL advisory lock shared by every
 * FCGS worker connected to the same production database.
 *
 * `wait=false` is ideal for recurring schedulers: if another worker owns the
 * job, this worker simply skips the current tick. `wait=true` is used for
 * startup work that must complete before the worker can become ready.
 */
export async function withDistributedLock<T>(
  key: number,
  fn: () => Promise<T>,
  options: { wait?: boolean; onBusy?: () => void } = {},
): Promise<T | undefined> {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = await acquireLock(client, key, options.wait === true);
    if (!locked) {
      options.onBusy?.();
      return undefined;
    }
    return await fn();
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_advisory_unlock($1, $2)", [FCGS_ADVISORY_LOCK_NAMESPACE, key])
        .catch((error) => console.error("Failed to release FCGS distributed advisory lock:", error));
    }
    client.release();
  }
}
