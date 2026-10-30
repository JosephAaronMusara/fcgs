const fs=require('node:fs');const assert=require('node:assert/strict');
const ts=require('typescript');
for(const [filename,kind] of [['client/src/pages/org-transport-oversight.tsx',ts.ScriptKind.TSX],['server/hq-operations-routes.ts',ts.ScriptKind.TS],['server/transport-hq-financials.ts',ts.ScriptKind.TS],['shared/schema.ts',ts.ScriptKind.TS]]){
 const s=fs.readFileSync(filename,'utf8');const tree=ts.createSourceFile(filename,s,ts.ScriptTarget.Latest,true,kind);
 if(tree.parseDiagnostics.length) throw new Error(`${filename}: ${tree.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'; '))}`);
 console.log('PASS syntax',filename)
}
const route=fs.readFileSync('server/hq-operations-routes.ts','utf8'), ui=fs.readFileSync('client/src/pages/org-transport-oversight.tsx','utf8');
for(const x of ['transportHqDisbursementClaimAllocations','distributeToSchoolClaims','FOR UPDATE','/api/hq/transport/income','/api/hq/transport/income.csv','buildTransportIncomeReport']) assert.ok(route.includes(x),x);
for(const x of ['value="schoolClaims"','value="payments"','value="income"','setClaimMonth','setClaimYear','setPayoutStatus','claimSearch.trim().toLowerCase()','paymentsSearch.trim().toLowerCase()','hasLegacyUnattributedPayment','Fill outstanding']) assert.ok(ui.includes(x),x);
for(const x of ['"hqClaims"','"payouts"','"runs"'])assert.ok(!ui.includes(`<TabsTrigger value=${x}`),'old settlement tab still exposed');
console.log('PASS HQ workflow and financial source contract checks');
