/**
 * Browser-side orchestration for Sage ID confirmation.
 * The server deliberately retains its 500-selection transactional limit.
 * No balance update is part of this workflow.
 */
export const SAGE_APPROVAL_CHUNK_SIZE = 500;

export type SageApprovalSelection = {
  itemId: number;
  studentId: number;
  customerCode: string;
};

export type SageApprovalRequestSelection = Pick<SageApprovalSelection, "itemId" | "studentId">;

export type SageApprovalProgress = {
  approved: number;
  total: number;
  completedBatches: number;
  totalBatches: number;
};

export class SageBulkApprovalError extends Error {
  constructor(
    message: string,
    public readonly progress: SageApprovalProgress,
    public readonly failedBatchNumber: number,
  ) {
    super(message);
    this.name = "SageBulkApprovalError";
  }
}

export function normalizeSageApprovalCode(value: string): string {
  // Match server/sage-matching.ts: never strip meaningful punctuation.
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

/** Reject conflicts across the *entire* selection, before committing chunk one. */
export function validateSageApprovalSelections(selections: SageApprovalSelection[]): void {
  if (!selections.length) throw new Error("Choose at least one learner");
  const seenItems = new Set<number>();
  const seenStudents = new Set<number>();
  const seenCodes = new Map<string, number>();
  for (const selection of selections) {
    if (!Number.isSafeInteger(selection.itemId) || selection.itemId <= 0 ||
        !Number.isSafeInteger(selection.studentId) || selection.studentId <= 0) {
      throw new Error("A selected Sage row or FCGS student ID is invalid. Review the selections.");
    }
    if (seenItems.has(selection.itemId)) {
      throw new Error(`Sage row ${selection.itemId} was selected more than once.`);
    }
    if (seenStudents.has(selection.studentId)) {
      throw new Error(`FCGS student ${selection.studentId} is selected for multiple Sage accounts. Review these selections before approving.`);
    }
    const code = normalizeSageApprovalCode(selection.customerCode);
    if (!code) throw new Error(`Sage row ${selection.itemId} has no customer code.`);
    const previous = seenCodes.get(code);
    if (previous !== undefined) {
      throw new Error(`Sage Customer ${selection.customerCode} appears in both row ${previous} and row ${selection.itemId}. Resolve the duplicate before approving.`);
    }
    seenItems.add(selection.itemId);
    seenStudents.add(selection.studentId);
    seenCodes.set(code, selection.itemId);
  }
}

/**
 * Sends one request at a time, so no overlapping transactions or hidden concurrency.
 * Each successful request is a committed unit; failures halt further submissions.
 * The caller removes ONLY confirmed selections and refreshes server-backed data.
 */
export async function approveSageSelectionsInBatches(
  selections: SageApprovalSelection[],
  sendBatch: (batch: SageApprovalRequestSelection[]) => Promise<{ approved: number }>,
  onBatchApproved: (batch: SageApprovalRequestSelection[], progress: SageApprovalProgress) => void,
): Promise<SageApprovalProgress> {
  validateSageApprovalSelections(selections);
  const total = selections.length;
  const totalBatches = Math.ceil(total / SAGE_APPROVAL_CHUNK_SIZE);
  let progress: SageApprovalProgress = { approved: 0, total, completedBatches: 0, totalBatches };

  for (let offset = 0; offset < total; offset += SAGE_APPROVAL_CHUNK_SIZE) {
    const chunk: SageApprovalRequestSelection[] = selections
      .slice(offset, offset + SAGE_APPROVAL_CHUNK_SIZE)
      .map(({ itemId, studentId }) => ({ itemId, studentId }));

    try {
      const result = await sendBatch(chunk);
      // A malformed response cannot be treated as a verified successful commit.
      if (!result || result.approved !== chunk.length) {
        throw new Error("The server returned an unexpected approval count. Refresh the reconciliation list before retrying.");
      }
    } catch (error) {
      throw new SageBulkApprovalError(
        error instanceof Error ? error.message : "Sage approval request failed",
        progress,
        progress.completedBatches + 1,
      );
    }

    progress = {
      approved: progress.approved + chunk.length,
      total,
      completedBatches: progress.completedBatches + 1,
      totalBatches,
    };
    onBatchApproved(chunk, progress);
  }

  return progress;
}
