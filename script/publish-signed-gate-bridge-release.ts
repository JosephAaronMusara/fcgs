/** Operator-only release publisher. No AWS signing key or signing permission on Portal. */
import 'dotenv/config';
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { readFile, readdir, mkdir, cp, rename, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
const root=path.resolve(process.cwd(),'gate-bridge-releases');
const approvedAssetNames=new Set(['node.exe','FCGSGateBridgeService.exe','gate-bridge.cjs','Start-GateBridge.ps1','Update-GateBridge.ps1','LICENSE-Node.txt','LICENSE-WinSW.txt','THIRD_PARTY_NOTICES.md']);
const mode=process.argv[2];
const id=process.argv[3];
const source=process.argv[4];
const expectedArn=process.env.FCGS_RELEASE_PUBLISH_KMS_KEY_ARN;
const pinnedSha=process.env.FCGS_RELEASE_PUBLISH_PUBLIC_KEY_SHA256;
const publicPath=process.env.FCGS_RELEASE_PUBLISH_PUBLIC_KEY_PEM;
const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
const safeId=(v:string)=>/^[a-zA-Z0-9_-]{5,100}$/.test(v||'');
/** Verify a complete staged or interrupted release against bytes authenticated by the signed manifest.
 * Reject symlinks, unexpected entries and altered assets; never auto-delete an unrecognised directory.
 */
async function assertExactReleaseTree(dir:string, manifestBytes:Buffer, signature:Buffer, signerBytes:Buffer, assets:{name:string,size:number,sha256:string}[]){
 const directory=await lstat(dir);
 if(!directory.isDirectory()||directory.isSymbolicLink())throw new Error('Release destination is not a regular directory');
 const expectedTop=['assets','manifest.json','manifest.sig','signer-key-id.txt'].sort();
 const top=(await readdir(dir)).sort();
 if(JSON.stringify(top)!==JSON.stringify(expectedTop))throw new Error('Unexpected files in the release destination; recovery refused');
 for(const [name,original] of [['manifest.json',manifestBytes],['manifest.sig',signature],['signer-key-id.txt',signerBytes]] as [string,Buffer][]){
  const file=path.join(dir,name),info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||!(await readFile(file)).equals(original))throw new Error(`Release metadata differs from approved package: ${name}`);
 }
 const assetDir=path.join(dir,'assets'),assetDirInfo=await lstat(assetDir);
 if(!assetDirInfo.isDirectory()||assetDirInfo.isSymbolicLink())throw new Error('Release asset directory must not be a symbolic link');
 const expectedAssets=assets.map(a=>a.name).sort();
 if(JSON.stringify((await readdir(assetDir)).sort())!==JSON.stringify(expectedAssets))throw new Error('Unexpected files in the release assets; recovery refused');
 for(const asset of assets){
  const file=path.join(assetDir,asset.name),info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.size!==asset.size||sha(await readFile(file))!==asset.sha256)throw new Error(`Stored release asset differs from approved manifest: ${asset.name}`);
 }
}
async function main(){
 if(!safeId(id))throw new Error('Require immutable, safe release ID');
 if(!['publish','approve','promote'].includes(mode))throw new Error('Usage: tsx script/publish-signed-gate-bridge-release.ts publish RELEASE_ID SIGNED_PACKAGE_DIR | approve RELEASE_ID APPROVER_CHANGE_REFERENCE');
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
 const client=new pg.Client({connectionString:process.env.DATABASE_URL});
 try{await client.connect();
  if(mode==='publish'){
   if(!source)throw new Error('Signed package directory required');
   if(!expectedArn?.startsWith('arn:aws:kms:af-south-1:')||!pinnedSha?.match(/^[a-fA-F0-9]{64}$/)||!publicPath)throw new Error('Independent KMS key ARN, public PEM and pinned DER SHA-256 must be provided');
   const pub=createPublicKey(await readFile(publicPath));
   const der=pub.export({type:'spki',format:'der'}) as Buffer;
   if(sha(der)!==pinnedSha.toLowerCase())throw new Error('Public verification key does not match independently pinned fingerprint');
   const metadataNames=['manifest.json','manifest.sig','signer-key-id.txt'];
   for(const name of metadataNames){
    const meta=await lstat(path.resolve(source,name));
    if(!meta.isFile()||meta.isSymbolicLink())throw new Error(`Signed release metadata must be regular files: ${name}`);
   }
   const manifestBytes=await readFile(path.resolve(source,'manifest.json'));
   const signature=await readFile(path.resolve(source,'manifest.sig'));
   const signerBytes=await readFile(path.resolve(source,'signer-key-id.txt'));
   const signer=signerBytes.toString('utf8').trim();
   if(signer!==expectedArn)throw new Error('Signer key ARN differs from independently approved signing authority');
   if(signature.length!==64||!verify(null,manifestBytes,pub,signature))throw new Error('Invalid AWS KMS Ed25519 signature');
   const manifest=JSON.parse(manifestBytes.toString('utf8'));
   if(manifest.releaseId!==id||!/^fcgs-gate-bridge\/\d+\.\d+\.\d+$/.test(manifest.version)||manifest.platform!=='win32-x64'||manifest.protocolVersion!==1)throw new Error('Invalid or incompatible release manifest');
   if(!Array.isArray(manifest.assets)||manifest.assets.length!==approvedAssetNames.size||new Set(manifest.assets.map((a:any)=>a.name)).size!==approvedAssetNames.size)throw new Error('Unexpected release asset inventory');
   for(const asset of manifest.assets){
    if(!approvedAssetNames.has(asset.name)||!Number.isSafeInteger(asset.size)||asset.size<8||asset.size>150_000_000||!/^([0-9a-f]{64})$/.test(asset.sha256))throw new Error('Invalid signed release asset description');
    const file=path.resolve(source,'assets',asset.name);
    const info=await lstat(file);
    if(!info.isFile()||info.isSymbolicLink())throw new Error(`Symbolic links or non-files are forbidden: ${asset.name}`);
    const data=await readFile(file);
    if(data.length!==asset.size||sha(data)!==asset.sha256)throw new Error(`Signed asset corrupted: ${asset.name}`);
   }
   await mkdir(root,{recursive:true});
   const target=path.join(root,id);
   // PostgreSQL controls the publication lock and commit. The immutable filesystem
   // destination is revalidated and recoverable after an interrupted rename/commit.
   const temp=path.join(root,`.pending_${process.pid}_${randomUUID()}_${id}`);
   let transactionOpen=false;
   let recovery=false;
   try{
    await client.query('BEGIN');transactionOpen=true;
    await client.query('SELECT pg_advisory_xact_lock(1180051270, hashtext($1::text))',[id]);
    const registered=await client.query('SELECT release_id FROM gate_bridge_signed_releases WHERE release_id=$1',[id]);
    if(registered.rows.length)throw new Error('This signed release is already registered; immutable publication refused');
    let existing;
    try{existing=await lstat(target);}catch(e:any){if(e?.code!=='ENOENT')throw e;}
    if(existing){
     // A previous process may have been interrupted AFTER installing the complete
     // directory, but BEFORE committing its database row. Recover only if every
     // byte and filename matches this independently verified signed release.
     await assertExactReleaseTree(target,manifestBytes,signature,signerBytes,manifest.assets);
     recovery=true;
    }else{
     await mkdir(temp,{recursive:false});
     for(const name of metadataNames)await cp(path.resolve(source,name),path.join(temp,name),{errorOnExist:true,force:false});
     await mkdir(path.join(temp,'assets'));
     for(const asset of manifest.assets)await cp(path.resolve(source,'assets',asset.name),path.join(temp,'assets',asset.name),{errorOnExist:true,force:false});
     // Re-verify copied bytes to prevent source changes during staging.
     await assertExactReleaseTree(temp,manifestBytes,signature,signerBytes,manifest.assets);
    }
    const result=await client.query(`INSERT INTO gate_bridge_signed_releases (release_id,version,protocol_version,manifest_sha256,signed_by_key_id,approved) VALUES ($1,$2,$3,$4,$5,false) ON CONFLICT DO NOTHING RETURNING release_id`,[id,manifest.version,manifest.protocolVersion,sha(manifestBytes),signer]);
    if(!result.rows.length)throw new Error('Conflicting release ID or version; immutable publication refused');
    // The DB row is not visible until COMMIT, performed AFTER the complete
    // verified release tree exists at its final immutable path.
    if(!recovery)await rename(temp,target);
    await client.query('COMMIT');transactionOpen=false;
    console.log(`${recovery?'Recovered interrupted and published':'Published'} signed release ${id} (${manifest.version}) as NOT APPROVED. No Windows computer will install until explicitly approved.`);
   }catch(e){
    if(transactionOpen){
     try{await client.query('ROLLBACK');}catch(rollbackError){console.error('Database rollback could not be confirmed:',rollbackError);}
    }
    // If the process stopped after rename, the matching unregistered directory
    // intentionally remains. The next attempt can verify and safely recover it.
    throw e;
   }finally{
    await rm(temp,{recursive:true,force:true});
   }
  } else {
   const approver=String(source||'').trim();
   if(approver.length<8||approver.length>200)throw new Error('Explicit approval change reference required (minimum 8 characters)');
   // Still independently verify immutable content immediately before approval.
   if(!expectedArn||!pinnedSha||!publicPath)throw new Error('The independent KMS verification environment must also be provided for approval');
   const pub=createPublicKey(await readFile(publicPath));const der=pub.export({type:'spki',format:'der'}) as Buffer;
   if(sha(der)!==pinnedSha.toLowerCase())throw new Error('Approval public-key fingerprint mismatch');
   const dir=path.join(root,id), manifest=await readFile(path.join(dir,'manifest.json')),sig=await readFile(path.join(dir,'manifest.sig'));
   if(!verify(null,manifest,pub,sig))throw new Error('Invalid release signature; approval refused');
   const signer=(await readFile(path.join(dir,'signer-key-id.txt'),'utf8')).trim();
   if(signer!==expectedArn)throw new Error('Signing authority mismatch');
   const parsed=JSON.parse(manifest.toString('utf8'));
   for(const asset of parsed.assets){const data=await readFile(path.join(dir,'assets',asset.name));if(data.length!==asset.size||sha(data)!==asset.sha256)throw new Error(`Published file altered: ${asset.name}`);}
   const query=mode==='approve'
    ? `UPDATE gate_bridge_signed_releases SET approved=true,rollout_stage='pilot',approved_at=NOW(),approved_by=$2 WHERE release_id=$1 AND approved=false AND manifest_sha256=$3 RETURNING release_id`
    : `UPDATE gate_bridge_signed_releases SET rollout_stage='general',approved_by=$2 WHERE release_id=$1 AND approved=true AND rollout_stage='pilot' AND manifest_sha256=$3 RETURNING release_id`;
   const updated=await client.query(query,[id,approver,sha(manifest)]);
   if(!updated.rows.length)throw new Error('Release not eligible for requested approval/promotion or fingerprint changed');
   console.log(mode==='approve'?`Approved ${id} for PILOT Bridge devices only. General devices must wait for a separately approved promotion.`:`Promoted ${id} to GENERAL rollout. Each Bridge still observes its auto-update policy and safety checks.`);
  }
 }finally{await client.end();}
}
main().catch(e=>{console.error('Signed release publication/approval BLOCKED:',e.message);process.exitCode=1;});
