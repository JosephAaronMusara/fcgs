/** Transport settlement schedule. All deadlines are local to Africa/Harare.
 * Saturdays and Sundays are not working days. Holidays are intentionally not yet considered.
 * Applicable rules are snapshotted at school claim submission; changing rules cannot rewrite submitted settlements.
 */
export type SettlementPolicy = {
  paymentDaysBeforeEnd: number;
  claimDaysBeforeEnd: number;
  paymentCutoffTime: string;
  claimCutoffTime: string;
  effectiveFrom: string;
};
export const DEFAULT_SETTLEMENT_POLICY: SettlementPolicy = {
  paymentDaysBeforeEnd: 1, claimDaysBeforeEnd: 0,
  paymentCutoffTime: '23:59', claimCutoffTime: '23:59',
  effectiveFrom: '2026-11-01',
};
export const localHarare = (date: Date) => new Intl.DateTimeFormat('en-CA', {timeZone:'Africa/Harare', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).reduce((acc:Record<string,string>,x) => {if(x.type!=='literal') acc[x.type]=x.value;return acc;},{});
export function previousWorkingDay(date: Date, count = 0): Date {
  if (!Number.isInteger(count) || count < 0 || count > 20) throw new Error('Invalid working-day offset');
  const d = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
  while ([0,6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate()-1);
  for (let i=0;i<count;i++) { do {d.setUTCDate(d.getUTCDate()-1)} while([0,6].includes(d.getUTCDay())); }
  return d;
}
export function deadlineFor(year:number, month:number, workingDaysBeforeEnd:number, time:string) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month<1 || month>12 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Invalid settlement deadline inputs');
  const last = new Date(Date.UTC(year,month,0));
  const day = previousWorkingDay(last,workingDaysBeforeEnd).toISOString().slice(0,10);
  return `${day}T${time}:00+02:00`;
}
export function followingCycle(year:number,month:number) {return month===12?{year:year+1,month:1}:{year,month:month+1};}
export function cycleForClaim(serviceYear:number,serviceMonth:number,submittedAt: Date, policy:SettlementPolicy) {
  const claimDeadline = deadlineFor(serviceYear,serviceMonth,policy.claimDaysBeforeEnd,policy.claimCutoffTime);
  const applicable = `${serviceYear}-${String(serviceMonth).padStart(2,'0')}-01` >= policy.effectiveFrom.slice(0,7)+'-01';
  return applicable && submittedAt.getTime()>Date.parse(claimDeadline) ? followingCycle(serviceYear,serviceMonth) : {year:serviceYear,month:serviceMonth};
}
export function paymentEligibleForCycle(paymentDate:string, paymentCreatedAt:Date|null, serviceYear:number, serviceMonth:number, cycleYear:number,cycleMonth:number,claimSubmittedAt:Date|null,policy:SettlementPolicy) {
  if (`${serviceYear}-${String(serviceMonth).padStart(2,'0')}-01` < policy.effectiveFrom.slice(0,7)+'-01') return true;
  const current = cycleYear === serviceYear && cycleMonth === serviceMonth;
  if (!current) return true; // Old-service allocations remain eligible for a subsequent open cycle only.
  if (paymentDate > deadlineFor(serviceYear,serviceMonth,policy.paymentDaysBeforeEnd,policy.paymentCutoffTime).slice(0,10)) return false;
  return !claimSubmittedAt || !paymentCreatedAt || paymentCreatedAt.getTime() <= claimSubmittedAt.getTime();
}
