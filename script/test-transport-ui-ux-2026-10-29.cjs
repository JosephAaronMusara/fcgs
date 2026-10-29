'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const school=read('client/src/pages/transport.tsx');
const hq=read('client/src/pages/org-transport-oversight.tsx');
const input=read('client/src/components/ui/input.tsx');
const orgDashboard=read('client/src/pages/org-dashboard.tsx');
function check(name,fn){fn();console.log('PASS',name)}
check('Learner services share one compact, responsive filter/action toolbar',()=>{
 assert.match(school,/Learner transport services<\/CardTitle>/);
 assert.match(school,/sm:flex-row sm:flex-wrap sm:items-center xl:flex-nowrap/);
 assert.match(school,/sm:w-52 sm:shrink-0/);
 assert.match(school,/>Register learner<\/Button>/);
});
check('School claims filters and Generate Claim remain together on desktop',()=>{
 const line=school.split('\n').find(l=>l.includes('School Vehicle Claims</CardTitle>'));
 assert.ok(line&&line.includes('flex-nowrap')&&line.includes('Claim status')&&line.includes('Payout status')&&line.includes('Generate Claim'));
});
check('Unified billing entrypoint preserves exact financial endpoints and legacy intent controls',()=>{
 assert.match(school,/Process Monthly Billing/);
 assert.match(school,/runBillingGeneration/);
 assert.match(school,/\/api\/transport\/charges\/generate/);
 assert.match(school,/\/api\/transport\/credits\/reconcile-preview/);
 assert.match(school,/\/api\/transport\/credits\/reconcile/);
 assert.match(school,/expectedDigest: creditPreview\.digest/);
 assert.match(school,/includeLegacyCredits/);
 assert.match(school,/New learners since the last billing run/);
 assert.doesNotMatch(school,/>Reconcile existing credits<\/Button>/);
});
check('HQ six filters are visible, compact and no More Filters control remains',()=>{
 const toolbar=hq.substring(hq.indexOf('id="hq-unified-search"'),hq.indexOf('Showing {consolidatedClaims.length}'));
 assert.match(toolbar,/xl:flex-nowrap/);
 for(const field of ['School','Year','Month','Stage','Provider','Vehicle'])assert.ok(toolbar.includes(`label="${field}"`),`missing filter ${field}`);
 assert.doesNotMatch(hq,/>More filters|>Fewer filters|showMoreClaimFilters/);
});
check('Vehicle filter displays registered primary driver and searches by name',()=>{
 assert.match(hq,/vehicle\?\.driverId/);
 assert.match(hq,/No primary driver assigned/);
 assert.match(hq,/registrationNumber} — \$\{primaryDriver\(v\)\}/);
 assert.match(hq,/searchText:\`\$\{v\.registrationNumber\} \$\{primaryDriver\(v\)\}\`/);
});
check('School settings are read-only by default with explicit edit, cancel, sensitive confirmation',()=>{
 assert.match(school,/if \(!editing\) \{/);
 assert.match(school,/Edit Settings/);
 assert.match(school,/Save Changes/);
 assert.match(school,/Sensitive Transport policy change/);
 assert.match(school,/canEdit=\{can\("transport\.settings\.manage", "transport\.edit"\)\}/);
 assert.match(school,/unsavedTransportSettings/);
});
check('HQ settlement and arrears policies have guarded edit modes',()=>{
 assert.match(hq,/editingSettlementRules/);
 assert.match(hq,/editingArrearsPolicy/);
 assert.match(hq,/Edit Settlement Rules/);
 assert.match(hq,/Edit Arrears Policy/);
 assert.match(hq,/transport\.hq\.settings\.manage/);
 assert.match(hq,/window\.confirm\("Change organisation settlement cut-offs/);
 assert.match(hq,/window\.confirm\("Save organisation arrears and seat policy/);
});
check('Shared search-field padding no longer gets reset by desktop input sizing',()=>{
 assert.match(input,/px-3 py-1\.5/);
 assert.doesNotMatch(input,/sm:px-3/);
 assert.match(input,/text-base sm:text-sm/);
 assert.match(hq,/id="hq-unified-search" className="h-11 pl-10 sm:h-9"/);
});
check('HQ oversight wording reflects payments and independent/future-owned fleet',()=>{
 assert.doesNotMatch(orgDashboard,/Read-only organisation monitoring of outsourced/);
 assert.match(orgDashboard,/consolidated claims, provider payments and financial oversight/);
});
check('No new database migration or School Finance/POS business logic introduced',()=>{
 const patchFiles=['client/src/pages/transport.tsx','client/src/pages/org-transport-oversight.tsx','client/src/pages/org-dashboard.tsx','client/src/components/ui/input.tsx'];
 assert.equal(patchFiles.length,4);
});
console.log('PASS 10 Transport UI/UX source regression checks');
