"use strict";
/*
 * FCGS Gate Bridge independently scheduled update agent, Windows-only.
 * FAIL CLOSED until a verified public key and signed, approved release exist.
 * Local logs are append-only until successfully sent to Portal.
 * No cloud KMS credentials or private keys are used here.
 */
const fs=require("node:fs");
const fsp=fs.promises;
const path=require("node:path");
const crypto=require("node:crypto");
const {execFileSync, spawnSync}=require("node:child_process");
const os=require("node:os");
const root=process.env.FCGS_UPDATE_AGENT_ROOT || path.join(process.env.ProgramData||"C:\\ProgramData","FCGS","Gate Bridge","update-agent");
const install=process.env.FCGS_GATE_BRIDGE_INSTALL || path.join(process.env.ProgramFiles||"C:\\Program Files","FCGS","Gate Bridge");
const portal=String(process.env.FCGS_GATE_BRIDGE_URL||"").replace(/\/$/,"");
const token=String(process.env.FCGS_GATE_BRIDGE_TOKEN||"").trim();
const VERSION="fcgs-gate-update-agent/1.0.0";
const allowNames=new Set(["node.exe","FCGSGateBridgeService.exe","gate-bridge.cjs","Start-GateBridge.ps1","Update-GateBridge.ps1","LICENSE-Node.txt","LICENSE-WinSW.txt","THIRD_PARTY_NOTICES.md"]);
const statePath=path.join(root,"state.json"),logPath=path.join(root,"update-events.jsonl"),keysPath=path.join(root,"trusted-release-keys.json");
let state={},stopped=false,running=false;
const now=()=>new Date().toISOString();
function writeState(){fs.writeFileSync(statePath+".tmp",JSON.stringify(state));fs.renameSync(statePath+".tmp",statePath);}
function log(attemptId,sequence,requestId,stage,status,errorCode,message,origin){
 const entry={attemptId,sequence,requestId:requestId||null,origin,stage,status,errorCode:errorCode||null,message:String(message||"").slice(0,900),occurredAt:now()};
 fs.appendFileSync(logPath,JSON.stringify(entry)+"\n");
 console.log(`[update-agent] ${stage}: ${status}${errorCode?" ("+errorCode+")":""}`);
}
function fail(stage,code,details){const e=new Error(details);e.stage=stage;e.code=code;throw e;}
async function request(p,method="GET",body,timeout=12000){
 const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),timeout);
 try{const r=await fetch(`${portal}${p}`,{method,signal:ac.signal,headers:{Authorization:`Bearer ${token}`,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
 const content=await r.text();const obj=content?JSON.parse(content):{};
 if(!r.ok)throw new Error(`Portal HTTP ${r.status}: ${obj.message||"error"}`);return obj;
 }finally{clearTimeout(timer);}
}
async function flush(){
 try{const data=(await fsp.readFile(logPath,"utf8")).trim().split("\n").filter(Boolean);
 if(!data.length)return;
 for(let n=0;n<data.length;n+=50){await request("/api/gate-bridge/update-agent/events","POST",{events:data.slice(n,n+50).map(JSON.parse)},15000);}
 const onDisk=await fsp.readFile(logPath,"utf8");
 const flushed=data.join("\n")+"\n";
 if(onDisk.startsWith(flushed)) await fsp.writeFile(logPath,onDisk.slice(flushed.length),"utf8");
 }catch(e){console.error("[update-agent] Log forwarding deferred:",e.message);}
}
function selectedSlot(checkHours,timeZone){
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone,hour:"2-digit",minute:"2-digit",year:"numeric",month:"2-digit",day:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
 const get=x=>parts.find(p=>p.type===x)?.value||"";
 const hour=Number(get("hour"));
 const slotHour=Math.floor(hour/checkHours)*checkHours;
 const date=`${get("year")}-${get("month")}-${get("day")}`;
 return {slot:`${date}T${String(slotHour).padStart(2,"0")}:00`,hour,minute:Number(get("minute")),time:`${get("hour")}:${get("minute")}`};
}
function isInWindow(time,start,end){return start<=end?(time>=start&&time<end):(time>=start||time<end);}
function compareVersions(a,b) {
 const pat=/^fcgs-gate-bridge\/(\d+)\.(\d+)\.(\d+)$/;
 const x=pat.exec(a||""),y=pat.exec(b||"");
 if(!x||!y)fail("compatibility","UNKNOWN_VERSION","Installed or target Gate Bridge version cannot be validated");
 for(let i=1;i<=3;i++){const d=Number(x[i])-Number(y[i]);if(d)return Math.sign(d);}
 return 0;
}
function signedRelease(input){
 if(!input?.manifestBase64||!input.signatureBase64)fail("verify","UNSIGNED","Release manifest/signature missing");
 const signed=Buffer.from(input.manifestBase64,"base64");
 if(signed.length>6144)fail("verify","OVERSIZE","Manifest exceeds KMS RAW-message limit");
 const signature=Buffer.from(input.signatureBase64,"base64");
 const trusted=JSON.parse(fs.readFileSync(keysPath,"utf8"));
 if(!Array.isArray(trusted.keys)||!trusted.keys.length)fail("verify","NO_TRUSTED_KEY","Trusted KMS public key not bootstrapped");
 const verified=trusted.keys.some(k=>k.keyId===input.signerKeyId&&k.publicKeyPem&&crypto.verify(null,signed,k.publicKeyPem,signature));
 if(!verified)fail("verify","BAD_SIGNATURE","Signature does not match a pinned, trusted AWS KMS public key");
 let manifest;try{manifest=JSON.parse(signed.toString("utf8"));}catch{fail("verify","INVALID_SIGNED_JSON","Signed manifest is not JSON");}
 if(manifest.releaseId!==input.releaseId||manifest.version!==input.version)fail("verify","METADATA_MISMATCH","Signed release identity differs from the Portal response");
 if(!/^fcgs-gate-bridge\/[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.version))fail("verify","BAD_VERSION","Unexpected release version");
 if(manifest.platform!=="win32-x64"||!Number.isInteger(manifest.protocolVersion)||manifest.protocolVersion<1)fail("verify","INCOMPATIBLE_PLATFORM","Unsupported release platform/protocol");
 const assets=manifest.assets;
 if(!Array.isArray(assets)||assets.length!==allowNames.size||new Set(assets.map(a=>a.name)).size!==allowNames.size)fail("verify","MISSING_ASSETS","Manifest must contain exactly the eight approved Windows runtime assets");
 for(const a of assets)if(!allowNames.has(a.name)||!Number.isSafeInteger(a.size)||a.size<=0||a.size>150_000_000||!/^[0-9a-f]{64}$/.test(a.sha256))fail("verify","BAD_ASSET","Malformed signed asset list");
 return manifest;
}
async function download(manifest){
 const dir=path.join(root,"staging",manifest.releaseId);
 await fsp.mkdir(dir,{recursive:true});
 for(const asset of manifest.assets){
   const target=path.join(dir,asset.name);
   let bytes;
   if(fs.existsSync(target)&&crypto.createHash("sha256").update(bytes=await fsp.readFile(target)).digest("hex")===asset.sha256)continue;
   const resp=await fetch(`${portal}/api/gate-bridge/update-agent/releases/${encodeURIComponent(manifest.releaseId)}/assets/${asset.name}`,{headers:{Authorization:`Bearer ${token}`}});
   if(!resp.ok)fail("download","HTTP_ASSET",`Asset download failed: ${asset.name}, HTTP ${resp.status}`);
   const buffer=Buffer.from(await resp.arrayBuffer());
   if(buffer.length!==asset.size||crypto.createHash("sha256").update(buffer).digest("hex")!==asset.sha256)fail("verify","HASH_MISMATCH",`Signed hash check failed: ${asset.name}`);
   await fsp.writeFile(target+".tmp",buffer);await fsp.rename(target+".tmp",target);
 }
 return dir;
}
async function local(endpoint,method="GET"){
 const secret=(await fsp.readFile(path.join(root,"local-auth.txt"),"utf8")).trim();
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),5000);
 try{const r=await fetch(`http://127.0.0.1:9191/__fcgs_update/${endpoint}`,{method,signal:ac.signal,headers:{"X-FCGS-Update-Secret":secret}});
 if(!r.ok)throw new Error(`Local Bridge refused ${endpoint}: HTTP ${r.status}`);
 return r.json();}finally{clearTimeout(timer);}
}
async function quiesce(){
 await local("quiesce","POST");
 for(let i=0;i<90;i++){
  const health=await local("ready");if(health.safe)return;
  await new Promise(r=>setTimeout(r,1000));
 }
 try{await local("resume","POST");}catch{}
 fail("quiesce","STILL_BUSY","Bridge did not drain critical terminal/recognition work in 90 seconds");
}
async function installSigned(dir,attemptId,requestId){
 const installer=path.join(root,"Install-VerifiedBridge.ps1");
 const cmd=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",installer,"-Staging",dir],{windowsHide:true,encoding:"utf8",timeout:180000,env:{...process.env,FCGS_UPDATE_AGENT_TOKEN:undefined}});
 if(cmd.error||cmd.status!==0){
  const output=String(cmd.stderr||"")+" "+String(cmd.stdout||"")+" "+String(cmd.error?.message||"");
  const e=new Error(`Signed installer failed (exit ${cmd.status}); ${output}`.slice(0,600));
  e.stage="install";e.code="INSTALL_FAILURE";
  e.rollbackVerified=/rollback service status:\s*True/i.test(output);
  throw e;
 }
}
async function runCycle(force=false){
 if(running)return;running=true;
 const lockDir=path.join(root,"install-agent.lock");
 let hasLock=false;
 try{await fsp.mkdir(lockDir);hasLock=true;await fsp.writeFile(path.join(lockDir,"started.json"),JSON.stringify({pid:process.pid,started:now()}));}
 catch(e){
   if(e?.code!=="EEXIST")throw e;
   try{const st=await fsp.stat(lockDir);if(Date.now()-st.mtimeMs>25*60*1000){
     await fsp.rm(lockDir,{recursive:true,force:true});await fsp.mkdir(lockDir);hasLock=true;
   }}catch{}
   if(!hasLock){running=false;return;}
 }
 let attemptId=crypto.randomUUID(),sequence=0,requestId=null,origin=force?"local":"automatic";
 const stage=(s,status,code,msg)=>log(attemptId,sequence++,requestId,s,status,code,msg,origin);
 try {
  await request("/api/gate-bridge/update-agent/heartbeat","POST",{agentVersion:VERSION});
  await flush();
  const info=await request(`/api/gate-bridge/update-agent/next${force?"?local=1":""}`);
  const settings=info.settings||{};
  const frequency=[1,3,6,12,24].includes(settings.checkIntervalHours)?settings.checkIntervalHours:1;
  const slot=selectedSlot(frequency,settings.timeZone||"Africa/Harare");
  const manual=info.request&&info.request.status==="queued";
  if(manual) origin="remote";
  const inWindow=isInWindow(slot.time,settings.maintenanceFrom||"02:00",settings.maintenanceTo||"04:00");
  const discover=force||manual||(settings.autoEnabled&&(state.lastProcessedSlot!==slot.slot || (state.pendingReleaseId&&inWindow)));
  if(!discover)return;
  // A missed slot is processed at the next run after restart; repeat runs in same slot are not repeated.
  state.lastProcessedSlot=slot.slot;writeState();
  if(!info.release){if(!manual){state.pendingReleaseId=null;state.pendingSince=null;}writeState();return;}
  requestId=manual?info.request.id:null;
  const installedConfigPath=path.join(process.env.ProgramData||"C:\\ProgramData","FCGS","Gate Bridge","config.json");
  const installed=JSON.parse(fs.readFileSync(installedConfigPath,"utf8"));
  if(installed.releaseVersion===info.release.version)return;
  if(!manual&&!force&&!settings.autoEnabled)return;
  if(state.badReleaseId===info.release.releaseId&&!force){stage("discovery","deferred","BAD_RELEASE_HOLD","Previously failed release held for review");return;}
  stage("discovery","passed",null,`Approved ${info.release.version}`);
  const manifest=signedRelease(info.release);stage("verify_signature","passed");
  if(compareVersions(manifest.version,installed.releaseVersion)<=0)fail("compatibility","DOWNGRADE_REJECTED","Unsigned downgrade overrides are not permitted");
  if(manifest.protocolVersion>1)fail("compatibility","PROTOCOL_TOO_NEW","Portal protocol compatibility not established");
  const dir=await download(manifest);
  await fsp.writeFile(path.join(dir,"manifest.json"),Buffer.from(info.release.manifestBase64,"base64"));
  stage("download_verify","passed");
  const isManual=Boolean(manual||force);
  if(!isManual&&settings.mode==="scheduled"&&!inWindow){
   if(state.pendingReleaseId!==manifest.releaseId)state.pendingSince=now();
   state.pendingReleaseId=manifest.releaseId;writeState();
   const hours=(Date.now()-Date.parse(state.pendingSince||now()))/3600000;
   stage("safe_window","deferred",hours>Number(settings.maxDeferralHours||24)?"MAX_DEFERRAL_EXCEEDED":"OUTSIDE_WINDOW",hours>Number(settings.maxDeferralHours||24)?"Update has exceeded the configured deferral limit; manual review required; mandatory safety constraints remain intact":"Waiting for configured maintenance window");return;
  }
  stage("safe_window","passed");
  await quiesce();stage("quiesce","passed");
  try {stage("install","started");await installSigned(dir,attemptId,requestId);stage("install","passed");}catch(e){state.badReleaseId=info.release.releaseId;writeState();stage(e.stage||"install","failed",e.code||"INSTALL_ERROR",e.message);if(e.rollbackVerified)stage("rollback","rolled_back",null,"Previous Bridge release and configuration restored; service and callback listener checked");
   else stage("rollback","failed","ROLLBACK_NOT_VERIFIED","Automatic rollback could not be verified. Physical gate operations require supervised attention");
   stage("complete","failed",e.code||"INSTALL_ERROR",e.message);return;}
  state.lastSuccessfulReleaseId=manifest.releaseId;state.badReleaseId=null;state.pendingReleaseId=null;state.pendingSince=null;writeState();stage("complete","passed",null,`Updated to ${manifest.version}`);
 } catch(e){
   if(e.code!=="OUTSIDE_WINDOW"&&e.code!=="STILL_BUSY") {try{const info=JSON.parse(fs.readFileSync(path.join(root,"state.json"),"utf8"));if(info.pendingReleaseId){info.badReleaseId=info.pendingReleaseId;fs.writeFileSync(statePath,JSON.stringify(info));}}catch{}}
   stage(e.stage||"agent","failed",e.code||"AGENT_ERROR",e.message);
   await request("/api/gate-bridge/update-agent/heartbeat","POST",{agentVersion:VERSION,error:`${e.code||"AGENT_ERROR"}: ${String(e.message||"").slice(0,350)}`}).catch(()=>undefined);
   if(requestId)stage("complete","failed",e.code||"AGENT_ERROR",e.message);
   try{await local("resume","POST");}catch{}
  }
 finally{await flush();if(hasLock)await fsp.rm(lockDir,{recursive:true,force:true}).catch(()=>{});running=false;}
}
async function main(){
 if(process.platform!=="win32")throw new Error("This updater can run only on Windows");
 if(!portal.startsWith("https://")||!token)throw new Error("Configured HTTPS Portal and protected Bridge credential required");
 await fsp.mkdir(root,{recursive:true});
 try{state=JSON.parse(await fsp.readFile(statePath,"utf8"));}catch{state={};}
 const localMode=process.argv.includes("--local-update-now");
 if(localMode){await runCycle(true);return;}
 await runCycle();
 setInterval(()=>void runCycle().catch(e=>console.error("[update-agent]",e.message)),60_000);
}
main().catch(e=>{console.error("[update-agent] Startup failed:",e.message);process.exitCode=1;});
