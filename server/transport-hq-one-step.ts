/** HQ one-action settlement: one signed confirmation, one atomic database transaction.
 * Existing HQ claims, payables, payment runs and disbursement tables stay authoritative.
 * No claim is paid by changing a status directly, and preview is read-only.
 */
import type { Express } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { requireAuth, requireAnyPermission } from './auth';
import { cents, currency, distributeToSchoolClaims, effectiveDeductions } from './transport-hq-financials';
import { groupHqClaims } from './transport-hq-settlement-groups';
import {
  schools, transportClaims, transportVehicles, transportDrivers, transportClaimDeductions, transportPayouts,
  transportHqClaims, transportHqClaimItems, transportHqPayouts, transportHqAdvanceRecoveries, transportAdvances,
  transportProviderPaymentRuns, transportProviderPaymentRunItems,
  transportProviderDisbursements, transportProviderDisbursementAllocations,
  transportHqDisbursementClaimAllocations, transportHqSettlementRequests,
} from '@shared/schema';

const centAmount=z.coerce.number().positive().finite().refine(v=>Math.abs(Math.round(v*100)-v*100)<.00001,'Amounts must have no more than two decimal places');
const requestSchema=z.object({
  requestId:z.string().uuid(), vehicleId:z.coerce.number().int().positive(), year:z.coerce.number().int().min(2020).max(2100),month:z.coerce.number().int().min(1).max(12),
  includeProvider:z.boolean().default(false), amount:centAmount,
  paymentDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/), paymentMethod:z.enum(['cash','bank_transfer','mobile_money','other']),
  paymentReference:z.string().trim().min(3).max(160), collectorType:z.enum(['owner','driver','other']),
  collectorDriverId:z.coerce.number().int().positive().nullable().optional(),collectorName:z.string().trim().max(150).nullable().optional(),
  collectorNationalId:z.string().trim().max(100).nullable().optional(),collectorPhone:z.string().trim().max(80).nullable().optional(),
  collectorRole:z.string().trim().max(100).nullable().optional(),notes:z.string().trim().max(2000).nullable().optional(),
  confirmed:z.literal(true),
});
const code=(prefix:string,id:number) => `${prefix}-${id}-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
const err=(message:string,status=409)=>Object.assign(new Error(message),{status});
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];

async function prepareForOneClick(tx:Tx,organizationId:number,userId:number,group:any){
  const sourceClaims=group.claims;
  const claimIds=sourceClaims.map((r:any)=>r.id);
  if(!claimIds.length)throw err('No submitted school claims available.');
  const legacySchoolPayouts=await tx.select().from(transportPayouts).where(inArray(transportPayouts.claimId,claimIds));
  if(legacySchoolPayouts.some(p=>cents(p.amountPaid)>0))throw err('A school-level payout has already been recorded for one of these claims. Resolve the historical settlement before HQ disbursement.');
  const deductions=await tx.select().from(transportClaimDeductions).where(inArray(transportClaimDeductions.claimId,claimIds));
  // A monthly vehicle subscription is never charged once per school. Do not silently alter immutable source claims.
  const subscriptions=new Map<string,number>();
  for(const d of deductions.filter(d=>d.deductionType==='subscription')){
    const claim=sourceClaims.find((r:any)=>r.id===d.claimId);
    const key=`${claim.vehicleId}:${claim.serviceYear}:${claim.serviceMonth}:${d.sourceId||'legacy'}`;
    subscriptions.set(key,(subscriptions.get(key)||0)+1);
  }
  if([...subscriptions.values()].some(n=>n>1))throw err('Duplicate vehicle subscription deductions detected across school claims. Finance must reconcile the submitted claims before payout; no duplicate deduction has been posted.');
  const [old]=await tx.select().from(transportHqClaims).where(and(eq(transportHqClaims.organizationId,organizationId),eq(transportHqClaims.vehicleId,group.vehicleId),eq(transportHqClaims.serviceYear,group.year),eq(transportHqClaims.serviceMonth,group.month)));
  let hq=old;
  if(old){
    const linked=await tx.select().from(transportHqClaimItems).where(eq(transportHqClaimItems.hqClaimId,old.id));
    if(linked.length!==sourceClaims.length||linked.some(i=>!claimIds.includes(i.schoolClaimId)))throw err('Frozen HQ settlement contains a different set of school claims. Refresh: late claims must move to a subsequent open cycle.');
    if(!['approved','paid'].includes(old.status))throw err('An older HQ settlement is awaiting an approval-stage review; resolve the existing record before one-click disbursement.');
  }else{
    const total=(key:'grossAmount'|'deductionAmount'|'netAmount')=>currency(sourceClaims.reduce((s:number,r:any)=>s+cents(r[key]),0));
    [hq]=await tx.insert(transportHqClaims).values({organizationId,vehicleId:group.vehicleId,ownerId:group.ownerId,claimNumber:code('HQCLM',organizationId),serviceYear:group.year,serviceMonth:group.month,
      status:'approved',grossAmount:total('grossAmount'),deductionAmount:total('deductionAmount'),netAmount:total('netAmount'),snapshot:{automaticallyPrepared:true,schoolClaimIds:claimIds,confirmedByUserId:userId,sourceServicePeriods:sourceClaims.map((c:any)=>({claimId:c.id,year:c.serviceYear,month:c.serviceMonth}))},preparedByUserId:userId,approvedByUserId:userId,approvedAt:new Date()}).returning();
    await tx.insert(transportHqClaimItems).values(sourceClaims.map((r:any)=>({hqClaimId:hq.id,schoolClaimId:r.id,schoolId:r.schoolId,grossAmount:r.grossAmount,deductionAmount:r.deductionAmount,netAmount:r.netAmount})));
  }
  let [payout]=await tx.select().from(transportHqPayouts).where(eq(transportHqPayouts.hqClaimId,hq.id));
  if(!payout){[payout]=await tx.insert(transportHqPayouts).values({organizationId,hqClaimId:hq.id,ownerId:group.ownerId,payoutNumber:code('HQPAY',organizationId),status:'not_paid',netAmount:hq.netAmount,amountPaid:'0',generatedByUserId:userId}).returning()}
  if(cents(payout.netAmount)!==cents(hq.netAmount))throw err('Payable amount does not match the approved HQ claim. Investigate rather than silently changing it.');
  return payout;
}

async function applyProviderAdvanceOffsets(tx:Tx,group:any,hqClaimId:number) {
  const claimIds=group.claims.map((r:any)=>r.id);
  const deductions=await tx.select().from(transportClaimDeductions).where(inArray(transportClaimDeductions.claimId,claimIds));
  // Recover posted advance principal ONCE when the offset becomes effective. Never recognize it as revenue.
  // If a prior HQ payout exists, only source deductions not previously recorded are eligible.
  for(const claim of group.claims){
    const claimDeductions=deductions.filter(d=>d.claimId===claim.id);
    const effective=effectiveDeductions(claimDeductions.map(d=>({id:d.id,deductionType:d.deductionType,sourceId:d.sourceId,description:d.description,amount:d.amount,priority:d.priority})),claim.deductionAmount);
    for(const d of effective.filter(d=>d.category==='advance_recovery'&&d.effectiveCents>0)){
      if(!d.sourceId)throw err('An advance deduction has no linked advance record.');
      const [recorded]=await tx.select().from(transportHqAdvanceRecoveries).where(eq(transportHqAdvanceRecoveries.claimDeductionId,d.id));
      if(recorded)continue;
      await tx.execute(sql`SELECT id FROM transport_advances WHERE id=${d.sourceId} FOR UPDATE`);
      const [advance]=await tx.select().from(transportAdvances).where(eq(transportAdvances.id,d.sourceId));
      if(!advance||advance.vehicleId!==claim.vehicleId||advance.schoolId!==claim.schoolId)throw err('Advance deduction is not linked to the correct provider, vehicle and school.');
      if(cents(advance.outstandingAmount)<d.effectiveCents)throw err('Advance principal has already been recovered or repaid. The frozen deduction must be reconciled before payout.');
      await tx.insert(transportHqAdvanceRecoveries).values({advanceId:advance.id,claimDeductionId:d.id,hqClaimId:hqClaimId,amount:currency(d.effectiveCents)});
      const remaining=cents(advance.outstandingAmount)-d.effectiveCents;
      await tx.update(transportAdvances).set({outstandingAmount:currency(remaining),status:remaining===0?'settled':'recovering'}).where(eq(transportAdvances.id,advance.id));
    }
  }
}

export function registerOneStepHqTransportDisbursements(app:Express){
 app.post('/api/hq/transport/settlements/disburse',requireAuth,requireAnyPermission('transport.hq.disbursements.manage','transport.organization.manage'),async(req,res)=>{
  try{
   const user=req.user as {id:number;role?:string;organizationId?:number|null};
   if(user?.role!=='org_admin'||!user.organizationId)return res.status(403).json({message:'HQ transport context required.'});
   const input=requestSchema.parse(req.body), organizationId=user.organizationId;
   const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
   const output=await db.transaction(async(tx)=>{
    // All new one-click settlements for this organisation are serialized; existing runs also receive row locks.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(302819,${organizationId})`);
    const [newRequest]=await tx.insert(transportHqSettlementRequests).values({requestId:input.requestId,organizationId,userId:user.id,requestHash:hash}).onConflictDoNothing().returning();
    if(!newRequest){
      const [previous]=await tx.select().from(transportHqSettlementRequests).where(eq(transportHqSettlementRequests.requestId,input.requestId));
      if(!previous||previous.organizationId!==organizationId||previous.requestHash!==hash||!previous.result)throw err('Payment request ID has already been used with different details.');
      return previous.result;
    }
    const orgSchools=await tx.select({id:schools.id}).from(schools).where(eq(schools.organizationId,organizationId));
    const ids=orgSchools.map(s=>s.id);
    if(!ids.length)throw err('No schools are configured for this organisation.');
    const vehicles=await tx.select().from(transportVehicles).where(inArray(transportVehicles.schoolId,ids));
    const selectedVehicle=vehicles.find(v=>v.id===input.vehicleId);
    if(!selectedVehicle||!selectedVehicle.ownerId)throw err('Vehicle/provider is not available in this organisation.');
    const ownerId=selectedVehicle.ownerId;
    const source=await tx.select().from(transportClaims).where(and(inArray(transportClaims.schoolId,ids),inArray(transportClaims.status,['submitted','verified','approved','paid'])));
    const hq=await tx.select().from(transportHqClaims).where(eq(transportHqClaims.organizationId,organizationId));
    const hqIds=hq.map(x=>x.id),links=hqIds.length?await tx.select().from(transportHqClaimItems).where(inArray(transportHqClaimItems.hqClaimId,hqIds)):[];
    const linkMap=new Map(links.map(x=>[x.schoolClaimId,x.hqClaimId]));
    const payoutRows=await tx.select().from(transportHqPayouts).where(eq(transportHqPayouts.organizationId,organizationId));
    const payoutByHq=new Map(payoutRows.map(x=>[x.hqClaimId,x]));
    const attributed=source.length?await tx.select().from(transportHqDisbursementClaimAllocations).where(inArray(transportHqDisbursementClaimAllocations.schoolClaimId,source.map(c=>c.id))):[];
    const paidBySource=new Map<number,number>();for(const a of attributed)paidBySource.set(a.schoolClaimId,(paidBySource.get(a.schoolClaimId)||0)+cents(a.amount));
    const payoutClaimCounts=new Map<number,number>();for(const l of links)payoutClaimCounts.set(l.hqClaimId,(payoutClaimCounts.get(l.hqClaimId)||0)+1);
    const groups=groupHqClaims(source.map(c=>{
       const hqId=linkMap.get(c.id)||0,payout=payoutByHq.get(hqId);const tracked=paidBySource.get(c.id)||0;
       const isComplete=Boolean(payout && cents(payout.amountPaid)>=cents(payout.netAmount));
       const legacySingle=Boolean(payout && payoutClaimCounts.get(hqId)===1 && cents(payout.amountPaid)>tracked);
       const unattributed=Boolean(payout && !isComplete && (payoutClaimCounts.get(hqId)||0)>1 && cents(payout.amountPaid)>links.filter(l=>l.hqClaimId===hqId).reduce((sum,l)=>sum+(paidBySource.get(l.schoolClaimId)||0),0));
       return {...c,hqClaimId:hqId||null,paidAmount:isComplete?Number(c.netAmount):Number(currency(legacySingle?cents(payout!.amountPaid):tracked)),hasLegacyUnattributedPayment:unattributed};
    }),hq);
    // Calculate target groups explicitly; no implicit selection of a different owner.
    const selected=groups.find(g=>g.vehicleId===input.vehicleId&&g.year===input.year&&g.month===input.month);
    if(selected?.hasLegacyUnattributedPayment)throw err('Historical payouts require school-level attribution before another disbursement.');
    if(!selected)throw err('This vehicle/settlement cycle has no submitted claims. Refresh the HQ page.');
    const candidates=input.includeProvider?groups.filter(g=>g.ownerId===ownerId&&!g.hasLegacyUnattributedPayment):[selected];
    const openGroups=candidates.filter(g=>g.claims.some(c=>!linkMap.has(c.id))||g.claims.some(c=>{
      const payout=payoutByHq.get(linkMap.get(c.id)||0);
      return payout && cents(payout.amountPaid)<cents(payout.netAmount);
    }));
    if(!openGroups.length)throw err('The selected provider claims have already been fully settled.');
    const paidGroups=[] as Array<{group:any;payout:any;remaining:number}>;
    for(const group of openGroups){
      if(group.ownerId!==ownerId)throw err('Cross-provider settlement is not permitted.');
      const payout=await prepareForOneClick(tx,organizationId,user.id,group);
      const remaining=cents(payout.netAmount)-cents(payout.amountPaid);
      if(remaining>0)paidGroups.push({group,payout,remaining});
    }
    const available=paidGroups.reduce((s,x)=>s+x.remaining,0);
    if(cents(input.amount)>available)throw err(`Payment exceeds the current confirmed outstanding entitlement (${currency(available)}). Refresh and retry.`);
    if(!paidGroups.length)throw err('No payable amounts remain. Zero-value claims do not require fictitious cash disbursements.');
    const drivers=await tx.select().from(transportDrivers).where(inArray(transportDrivers.schoolId,ids));
    if(input.collectorType==='driver' && !drivers.some(d=>d.id===input.collectorDriverId&&d.ownerId===ownerId))throw err('Selected driver is not linked to the provider.');
    if(input.collectorType==='other' &&(!input.collectorName||!input.collectorNationalId))throw err('Authorised representative name and National ID are required.');
    if(input.paymentMethod==='cash'&&input.collectorType==='other'&&!input.collectorPhone)throw err('A contact phone is required for an external cash collector.');
    let toPay=cents(input.amount);
    const allocations=[] as Array<{payout:any;group:any;amountCents:number}>;
    for(const x of paidGroups){const take=Math.min(toPay,x.remaining);if(take)allocations.push({payout:x.payout,group:x.group,amountCents:take});toPay-=take;if(!toPay)break;}
    if(toPay!==0)throw err('Insufficient payable entitlement.');
    const priorItems=await tx.select().from(transportProviderPaymentRunItems).where(inArray(transportProviderPaymentRunItems.payoutId,allocations.map(x=>x.payout.id)));
    const byPayout=new Map(priorItems.map(x=>[x.payoutId,x]));
    const newAllocations=allocations.filter(x=>!byPayout.has(x.payout.id));
    if(newAllocations.length){
      const newRunTotal=newAllocations.reduce((sum,x)=>sum+cents(x.payout.netAmount)-cents(x.payout.amountPaid),0);
      const [run]=await tx.insert(transportProviderPaymentRuns).values({organizationId,ownerId,runNumber:code('PAYRUN',organizationId),serviceYear:allocations.every(x=>x.group.year===allocations[0].group.year)?allocations[0].group.year:null,serviceMonth:allocations.every(x=>x.group.month===allocations[0].group.month)?allocations[0].group.month:null,status:'open',totalDue:currency(newRunTotal),amountPaid:'0',notes:'Automatic preparation on authorised HQ disbursement',createdByUserId:user.id}).returning();
      const inserted=await tx.insert(transportProviderPaymentRunItems).values(newAllocations.map(x=>({runId:run.id,payoutId:x.payout.id,amountDue:currency(cents(x.payout.netAmount)-cents(x.payout.amountPaid))}))).returning();
      for(const item of inserted)byPayout.set(item.payoutId,item);
    }
    // Advance principal becomes recovered only for payables actually included in this signed disbursement.
    // Never consume an advance on an unrelated prepared-but-unpaid provider claim.
    for(const allocation of allocations)await applyProviderAdvanceOffsets(tx,allocation.group,allocation.payout.hqClaimId);
    const runGroups=new Map<number,typeof allocations>();
    for(const a of allocations){const item=byPayout.get(a.payout.id)!;runGroups.set(item.runId,[...(runGroups.get(item.runId)||[]),a]);}
    const disbursements=[] as Array<{id:number;number:string;amount:string}>;
    for(const [runId,selectedAllocations] of runGroups){
      await tx.execute(sql`SELECT id FROM transport_provider_payment_runs WHERE id=${runId} FOR UPDATE`);
      const [run]=await tx.select().from(transportProviderPaymentRuns).where(eq(transportProviderPaymentRuns.id,runId));
      if(!run||run.organizationId!==organizationId||run.ownerId!==ownerId||run.status==='paid')throw err('Provider payment run has changed. Refresh and retry.');
      const itemIds=selectedAllocations.map(a=>byPayout.get(a.payout.id)!.id);
      const prior=await tx.select().from(transportProviderDisbursementAllocations).where(inArray(transportProviderDisbursementAllocations.runItemId,itemIds));
      for(const a of selectedAllocations){
        const item=byPayout.get(a.payout.id)!;
        const paid=prior.filter(p=>p.runItemId===item.id).reduce((sum,p)=>sum+cents(p.amount),0);
        if(a.amountCents>cents(item.amountDue)-paid)throw err('Payment run has a newer disbursement. Refresh and retry.');
      }
      const groupTotal=selectedAllocations.reduce((sum,a)=>sum+a.amountCents,0);
      const [disb]=await tx.insert(transportProviderDisbursements).values({runId,disbursementNumber:code('DISB',organizationId),amount:currency(groupTotal),paymentDate:input.paymentDate,paymentMethod:input.paymentMethod,paymentReference:input.paymentReference,
        collectorType:input.collectorType,collectorOwnerId:input.collectorType==='owner'?ownerId:null,collectorDriverId:input.collectorType==='driver'?input.collectorDriverId:null,
        collectorName:input.collectorType==='other'?input.collectorName:null,collectorNationalId:input.collectorNationalId||null,collectorPhone:input.collectorPhone||null,collectorRole:input.collectorRole||null,
        notes:`${input.notes||''}\nHQ authenticated sign-off by user ${user.id}; request ${input.requestId}`.trim(),processedByUserId:user.id}).returning();
      await tx.insert(transportProviderDisbursementAllocations).values(selectedAllocations.map(a=>({disbursementId:disb.id,runItemId:byPayout.get(a.payout.id)!.id,amount:currency(a.amountCents)})));
      for(const a of selectedAllocations){
        const items=await tx.select().from(transportHqClaimItems).where(eq(transportHqClaimItems.hqClaimId,a.payout.hqClaimId));
        const previous=await tx.select().from(transportHqDisbursementClaimAllocations).where(inArray(transportHqDisbursementClaimAllocations.schoolClaimId,items.map(i=>i.schoolClaimId)));
        const oldClaimPaid=cents(a.payout.amountPaid)-previous.reduce((sum,p)=>sum+cents(p.amount),0);
        if(oldClaimPaid>0&&items.length>1)throw err('Historical multi-school partial settlement lacks school-level attribution. Investigate it before recording another payment.');
        const perClaim=distributeToSchoolClaims(a.amountCents,items.map(i=>({schoolClaimId:i.schoolClaimId,netCents:cents(i.netAmount),recordedPaidCents:previous.filter(p=>p.schoolClaimId===i.schoolClaimId).reduce((sum,p)=>sum+cents(p.amount),0)+(items.length===1?Math.max(0,oldClaimPaid):0)})));
        await tx.insert(transportHqDisbursementClaimAllocations).values(perClaim.map(p=>({disbursementId:disb.id,schoolClaimId:p.schoolClaimId,amount:currency(p.amountCents)})));
        const paid=cents(a.payout.amountPaid)+a.amountCents;
        const full=paid>=cents(a.payout.netAmount);
        await tx.update(transportHqPayouts).set({amountPaid:currency(paid),status:full?'paid':'partially_paid',updatedAt:new Date()}).where(eq(transportHqPayouts.id,a.payout.id));
        if(full){await tx.update(transportHqClaims).set({status:'paid',updatedAt:new Date()}).where(eq(transportHqClaims.id,a.payout.hqClaimId));await tx.update(transportClaims).set({status:'paid'}).where(inArray(transportClaims.id,items.map(x=>x.schoolClaimId)));}
      }
      const runPaid=cents(run.amountPaid)+groupTotal;const completed=runPaid>=cents(run.totalDue);
      await tx.update(transportProviderPaymentRuns).set({amountPaid:currency(runPaid),status:completed?'paid':'partially_paid',updatedAt:new Date()}).where(eq(transportProviderPaymentRuns.id,runId));
      disbursements.push({id:disb.id,number:disb.disbursementNumber,amount:currency(groupTotal)});
    }
    const result={requestId:input.requestId,providerId:ownerId,amount:currency(cents(input.amount)),disbursements,recordedByUserId:user.id,recordedAt:new Date().toISOString()};
    await tx.update(transportHqSettlementRequests).set({result}).where(eq(transportHqSettlementRequests.requestId,input.requestId));
    return result;
   });
   res.status(201).json(output);
  }catch(e){const status=typeof (e as any)?.status==='number'?(e as any).status:400;res.status(status).json({message:e instanceof Error?e.message:'Unable to disburse provider settlement'});}
 });
}
