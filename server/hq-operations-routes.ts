import type { Express, Request, Response } from "express";
import { cents, currency, effectiveDeductions, isEarnedClass, distributeToSchoolClaims } from "./transport-hq-financials";
import { groupHqClaims } from "./transport-hq-settlement-groups";
import { registerOneStepHqTransportDisbursements } from "./transport-hq-one-step";
import { DEFAULT_SETTLEMENT_POLICY, deadlineFor } from "./transport-settlement-calendar";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { requireAnyPermission, requireAuth, requirePermission } from "./auth";
import { renderHtmlPdf, reportPdfFilename } from "./pdf-renderer";
import {
  schools,
  transportAssignments,
  transportCharges,
  transportCashups,
  transportClaims,
  transportDrivers,
  transportHqClaimItems,
  transportHqDisbursementClaimAllocations,
  transportClaimDeductions,
  transportProviderAdjustments,
  transportHqClaims,
  transportHqPayouts,
  transportIncidents,
  transportOwners,
  transportPayments,
  transportPeriodLocks,
  transportProviderDisbursementAllocations,
  transportProviderDisbursements,
  transportProviderPaymentRunItems,
  transportProviderPaymentRuns,
  transportRoutes,
  transportSubscriptionPolicies,
  transportOrganizationSettings,
  transportVehicles,
  users,
} from "@shared/schema";

type HqUser = { id: number; role?: string; organizationId?: number | null; username?: string | null };

const monthSchema = z.coerce.number().int().min(1).max(12);
const moneySchema = z.coerce.number().finite().positive();

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function rounded(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char] || char));
}
function requireHqUser(req: Request) {
  const user = req.user as HqUser;
  if (user?.role !== "org_admin" || !user.organizationId) throw new Error("HQ organisation context is required");
  return user;
}
function periodKey(year: number, month: number) { return year * 100 + month; }
function numberCode(prefix: string, organizationId: number) {
  return `${prefix}-${organizationId}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(2, 14)}-${Math.floor(Math.random() * 900 + 100)}`;
}

async function orgSchoolRows(organizationId: number) {
  return db.select({ id: schools.id, name: schools.name, shortCode: schools.shortCode, enableTransport: schools.enableTransport, terminationStatus: schools.terminationStatus, archivedAt: schools.archivedAt })
    .from(schools).where(eq(schools.organizationId, organizationId)).orderBy(asc(schools.name));
}

async function buildTransportOverview(organizationId: number) {
  const orgSchools = await orgSchoolRows(organizationId);
  const activeSchools = orgSchools.filter((school) => !school.archivedAt && school.terminationStatus !== "pending");
  const schoolIds = activeSchools.map((school) => school.id);
  if (!schoolIds.length) return { summary: { schoolsOperating: 0, activeRoutes: 0, activeVehicles: 0, activeLearners: 0, totalCharges: 0, totalCollections: 0, outstandingBalance: 0, collectionRate: 0, openIncidents: 0, openClaims: 0, complianceWarnings: 0 }, schools: [], alerts: [], generatedAt: new Date().toISOString() };

  const [routes, vehicles, assignments, charges, payments, incidents, claims] = await Promise.all([
    db.select().from(transportRoutes).where(inArray(transportRoutes.schoolId, schoolIds)),
    db.select().from(transportVehicles).where(inArray(transportVehicles.schoolId, schoolIds)),
    db.select().from(transportAssignments).where(inArray(transportAssignments.schoolId, schoolIds)),
    db.select().from(transportCharges).where(inArray(transportCharges.schoolId, schoolIds)),
    db.select().from(transportPayments).where(inArray(transportPayments.schoolId, schoolIds)),
    db.select().from(transportIncidents).where(inArray(transportIncidents.schoolId, schoolIds)),
    db.select().from(transportClaims).where(inArray(transportClaims.schoolId, schoolIds)),
  ]);
  const todayText = new Date().toISOString().slice(0, 10);
  const warningCutoff = new Date(); warningCutoff.setDate(warningCutoff.getDate() + 30);

  const schoolRows = activeSchools.map((school) => {
    const schoolRoutes = routes.filter((row) => row.schoolId === school.id && row.isActive && row.status !== "retired");
    const schoolAssignments = assignments.filter((row) => row.schoolId === school.id && row.isActive && row.startDate <= todayText && (!row.endDate || row.endDate >= todayText) && !["terminated", "cancelled"].includes(row.serviceState));
    // Vehicles are organisation master records; a school only counts vehicles actually serving one of its active learners.
    const servingVehicleIds = new Set<number>();
    schoolAssignments.forEach((row) => { if (row.vehicleId) servingVehicleIds.add(Number(row.vehicleId)); if (row.outboundVehicleId) servingVehicleIds.add(Number(row.outboundVehicleId)); });
    const schoolVehicles = vehicles.filter((row) => servingVehicleIds.has(Number(row.id)) && row.isActive && row.status !== "retired");
    const schoolCharges = charges.filter((row) => row.schoolId === school.id && row.status !== "void");
    const schoolPayments = payments.filter((row) => row.schoolId === school.id && row.status !== "reversed" && !row.reversedAt);
    const schoolIncidents = incidents.filter((row) => row.schoolId === school.id && !["resolved", "closed"].includes(row.status));
    const schoolClaims = claims.filter((row) => row.schoolId === school.id && !["paid", "closed", "cancelled", "rejected"].includes(row.status));
    const totalCharges = schoolCharges.reduce((sum, row) => sum + numberValue(row.amount), 0);
    const totalCollections = schoolPayments.reduce((sum, row) => sum + numberValue(row.amount), 0);
    const complianceWarnings = schoolVehicles.filter((vehicle) => [vehicle.insuranceExpiry, vehicle.fitnessExpiry].filter(Boolean).map((value) => new Date(String(value))).some((date) => date <= warningCutoff)).length;
    const collectionRate = totalCharges > 0 ? Math.min(100, (totalCollections / totalCharges) * 100) : 0;
    return { schoolId: school.id, schoolName: school.name, shortCode: school.shortCode, enabled: !!school.enableTransport, activeRoutes: schoolRoutes.length, activeVehicles: schoolVehicles.length, activeLearners: schoolAssignments.length, totalCharges, totalCollections, outstandingBalance: Math.max(0, totalCharges - totalCollections), collectionRate, openIncidents: schoolIncidents.length, openClaims: schoolClaims.length, complianceWarnings, status: school.enableTransport || schoolRoutes.length || schoolAssignments.length ? "operating" : "not_configured" };
  });
  const summary = schoolRows.reduce((acc, row) => ({ schoolsOperating: acc.schoolsOperating + (row.status === "operating" ? 1 : 0), activeRoutes: acc.activeRoutes + row.activeRoutes, activeVehicles: acc.activeVehicles + row.activeVehicles, activeLearners: acc.activeLearners + row.activeLearners, totalCharges: acc.totalCharges + row.totalCharges, totalCollections: acc.totalCollections + row.totalCollections, outstandingBalance: acc.outstandingBalance + row.outstandingBalance, collectionRate: 0, openIncidents: acc.openIncidents + row.openIncidents, openClaims: acc.openClaims + row.openClaims, complianceWarnings: acc.complianceWarnings + row.complianceWarnings }), { schoolsOperating: 0, activeRoutes: 0, activeVehicles: 0, activeLearners: 0, totalCharges: 0, totalCollections: 0, outstandingBalance: 0, collectionRate: 0, openIncidents: 0, openClaims: 0, complianceWarnings: 0 });
  summary.collectionRate = summary.totalCharges > 0 ? Math.min(100, (summary.totalCollections / summary.totalCharges) * 100) : 0;
  const alerts = schoolRows.flatMap((row) => {
    const rows: Array<{ schoolId: number; schoolName: string; type: string; count: number; severity: string; message: string }> = [];
    if (row.complianceWarnings) rows.push({ schoolId: row.schoolId, schoolName: row.schoolName, type: "compliance", count: row.complianceWarnings, severity: "warning", message: `${row.complianceWarnings} vehicle compliance record(s) expire within 30 days or are overdue.` });
    if (row.openIncidents) rows.push({ schoolId: row.schoolId, schoolName: row.schoolName, type: "incidents", count: row.openIncidents, severity: "error", message: `${row.openIncidents} transport incident(s) remain unresolved.` });
    if (row.openClaims) rows.push({ schoolId: row.schoolId, schoolName: row.schoolName, type: "claims", count: row.openClaims, severity: "info", message: `${row.openClaims} provider claim(s) remain open.` });
    if (row.outstandingBalance > 0) rows.push({ schoolId: row.schoolId, schoolName: row.schoolName, type: "balances", count: 1, severity: "info", message: `Outstanding learner transport balance: ${row.outstandingBalance.toFixed(2)}.` });
    return rows;
  });
  return { summary, schools: schoolRows, alerts, generatedAt: new Date().toISOString() };
}

