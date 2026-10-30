import type { PoolClient } from "pg";
import { pool } from "./db";

const SEMAPHORE_NAMESPACE = 1178814293;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cross-worker advisory-lock semaphore. Waiting callers do not hold a database
 * connection; a connection is retained only after a slot has been acquired.
 */
export async function acquireDistributedSemaphore(
  slots: number,
  options: { pollMs?: number; label?: string } = {},
): Promise<() => Promise<void>> {
  const slotCount = Math.max(1, Math.min(32, Math.floor(slots)));
  const pollMs = Math.max(25, Number(options.pollMs || 75));

  for (;;) {
    const client = await pool.connect();
    let acquiredSlot = 0;
    try {
      for (let slot = 1; slot <= slotCount; slot += 1) {
        const result = await client.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock($1, $2) AS locked",
          [SEMAPHORE_NAMESPACE, slot],
        );
        if (result.rows[0]?.locked === true) {
          acquiredSlot = slot;
          break;
        }
      }

      if (acquiredSlot > 0) {
        let released = false;
        return async () => {
          if (released) return;
          released = true;
          try {
            await client.query("SELECT pg_advisory_unlock($1, $2)", [SEMAPHORE_NAMESPACE, acquiredSlot]);
          } finally {
            client.release();
          }
        };
      }
    } catch (error) {
      client.release();
      throw error;
    }

    client.release();
    await sleep(pollMs);
  }
}
