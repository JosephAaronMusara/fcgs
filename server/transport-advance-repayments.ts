/** Direct repayment of an advance is repayment of principal, NOT transport revenue.
 * Cash receipts must be attached to an HQ-confirmed Transport cash-up before Accounts verification.
 * Bank/mobile transfers require independent Accounts verification with documentary reference.
 */
import type {Express} from 'express';
import {z} from 'zod';
import {and,eq,inArray,sql} from 'drizzle-orm';
import {db} from './db';
import {requireAuth,requireAnyPermission} from './auth';
import {schools,transportAdvances,transportAdvanceRepayments,transportCashups} from '@shared/schema';
import {cents,currency} from './transport-hq-financials';

const money=z.coerce.number().finite().positive().refine(v=>Math.abs(Math.round(v*100)-v*100)<.00001);
const input=z.object({amount:money,paymentDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),paymentMethod:z.enum(['cash','bank_transfer','mobile_money','other']),paymentReference:z.string().trim().min(3).max(160),notes:z.string().trim().max(2000).optional()});
const error=(m:string,status=409)=>Object.assign(new Error(m),{status});

export function registerTransportAdvanceRepaymentRoutes(app:Express) {
  const schoolFor=async(req:any)=>{
    const u=req.user as {id:number;role:string;schoolId?:number|null;organizationId?:number|null};
    const schoolId=Number(req.headers['x-school-id']||u.schoolId||0);
    if(!schoolId)return null;
    const [s]=await db.select().from(schools).where(eq(schools.id,schoolId));
    if(!s || (u.organizationId && s.organizationId!==u.organizationId) || (u.role!=='org_admin' && Number(u.schoolId)!==schoolId))return null;
    return {school:s,user:u};
  };
  app.get('/api/transport/advances/repayments',requireAuth,requireAnyPermission('transport.advances.request','transport.advances.repayments.record','transport.advances.repayments.verify','transport.advances.approve'),async(req,res)=>{
    try {const ctx=await schoolFor(req);if(!ctx)return res.status(403).json({message:'School context required'});
      const rows=await db.select().from(transportAdvanceRepayments).where(eq(transportAdvanceRepayments.schoolId,ctx.school.id));res.json(rows);
    }catch(e){res.status(400).json({message:e instanceof Error?e.message:'Unable to load repayments'});}
  });
  app.post('/api/transport/advances/:id/repayments',requireAuth,requireAnyPermission('transport.advances.repayments.record'),async(req,res)=>{
    try{const ctx=await schoolFor(req);if(!ctx)return res.status(403).json({message:'School context required'});
      const values=input.parse(req.body);
      const [advance]=await db.select().from(transportAdvances).where(and(eq(transportAdvances.id,Number(req.params.id)),eq(transportAdvances.schoolId,ctx.school.id)));
      if(!advance||!['disbursed','recovering'].includes(advance.status))return res.status(409).json({message:'Advance must be disbursed and still outstanding.'});
      if(cents(values.amount)>cents(advance.outstandingAmount))return res.status(409).json({message:'Repayment exceeds the outstanding advance principal.'});
      const [row]=await db.insert(transportAdvanceRepayments).values({advanceId:advance.id,schoolId:ctx.school.id,amount:currency(cents(values.amount)),paymentDate:values.paymentDate,paymentMethod:values.paymentMethod,paymentReference:values.paymentReference,notes:values.notes||null,recordedByUserId:ctx.user.id}).returning();
      res.status(201).json(row);
    }catch(e){res.status(400).json({message:e instanceof Error?e.message:'Unable to record direct repayment'});}
  });
  app.post('/api/transport/advances/repayments/:id/verify',requireAuth,requireAnyPermission('transport.advances.repayments.verify'),async(req,res)=>{
    try{const ctx=await schoolFor(req);if(!ctx)return res.status(403).json({message:'School context required'});
      const proof=z.object({verificationNotes:z.string().trim().min(5).max(2000)}).parse(req.body);
      const result=await db.transaction(async(tx)=>{
        const id=Number(req.params.id);
        await tx.execute(sql`SELECT id FROM transport_advance_repayments WHERE id=${id} FOR UPDATE`);
        const [repayment]=await tx.select().from(transportAdvanceRepayments).where(and(eq(transportAdvanceRepayments.id,id),eq(transportAdvanceRepayments.schoolId,ctx.school.id)));
        if(!repayment||repayment.status!=='pending')throw error('Repayment is no longer awaiting verification.');
        if(repayment.recordedByUserId===ctx.user.id)throw error('A repayment cannot be verified by the person who recorded it.',403);
        if(repayment.paymentMethod==='cash'){
          if(!repayment.cashupId)throw error('Cash repayment must first be included in a school cash-up and confirmed by HQ.');
          const [cashup]=await tx.select().from(transportCashups).where(and(eq(transportCashups.id,repayment.cashupId),eq(transportCashups.schoolId,ctx.school.id)));
          if(!cashup||cashup.status!=='hq_confirmed'||!cashup.hqConfirmedAt)throw error('Linked cash-up has not been fully verified and confirmed by HQ.');
          if(cashup.cashierUserId===ctx.user.id)throw error('Cashier cannot verify their own cash repayment.');
        }
        await tx.execute(sql`SELECT id FROM transport_advances WHERE id=${repayment.advanceId} FOR UPDATE`);
        const [advance]=await tx.select().from(transportAdvances).where(eq(transportAdvances.id,repayment.advanceId));
        if(!advance||!['disbursed','recovering'].includes(advance.status))throw error('Advance cannot accept recovery.');
        const current=cents(advance.outstandingAmount),received=cents(repayment.amount);
        if(received>current)throw error('Repayment exceeds remaining advance principal; investigate any intervening payout recoveries.');
        const remaining=current-received;
        await tx.update(transportAdvances).set({outstandingAmount:currency(remaining),status:remaining===0?'settled':'recovering'}).where(eq(transportAdvances.id,advance.id));
        const [verified]=await tx.update(transportAdvanceRepayments).set({status:'verified',verifiedByUserId:ctx.user.id,verifiedAt:new Date(),notes:[repayment.notes,`[Accounts verified] ${proof.verificationNotes}`].filter(Boolean).join('\n')}).where(eq(transportAdvanceRepayments.id,id)).returning();
        return {repayment:verified,advanceOutstanding:currency(remaining)};
      });res.json(result);
    }catch(e){res.status((e as any)?.status||400).json({message:e instanceof Error?e.message:'Unable to verify repayment'});}
  });
  app.post('/api/transport/advances/repayments/:id/reject',requireAuth,requireAnyPermission('transport.advances.repayments.verify'),async(req,res)=>{
    try{const ctx=await schoolFor(req);if(!ctx)return res.status(403).json({message:'School context required'});
      const reason=z.object({reason:z.string().trim().min(5)}).parse(req.body).reason;
      const record=await db.transaction(async(tx)=>{
        const id=Number(req.params.id);
        await tx.execute(sql`SELECT id FROM transport_advance_repayments WHERE id=${id} FOR UPDATE`);
        const [prior]=await tx.select().from(transportAdvanceRepayments).where(and(eq(transportAdvanceRepayments.id,id),eq(transportAdvanceRepayments.schoolId,ctx.school.id)));
        if(!prior || prior.status!=='pending')throw error('Repayment is no longer pending.');
        if(prior.recordedByUserId===ctx.user.id)throw error('Recorder cannot reject their own repayment.',403);
        if(prior.cashupId){const [cashup]=await tx.select().from(transportCashups).where(eq(transportCashups.id,prior.cashupId));if(cashup&&cashup.status!=='discarded')throw error('A linked cash-up must first be reconciled or corrected; repayment cannot be rejected independently.');}
        const [rejected]=await tx.update(transportAdvanceRepayments).set({status:'rejected',rejectionReason:reason,verifiedByUserId:ctx.user.id,verifiedAt:new Date()}).where(eq(transportAdvanceRepayments.id,id)).returning();
        return rejected;
      });
      res.json(record);
    }catch(e){res.status((e as any)?.status||400).json({message:e instanceof Error?e.message:'Unable to reject repayment'});}
  });
}