async function refreshPolicyStatuses(organizationId: number) {
  const rows = await db.select().from(transportSubscriptionPolicies).where(eq(transportSubscriptionPolicies.organizationId, organizationId)).orderBy(asc(transportSubscriptionPolicies.startYear), asc(transportSubscriptionPolicies.startMonth), asc(transportSubscriptionPolicies.createdAt));
  const current = periodKey(new Date().getFullYear(), new Date().getMonth() + 1);
  const byScope = new Map<string, typeof rows>();
  for (const row of rows) {
    if (row.status === "replaced_before_posting") continue;
    const key = row.vehicleId ? `vehicle:${row.vehicleId}` : "default";
    byScope.set(key, [...(byScope.get(key) || []), row]);
  }
  for (const scopeRows of byScope.values()) {
    const applicable = scopeRows.filter((row) => periodKey(row.startYear, row.startMonth) <= current);
    const activeId = applicable.length ? applicable[applicable.length - 1].id : null;
    for (const row of scopeRows) {
      const desired = periodKey(row.startYear, row.startMonth) > current ? "pending" : row.id === activeId ? "active" : "superseded";
      if (row.status !== desired) await db.update(transportSubscriptionPolicies).set({ status: desired }).where(eq(transportSubscriptionPolicies.id, row.id));
    }
  }
}

async function buildSettlementWorkspace(organizationId: number) {
  await refreshPolicyStatuses(organizationId);
  const orgSchools = await orgSchoolRows(organizationId);
  const schoolIds = orgSchools.map((row) => row.id);
  const [vehicles, owners, drivers, schoolClaims, hqClaims, hqItems, hqPayouts, cashups, runs, runItems, disbursements, allocations, policies, userRows, schoolDisbursementAttributions] = await Promise.all([
    schoolIds.length ? db.select().from(transportVehicles).where(inArray(transportVehicles.schoolId, schoolIds)) : [],
    schoolIds.length ? db.select().from(transportOwners).where(inArray(transportOwners.schoolId, schoolIds)) : [],
    schoolIds.length ? db.select().from(transportDrivers).where(inArray(transportDrivers.schoolId, schoolIds)) : [],
    schoolIds.length ? db.select().from(transportClaims).where(inArray(transportClaims.schoolId, schoolIds)).orderBy(desc(transportClaims.createdAt)) : [],
    db.select().from(transportHqClaims).where(eq(transportHqClaims.organizationId, organizationId)).orderBy(desc(transportHqClaims.createdAt)),
    db.select().from(transportHqClaimItems),
    db.select().from(transportHqPayouts).where(eq(transportHqPayouts.organizationId, organizationId)).orderBy(desc(transportHqPayouts.createdAt)),
    schoolIds.length ? db.select().from(transportCashups).where(inArray(transportCashups.schoolId, schoolIds)).orderBy(desc(transportCashups.cashupDate), desc(transportCashups.createdAt)) : [],
    db.select().from(transportProviderPaymentRuns).where(eq(transportProviderPaymentRuns.organizationId, organizationId)).orderBy(desc(transportProviderPaymentRuns.createdAt)),
    db.select().from(transportProviderPaymentRunItems),
    db.select().from(transportProviderDisbursements).orderBy(desc(transportProviderDisbursements.createdAt)),
    db.select().from(transportProviderDisbursementAllocations),
    db.select().from(transportSubscriptionPolicies).where(eq(transportSubscriptionPolicies.organizationId, organizationId)).orderBy(desc(transportSubscriptionPolicies.startYear), desc(transportSubscriptionPolicies.startMonth), desc(transportSubscriptionPolicies.createdAt)),
    db.select({ id: users.id, username: users.username, firstName: users.firstName, lastName: users.lastName }).from(users),
    schoolIds.length ? db.select({ disbursementId: transportHqDisbursementClaimAllocations.disbursementId, schoolClaimId: transportHqDisbursementClaimAllocations.schoolClaimId, amount: transportHqDisbursementClaimAllocations.amount })
      .from(transportHqDisbursementClaimAllocations)
      .innerJoin(transportClaims,eq(transportClaims.id,transportHqDisbursementClaimAllocations.schoolClaimId))
      .where(inArray(transportClaims.schoolId,schoolIds)) : [],
  ]);
  const schoolMap = new Map(orgSchools.map((row) => [row.id, row]));
  const vehicleMap = new Map(vehicles.map((row) => [row.id, row]));
  const ownerMap = new Map(owners.map((row) => [row.id, row]));
  const userMap = new Map(userRows.map((row) => [row.id, row]));
  const itemBySchoolClaim = new Map(hqItems.map((row) => [row.schoolClaimId, row]));
  const payoutByClaim = new Map(hqPayouts.map((row) => [row.hqClaimId, row]));
  const hqClaimMap = new Map(hqClaims.map((row) => [row.id, row]));
  const trackedByClaim = new Map<number, number>();
  const trackedByPayout = new Map<number, number>();
  const schoolClaimToPayout = new Map<number, number>();
  for (const link of hqItems) {
    const payout = payoutByClaim.get(link.hqClaimId);
    if (payout) schoolClaimToPayout.set(link.schoolClaimId, payout.id);
  }
  for (const attribution of schoolDisbursementAttributions) {
    const value = cents(attribution.amount);
    trackedByClaim.set(attribution.schoolClaimId, (trackedByClaim.get(attribution.schoolClaimId) || 0) + value);
    const payoutId = schoolClaimToPayout.get(attribution.schoolClaimId);
    if (payoutId) trackedByPayout.set(payoutId, (trackedByPayout.get(payoutId) || 0) + value);
  }
  const numClaimsByPayout = new Map<number,number>();
  for (const payoutId of schoolClaimToPayout.values()) numClaimsByPayout.set(payoutId,(numClaimsByPayout.get(payoutId)||0)+1);
  const enrichedSchoolClaims = schoolClaims.map((claim) => {
    const item = itemBySchoolClaim.get(claim.id); const hq = item ? hqClaimMap.get(item.hqClaimId) : null; const payout = hq ? payoutByClaim.get(hq.id) : null;
    return { ...claim, schoolName: schoolMap.get(claim.schoolId)?.name || `School #${claim.schoolId}`, vehicleRegistration: vehicleMap.get(claim.vehicleId)?.registrationNumber || `Vehicle #${claim.vehicleId}`, ownerName: claim.ownerId ? ownerMap.get(claim.ownerId)?.name || `Owner #${claim.ownerId}` : "—", hqClaimId: hq?.id || null, hqClaimNumber: hq?.claimNumber || null, payoutId: payout?.id || null, payoutNumber: payout?.payoutNumber || null, payoutStatus: payout?.status || "not_paid", paidAmount: payout ? (
      cents(payout.amountPaid) >= cents(payout.netAmount) ? numberValue(claim.netAmount) :
      (numClaimsByPayout.get(payout.id) === 1 ? numberValue(payout.amountPaid) : Number(currency(trackedByClaim.get(claim.id)||0)))
    ) : 0,
    hasLegacyUnattributedPayment: Boolean(payout && numClaimsByPayout.get(payout.id)! > 1 && cents(payout.amountPaid) < cents(payout.netAmount) && cents(payout.amountPaid) > (trackedByPayout.get(payout.id)||0)),
    paymentStage: !payout ? 'awaiting_preparation' : cents(payout.amountPaid) >= cents(payout.netAmount) ? 'paid' : cents(payout.amountPaid) > 0 ? 'partially_paid' : 'payment_pending'  };
  });
  const enrichedHqClaims = hqClaims.map((claim) => ({ ...claim, vehicleRegistration: vehicleMap.get(claim.vehicleId)?.registrationNumber || `Vehicle #${claim.vehicleId}`, ownerName: claim.ownerId ? ownerMap.get(claim.ownerId)?.name || `Owner #${claim.ownerId}` : "—", items: hqItems.filter((row) => row.hqClaimId === claim.id).map((row) => ({ ...row, schoolName: schoolMap.get(row.schoolId)?.name || `School #${row.schoolId}`, claim: schoolClaims.find((claimRow) => claimRow.id === row.schoolClaimId) })), payout: payoutByClaim.get(claim.id) || null }));
  const payableSchoolClaims = enrichedSchoolClaims.filter((claim: any) => ["submitted", "verified", "approved", "paid"].includes(String(claim.status)));
  const payablesBySchool = Array.from(new Set(payableSchoolClaims.map((claim: any) => Number(claim.schoolId)))).map((schoolId) => {
    const rows = payableSchoolClaims.filter((claim: any) => Number(claim.schoolId) === schoolId);
    const gross = rounded(rows.reduce((sum: number, row: any) => sum + numberValue(row.grossAmount), 0));
    const deductions = rounded(rows.reduce((sum: number, row: any) => sum + numberValue(row.deductionAmount), 0));
    const netPayable = rounded(rows.reduce((sum: number, row: any) => sum + numberValue(row.netAmount), 0));
    const paid = rounded(rows.reduce((sum: number, row: any) => sum + numberValue(row.paidAmount), 0));
    return { schoolId, schoolName: schoolMap.get(schoolId)?.name || `School #${schoolId}`, claimsDue: rows.length, gross, deductions, netPayable, paid, outstanding: Math.max(0, rounded(netPayable - paid)) };
  }).sort((a, b) => a.schoolName.localeCompare(b.schoolName));
  const enrichedCashups = cashups.map((row: any) => ({
    ...row,
    schoolName: schoolMap.get(Number(row.schoolId))?.name || `School #${row.schoolId}`,
    expectedTotal: rounded(numberValue(row.expectedCash) + numberValue(row.expectedNonCash)),
    receptionistDeclared: rounded(numberValue(row.actualCash) + numberValue(row.actualNonCash)),
    accountsReceived: rounded(numberValue(row.accountsReceivedCash) + numberValue(row.accountsReceivedNonCash)),
    hqReceived: rounded(numberValue(row.hqReceivedCash) + numberValue(row.hqReceivedNonCash)),
  }));
  const runItemMap = new Map(runItems.map((row) => [row.id, row]));
  const enrichedRuns = runs.map((run) => ({ ...run, ownerName: run.ownerId ? ownerMap.get(run.ownerId)?.name || `Owner #${run.ownerId}` : "—", items: runItems.filter((row) => row.runId === run.id).map((row) => ({ ...row, payout: hqPayouts.find((payout) => payout.id === row.payoutId) })), disbursements: disbursements.filter((row) => row.runId === run.id).map((row) => ({ ...row, processedByName: (() => { const u = userMap.get(row.processedByUserId); return u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.username : `User #${row.processedByUserId}`; })(), allocations: allocations.filter((a) => a.disbursementId === row.id).map((a) => ({ ...a, runItem: runItemMap.get(a.runItemId) })), schoolClaimAllocations: schoolDisbursementAttributions.filter((a)=>a.disbursementId===row.id) })) }));
  const consolidatedGroups = groupHqClaims(enrichedSchoolClaims, hqClaims);
  return { schools: orgSchools, vehicles, owners, drivers, consolidatedGroups, schoolClaims: enrichedSchoolClaims, hqClaims: enrichedHqClaims, payouts: hqPayouts.map((payout) => ({ ...payout, claim: hqClaimMap.get(payout.hqClaimId), vehicleRegistration: vehicleMap.get(hqClaimMap.get(payout.hqClaimId)?.vehicleId || 0)?.registrationNumber || "—", ownerName: payout.ownerId ? ownerMap.get(payout.ownerId)?.name || `Owner #${payout.ownerId}` : "—" })), payablesBySchool, cashups: enrichedCashups, paymentRuns: enrichedRuns, subscriptionPolicies: policies };
}

