/** Pure arithmetic for transport income and claim-level settlement attribution.
 * Units are integer cents; never infer income from cash still held for a provider.
 */
export type IncomeClass = 'subscription' | 'penalty' | 'administration' | 'other_income' | 'advance_recovery' | 'refund_recovery' | 'unclassified';
export const cents = (value: unknown) => Math.round(Number(value || 0) * 100);
export const currency = (value: number) => (value / 100).toFixed(2);

const OTHER_EARNED = new Set(['admin_fee','administration_fee','management_fee','service_fee','other_income','earned_fee']);
export function classifyTransportDeduction(deductionType: string, adjustmentType?: string | null): IncomeClass {
  switch (deductionType) {
    case 'subscription': return 'subscription';
    case 'penalty': return 'penalty';
    case 'advance': return 'advance_recovery';
    case 'refund': return 'refund_recovery';
    case 'other':
      if (adjustmentType && OTHER_EARNED.has(adjustmentType)) return adjustmentType === 'other_income' ? 'other_income' : 'administration';
      return 'unclassified';
    default: return 'unclassified';
  }
}
export const isEarnedClass = (category: IncomeClass) => ['subscription','penalty','administration','other_income'].includes(category);

export type ChargeDeduction = {id:number; deductionType:string; sourceId:number|null; description:string; amount:unknown; priority:number; adjustmentType?:string|null};
/** A claim can cap its overall deductions to gross. Allocate the posted cap in priority order. */
export function effectiveDeductions(deductions: ChargeDeduction[], postedTotal: unknown) {
  let remaining = Math.max(0, cents(postedTotal));
  return [...deductions].sort((a,b) => a.priority-b.priority || a.id-b.id).map(row => {
    const raw = Math.max(0,cents(row.amount));
    const realized = Math.min(remaining,raw);
    remaining -= realized;
    return {...row, effectiveCents:realized, category:classifyTransportDeduction(row.deductionType,row.adjustmentType)};
  });
}
/** Disbursements are attributed to school claims in a stable sequence and recorded durably.
 * Existing legacy un-attributed disbursements are NOT rewritten or guessed.
 */
export function distributeToSchoolClaims(amountCents: number, claims: Array<{schoolClaimId:number; netCents:number; recordedPaidCents:number}>) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error('Invalid disbursement amount');
  let pending = amountCents;
  const result: Array<{schoolClaimId:number; amountCents:number}> = [];
  for (const row of [...claims].sort((a,b)=>a.schoolClaimId-b.schoolClaimId)) {
    const due = Math.max(0,row.netCents-row.recordedPaidCents);
    const amount = Math.min(pending,due);
    if (amount) result.push({schoolClaimId:row.schoolClaimId,amountCents:amount});
    pending -= amount;
    if (!pending) break;
  }
  if (pending > 0) throw new Error('School claim entitlements insufficient for payout allocation');
  return result;
}
