/**
 * FCGS Transport credit planner: pure, deterministic and testable.
 * No DB queries or writes. Server routes lock, obtain authoritative records,
 * validate the digest, and apply each operation in an audited transaction.
 */
import { createHash } from 'node:crypto';

// Shared Transport credit allocation engine. Uses integer cents throughout: money is never
// inferred from the learner's net ledger balance (which may include refunds or adjustments).
// Preview and commit share this exact planner; all writes occur in the caller's transaction.
export const transportCents = (value: unknown): number => Math.round(Number(value || 0) * 100);
export const transportMoney = (cents: number): string => (cents / 100).toFixed(2);
export const creditPeriodKey = (year: number, month: number): number => year * 100 + month;


export type TransportCreditOperation = {
  paymentId: number; chargeId: number; studentId: number; amountCents: number;
  serviceYear: number; serviceMonth: number; vehicleId: number | null;
  existingAllocationId: number | null; existingAmountCents: number;
  mode: string;
};
export type TransportCreditPlan = {
  operations: TransportCreditOperation[];
  excluded: { held: number; legacy: number; locked: number; refunded: number; specific: number };
  totalAllocatedCents: number;
  affectedStudents: number[];
  remainingUnallocatedCents: number;
  digest: string;
};

export function createTransportCreditPlan(
  schoolId: number,
  paymentRows: any[], chargeRows: any[], allocationRows: any[], refundRows: any[], lockRows: any[],
  options: { maxPeriod?: number; includeLegacy?: boolean; studentId?: number } = {},
): TransportCreditPlan {
  const locked = new Set((lockRows).map(r => creditPeriodKey(Number(r.year), Number(r.month))));
  const refunded = new Map<number, number>((refundRows).map(r => [Number(r.studentId), transportCents(r.refunded)]));
  const chargesByStudent = new Map<number, any[]>();
  for (const c of chargeRows) {
    const studentId = Number(c.studentId);
    const all = chargesByStudent.get(studentId) || [];
    const period = creditPeriodKey(Number(c.academicYear), Number(c.month));
    if (options.maxPeriod == null || period <= options.maxPeriod) {
      all.push({ ...c, period, outstandingCents: Math.max(0, transportCents(c.amount) + transportCents(c.adjustment) - transportCents(c.allocated)) });
    }
    chargesByStudent.set(studentId, all);
  }
  const allocations = new Map<string, { id: number; cents: number; claimed: boolean }>();
  for (const a of allocationRows) allocations.set(`${a.paymentId}:${a.chargeId}`, { id: Number(a.id), cents: transportCents(a.amount), claimed: a.claimed === true });
  const operations: TransportCreditOperation[] = [];
  const excluded = { held: 0, legacy: 0, locked: 0, refunded: 0, specific: 0 };
  const refundRemaining = new Map(refunded);
  let remainingUnallocatedCents = 0;
  const affected = new Set<number>();
  for (const p of paymentRows) {
    const studentId = Number(p.studentId);
    let remaining = Math.max(0, transportCents(p.amount) - transportCents(p.allocated));
    if (remaining === 0) continue;
    const mode = String(p.allocationMode || 'legacy_unclassified');
    if (mode === 'future_credit') { excluded.held += remaining; remainingUnallocatedCents += remaining; continue; }
    if (mode === 'legacy_unclassified' && !options.includeLegacy) { excluded.legacy += remaining; remainingUnallocatedCents += remaining; continue; }
    if (!['oldest_first', 'specific', 'legacy_unclassified'].includes(mode)) { excluded.held += remaining; remainingUnallocatedCents += remaining; continue; }
    // Cash already returned to a family cannot be allocated again to provider entitlement.
    // Without per-receipt refund links, conservatively reserve cash refunds from the pool.
    const refundReserve = Math.min(remaining, refundRemaining.get(studentId) || 0);
    if (refundReserve) { remaining -= refundReserve; excluded.refunded += refundReserve; refundRemaining.set(studentId, (refundRemaining.get(studentId) || 0) - refundReserve); }
    const permitted = new Set<number>((p.allocationChargeIds || []).map(Number));
    if (mode === 'specific' && permitted.size === 0) { excluded.specific += remaining; remainingUnallocatedCents += remaining + refundReserve; continue; }
    // Preserve existing oldest_first semantics: the receipt's informational service
    // month never used to restrict allocation at recording time. Legacy receipts
    // have unknown intent, so the manual recovery takes the conservative floor.
    const designationFloor = mode === 'legacy_unclassified' && Number(p.month) > 0
      ? creditPeriodKey(Number(p.academicYear), Number(p.month)) : 0;
    for (const c of chargesByStudent.get(studentId) || []) {
      if (remaining <= 0) break;
      if (c.outstandingCents <= 0) continue;
      if (c.period < designationFloor) continue;
      if (mode === 'specific' && !permitted.has(Number(c.id))) continue;
      if (String(p.currencyCode) !== String(c.currencyCode)) continue;
      if (locked.has(c.period)) { excluded.locked += Math.min(remaining, c.outstandingCents); continue; }
      const existing = allocations.get(`${p.id}:${c.id}`);
      if (existing?.claimed) continue; // Frozen entitlement: never mutate a claimed allocation.
      const cents = Math.min(remaining, c.outstandingCents);
      if (cents <= 0) continue;
      operations.push({ paymentId: Number(p.id), chargeId: Number(c.id), studentId,
        amountCents: cents, serviceYear: Number(c.academicYear), serviceMonth: Number(c.month),
        vehicleId: c.vehicleId == null ? null : Number(c.vehicleId),
        existingAllocationId: existing?.id || null, existingAmountCents: existing?.cents || 0, mode });
      c.outstandingCents -= cents;
      remaining -= cents;
      affected.add(studentId);
      if (existing) existing.cents += cents;
      else allocations.set(`${p.id}:${c.id}`, { id: 0, cents, claimed: false });
    }
    remainingUnallocatedCents += remaining + refundReserve;
  }
  const totalAllocatedCents = operations.reduce((sum, op) => sum + op.amountCents, 0);
  const digest = createHash('sha256').update(JSON.stringify({ schoolId, maxPeriod: options.maxPeriod || 0, includeLegacy: Boolean(options.includeLegacy), operations, excluded, remainingUnallocatedCents })).digest('hex');
  return { operations, excluded, totalAllocatedCents, affectedStudents: [...affected].sort((a,b)=>a-b), remainingUnallocatedCents, digest };
}