type IncomeFilters = {year:number;month:number;schoolId:number;providerId:number;vehicleId:number;category:'all'|'subscription'|'penalty'|'administration'|'other_income'};
async function buildTransportIncomeReport(organizationId:number, filters:IncomeFilters) {
  const orgSchools = await orgSchoolRows(organizationId);
  const allowed = orgSchools.filter(x=>!filters.schoolId || x.id===filters.schoolId);
  if (filters.schoolId && !allowed.length) throw new Error('School is outside your organisation');
  const schoolIds = allowed.map(x=>x.id);
  const claims = schoolIds.length ? await db.select().from(transportClaims).where(and(
    inArray(transportClaims.schoolId,schoolIds),eq(transportClaims.serviceYear,filters.year),
    ...(filters.month ? [eq(transportClaims.serviceMonth,filters.month)] : []),
    inArray(transportClaims.status,['submitted','verified','approved','paid']),
    ...(filters.providerId?[eq(transportClaims.ownerId,filters.providerId)]:[]),
    ...(filters.vehicleId?[eq(transportClaims.vehicleId,filters.vehicleId)]:[]),
  )) : [];
  const claimIds=claims.map(x=>x.id);
  const [deductions, hqItems, payoutRows, adjustments, allVehicles, allOwners, postedHqClaims] = await Promise.all([
    claimIds.length?db.select().from(transportClaimDeductions).where(inArray(transportClaimDeductions.claimId,claimIds)):[],
    claimIds.length?db.select().from(transportHqClaimItems).where(inArray(transportHqClaimItems.schoolClaimId,claimIds)):[],
    db.select().from(transportHqPayouts).where(eq(transportHqPayouts.organizationId,organizationId)),
    schoolIds.length?db.select().from(transportProviderAdjustments).where(inArray(transportProviderAdjustments.schoolId,schoolIds)):[],
    schoolIds.length?db.select().from(transportVehicles).where(inArray(transportVehicles.schoolId,schoolIds)):[],
    schoolIds.length?db.select().from(transportOwners).where(inArray(transportOwners.schoolId,schoolIds)):[],
    db.select({id:transportHqClaims.id,status:transportHqClaims.status}).from(transportHqClaims).where(eq(transportHqClaims.organizationId,organizationId)),
  ]);
  const names = new Map(orgSchools.map(x=>[x.id,x.name]));
  const vehicleNames = new Map(allVehicles.map(x=>[x.id,x.registrationNumber]));
  const ownerNames = new Map(allOwners.map(x=>[x.id,x.name]));
  const adjById=new Map(adjustments.map(x=>[x.id,x]));
  const payoutByHq=new Map(payoutRows.map(x=>[x.hqClaimId,x]));
  const hqStatuses=new Map(postedHqClaims.map(x=>[x.id,x.status]));
  const hqIdBySchool=new Map(hqItems.map(x=>[x.schoolClaimId,x.hqClaimId]));
  const rows:Array<{schoolId:number;schoolName:string;vehicleId:number;vehicleRegistration:string;providerId:number|null;providerName:string;claimId:number;claimNumber:string;serviceYear:number;serviceMonth:number;category:string;description:string;sourceId:number|null;earned:string;collected:string;outstanding:string}> = [];
  const unclassified:Array<{claimNumber:string;type:string;amount:string}> = [];
  for (const claim of claims) {
    const hqId = hqIdBySchool.get(claim.id)||0;
    const payout=payoutByHq.get(hqId);
    // The HQ payable is built from verified/eligible parent collections and
    // deducts FCGS fees *before* the provider's net entitlement is disbursed.
    // The contractual offset is effective when that HQ payable is posted;
    // pending provider cash disbursements are separate liabilities.
    const feeOffsetPosted=Boolean(payout && ['approved','paid'].includes(hqStatuses.get(hqId)||''));
    for(const row of effectiveDeductions(deductions.filter(x=>x.claimId===claim.id).map(x=>({
      ...x, adjustmentType:x.deductionType==='other'?adjById.get(x.sourceId||0)?.adjustmentType:null,
    })),claim.deductionAmount)) {
      if (!row.effectiveCents) continue;
      if (!isEarnedClass(row.category)) {
        unclassified.push({claimNumber:claim.claimNumber,type:row.category,amount:currency(row.effectiveCents)});
        continue;
      }
      if (filters.category!=='all' && row.category!==filters.category) continue;
      rows.push({ schoolId:claim.schoolId, schoolName:names.get(claim.schoolId)||'—',vehicleId:claim.vehicleId,
        vehicleRegistration:vehicleNames.get(claim.vehicleId)||'—',providerId:claim.ownerId,
        providerName:claim.ownerId?ownerNames.get(claim.ownerId)||'—':'FCGS',claimId:claim.id,claimNumber:claim.claimNumber,
        serviceYear:claim.serviceYear,serviceMonth:claim.serviceMonth,category:row.category,
        description:row.description,sourceId:row.sourceId,
        earned:currency(row.effectiveCents),collected:currency(feeOffsetPosted?row.effectiveCents:0),
        outstanding:currency(feeOffsetPosted?0:row.effectiveCents),
      });
    }
  }
  const totals = rows.reduce((acc,r)=>({earned:acc.earned+cents(r.earned),collected:acc.collected+cents(r.collected),outstanding:acc.outstanding+cents(r.outstanding)}),{earned:0,collected:0,outstanding:0});
  const duplicateSubscriptions: Array<{vehicleId:number; serviceYear:number; serviceMonth:number; sourceId:number; count:number}> = [];
  const subscriptionKeys = new Map<string,{vehicleId:number;serviceYear:number;serviceMonth:number;sourceId:number;count:number}>();
  for(const row of rows.filter(row=>row.category==='subscription' && row.sourceId)) {
    const key=`${row.vehicleId}:${row.serviceYear}:${row.serviceMonth}:${row.sourceId}`;
    const existing=subscriptionKeys.get(key);
    subscriptionKeys.set(key, existing?{...existing,count:existing.count+1}:{vehicleId:row.vehicleId,serviceYear:row.serviceYear,serviceMonth:row.serviceMonth,sourceId:row.sourceId!,count:1});
  }
  duplicateSubscriptions.push(...[...subscriptionKeys.values()].filter(row=>row.count>1));
  const monthly = Array.from({length:12},(_,index)=>{
    const monthRows=rows.filter(row=>row.serviceMonth===index+1);
    return {year:filters.year,month:index+1,earned:currency(monthRows.reduce((sum,row)=>sum+cents(row.earned),0)),collected:currency(monthRows.reduce((sum,row)=>sum+cents(row.collected),0)),outstanding:currency(monthRows.reduce((sum,row)=>sum+cents(row.outstanding),0))};
  });
  const categories = ['subscription','penalty','administration','other_income'].map(category=>{
    const rr=rows.filter(r=>r.category===category);
    return {category,earned:currency(rr.reduce((sum,r)=>sum+cents(r.earned),0)),collected:currency(rr.reduce((sum,r)=>sum+cents(r.collected),0)),outstanding:currency(rr.reduce((sum,r)=>sum+cents(r.outstanding),0))};
  });
  return {filters,totals:{earned:currency(totals.earned),collected:currency(totals.collected),outstanding:currency(totals.outstanding)},categories,monthly,duplicateSubscriptions,rows,excludedSummary:{count:unclassified.length,amount:currency(unclassified.reduce((sum,x)=>sum+cents(x.amount),0))},
  collectionPolicy:'Conservative: a posted income deduction is shown as collected only after its linked provider payout is fully settled. Partial payout offsets are shown as outstanding until complete.',
  note:'Recoveries and unclassified deductions are deliberately excluded. Period is claim service month; never treat cash held for providers as income.'};
}

