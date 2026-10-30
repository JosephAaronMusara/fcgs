/** FCGS signed update control plane. No signing key is present on the Portal. */
import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { storage } from "./storage";
import { requirePermission } from "./auth";
import { gateBridges, gateBridgeUpdateSettings, gateBridgeSignedReleases, gateBridgeUpdateRequests, gateBridgeUpdateEvents, schools, gateDevices, activityLogs, type User } from "@shared/schema";

const RELEASE_ROOT = path.resolve(process.cwd(), "gate-bridge-releases");
const FREQ = [1,3,6,12,24];
const SETTINGS = z.object({autoEnabled:z.boolean(),mode:z.enum(["scheduled","as_soon_as_safe"]),checkIntervalHours:z.number().int().refine(n=>FREQ.includes(n)),releaseTrack:z.enum(["pilot","general"]),maintenanceFrom:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),maintenanceTo:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),timeZone:z.string().min(3).max(60),maxDeferralHours:z.number().int().min(1).max(168)}).refine(s=>s.maintenanceFrom!==s.maintenanceTo,{message:"Maintenance window start and end cannot be identical"});
const EVENT = z.object({attemptId:z.string().uuid(),sequence:z.number().int().min(0).max(10000),requestId:z.number().int().positive().nullable().optional(),stage:z.string().min(2).max(80),origin:z.enum(["automatic","remote","local"]).default("automatic"),status:z.enum(["started","passed","failed","deferred","rolled_back"]),errorCode:z.string().max(100).optional(),message:z.string().max(1000).optional(),occurredAt:z.string().datetime()});
const DEFAULT_SETTINGS = {autoEnabled:false,mode:"scheduled",checkIntervalHours:1,releaseTrack:"general",maintenanceFrom:"02:00",maintenanceTo:"04:00",timeZone:"Africa/Harare",maxDeferralHours:24} as const;

async function context(req:Request, bridgeId:number) {
 const user = req.user as User | undefined;
 if(!user) return null;
 const [bridge] = await db.select().from(gateBridges).where(eq(gateBridges.id,bridgeId)).limit(1);
 if(!bridge) return null;
 if(user.organizationId && user.organizationId!==bridge.organizationId) return null;
 if(user.role==="org_admin") {
   const sid=Number(req.header("X-School-Id")||0);
   if(sid && sid!==bridge.schoolId) return null;
   if(!user.organizationId) { const access=await storage.getUserSchoolAccess(user.id);if(!access.includes(bridge.schoolId))return null; }
 } else if(user.schoolId!==bridge.schoolId)return null;
 return {bridge,user};
}
async function authenticateAgent(req:Request,res:Response){
 const h=req.header("Authorization")||"";const token=h.startsWith("Bearer ")?h.slice(7).trim():"";
 if(!token) {res.status(401).json({message:"Missing Bridge token"});return null;}
 const keyHash=createHash("sha256").update(token,"utf8").digest("hex");
 const [b]=await db.select().from(gateBridges).where(and(eq(gateBridges.bridgeKeyHash,keyHash),eq(gateBridges.isActive,true))).limit(1);
 if(!b){res.status(401).json({message:"Bridge authentication failed"});return null;}
 return b;
}
function fail(res:Response,error:unknown){return res.status(400).json({message:error instanceof Error?error.message:"Gate Bridge update error"});}
function releaseDir(id:string){if(!/^[a-zA-Z0-9_-]{5,100}$/.test(id))throw new Error("Invalid release ID");return path.join(RELEASE_ROOT,id);}
async function signedPayload(release:typeof gateBridgeSignedReleases.$inferSelect){
 const dir=releaseDir(release.releaseId);
 const manifest=await readFile(path.join(dir,"manifest.json"));
 const signature=await readFile(path.join(dir,"manifest.sig"));
 if(createHash("sha256").update(manifest).digest("hex")!==release.manifestSha256)throw new Error("Published release manifest fingerprint differs from approval");
 if(signature.length!==64)throw new Error("Invalid Ed25519 signature length");
 const parsed=JSON.parse(manifest.toString("utf8"));
 if(parsed.releaseId!==release.releaseId || parsed.version!==release.version || parsed.protocolVersion!==release.protocolVersion || !Array.isArray(parsed.assets))throw new Error("Release manifest metadata differs from approval");
 return {releaseId:release.releaseId,version:release.version,manifestBase64:manifest.toString("base64"),signatureBase64:signature.toString("base64"),signerKeyId:release.signedByKeyId};
}
async function latestRelease(track:"pilot"|"general"="general"){
 const condition=track==="pilot"?eq(gateBridgeSignedReleases.approved,true):and(eq(gateBridgeSignedReleases.approved,true),eq(gateBridgeSignedReleases.rolloutStage,"general"));
 const [release]=await db.select().from(gateBridgeSignedReleases).where(condition).orderBy(desc(gateBridgeSignedReleases.approvedAt)).limit(1);return release||null;
}

