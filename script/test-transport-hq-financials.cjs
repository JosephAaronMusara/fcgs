const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let ts;
try { ts = require('typescript'); } catch(e) {
  throw new Error('TypeScript dependency missing. Run npm ci in the FCGS repository before the HQ financial tests.');
}
const source = fs.readFileSync(path.resolve(__dirname,'../server/transport-hq-financials.ts'),'utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},reportDiagnostics:true});
assert.equal((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const mod = {exports:{}};vm.runInNewContext(compiled.outputText,{exports:mod.exports,module:mod});
const {cents,currency,classifyTransportDeduction,effectiveDeductions,isEarnedClass,distributeToSchoolClaims}=mod.exports;
const t=(name,fn)=>{fn(); console.log('PASS',name)};
t('exact cents arithmetic',()=>{assert.equal(cents('45.67'),4567);assert.equal(currency(4567),'45.67')});
t('subscriptions are earned income',()=>assert.equal(classifyTransportDeduction('subscription'),'subscription'));
t('penalties are earned income',()=>assert.equal(classifyTransportDeduction('penalty'),'penalty'));
t('advance principal is recovery, NOT income',()=>assert.equal(isEarnedClass(classifyTransportDeduction('advance')),false));
t('refund recovery is NOT earned income',()=>assert.equal(isEarnedClass(classifyTransportDeduction('refund')),false));
t('unknown provider deductions are never silently income',()=>assert.equal(isEarnedClass(classifyTransportDeduction('other','supplier_debt')),false));
t('explicit admin fee is income',()=>assert.equal(classifyTransportDeduction('other','administration_fee'),'administration'));
t('capped claims never overstate posted deductions',()=>{
const lines=effectiveDeductions([{id:1,deductionType:'subscription',priority:1,sourceId:5,amount:'100'}, {id:2,deductionType:'advance',priority:2,sourceId:3,amount:'200'}],'150');
assert.equal(lines[0].effectiveCents,10000);assert.equal(lines[1].effectiveCents,5000);assert.equal(lines.reduce((sum,x)=>sum+x.effectiveCents,0),15000);
});
t('same-priority deductions have stable ID order',()=>{
const lines=effectiveDeductions([{id:2,deductionType:'penalty',priority:1,sourceId:null,amount:'30'}, {id:1,deductionType:'subscription',priority:1,sourceId:null,amount:'30'}],'40');
assert.equal(lines[0].id,1);assert.equal(lines[1].effectiveCents,1000);
});
t('provider disbursement allocates to oldest school claim first',()=>{
const x=distributeToSchoolClaims(7000,[{schoolClaimId:10,netCents:5000,recordedPaidCents:0},{schoolClaimId:5,netCents:4000,recordedPaidCents:0}]);
assert.deepEqual(JSON.parse(JSON.stringify(x)),[{schoolClaimId:5,amountCents:4000},{schoolClaimId:10,amountCents:3000}]);
});
t('partial school payment respects already tracked claim payments',()=>{
const x=distributeToSchoolClaims(4000,[{schoolClaimId:1,netCents:3000,recordedPaidCents:2000},{schoolClaimId:2,netCents:6000,recordedPaidCents:0}]);
assert.deepEqual(JSON.parse(JSON.stringify(x)),[{schoolClaimId:1,amountCents:1000},{schoolClaimId:2,amountCents:3000}]);
});
t('cannot disburse more than remaining claim entitlements',()=>{
assert.throws(()=>distributeToSchoolClaims(4000,[{schoolClaimId:1,netCents:3000,recordedPaidCents:1000}]));
});
console.log('PASS 12 HQ income and school-claim attribution tests');