// Spreadsheet formula hardening for operator-entered reference and description fields.
function incomeCsvCell(value: unknown) {
  const str=String(value ?? '');
  return csvCell(/^\s*[=+@-]/.test(str) ? `'${str}` : str);
}
function csvCell(value: unknown) { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }

export function registerHqOperationsRoutes(app: Express) {
  registerOneStepHqTransportDisbursements(app);

  app.get("/api/hq/transport/settlement-policy", requireAuth, requireAnyPermission("transport.organization.view", "transport.organization.manage", "transport.hq.claims.manage", "transport.hq.disbursements.manage"), async(req,res)=>{
    try {
      const user=requireHqUser(req);
      const [r]=await db.select().from(transportOrganizationSettings).where(eq(transportOrganizationSettings.organizationId,user.organizationId!));
      const policy=r?{paymentDaysBeforeEnd:r.paymentCutoffWorkingDaysBeforeEnd,claimDaysBeforeEnd:r.claimCutoffWorkingDaysBeforeEnd,paymentCutoffTime:r.paymentCutoffTime,claimCutoffTime:r.claimCutoffTime,effectiveFrom:String(r.settlementRulesEffectiveFrom)}:DEFAULT_SETTLEMENT_POLICY;
      const year=Number(req.query.year||new Date().getFullYear()),month=Number(req.query.month||new Date().getMonth()+1);
      if (!Number.isInteger(year)||year<2020||year>2100||!Number.isInteger(month)||month<1||month>12) return res.status(400).json({message:'Invalid period'});
      res.json({policy,year,month,paymentDeadline:deadlineFor(year,month,policy.paymentDaysBeforeEnd,policy.paymentCutoffTime),claimDeadline:deadlineFor(year,month,policy.claimDaysBeforeEnd,policy.claimCutoffTime)});
    } catch(e){res.status(400).json({message:e instanceof Error?e.message:'Unable to load deadlines'});}
  });
  app.put("/api/hq/transport/settlement-policy", requireAuth, requirePermission("transport.hq.settings.manage"), async(req,res)=>{
    try {
      const user=requireHqUser(req);
      const input=z.object({paymentDaysBeforeEnd:z.coerce.number().int().min(0).max(10),claimDaysBeforeEnd:z.coerce.number().int().min(0).max(10),paymentCutoffTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),claimCutoffTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),effectiveFrom:z.string().regex(/^\d{4}-\d{2}-01$/)}).parse(req.body);
      // Preserve frozen historical policy. No mid-month retroactive policy changes.
      const now=new Date();const currentMonth=now.toISOString().slice(0,7)+'-01';
      if(input.effectiveFrom<=currentMonth) return res.status(409).json({message:'Settlement rules must start from a future first day of the month. Existing claims retain their original policy.'});
      const [updated]=await db.insert(transportOrganizationSettings).values({organizationId:user.organizationId!,paymentCutoffWorkingDaysBeforeEnd:input.paymentDaysBeforeEnd,claimCutoffWorkingDaysBeforeEnd:input.claimDaysBeforeEnd,paymentCutoffTime:input.paymentCutoffTime,claimCutoffTime:input.claimCutoffTime,settlementRulesEffectiveFrom:input.effectiveFrom}).onConflictDoUpdate({target:transportOrganizationSettings.organizationId,set:{paymentCutoffWorkingDaysBeforeEnd:input.paymentDaysBeforeEnd,claimCutoffWorkingDaysBeforeEnd:input.claimDaysBeforeEnd,paymentCutoffTime:input.paymentCutoffTime,claimCutoffTime:input.claimCutoffTime,settlementRulesEffectiveFrom:input.effectiveFrom,updatedAt:new Date()}}).returning();
      res.json(updated);
    }catch(e){res.status(400).json({message:e instanceof Error?e.message:'Unable to update settlement rules'});}
  });

  app.get("/api/hq/transport/overview", requireAuth, requireAnyPermission("transport.organization.view", "transport.organization.reports", "transport.organization.manage"), async (req, res) => {
    try { const user = requireHqUser(req); res.json(await buildTransportOverview(user.organizationId!)); }
    catch (error) { res.status(403).json({ message: error instanceof Error ? error.message : "Unable to load HQ transport oversight" }); }
  });

  app.get("/api/hq/transport/settlements", requireAuth, requireAnyPermission("transport.organization.view", "transport.hq.claims.manage", "transport.hq.payouts.manage", "transport.organization.manage"), async (req, res) => {
    try { const user = requireHqUser(req); res.json(await buildSettlementWorkspace(user.organizationId!)); }
    catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : "Unable to load HQ settlement workspace" }); }
  });

  // Read-only income reporting. Only qualifying posted deductions are income;
  // recoveries (advance/refund) and unclassified deductions are excluded.
  app.get("/api/hq/transport/income", requireAuth, requireAnyPermission("transport.organization.reports", "transport.organization.manage"), async (req, res) => {
    try {
      const user = requireHqUser(req);
      const input = z.object({
        year: z.coerce.number().int().min(2020).max(2100),
        month: z.coerce.number().int().min(0).max(12).default(0),
        schoolId: z.coerce.number().int().min(0).default(0),
        providerId: z.coerce.number().int().min(0).default(0),
        vehicleId: z.coerce.number().int().min(0).default(0),
        category: z.enum(['all','subscription','penalty','administration','other_income']).default('all'),
      }).parse(req.query);
      const report = await buildTransportIncomeReport(user.organizationId!, input);
      res.json(report);
    } catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to load transport income report' }); }
  });
  app.get("/api/hq/transport/income.csv", requireAuth, requirePermission("transport.organization.export"), async (req, res) => {
    try {
      const user = requireHqUser(req);
      const input = z.object({ year:z.coerce.number().int().min(2020).max(2100), month:z.coerce.number().int().min(0).max(12).default(0), schoolId:z.coerce.number().int().min(0).default(0), providerId:z.coerce.number().int().min(0).default(0), vehicleId:z.coerce.number().int().min(0).default(0), category:z.enum(['all','subscription','penalty','administration','other_income']).default('all') }).parse(req.query);
      const report = await buildTransportIncomeReport(user.organizationId!, input);
      res.setHeader('Content-Type','text/csv; charset=utf-8');
      res.setHeader('Content-Disposition','attachment; filename="transport-income.csv"');
      res.send(['School,Vehicle,Provider,Claim,Period,Category,Source,Description,Earned USD,Collected USD,Outstanding USD',...report.rows.map((row: any)=>[row.schoolName,row.vehicleRegistration,row.providerName,row.claimNumber,`${row.serviceYear}-${String(row.serviceMonth).padStart(2,'0')}`,row.category,row.sourceId||'',row.description,row.earned,row.collected,row.outstanding].map(incomeCsvCell).join(','))].join('\n'));
    } catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to export transport income' }); }
  });

  app.get("/api/hq/transport/payables", requireAuth, requireAnyPermission("transport.organization.view", "transport.organization.reports", "transport.hq.claims.manage", "transport.organization.manage"), async (req, res) => {
    try {
      const user = requireHqUser(req);
      const parsed = z.object({ year: z.coerce.number().int().min(2020), month: monthSchema }).parse(req.query);
      const workspace = await buildSettlementWorkspace(user.organizationId!);
      const claims = (workspace.schoolClaims || []).filter((row: any) => Number(row.serviceYear) === parsed.year && Number(row.serviceMonth) === parsed.month && ["submitted", "verified", "approved", "paid"].includes(String(row.status)));
      const rows = (workspace.schools || []).map((school: any) => {
        const schoolClaims = claims.filter((row: any) => Number(row.schoolId) === Number(school.id));
        const gross = rounded(schoolClaims.reduce((sum: number, row: any) => sum + numberValue(row.grossAmount), 0));
        const deductions = rounded(schoolClaims.reduce((sum: number, row: any) => sum + numberValue(row.deductionAmount), 0));
        const netPayable = rounded(schoolClaims.reduce((sum: number, row: any) => sum + numberValue(row.netAmount), 0));
        const paid = rounded(schoolClaims.reduce((sum: number, row: any) => sum + numberValue(row.paidAmount), 0));
        return { schoolId: school.id, schoolName: school.name, claimsDue: schoolClaims.length, gross, deductions, netPayable, paid, outstanding: Math.max(0, rounded(netPayable - paid)) };
      }).filter((row: any) => row.claimsDue > 0 || row.netPayable > 0);
      res.json({ ...parsed, rows, totals: rows.reduce((acc: any, row: any) => ({ claimsDue: acc.claimsDue + row.claimsDue, gross: rounded(acc.gross + row.gross), deductions: rounded(acc.deductions + row.deductions), netPayable: rounded(acc.netPayable + row.netPayable), paid: rounded(acc.paid + row.paid), outstanding: rounded(acc.outstanding + row.outstanding) }), { claimsDue: 0, gross: 0, deductions: 0, netPayable: 0, paid: 0, outstanding: 0 }) });
    } catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : "Unable to load payables report" }); }
  });

  app.post("/api/hq/transport/cashups/:id/confirm", requireAuth, requireAnyPermission("transport.organization.manage", "transport.organization.reports"), async (req, res) => {
    try {
      const user = requireHqUser(req);
      const parsed = z.object({ receivedCash: z.coerce.number().finite().min(0), receivedNonCash: z.coerce.number().finite().min(0).default(0), notes: z.string().trim().nullable().optional() }).parse(req.body);
      const schoolRows = await orgSchoolRows(user.organizationId!); const schoolIds = schoolRows.map((row) => row.id);
      const [previous] = await db.select().from(transportCashups).where(and(eq(transportCashups.id, Number(req.params.id)), inArray(transportCashups.schoolId, schoolIds)));
      if (!previous) return res.status(404).json({ message: "Cash-up not found." });
      if (!["verified", "hq_discrepancy"].includes(String(previous.status))) return res.status(409).json({ message: "Accounts must verify this cash-up before HQ confirmation." });
      const expected = rounded(numberValue(previous.expectedCash) + numberValue(previous.expectedNonCash));
      const received = rounded(parsed.receivedCash + parsed.receivedNonCash);
      const variance = rounded(received - expected);
      if (Math.abs(variance) > 0.009 && !parsed.notes) return res.status(400).json({ message: "Enter a reconciliation note because the HQ amount received differs from the system expected amount." });
      const [updated] = await db.update(transportCashups).set({
        hqReceivedCash: String(parsed.receivedCash), hqReceivedNonCash: String(parsed.receivedNonCash), hqVariance: String(variance), hqNotes: parsed.notes || null,
        hqConfirmedByUserId: user.id, hqConfirmedAt: new Date(), status: Math.abs(variance) > 0.009 ? "hq_discrepancy" : "hq_confirmed",
      }).where(eq(transportCashups.id, previous.id)).returning();
      res.json(updated);
    } catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : "Unable to confirm HQ cash-up" }); }
  });

  app.get("/api/hq/transport/payment-register/print", requireAuth, requireAnyPermission("transport.organization.reports", "transport.hq.payouts.manage", "transport.organization.manage"), async (req, res) => {
    try {
      const user = requireHqUser(req);
      const parsed = z.object({ year: z.coerce.number().int().min(2020), month: monthSchema, schoolId: z.coerce.number().int().positive().optional() }).parse(req.query);
      const workspace = await buildSettlementWorkspace(user.organizationId!);
      let claims = (workspace.schoolClaims || []).filter((row: any) => Number(row.serviceYear) === parsed.year && Number(row.serviceMonth) === parsed.month && ["submitted", "verified", "approved", "paid"].includes(String(row.status)));
      if (parsed.schoolId) claims = claims.filter((row: any) => Number(row.schoolId) === parsed.schoolId);
      const vehicleById = new Map((workspace.vehicles || []).map((row: any) => [Number(row.id), row]));
      const ownerById = new Map((workspace.owners || []).map((row: any) => [Number(row.id), row]));
      const driverById = new Map((workspace.drivers || []).map((row: any) => [Number(row.id), row]));
      const payoutById = new Map((workspace.payouts || []).map((row: any) => [Number(row.id), row]));
      const disbursementByPayout = new Map<number, any>();
      for (const run of workspace.paymentRuns || []) for (const disbursement of run.disbursements || []) for (const allocation of disbursement.allocations || []) {
        const payoutId = allocation.runItem?.payoutId; if (payoutId) disbursementByPayout.set(Number(payoutId), disbursement);
      }
      const rows = claims.map((claim: any) => {
        const vehicle = vehicleById.get(Number(claim.vehicleId)); const owner = claim.ownerId ? ownerById.get(Number(claim.ownerId)) : null; const driver = claim.driverId ? driverById.get(Number(claim.driverId)) : null;
        const payout = claim.payoutId ? payoutById.get(Number(claim.payoutId)) : null; const disbursement = payout ? disbursementByPayout.get(Number(payout.id)) : null;
        const collector = disbursement?.collectorType === "driver" && disbursement.collectorDriverId ? driverById.get(Number(disbursement.collectorDriverId)) : null;
        return { claim, vehicle, owner, driver, payout, disbursement, collectorName: collector ? `${collector.firstName} ${collector.lastName}` : disbursement?.collectorName || (disbursement?.collectorType === "owner" ? owner?.name : null) || "—" };
      });
      const bodyRows = rows.map(({ claim, vehicle, owner, driver, disbursement, collectorName }: any) => `<tr><td>${escapeHtml(claim.schoolName)}</td><td>${escapeHtml(owner?.name || "FCGS")}</td><td>${escapeHtml(driver ? `${driver.firstName} ${driver.lastName}` : "—")}</td><td>${escapeHtml(vehicle?.registrationNumber || "—")}</td><td>${escapeHtml(claim.claimNumber)}</td><td>${numberValue(claim.grossAmount).toFixed(2)}</td><td>${numberValue(claim.deductionAmount).toFixed(2)}</td><td>${numberValue(claim.netAmount).toFixed(2)}</td><td>${numberValue(claim.paidAmount).toFixed(2)}</td><td>${escapeHtml(disbursement?.paymentMethod || "—")} ${escapeHtml(disbursement?.paymentReference || "")}</td><td>${escapeHtml(collectorName)}</td><td class="signature"></td></tr>`).join("");
      const html = `<!doctype html><html><head><meta charset="utf-8"/><style>@page{size:A4 landscape;margin:8mm}body{font-family:Arial;font-size:9px}h1,h2{text-align:center;margin:3px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #aaa;padding:5px}th{background:#eee}.signature{min-width:90px;height:28px}</style></head><body><h1>FIRST CHOICE GROUP OF SCHOOLS</h1><h2>MONTHLY TRANSPORT PROVIDER PAYMENT REGISTER · ${parsed.year}-${String(parsed.month).padStart(2,"0")}</h2><table><thead><tr><th>School</th><th>Payee / Provider</th><th>Driver</th><th>Vehicle</th><th>Claim</th><th>Gross</th><th>Deductions</th><th>Net Due</th><th>Paid</th><th>Method / Ref</th><th>Collected By</th><th>Acknowledgement</th></tr></thead><tbody>${bodyRows || '<tr><td colspan="12">No payable claims for this period.</td></tr>'}</tbody></table></body></html>`;
      const pdf = await renderHtmlPdf({ html, pdfOptions: { format: "A4", landscape: true, printBackground: true, preferCSSPageSize: true } });
      const filename = reportPdfFilename(`Transport_Provider_Payment_Register_${parsed.year}_${String(parsed.month).padStart(2,"0")}`);
      res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", `inline; filename="${filename}.pdf"`); res.send(pdf);
    } catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : "Unable to generate provider payment register" }); }
  });

  app.post("/api/hq/transport/subscription-policies", requireAuth, requireAnyPermission("transport.subscription.manage", "transport.organization.manage"), async (req, res) => {
    try {
      const user = requireHqUser(req);
      const parsed = z.object({ vehicleId: z.coerce.number().int().positive().nullable().optional(), ruleType: z.enum(["fixed", "percentage"]).default("fixed"), value: z.coerce.number().finite().nonnegative(), minimumAmount: z.coerce.number().finite().nonnegative().nullable().optional(), maximumAmount: z.coerce.number().finite().nonnegative().nullable().optional(), startYear: z.coerce.number().int().min(2020), startMonth: monthSchema, notes: z.string().trim().nullable().optional() }).parse(req.body);
      const schoolRows = await orgSchoolRows(user.organizationId!); const schoolIds = schoolRows.map((row) => row.id);
      if (parsed.vehicleId) {
        const [vehicle] = await db.select().from(transportVehicles).where(and(eq(transportVehicles.id, parsed.vehicleId), inArray(transportVehicles.schoolId, schoolIds)));
        if (!vehicle) return res.status(404).json({ message: "Vehicle is not available in this organisation." });
      }
      const frozenClaims = schoolIds.length ? await db.select({ id: transportClaims.id }).from(transportClaims).where(and(inArray(transportClaims.schoolId, schoolIds), eq(transportClaims.serviceYear, parsed.startYear), eq(transportClaims.serviceMonth, parsed.startMonth), inArray(transportClaims.status, ["submitted", "verified", "approved", "paid"]))) : [];
      const locks = schoolIds.length ? await db.select({ id: transportPeriodLocks.id }).from(transportPeriodLocks).where(and(inArray(transportPeriodLocks.schoolId, schoolIds), eq(transportPeriodLocks.year, parsed.startYear), eq(transportPeriodLocks.month, parsed.startMonth), eq(transportPeriodLocks.status, "locked"))) : [];
      if (frozenClaims.length || locks.length) return res.status(409).json({ message: `The ${parsed.startYear}-${String(parsed.startMonth).padStart(2, "0")} policy is already frozen into submitted accounting/settlement records. Start the correction in the next open month.` });
      const existing = await db.select().from(transportSubscriptionPolicies).where(and(eq(transportSubscriptionPolicies.organizationId, user.organizationId!), parsed.vehicleId ? eq(transportSubscriptionPolicies.vehicleId, parsed.vehicleId) : isNull(transportSubscriptionPolicies.vehicleId), eq(transportSubscriptionPolicies.startYear, parsed.startYear), eq(transportSubscriptionPolicies.startMonth, parsed.startMonth), ne(transportSubscriptionPolicies.status, "replaced_before_posting"))).orderBy(desc(transportSubscriptionPolicies.createdAt));
      const nowPeriod = periodKey(new Date().getFullYear(), new Date().getMonth() + 1); const newPeriod = periodKey(parsed.startYear, parsed.startMonth);
      const created = await db.transaction(async (tx) => {
        for (const row of existing) await tx.update(transportSubscriptionPolicies).set({ status: "replaced_before_posting", replacedAt: new Date(), replacedByUserId: user.id }).where(eq(transportSubscriptionPolicies.id, row.id));
        const [row] = await tx.insert(transportSubscriptionPolicies).values({ organizationId: user.organizationId!, vehicleId: parsed.vehicleId || null, ruleType: parsed.ruleType, value: String(parsed.value), minimumAmount: parsed.minimumAmount == null ? null : String(parsed.minimumAmount), maximumAmount: parsed.maximumAmount == null ? null : String(parsed.maximumAmount), startYear: parsed.startYear, startMonth: parsed.startMonth, status: newPeriod > nowPeriod ? "pending" : "active", notes: parsed.notes || null, createdByUserId: user.id }).returning();
        return row;
      });
      await refreshPolicyStatuses(user.organizationId!);
      res.status(201).json({ ...created, replacedPolicyIds: existing.map((row) => row.id) });
    } catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : "Unable to save subscription policy" }); }
  });

  app.post("/api/hq/transport/claims/consolidate", requireAuth, requireAnyPermission("transport.hq.claims.manage", "transport.organization.manage"), async (req, res) => {
    try {
      const user = requireHqUser(req); const parsed = z.object({ vehicleId: z.coerce.number().int().positive(), serviceYear: z.coerce.number().int().min(2020), serviceMonth: monthSchema, notes: z.string().trim().nullable().optional() }).parse(req.body);
      const schoolRows = await orgSchoolRows(user.organizationId!); const schoolIds = schoolRows.map((row) => row.id);
      const [vehicle] = await db.select().from(transportVehicles).where(and(eq(transportVehicles.id, parsed.vehicleId), inArray(transportVehicles.schoolId, schoolIds)));
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found in this organisation." });
      const sourceClaims = await db.select().from(transportClaims).where(and(inArray(transportClaims.schoolId, schoolIds), eq(transportClaims.vehicleId, parsed.vehicleId), eq(transportClaims.serviceYear, parsed.serviceYear), eq(transportClaims.serviceMonth, parsed.serviceMonth), inArray(transportClaims.status, ["submitted", "verified", "approved"]))).orderBy(asc(transportClaims.schoolId));
      if (!sourceClaims.length) return res.status(409).json({ message: "There are no Transport Manager-submitted claims to prepare for payment for this vehicle and month." });
      const existingLinks = await db.select().from(transportHqClaimItems).where(inArray(transportHqClaimItems.schoolClaimId, sourceClaims.map((row) => row.id)));
      const existing = await db.select().from(transportHqClaims).where(and(eq(transportHqClaims.organizationId, user.organizationId!), eq(transportHqClaims.vehicleId, parsed.vehicleId), eq(transportHqClaims.serviceYear, parsed.serviceYear), eq(transportHqClaims.serviceMonth, parsed.serviceMonth)));
      if (existing[0] && !["draft", "reviewed"].includes(existing[0].status)) return res.status(409).json({ message: "The HQ claim is already approved/frozen and cannot be recalculated." });
      if (existingLinks.some((link) => !existing[0] || link.hqClaimId !== existing[0].id)) return res.status(409).json({ message: "One or more school claims are already included in another HQ settlement." });
      const gross = rounded(sourceClaims.reduce((sum, row) => sum + numberValue(row.grossAmount), 0)); const deductions = rounded(sourceClaims.reduce((sum, row) => sum + numberValue(row.deductionAmount), 0)); const net = rounded(sourceClaims.reduce((sum, row) => sum + numberValue(row.netAmount), 0));
      const result = await db.transaction(async (tx) => {
        let hq = existing[0];
        const approvedAt = new Date();
        if (hq) {
          [hq] = await tx.update(transportHqClaims).set({ ownerId: vehicle.ownerId || null, grossAmount: String(gross), deductionAmount: String(deductions), netAmount: String(net), notes: parsed.notes || hq.notes, snapshot: { refreshedAt: approvedAt.toISOString(), schoolClaimIds: sourceClaims.map((row) => row.id), sourceVerifiedAtSchool: true }, updatedAt: approvedAt, status: "approved", approvedByUserId: user.id, approvedAt }).where(eq(transportHqClaims.id, hq.id)).returning();
          await tx.delete(transportHqClaimItems).where(eq(transportHqClaimItems.hqClaimId, hq.id));
        } else {
          [hq] = await tx.insert(transportHqClaims).values({ organizationId: user.organizationId!, vehicleId: parsed.vehicleId, ownerId: vehicle.ownerId || null, claimNumber: numberCode("HQCLM", user.organizationId!), serviceYear: parsed.serviceYear, serviceMonth: parsed.serviceMonth, status: "approved", grossAmount: String(gross), deductionAmount: String(deductions), netAmount: String(net), notes: parsed.notes || null, snapshot: { createdAt: approvedAt.toISOString(), schoolClaimIds: sourceClaims.map((row) => row.id), sourceVerifiedAtSchool: true }, preparedByUserId: user.id, approvedByUserId: user.id, approvedAt }).returning();
        }
        await tx.insert(transportHqClaimItems).values(sourceClaims.map((row) => ({ hqClaimId: hq.id, schoolClaimId: row.id, schoolId: row.schoolId, grossAmount: row.grossAmount, deductionAmount: row.deductionAmount, netAmount: row.netAmount })));
        const existingPayout = await tx.select().from(transportHqPayouts).where(eq(transportHqPayouts.hqClaimId, hq.id));
        let payout = existingPayout[0];
        if (!payout) [payout] = await tx.insert(transportHqPayouts).values({ organizationId: user.organizationId!, hqClaimId: hq.id, ownerId: hq.ownerId || null, payoutNumber: numberCode("HQPAY", user.organizationId!), status: "not_paid", netAmount: hq.netAmount, amountPaid: "0", generatedByUserId: user.id }).returning();
        return { claim: hq, payout };
      });
      res.status(201).json(result);
    } catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : "Unable to consolidate HQ claim" }); }
  });

  app.post("/api/hq/transport/claims/:id/status", requireAuth, requireAnyPermission("transport.hq.claims.manage", "transport.organization.manage"), async (req, res) => {
    try {
      const user = requireHqUser(req); const id = Number(req.params.id); const parsed = z.object({ status: z.enum(["reviewed", "approved", "rejected"]), reason: z.string().trim().nullable().optional() }).parse(req.body);
      const [previous] = await db.select().from(transportHqClaims).where(and(eq(transportHqClaims.id, id), eq(transportHqClaims.organizationId, user.organizationId!)));
      if (!previous) return res.status(404).json({ message: "HQ claim not found." });
      const transitions: Record<string, string[]> = { draft: ["reviewed", "rejected"], reviewed: ["approved", "rejected"] };
      if (!(transitions[previous.status] || []).includes(parsed.status)) return res.status(409).json({ message: `HQ claim cannot move from ${previous.status} to ${parsed.status}.` });
      if (previous.preparedByUserId === user.id && ["reviewed", "approved"].includes(parsed.status)) return res.status(409).json({ message: "The HQ claim preparer cannot review or approve the same settlement." });
      if (parsed.status === "approved" && previous.reviewedByUserId === user.id) return res.status(409).json({ message: "The HQ reviewer cannot approve the same settlement." });
      if (parsed.status === "rejected" && !parsed.reason) return res.status(400).json({ message: "A rejection reason is required." });
      const changes: any = { status: parsed.status, updatedAt: new Date() };
      if (parsed.status === "reviewed") { changes.reviewedByUserId = user.id; changes.reviewedAt = new Date(); }
      if (parsed.status === "approved") { changes.approvedByUserId = user.id; changes.approvedAt = new Date(); }
      const result = await db.transaction(async (tx) => {
        const [row] = await tx.update(transportHqClaims).set(changes).where(eq(transportHqClaims.id, id)).returning();
        if (parsed.status === "approved") {
          const existing = await tx.select().from(transportHqPayouts).where(eq(transportHqPayouts.hqClaimId, id));
          if (!existing.length) await tx.insert(transportHqPayouts).values({ organizationId: user.organizationId!, hqClaimId: id, ownerId: row.ownerId || null, payoutNumber: numberCode("HQPAY", user.organizationId!), status: "not_paid", netAmount: row.netAmount, amountPaid: "0", generatedByUserId: user.id });
        }
        return row;
      });
      res.json(result);
    } catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : "Unable to update HQ claim" }); }
  });

  app.post("/api/hq/transport/payment-runs", requireAuth, requireAnyPermission("transport.hq.payouts.manage", "transport.organization.manage"), async (req, res) => {
    try {
      const user = requireHqUser(req); const parsed = z.object({ payoutIds: z.array(z.coerce.number().int().positive()).min(1), notes: z.string().trim().nullable().optional() }).parse(req.body);
      const payouts = await db.select().from(transportHqPayouts).where(and(eq(transportHqPayouts.organizationId, user.organizationId!), inArray(transportHqPayouts.id, parsed.payoutIds)));
      if (payouts.length !== new Set(parsed.payoutIds).size) return res.status(404).json({ message: "One or more payouts were not found." });
      const ownerIds = new Set(payouts.map((row) => row.ownerId || 0)); if (ownerIds.size !== 1) return res.status(409).json({ message: "A provider payment run may only contain payouts owed to the same owner/provider." });
      const existingItems = await db.select().from(transportProviderPaymentRunItems).where(inArray(transportProviderPaymentRunItems.payoutId, parsed.payoutIds));
      if (existingItems.length) return res.status(409).json({ message: "One or more payouts are already included in a payment run." });
      const openPayouts = payouts.filter((row) => numberValue(row.amountPaid) < numberValue(row.netAmount)); if (!openPayouts.length) return res.status(409).json({ message: "All selected payouts are already fully paid." });
      const claimRows = await db.select().from(transportHqClaims).where(inArray(transportHqClaims.id, openPayouts.map((row) => row.hqClaimId)));
      const years = new Set(claimRows.map((row) => row.serviceYear)); const months = new Set(claimRows.map((row) => row.serviceMonth));
      const result = await db.transaction(async (tx) => {
        const totalDue = rounded(openPayouts.reduce((sum, row) => sum + Math.max(0, numberValue(row.netAmount) - numberValue(row.amountPaid)), 0));
        const [run] = await tx.insert(transportProviderPaymentRuns).values({ organizationId: user.organizationId!, ownerId: openPayouts[0].ownerId || null, runNumber: numberCode("PAYRUN", user.organizationId!), serviceYear: years.size === 1 ? Array.from(years)[0] : null, serviceMonth: months.size === 1 ? Array.from(months)[0] : null, status: "open", totalDue: String(totalDue), amountPaid: "0", notes: parsed.notes || null, createdByUserId: user.id }).returning();
        await tx.insert(transportProviderPaymentRunItems).values(openPayouts.map((row) => ({ runId: run.id, payoutId: row.id, amountDue: String(Math.max(0, rounded(numberValue(row.netAmount) - numberValue(row.amountPaid)))) })));
        return run;
      });
      res.status(201).json(result);
    } catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : "Unable to create provider payment run" }); }
  });

  app.post("/api/hq/transport/payment-runs/:id/disbursements", requireAuth, requireAnyPermission("transport.hq.disbursements.manage", "transport.organization.manage"), async (req, res) => {
    try {
      const user = requireHqUser(req); const runId = Number(req.params.id);
      const parsed = z.object({ paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), paymentMethod: z.enum(["cash", "bank_transfer", "mobile_money", "other"]).default("cash"), paymentReference: z.string().trim().nullable().optional(), collectorType: z.enum(["owner", "driver", "other"]), collectorOwnerId: z.coerce.number().int().positive().nullable().optional(), collectorDriverId: z.coerce.number().int().positive().nullable().optional(), collectorName: z.string().trim().nullable().optional(), collectorNationalId: z.string().trim().nullable().optional(), collectorPhone: z.string().trim().nullable().optional(), collectorRole: z.string().trim().nullable().optional(), notes: z.string().trim().nullable().optional(), allocations: z.array(z.object({ runItemId: z.coerce.number().int().positive(), amount: moneySchema })).min(1) }).parse(req.body);
      const [run] = await db.select().from(transportProviderPaymentRuns).where(and(eq(transportProviderPaymentRuns.id, runId), eq(transportProviderPaymentRuns.organizationId, user.organizationId!)));
      if (!run) return res.status(404).json({ message: "Provider payment run not found." });
      if (run.status === "paid") return res.status(409).json({ message: "This payment run is already fully paid." });
      const runItems = await db.select().from(transportProviderPaymentRunItems).where(eq(transportProviderPaymentRunItems.runId, runId));
      const itemMap = new Map(runItems.map((row) => [row.id, row]));
      if (parsed.allocations.some((row) => !itemMap.has(row.runItemId))) return res.status(400).json({ message: "One or more payout allocations do not belong to this payment run." });
      const existingAllocations = runItems.length ? await db.select().from(transportProviderDisbursementAllocations).where(inArray(transportProviderDisbursementAllocations.runItemId, runItems.map((row) => row.id))) : [];
      const paidByItem = new Map<number, number>(); existingAllocations.forEach((row) => paidByItem.set(row.runItemId, rounded((paidByItem.get(row.runItemId) || 0) + numberValue(row.amount))));
      for (const allocation of parsed.allocations) { const item = itemMap.get(allocation.runItemId)!; const remaining = rounded(numberValue(item.amountDue) - (paidByItem.get(item.id) || 0)); if (allocation.amount > remaining + 0.001) return res.status(409).json({ message: `Allocated amount exceeds the outstanding amount for payout item ${item.id}.` }); }
      if (parsed.allocations.some(row=>Math.abs(row.amount*100-Math.round(row.amount*100))>0.00001)) return res.status(400).json({message:'Payment allocations must use whole cents.'});
      const total = rounded(parsed.allocations.reduce((sum, row) => sum + row.amount, 0));
      if (parsed.collectorType === "owner") {
        if (!run.ownerId) return res.status(409).json({ message: "This payment run has no linked provider/owner." });
        if (parsed.collectorOwnerId && parsed.collectorOwnerId !== run.ownerId) return res.status(409).json({ message: "The selected owner is not the provider owed by this payment run." });
        parsed.collectorOwnerId = run.ownerId;
      }
      if (parsed.collectorType === "driver") {
        if (!parsed.collectorDriverId) return res.status(400).json({ message: "Select the driver who collected the payment." });
        const [driver] = await db.select().from(transportDrivers).where(eq(transportDrivers.id, parsed.collectorDriverId));
        if (!driver || (run.ownerId && Number(driver.ownerId || 0) !== Number(run.ownerId))) return res.status(409).json({ message: "The selected driver is not linked to this provider." });
      }
      if (parsed.collectorType === "other" && (!parsed.collectorName || !parsed.collectorNationalId)) return res.status(400).json({ message: "Full name and National ID are required for an authorised representative." });
      if (parsed.paymentMethod === "cash" && parsed.collectorType === "other" && !parsed.collectorPhone) return res.status(400).json({ message: "A contact phone is required for an external cash collector." });
      if (new Set(parsed.allocations.map((a)=>a.runItemId)).size !== parsed.allocations.length) return res.status(409).json({message:'Duplicate payout allocation in the same disbursement.'});
      const result = await db.transaction(async (tx) => {
        // Serialize disbursements for one run so simultaneous clerks cannot overpay it.
        await tx.execute(sql`SELECT id FROM transport_provider_payment_runs WHERE id = ${runId} FOR UPDATE`);
        const [lockedRun] = await tx.select().from(transportProviderPaymentRuns).where(eq(transportProviderPaymentRuns.id, runId));
        if (!lockedRun || lockedRun.status === 'paid') throw new Error('Provider payment run has already been settled');
        const lockedItems = await tx.select().from(transportProviderPaymentRunItems).where(eq(transportProviderPaymentRunItems.runId, runId));
        const prior = lockedItems.length ? await tx.select().from(transportProviderDisbursementAllocations).where(inArray(transportProviderDisbursementAllocations.runItemId, lockedItems.map(x=>x.id))) : [];
        for (const allocation of parsed.allocations) {
          const item = lockedItems.find(x=>x.id===allocation.runItemId);
          if (!item) throw new Error('Payment run item missing');
          const already = prior.filter(x=>x.runItemId===item.id).reduce((sum,x)=>sum+cents(x.amount),0);
          if (cents(allocation.amount) > cents(item.amountDue)-already) throw new Error('Payout already paid by another transaction. Refresh and retry.');
        }
        const [disbursement] = await tx.insert(transportProviderDisbursements).values({ runId, disbursementNumber: numberCode("DISB", user.organizationId!), amount: String(total), paymentDate: parsed.paymentDate, paymentMethod: parsed.paymentMethod, paymentReference: parsed.paymentReference || null, collectorType: parsed.collectorType, collectorOwnerId: parsed.collectorType === "owner" ? parsed.collectorOwnerId || null : null, collectorDriverId: parsed.collectorType === "driver" ? parsed.collectorDriverId || null : null, collectorName: parsed.collectorType === "other" ? parsed.collectorName || null : null, collectorNationalId: parsed.collectorNationalId || null, collectorPhone: parsed.collectorPhone || null, collectorRole: parsed.collectorRole || null, notes: parsed.notes || null, processedByUserId: user.id }).returning();
        await tx.insert(transportProviderDisbursementAllocations).values(parsed.allocations.map((row) => ({ disbursementId: disbursement.id, runItemId: row.runItemId, amount: String(row.amount) })));
        for (const allocation of parsed.allocations) {
          const item = itemMap.get(allocation.runItemId)!; const [payout] = await tx.select().from(transportHqPayouts).where(eq(transportHqPayouts.id, item.payoutId)); if (!payout) continue;
          const claimItems = await tx.select().from(transportHqClaimItems).where(eq(transportHqClaimItems.hqClaimId,payout.hqClaimId));
          if (!claimItems.length) throw new Error('HQ payout has no school claim items');
          const historical = await tx.select().from(transportHqDisbursementClaimAllocations).where(inArray(transportHqDisbursementClaimAllocations.schoolClaimId,claimItems.map(x=>x.schoolClaimId)));
          const claimAllocations = distributeToSchoolClaims(cents(allocation.amount),claimItems.map(x=>({
            schoolClaimId:x.schoolClaimId, netCents:cents(x.netAmount),
            recordedPaidCents:historical.filter(a=>a.schoolClaimId===x.schoolClaimId).reduce((sum,a)=>sum+cents(a.amount),0),
          })));
          await tx.insert(transportHqDisbursementClaimAllocations).values(claimAllocations.map(x=>({
            disbursementId:disbursement.id, schoolClaimId:x.schoolClaimId, amount:currency(x.amountCents),
          })));
          const newPaid = rounded(numberValue(payout.amountPaid) + allocation.amount); const payoutStatus = newPaid + 0.001 >= numberValue(payout.netAmount) ? "paid" : "partially_paid";
          await tx.update(transportHqPayouts).set({ amountPaid: String(newPaid), status: payoutStatus, updatedAt: new Date() }).where(eq(transportHqPayouts.id, payout.id));
          if (payoutStatus === "paid") {
            const itemLinks = await tx.select().from(transportHqClaimItems).where(eq(transportHqClaimItems.hqClaimId, payout.hqClaimId));
            if (itemLinks.length) await tx.update(transportClaims).set({ status: "paid" }).where(inArray(transportClaims.id, itemLinks.map((row) => row.schoolClaimId)));
            await tx.update(transportHqClaims).set({ status: "paid", updatedAt: new Date() }).where(eq(transportHqClaims.id, payout.hqClaimId));
          }
        }
        const newRunPaid = rounded(numberValue(lockedRun.amountPaid) + total); const runStatus = newRunPaid + 0.001 >= numberValue(lockedRun.totalDue) ? "paid" : "partially_paid";
        await tx.update(transportProviderPaymentRuns).set({ amountPaid: String(newRunPaid), status: runStatus, updatedAt: new Date() }).where(eq(transportProviderPaymentRuns.id, runId));
        return disbursement;
      });
      res.status(201).json(result);
    } catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : "Unable to record provider disbursement" }); }
  });

  app.get("/api/hq/transport/disbursements/:id/print", requireAuth, requireAnyPermission("transport.hq.payouts.manage", "transport.hq.disbursements.manage", "transport.organization.view"), async (req, res) => {
    try {
      const user = requireHqUser(req); const id = Number(req.params.id);
      const [d] = await db.select().from(transportProviderDisbursements).where(eq(transportProviderDisbursements.id, id)); if (!d) return res.status(404).send("Disbursement not found");
      const [run] = await db.select().from(transportProviderPaymentRuns).where(and(eq(transportProviderPaymentRuns.id, d.runId), eq(transportProviderPaymentRuns.organizationId, user.organizationId!))); if (!run) return res.status(404).send("Disbursement not found");
      const [owner] = run.ownerId ? await db.select().from(transportOwners).where(eq(transportOwners.id, run.ownerId)) : [null as any];
      const [driver] = d.collectorDriverId ? await db.select().from(transportDrivers).where(eq(transportDrivers.id, d.collectorDriverId)) : [null as any];
      const [processor] = await db.select().from(users).where(eq(users.id, d.processedByUserId));
      const collector = d.collectorType === "owner" ? owner?.name || "Provider / owner" : d.collectorType === "driver" ? `${driver?.firstName || ""} ${driver?.lastName || ""}`.trim() : d.collectorName || "Authorised representative";
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(d.disbursementNumber)}</title><style>@page{size:A4;margin:18mm}body{font-family:Arial,sans-serif;color:#111}h1,h2{text-align:center}.box{border:1px solid #aaa;padding:14px;margin:16px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.line{border-top:1px solid #111;margin-top:55px;padding-top:5px}</style></head><body><h1>First Choice Group of Schools</h1><h2>TRANSPORT PROVIDER PAYMENT ACKNOWLEDGEMENT</h2><div class="box"><div class="grid"><div><b>Disbursement:</b> ${escapeHtml(d.disbursementNumber)}</div><div><b>Payment run:</b> ${escapeHtml(run.runNumber)}</div><div><b>Provider:</b> ${escapeHtml(owner?.name || "—")}</div><div><b>Date:</b> ${escapeHtml(d.paymentDate)}</div><div><b>Amount:</b> USD ${numberValue(d.amount).toFixed(2)}</div><div><b>Method:</b> ${escapeHtml(d.paymentMethod)}</div><div><b>Collected by:</b> ${escapeHtml(collector)}</div><div><b>Collector type:</b> ${escapeHtml(d.collectorType)}</div><div><b>National ID:</b> ${escapeHtml(d.collectorNationalId || "—")}</div><div><b>Phone:</b> ${escapeHtml(d.collectorPhone || "—")}</div><div><b>Reference:</b> ${escapeHtml(d.paymentReference || "—")}</div><div><b>Processed by:</b> ${escapeHtml(processor ? `${processor.firstName || ""} ${processor.lastName || ""}`.trim() || processor.username : `User #${d.processedByUserId}`)}</div></div></div><p>I acknowledge receipt of the above transport-provider payment on behalf of the named provider.</p><div class="grid"><div class="line">Collector signature / acknowledgement</div><div class="line">FCGS Finance</div></div></body></html>`;
      const pdf = await renderHtmlPdf({ html, pdfOptions: { format: "A4", printBackground: true, preferCSSPageSize: true } }); const filename = reportPdfFilename(`Transport_Provider_Payment_${d.disbursementNumber}`); res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", `inline; filename="${filename}.pdf"`); res.send(pdf);
    } catch (error) { res.status(400).json({ message: error instanceof Error ? error.message : "Unable to generate payment acknowledgement" }); }
  });

  app.get("/api/hq/transport/overview.csv", requireAuth, requirePermission("transport.organization.export"), async (req, res) => {
    try {
      const user = requireHqUser(req); const overview = await buildTransportOverview(user.organizationId!); const headings = ["School", "Destinations", "Vehicles", "Learners", "Charges", "Collections", "Outstanding", "Collection Rate", "Open Incidents", "Open Claims", "Compliance Warnings"];
      const rows = overview.schools.map((row) => [row.schoolName, row.activeRoutes, row.activeVehicles, row.activeLearners, row.totalCharges.toFixed(2), row.totalCollections.toFixed(2), row.outstandingBalance.toFixed(2), `${row.collectionRate.toFixed(1)}%`, row.openIncidents, row.openClaims, row.complianceWarnings]);
      const csv = [headings, ...rows].map((row) => row.map(csvCell).join(",")).join("\n"); res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="hq-transport-oversight-${new Date().toISOString().slice(0, 10)}.csv"`); res.send(csv);
    } catch (error) { res.status(403).json({ message: error instanceof Error ? error.message : "Unable to export HQ transport oversight" }); }
  });
}
