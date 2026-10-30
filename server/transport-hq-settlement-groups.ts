/** Groups school claims by vehicle and actual HQ settlement cycle, without mutating source claims.
 * Late claims are deferred past an already-frozen vehicle/cycle settlement.
 */
export type SchoolClaimView = {
  id:number; vehicleId:number; ownerId:number|null; serviceYear:number;serviceMonth:number;
  settlementYear?:number|null;settlementMonth?:number|null;status:string;
  hqClaimId?:number|null;grossAmount:string|number;deductionAmount:string|number;netAmount:string|number;
  paidAmount?:number;hasLegacyUnattributedPayment?:boolean;
};
export type HqClaimView={id:number;vehicleId:number;serviceYear:number;serviceMonth:number;status:string};
export const nextCycle=(year:number,month:number) => month===12?{year:year+1,month:1}:{year,month:month+1};
export function groupHqClaims(claims:SchoolClaimView[], hqClaims:HqClaimView[]) {
  const frozen = new Map(hqClaims.map(r=>[`${r.vehicleId}:${r.serviceYear}:${r.serviceMonth}`,r]));
  const groups=new Map<string,{vehicleId:number;ownerId:number|null;year:number;month:number;claims:SchoolClaimView[]}>();
  for(const row of claims) {
    if(!['submitted','verified','approved','paid'].includes(row.status)) continue;
    const linked = row.hqClaimId ? hqClaims.find(h=>h.id===row.hqClaimId) : undefined;
    let cycle = linked?{year:linked.serviceYear,month:linked.serviceMonth}:{year:row.settlementYear||row.serviceYear,month:row.settlementMonth||row.serviceMonth};
    if(!linked) {
      // An old approved/frozen payout cannot be silently reopened. Schedule in next available cycle.
      for(let i=0;i<48;i++) {
        const old=frozen.get(`${row.vehicleId}:${cycle.year}:${cycle.month}`);
        if(!old)break;
        if(i===47)throw new Error('Could not find an open vehicle settlement cycle');
        cycle=nextCycle(cycle.year,cycle.month);
      }
    }
    const key=`${row.vehicleId}:${cycle.year}:${cycle.month}`;
    let group=groups.get(key);
    if(!group){group={vehicleId:row.vehicleId,ownerId:row.ownerId,year:cycle.year,month:cycle.month,claims:[]};groups.set(key,group)}
    if (group.ownerId!==row.ownerId) throw new Error(`Conflicting owners for vehicle ${row.vehicleId} settlement ${cycle.year}-${cycle.month}`);
    group.claims.push(row);
  }
  return [...groups.values()].sort((a,b)=>b.year-a.year||b.month-a.month||a.vehicleId-b.vehicleId).map(g=>{
    const sum=(field:'grossAmount'|'deductionAmount'|'netAmount')=>Math.round(g.claims.reduce((n,r)=>n+Math.round(Number(r[field])*100),0))/100;
    const paid=Math.round(g.claims.reduce((n,r)=>n+Math.round(Number(r.paidAmount||0)*100),0))/100;
    const hasLegacyUnattributedPayment=g.claims.some(x=>x.hasLegacyUnattributedPayment);
    const outstanding=Math.max(0,Math.round((sum('netAmount')-paid)*100)/100);
    const stage=hasLegacyUnattributedPayment?'review_required':outstanding===0?(sum('netAmount')===0?'settled_no_payment_required':'paid'):paid>0?'partially_paid':'submitted';
    return {...g,id:`${g.vehicleId}:${g.year}:${g.month}`,schoolCount:g.claims.length,
      grossAmount:sum('grossAmount'),deductionAmount:sum('deductionAmount'),netAmount:sum('netAmount'),paidAmount:paid,outstanding,
      hasLegacyUnattributedPayment,stage};
  });
}
