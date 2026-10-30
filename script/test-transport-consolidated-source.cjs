const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const read=f=>fs.readFileSync(f,'utf8');
const files=['server/transport-routes.ts','server/hq-operations-routes.ts','server/transport-hq-financials.ts','server/transport-hq-one-step.ts','server/transport-hq-settlement-groups.ts','server/transport-settlement-calendar.ts','server/transport-advance-repayments.ts','client/src/pages/transport.tsx','client/src/pages/org-transport-oversight.tsx','shared/schema.ts'];
for(const f of files){const t=read(f),p=ts.createSourceFile(f,t,ts.ScriptTarget.Latest,true,f.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);assert.equal(p.parseDiagnostics.length,0,`${f} syntax: ${p.parseDiagnostics.map(e=>e.messageText).join(',')}`);console.log('PASS syntax',f)}
const one=read('server/transport-hq-one-step.ts'),repay=read('server/transport-advance-repayments.ts'),transport=read('server/transport-routes.ts'),org=read('client/src/pages/org-transport-oversight.tsx'),sch=read('shared/schema.ts');
for(const symbol of ['pg_advisory_xact_lock','requestHash','applyProviderAdvanceOffsets','transportHqDisbursementClaimAllocations','distributeToSchoolClaims','includeProvider','amountPaid','transportProviderDisbursements'])assert(one.includes(symbol),symbol);
assert(one.includes('for(const allocation of allocations)await applyProviderAdvanceOffsets'), 'Advance recovery must be on actually selected disbursements');
assert(repay.includes("recordedByUserId===ctx.user.id") && repay.includes('FOR UPDATE') && repay.includes("cashup.status!=='hq_confirmed'"));
assert(transport.includes('cashupAdvanceRepayments') && transport.includes('advanceRepaymentIds') && transport.includes('settlementPolicySnapshot'));
assert(org.includes('Claims &amp; Payments') && org.includes('Confirm &amp; Record') && !org.includes('<TabsTrigger value="payments"'));
for(const key of ['transportAdvanceRepayments','transportHqSettlementRequests','transportHqAdvanceRecoveries'])assert(sch.includes(key));
console.log('PASS settlement, cash-up, advance, RBAC entrypoints and source contracts');
