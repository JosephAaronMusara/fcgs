/** Offline integration tests: real Ed25519 signing and real filesystem, fake PostgreSQL transaction boundary.
 * NO production database, AWS credentials or network required. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

const SOURCE = path.resolve(__dirname, 'publish-signed-gate-bridge-release.ts');
const approvedAssets = ['node.exe','FCGSGateBridgeService.exe','gate-bridge.cjs','Start-GateBridge.ps1','Update-GateBridge.ps1','LICENSE-Node.txt','LICENSE-WinSW.txt','THIRD_PARTY_NOTICES.md'];
const arn='arn:aws:kms:af-south-1:359793380982:key/c746a4fa-cfeb-444a-90b3-a6055b799d00';
const sum = v=>crypto.createHash('sha256').update(v).digest('hex');
// Real filesystem symlinks on Unix; restricted Windows often denies symlink creation.
// When Windows denies the operation, simulate only lstat().isSymbolicLink()
// inside the isolated VM test harness, never in the production publisher.
async function symlinkForTest(f, target, linkPath) {
  if (process.env.FCGS_TEST_FORCE_SYMLINK_SIMULATION === '1') {
    await fsp.copyFile(target, linkPath);
    f.syntheticSymlinkPaths.add(path.resolve(linkPath));
    return;
  }
  try {
    await fsp.symlink(target, linkPath);
  } catch (err) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOTSUP'].includes(err.code)) throw err;
    await fsp.copyFile(target, linkPath);
    f.syntheticSymlinkPaths.add(path.resolve(linkPath));
  }
}
const sourceCode = fs.readFileSync(SOURCE, 'utf8');
assert.match(sourceCode, /await client\.query\('COMMIT'\)/);
const testSource = sourceCode.replace(/main\(\)\.catch\(e=>\{console\.error\('Signed release publication\/approval BLOCKED:',e\.message\);process\.exitCode=1;\}\);\s*$/, '(globalThis).__invokePublisher = main;');
assert.notEqual(testSource,sourceCode,'Test harness must locate the real script entrypoint');
const compiled = ts.transpileModule(testSource,{ compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
let tests=0;
async function fixture() {
 const base=await fsp.mkdtemp(path.join(os.tmpdir(),'fcgs-publication-recovery-test-'));
 const src=path.join(base,'verified_signed');
 const root=path.join(base,'gate-bridge-releases');
 await fsp.mkdir(path.join(src,'assets'),{recursive:true});
 const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
 const pubPath=path.join(base,'public.pem');
 await fsp.writeFile(pubPath,publicKey.export({type:'spki',format:'pem'}));
 const assets=[];
 for(let i=0;i<approvedAssets.length;i++){
  const name=approvedAssets[i],data=Buffer.from(`FCGS-TEST-ONLY-${name}-${'X'.repeat(100+i)}`);
  await fsp.writeFile(path.join(src,'assets',name),data);
  assets.push({name,size:data.length,sha256:sum(data)});
 }
 const releaseId='fcgs_bridge_1_1_1_pilot_01';
 const manifest=Buffer.from(JSON.stringify({releaseId,version:'fcgs-gate-bridge/1.1.1',platform:'win32-x64',protocolVersion:1,assets}));
 await fsp.writeFile(path.join(src,'manifest.json'),manifest);
 await fsp.writeFile(path.join(src,'manifest.sig'),crypto.sign(null,manifest,privateKey));
 await fsp.writeFile(path.join(src,'signer-key-id.txt'),arn+'\n');
 return {base,src,root,releaseId,publicKey,privateKey,pubPath,pinned:sum(publicKey.export({type:'spki',format:'der'})),rows:new Map(),failure:null,syntheticSymlinkPaths:new Set()};
}
async function invoke(f,flags={}) {
 const fixture=f;
 class FakeClient {
  async connect() {}
  async end() {}
  async query(sql,params=[]){
   if(sql==='BEGIN') { this.pending=new Map(fixture.rows);return {rows:[]};}
   if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
   if(sql.startsWith('SELECT release_id'))return {rows:this.pending.has(params[0])?[{release_id:params[0]}]:[]};
   if(sql.startsWith('INSERT INTO gate_bridge_signed_releases')){
    if(fixture.failure==='INSERT')throw new Error('Injected PostgreSQL insert failure');
    const [id,version,protocol,manifestSha,signer]=params;
    if(this.pending.has(id)||[...this.pending.values()].some(row=>row.version===version))return {rows:[]};
    this.pending.set(id,{releaseId:id,version,protocol,manifestSha,signer,approved:false});return {rows:[{release_id:id}]};
   }
   if(sql==='COMMIT'){
    if(fixture.failure==='COMMIT')throw new Error('Injected PostgreSQL commit failure');
    fixture.rows=new Map(this.pending);return {rows:[]};
   }
   if(sql==='ROLLBACK'){this.pending=null;return {rows:[]};}
   throw new Error('Unexpected SQL query: '+sql);
  }
 }
 const lines=[];
 const context={
  console:{log:msg=>lines.push(String(msg)),error:msg=>lines.push('ERR '+String(msg))},
  process:{cwd:()=>f.base,pid:process.pid,env:{DATABASE_URL:'postgresql://offline-test-no-network',FCGS_RELEASE_PUBLISH_KMS_KEY_ARN:arn,FCGS_RELEASE_PUBLISH_PUBLIC_KEY_SHA256:f.pinned,FCGS_RELEASE_PUBLISH_PUBLIC_KEY_PEM:f.pubPath},argv:['node',SOURCE,'publish',f.releaseId,f.src]},
  require:(id)=>id==='pg'?{Client:FakeClient}:id==='dotenv/config'?{}:
     id==='node:fs/promises'?{...fsp,lstat:async p=>{
       const info=await fsp.lstat(p);
       // Model the OS lstat response for a symlink when Windows denies creation.
       return fixture.syntheticSymlinkPaths.has(path.resolve(String(p)))
         ? new Proxy(info,{get(target,property,receiver){
             if(property==='isSymbolicLink')return ()=>true;
             return Reflect.get(target,property,receiver);
           }})
         : info;
     }}:require(id),
  Buffer, exports:{}, module:{exports:{}},
 };
 vm.runInNewContext(compiled,context,{filename:SOURCE});
 try {await context.__invokePublisher();if(flags.expectFailure)throw new Error('Expected publication failure but it succeeded: '+lines.join('; '));} 
 catch(e){if(!flags.expectFailure)throw e; if(flags.message && !String(e.message).includes(flags.message))throw new Error(`Unexpected failure: ${e.message}`);return String(e.message)}
 return lines.join('\n');
}
async function scenario(name,fn){
 const f=await fixture();
 try{await fn(f);console.log('PASS '+name+(f.syntheticSymlinkPaths.size?' [Windows symlink simulated]':''));tests++;}
 finally{await fsp.rm(f.base,{recursive:true,force:true});}
}
(async()=>{
 await scenario('normal publication is durable and NOT APPROVED',async f=>{
  await invoke(f);
  assert.equal(f.rows.get(f.releaseId).approved,false);
  assert.equal((await fsp.readdir(path.join(f.root,f.releaseId,'assets'))).length,8);
  assert.equal((await fsp.readdir(f.root)).length,1);
 });
 await scenario('second publication rejects an immutable existing release',async f=>{
  await invoke(f);
  await invoke(f,{expectFailure:true,message:'already registered'});
  assert.equal(f.rows.size,1);
 });
 await scenario('database insert failure cleans pending files and commits nothing',async f=>{
  f.failure='INSERT';
  await invoke(f,{expectFailure:true,message:'Injected PostgreSQL insert failure'});
  assert.equal(f.rows.size,0);
  assert.deepEqual(await fsp.readdir(f.root),[]);
 });
 await scenario('commit failure leaves a safely recoverable complete orphan',async f=>{
  f.failure='COMMIT';
  await invoke(f,{expectFailure:true,message:'Injected PostgreSQL commit failure'});
  assert.equal(f.rows.size,0);
  assert.equal((await fsp.readdir(f.root)).length,1);
  f.failure=null;
  const result=await invoke(f);
  assert.match(result,/Recovered interrupted and published/);
  assert.equal(f.rows.get(f.releaseId).approved,false);
 });
 await scenario('corrupted orphan cannot be recovered or overwritten',async f=>{
  f.failure='COMMIT';await invoke(f,{expectFailure:true});f.failure=null;
  const a=path.join(f.root,f.releaseId,'assets','node.exe');
  await fsp.appendFile(a,'BAD');
  await invoke(f,{expectFailure:true,message:'Stored release asset differs'});
  assert.equal(f.rows.size,0);
  assert.ok((await fsp.readFile(a)).includes(Buffer.from('BAD')));
 });
 await scenario('unexpected file in orphan blocks recovery',async f=>{
  f.failure='COMMIT';await invoke(f,{expectFailure:true});f.failure=null;
  await fsp.writeFile(path.join(f.root,f.releaseId,'unexpected.txt'),'x');
  await invoke(f,{expectFailure:true,message:'Unexpected files'});
  assert.equal(f.rows.size,0);
 });
 await scenario('symlink in orphan blocks recovery',async f=>{
  f.failure='COMMIT';await invoke(f,{expectFailure:true});f.failure=null;
  const a=path.join(f.root,f.releaseId,'assets','node.exe');
  await fsp.unlink(a);
  await symlinkForTest(f,path.join(f.src,'assets','node.exe'),a);
  await invoke(f,{expectFailure:true,message:'Stored release asset differs'});
  assert.equal(f.rows.size,0);
 });
 await scenario('modified signature rejects before filesystem publication',async f=>{
  await fsp.writeFile(path.join(f.src,'manifest.sig'),Buffer.alloc(64,0));
  await invoke(f,{expectFailure:true,message:'Invalid AWS KMS Ed25519 signature'});
  assert.equal(f.rows.size,0);
 });
 await scenario('metadata symlink rejected before publication',async f=>{
  const manifest=path.join(f.src,'manifest.json');
  await fsp.rename(manifest,manifest+'.old');
  await symlinkForTest(f,manifest+'.old',manifest);
  await invoke(f,{expectFailure:true,message:'metadata must be regular files'});
  assert.equal(f.rows.size,0);
 });
 console.log(`\n${tests}/${tests} offline release-publisher recovery tests passed.`);
})().catch(error=>{console.error(error);process.exitCode=1});
