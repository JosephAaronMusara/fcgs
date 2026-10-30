import type { PoolClient } from "pg";
import { pool } from "./db";

type LockEntry = {
  tail: Promise<void>;
  pending: number;
};

const assessmentLocks = new Map<number, LockEntry>();
const ASSESSMENT_LOCK_NAMESPACE = 1178814292;

/**
 * Serializes mark writes and paper-configuration changes for one assessment.
 *
 * The in-process queue keeps callers within one worker ordered without opening
 * multiple waiting PostgreSQL connections. Once at the head of the local
 * queue, the caller also takes a PostgreSQL advisory lock so the same
 * assessment cannot be mutated concurrently by another FCGS worker.
 */
export async function acquireAssessmentMutationLock(assessmentId: number): Promise<() => Promise<void>> {
  const normalizedId = Number(assessmentId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0 || normalizedId > 2_147_483_647) {
    throw new Error("A valid assessment ID is required for the mutation lock");
  }

  const previousEntry = assessmentLocks.get(normalizedId);
  const previousTail = previousEntry?.tail ?? Promise.resolve();
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const entry: LockEntry = {
    tail: previousTail.then(() => gate),
    pending: (previousEntry?.pending ?? 0) + 1,
  };
  assessmentLocks.set(normalizedId, entry);

  await previousTail;

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query("SELECT pg_advisory_lock($1, $2)", [ASSESSMENT_LOCK_NAMESPACE, normalizedId]);
  } catch (error) {
    client?.release();
    releaseGate();
    const current = assessmentLocks.get(normalizedId);
    if (current) {
      current.pending -= 1;
      if (current.pending <= 0 && current === entry) assessmentLocks.delete(normalizedId);
    }
    throw error;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await client!
        .query("SELECT pg_advisory_unlock($1, $2)", [ASSESSMENT_LOCK_NAMESPACE, normalizedId])
        .catch((error) => console.error(`Failed to release assessment advisory lock ${normalizedId}:`, error));
    } finally {
      client!.release();
      releaseGate();

      const current = assessmentLocks.get(normalizedId);
      if (!current) return;
      current.pending -= 1;
      if (current.pending <= 0 && current === entry) {
        assessmentLocks.delete(normalizedId);
      }
    }
  };
}
