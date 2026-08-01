type LockEntry = {
  tail: Promise<void>;
  pending: number;
};

const assessmentLocks = new Map<number, LockEntry>();

/**
 * Serializes mark writes and paper-configuration changes for one assessment.
 * Waiting callers do not occupy PostgreSQL pool connections.
 */
export async function acquireAssessmentMutationLock(assessmentId: number): Promise<() => void> {
  const normalizedId = Number(assessmentId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
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

  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseGate();

    const current = assessmentLocks.get(normalizedId);
    if (!current) return;
    current.pending -= 1;
    if (current.pending <= 0 && current === entry) {
      assessmentLocks.delete(normalizedId);
    }
  };
}
