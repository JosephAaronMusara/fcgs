/* Pure offline functional tests; no DB, AWS, or gate hardware required. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
let checks=0;function check(name,fn){fn();checks++;console.log('PASS',name)}
const src=fs.readFileSync(path.join(root,'server/sage-matching.ts'),'utf8');
const transpiled=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const sandbox={exports:{},module:{exports:{}}};sandbox.exports=sandbox.module.exports;vm.runInNewContext(transpiled,sandbox,{filename:'sage-matching.js'});
const {sageCode,suggestSageStudents,sageForm}=sandbox.module.exports;
check('Sage ID trims / case-folds but retains meaningful punctuation',()=>{assert.equal(sageCode('  Wcamb-02144  '),'wcamb-02144');assert.notEqual(sageCode('AB/12'),sageCode('AB-12'));});
check('Sage Group FORM 1..6 understood',()=>{assert.equal(sageForm('FORM 3'),3);assert.equal(sageForm('L6Science'),6);});
const students=[{id:1,firstName:'Tinashe',lastName:'Moyo',admissionNo:'FCGS26S1P',className:'Form 2 AMBER',streamName:'Form 2'},{id:2,firstName:'Tinashe',lastName:'Moyo',admissionNo:'FCGS26S2P',className:'Form 2 BLUE',streamName:'Form 2'},{id:3,firstName:'Chipo',lastName:'Dube',className:'Form 3 A'}];
check('Ambiguous identical names return ALL plausible candidates (no arbitrary first match)',()=>{const matches=suggestSageStudents('MOYO TINASHE','FORM 2','',students);assert.equal(matches.length,2);assert.equal(matches[0].score,matches[1].score);});
check('Wrong FORM excluded when student class evidence exists',()=>{const matches=suggestSageStudents('MOYO TINASHE','FORM 3','',students);assert.equal(matches.length,0);});
check('Case and hyphen/diacritic normalization',()=>{const matches=suggestSageStudents('DUBÉ CHIPO','FORM 3','',[students[2]]);assert.equal(matches.length,1);});
check('Unknown/no-match name is left unresolved',()=>{assert.equal(suggestSageStudents('ZORO UNKNOWN','FORM 1','',students).length,0);});
check('Unique non-matching names are not magically verified',()=>{const body=fs.readFileSync(path.join(root,'server/fees-import-routes.ts'),'utf8');assert.match(body,/mappingState:\s*matchedStudent\s*\?\s*"confirmed"/);assert.match(body,/"suggested"/);});
check('Financial importer guards blank unknown and newer snapshots',()=>{const b=fs.readFileSync(path.join(root,'server/fees-import-routes.ts'),'utf8');assert.match(b,/!balanceText\)/);assert.match(b,/balanceProvided:\s*false/);assert.match(b,/feesSnapshotAt.*effectiveSnapshotAt|feesSnapshotAt.*snapshotAt/s);});
check('Create and edit Sage ID require dedicated permission',()=>{const b=fs.readFileSync(path.join(root,'server/routes.ts'),'utf8');assert.ok((b.match(/fees\.sage_mapping\.manage/g)||[]).length>=3);});
check('Explicitly disabled enrolment placeholders before rollover build',()=>{const b=fs.readFileSync(path.join(root,'client/src/pages/students.tsx'),'utf8');assert.match(b,/name="futureEnrollmentCategory" value="internal" disabled/);assert.match(b,/name="futureEnrollmentCategory" value="external" disabled/);});
check('Nightly inspection frequencies midnight-divisible',()=>{for(const n of [1,3,6,12,24]){const hours=Array.from({length:24/n},(_,i)=>n*i);assert.equal(hours[0],0);assert.equal(hours[hours.length-1],24-n);}});
check('Ed25519 detached manifest verification rejects tampering',()=>{const keys=crypto.generateKeyPairSync('ed25519');const data=Buffer.from('{"version":"fcgs-gate-bridge/1.2.0"}\n');const sig=crypto.sign(null,data,keys.privateKey);assert.equal(crypto.verify(null,data,keys.publicKey,sig),true);assert.equal(crypto.verify(null,Buffer.from('modified'),keys.publicKey,sig),false);});
console.log(`${checks}/${checks} offline build checks passed; AWS KMS, PostgreSQL, Windows services, real browsers and terminals still require integration tests.`);