export function registerGateBridgeAutomaticUpdates(app:Express){
 app.get("/api/access-control/bridges/:id/updates",requirePermission("access_control.view"),async(req,res)=>{
  try {const ctx=await context(req,Number(req.params.id));if(!ctx)return res.status(404).json({message:"Bridge unavailable in your school"});
    const [settings]=await db.select().from(gateBridgeUpdateSettings).where(eq(gateBridgeUpdateSettings.bridgeId,ctx.bridge.id)).limit(1);
    const requests=await db.select().from(gateBridgeUpdateRequests).where(eq(gateBridgeUpdateRequests.bridgeId,ctx.bridge.id)).orderBy(desc(gateBridgeUpdateRequests.id)).limit(30);
    const events=await db.select().from(gateBridgeUpdateEvents).where(eq(gateBridgeUpdateEvents.bridgeId,ctx.bridge.id)).orderBy(desc(gateBridgeUpdateEvents.id)).limit(150);
    const release=await latestRelease(settings?.releaseTrack==="pilot"?"pilot":"general");return res.json({settings:settings||{bridgeId:ctx.bridge.id,schoolId:ctx.bridge.schoolId,...DEFAULT_SETTINGS},bridge:{id:ctx.bridge.id,version:ctx.bridge.softwareVersion,agentVersion:ctx.bridge.updateAgentVersion,lastAgentSeenAt:ctx.bridge.updateAgentLastSeenAt,lastAgentError:ctx.bridge.updateAgentError},latestRelease:release?{releaseId:release.releaseId,version:release.version,approved:true,rolloutStage:release.rolloutStage}:null,requests,events});
  }catch(error){return fail(res,error);}
 });
 app.patch("/api/access-control/bridges/:id/updates/settings",requirePermission("access_control.bridge_updates.manage"),async(req,res)=>{
  try {const ctx=await context(req,Number(req.params.id));if(!ctx)return res.status(404).json({message:"Bridge not found"});
    const input=SETTINGS.parse(req.body);
    if(input.autoEnabled && (!ctx.bridge.updateAgentLastSeenAt || Date.now()-new Date(ctx.bridge.updateAgentLastSeenAt).getTime()>10*60*1000))
      return res.status(409).json({message:"Automatic updating cannot be enabled until the independently bootstrapped Windows Update Agent reports a recent heartbeat"});
    try{new Intl.DateTimeFormat("en-US",{timeZone:input.timeZone}).format();}catch{throw new Error("Unknown timezone");}
    const [saved]=await db.insert(gateBridgeUpdateSettings).values({...input,bridgeId:ctx.bridge.id,schoolId:ctx.bridge.schoolId,updatedByUserId:ctx.user.id}).onConflictDoUpdate({target:gateBridgeUpdateSettings.bridgeId,set:{...input,updatedByUserId:ctx.user.id,updatedAt:new Date()}}).returning();
    await db.insert(activityLogs).values({schoolId:ctx.bridge.schoolId,organizationId:ctx.bridge.organizationId,userId:ctx.user.id,userRole:ctx.user.role,action:"gate_bridge.update_settings",category:"Access Control",description:`Update policy edited for bridge ${ctx.bridge.id}`,metadata:input});
    return res.json({settings:saved});
  }catch(error){return fail(res,error);}
 });
 app.post("/api/access-control/bridges/:id/updates/remote",requirePermission("access_control.bridge_updates.manage"),async(req,res)=>{
  try {const ctx=await context(req,Number(req.params.id));if(!ctx)return res.status(404).json({message:"Bridge not found"});
    if(req.body?.confirmInterruption!==true)return res.status(400).json({message:"Confirm remote service interruption first"});
    const [policy]=await db.select().from(gateBridgeUpdateSettings).where(eq(gateBridgeUpdateSettings.bridgeId,ctx.bridge.id)).limit(1);
    const release=await latestRelease(policy?.releaseTrack==="pilot"?"pilot":"general");if(!release)return res.status(409).json({message:"No approved signed Gate Bridge release has been published"});
    await signedPayload(release);
    if(ctx.bridge.softwareVersion===release.version)return res.status(409).json({message:"Bridge already reports this release"});
    await db.update(gateBridgeUpdateRequests).set({status:"expired",completedAt:new Date(),failureCode:"REMOTE_REQUEST_EXPIRED"}).where(and(eq(gateBridgeUpdateRequests.bridgeId,ctx.bridge.id),eq(gateBridgeUpdateRequests.status,"queued"),sql`${gateBridgeUpdateRequests.expiresAt} IS NOT NULL AND ${gateBridgeUpdateRequests.expiresAt} < NOW()`));
    const [pending]=await db.select().from(gateBridgeUpdateRequests).where(and(eq(gateBridgeUpdateRequests.bridgeId,ctx.bridge.id),sql`${gateBridgeUpdateRequests.status} IN ('queued','running')`)).limit(1);
    if(pending)return res.status(409).json({message:`Existing update request #${pending.id} still pending`});
    const [request]=await db.insert(gateBridgeUpdateRequests).values({bridgeId:ctx.bridge.id,schoolId:ctx.bridge.schoolId,releaseId:release.releaseId,origin:"remote",initiatedByUserId:ctx.user.id,expiresAt:new Date(Date.now()+6*60*60*1000)}).returning();
    await db.insert(activityLogs).values({schoolId:ctx.bridge.schoolId,organizationId:ctx.bridge.organizationId,userId:ctx.user.id,userRole:ctx.user.role,action:"gate_bridge.remote_update_requested",category:"Access Control",description:`Requested remote update of bridge ${ctx.bridge.name} to ${release.version}`,targetType:"gate_bridge",targetId:ctx.bridge.id});
    return res.status(202).json({request});
  }catch(error){return fail(res,error);}
 });
 app.get("/api/gate-bridge/update-agent/next",async(req,res)=>{
  const bridge=await authenticateAgent(req,res);if(!bridge)return;
  try {const [settings]=await db.select().from(gateBridgeUpdateSettings).where(eq(gateBridgeUpdateSettings.bridgeId,bridge.id)).limit(1);
    // Expired requests must not block later remote actions forever.
    await db.update(gateBridgeUpdateRequests).set({status:"expired",completedAt:new Date(),failureCode:"REMOTE_REQUEST_EXPIRED",failureReason:"Bridge did not accept the update within the six-hour request window"}).where(and(eq(gateBridgeUpdateRequests.bridgeId,bridge.id),eq(gateBridgeUpdateRequests.status,"queued"),sql`${gateBridgeUpdateRequests.expiresAt} IS NOT NULL AND ${gateBridgeUpdateRequests.expiresAt} < NOW()`));
    const [request]=await db.select().from(gateBridgeUpdateRequests).where(and(eq(gateBridgeUpdateRequests.bridgeId,bridge.id),eq(gateBridgeUpdateRequests.status,"queued"))).orderBy(desc(gateBridgeUpdateRequests.id)).limit(1);
    // A remote request is pinned to the exact approved release selected at initiation.
    // Never silently substitute a newer release that became approved later.
    const [requestedRelease]=request ? await db.select().from(gateBridgeSignedReleases).where(and(eq(gateBridgeSignedReleases.releaseId,request.releaseId),eq(gateBridgeSignedReleases.approved,true))).limit(1) : [];
    const localRequested = req.query.local === "1";
    const release=request ? (requestedRelease||null) : await latestRelease(settings?.releaseTrack==="pilot"?"pilot":"general");
    let signed=null;
    if(release&&(settings?.autoEnabled||request||localRequested)&&bridge.softwareVersion!==release.version) signed=await signedPayload(release);
    return res.json({serverTime:new Date().toISOString(),settings:settings||DEFAULT_SETTINGS,request:request&&(!request.expiresAt||request.expiresAt>new Date())?request:null,release:signed});
  }catch(error){return fail(res,error);}
 });
 app.get("/api/gate-bridge/update-agent/health",async(req,res)=>{
  const bridge=await authenticateAgent(req,res);if(!bridge)return;
  const devices=await db.select({id:gateDevices.id,status:gateDevices.lastConnectionStatus,lastSeenAt:gateDevices.lastSeenAt,isActive:gateDevices.isActive}).from(gateDevices).where(eq(gateDevices.bridgeId,bridge.id));
  return res.json({version:bridge.softwareVersion,lastHeartbeatAt:bridge.lastHeartbeatAt,callbackError:bridge.callbackError,devices});
 });
 app.post("/api/gate-bridge/update-agent/heartbeat",async(req,res)=>{
  const bridge=await authenticateAgent(req,res);if(!bridge)return;
  const body=z.object({agentVersion:z.string().max(80),error:z.string().max(500).nullable().optional()}).safeParse(req.body);
  if(!body.success)return res.status(400).json({message:"Invalid heartbeat"});
  await db.update(gateBridges).set({updateAgentVersion:body.data.agentVersion,updateAgentLastSeenAt:new Date(),updateAgentError:body.data.error||null}).where(eq(gateBridges.id,bridge.id));return res.json({ok:true});
 });
 app.post("/api/gate-bridge/update-agent/events",async(req,res)=>{
  const bridge=await authenticateAgent(req,res);if(!bridge)return;
  try {const input=z.object({events:z.array(EVENT).min(1).max(50)}).parse(req.body);
    for(const event of input.events){
      if(event.requestId){const [r]=await db.select().from(gateBridgeUpdateRequests).where(and(eq(gateBridgeUpdateRequests.id,event.requestId),eq(gateBridgeUpdateRequests.bridgeId,bridge.id))).limit(1);if(!r) return res.status(403).json({message:"Request is not associated with Bridge"});}
      await db.insert(gateBridgeUpdateEvents).values({bridgeId:bridge.id,requestId:event.requestId||null,attemptId:event.attemptId,sequence:event.sequence,stage:event.stage,origin:event.origin,status:event.status,errorCode:event.errorCode||null,message:event.message||null,occurredAt:new Date(event.occurredAt)}).onConflictDoNothing();
      if(event.requestId){const status=event.stage==="complete"&&event.status==="passed"?"completed":event.stage==="complete"&&event.status==="failed"?"failed":"running";
        await db.update(gateBridgeUpdateRequests).set({status,startedAt:new Date(),...(status==="completed"||status==="failed"?{completedAt:new Date()}:{}),failureCode:event.errorCode||null,failureReason:event.status==="failed"?event.message||null:null,rolledBack:event.status==="rolled_back"?true:undefined}).where(and(eq(gateBridgeUpdateRequests.id,event.requestId),eq(gateBridgeUpdateRequests.bridgeId,bridge.id),sql`${gateBridgeUpdateRequests.status} IN ('queued','running')`));
      }
    }
    return res.json({ok:true});
  }catch(error){return fail(res,error);}
 });
 app.get("/api/gate-bridge/update-agent/releases/:releaseId/assets/:asset",async(req,res)=>{
  const bridge=await authenticateAgent(req,res);if(!bridge)return;
  try {const id=String(req.params.releaseId);const asset=String(req.params.asset);
    const [release]=await db.select().from(gateBridgeSignedReleases).where(and(eq(gateBridgeSignedReleases.releaseId,id),eq(gateBridgeSignedReleases.approved,true))).limit(1);
    if(!release)return res.status(404).json({message:"Unapproved release"});
    const signed=await signedPayload(release);
    const manifest=JSON.parse(Buffer.from(signed.manifestBase64,"base64").toString("utf8"));
    if(!/^[a-zA-Z0-9._-]{1,100}$/.test(asset)||!manifest.assets.some((a:any)=>a.name===asset))return res.status(404).json({message:"Unknown release asset"});
    const file=path.join(releaseDir(id),"assets",asset);
    if(!(await stat(file)).isFile())throw new Error("Release asset is unavailable");
    res.setHeader("Cache-Control","public, immutable, max-age=31536000");return res.sendFile(file);
  }catch(error){return fail(res,error);}
 });
}
