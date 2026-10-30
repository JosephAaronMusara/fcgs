/** Execute with: node script/test-transport-credit-allocation.cjs
 * Requires devDependencies (TypeScript) from existing FCGS package.json.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const sourcePath = path.join(__dirname, '../server/transport-credit-engine.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, { fileName: sourcePath, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const engineModule = new Module(sourcePath, module);
engineModule.filename = sourcePath;
engineModule.paths = module.paths;
engineModule._compile(compiled, sourcePath);
const { createTransportCreditPlan: plan, transportMoney } = engineModule.exports;
const cents = (o) => o.totalAllocatedCents;
const p = (id, amount, extra={}) => ({id,studentId:1,amount:String(amount),allocated:'0',currencyCode:'USD',academicYear:2026,month:0,allocationMode:'oldest_first',allocationChargeIds:null,...extra});
const c = (id, month, amount, extra={}) => ({id,studentId:1,academicYear:2026,month,vehicleId:99,currencyCode:'USD',amount:String(amount),allocated:'0',adjustment:'0',...extra});
const run = (payments,charges,allocations=[],refunds=[],locks=[],options={}) => plan(7,payments,charges,allocations,refunds,locks,options);
let passed=0;
const test=(name, fn)=>{fn();passed++;console.log('PASS',name)};
test('payment before billing, partial balance',()=>{const o=run([p(1,30)],[c(8,10,75)]);assert.equal(cents(o),3000);assert.equal(o.operations[0].vehicleId,99)});
test('multi-month prepayment allocates progressively, not future entitlements',()=>{const o=run([p(1,225)],[c(8,10,75),c(9,11,75)],[],[],[],{maxPeriod:202610});assert.equal(cents(o),7500);assert.equal(o.remainingUnallocatedCents,15000);const next=run([p(1,225,{allocated:'75'})],[c(8,10,75,{allocated:'75'}),c(9,11,75)]);assert.equal(cents(next),7500);});
test('oldest charge allocated first',()=>{const o=run([p(1,100)],[c(1,9,50),c(2,10,75)]);assert.deepEqual(o.operations.map(r=>r.amountCents),[5000,5000])});
test('legacy month hint conservatively avoids earlier charge',()=>{const o=run([p(1,100,{month:10,allocationMode:'legacy_unclassified'})],[c(1,9,50),c(2,10,75)],[],[],[],{includeLegacy:true});assert.deepEqual(o.operations.map(r=>r.chargeId),[2])});
test('normal oldest first retains existing allocation ordering even when receipt has month label',()=>{const o=run([p(1,100,{month:10})],[c(1,9,50),c(2,10,75)]);assert.deepEqual(o.operations.map(r=>r.chargeId),[1,2])});
test('explicit future credit never auto allocates',()=>{const o=run([p(1,225,{allocationMode:'future_credit'})],[c(1,10,75)]);assert.equal(cents(o),0);assert.equal(o.excluded.held,22500)});
test('legacy intent is excluded until authorized; no mutation on preview',()=>{const x=[p(1,100,{allocationMode:'legacy_unclassified'})],y=[c(1,10,75)];assert.equal(cents(run(x,y)),0);assert.equal(cents(run(x,y,[],[],[],{includeLegacy:true})),7500);assert.equal(y[0].allocated,'0')});
test('partial earlier allocation extends the same pair (not duplicated)',()=>{const o=run([p(1,75,{allocated:'20'})],[c(1,10,75,{allocated:'20'})],[{id:9,paymentId:1,chargeId:1,amount:'20',claimed:false}]);assert.equal(cents(o),5500);assert.equal(o.operations[0].existingAllocationId,9);assert.equal(transportMoney(o.operations[0].existingAmountCents+o.operations[0].amountCents),'75.00')});
test('claimed allocation is immutable',()=>{const o=run([p(1,75,{allocated:'20'})],[c(1,10,75,{allocated:'20'})],[{id:9,paymentId:1,chargeId:1,amount:'20',claimed:true}]);assert.equal(cents(o),0)});
test('locked settlements untouched',()=>{const o=run([p(1,100)],[c(1,9,50),c(2,10,75)],[],[],[{year:2026,month:9}]);assert.equal(cents(o),7500);assert.equal(o.operations[0].chargeId,2)});
test('refunds reserve returned cash',()=>{const o=run([p(1,100)],[c(1,10,100)],[],[{studentId:1,refunded:'30'}]);assert.equal(cents(o),7000);assert.equal(o.remainingUnallocatedCents,3000)});
test('different learners and currencies cannot consume each others balances',()=>{const o=run([p(1,75)],[c(1,10,75,{studentId:2}),c(2,10,75,{currencyCode:'ZAR'})]);assert.equal(cents(o),0)});
test('specific designation restricts to selected charges',()=>{const o=run([p(1,120,{allocationMode:'specific',allocationChargeIds:[2]})],[c(1,10,75),c(2,11,75)]);assert.equal(cents(o),7500);assert.equal(o.operations[0].chargeId,2)});
test('digest changes when eligible plan changes',()=>{assert.notEqual(run([p(1,75)],[c(1,10,75)]).digest,run([p(1,65)],[c(1,10,75)]).digest)});
test('already settled charges do not allocate again',()=>{assert.equal(cents(run([p(1,75,{allocated:'75'})],[c(1,10,75,{allocated:'75'})])),0)});
console.log(`PASS ${passed} Transport credit allocation tests`);
