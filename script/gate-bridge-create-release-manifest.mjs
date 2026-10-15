// Prepare a deterministic Gate Bridge release manifest. SIGNING happens only in a
// protected GitHub Actions environment (AWS KMS). Never accept a private key here.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename, join } from 'node:path';
import { createHash } from 'node:crypto';
const [version, releaseId, source, target] = process.argv.slice(2);
if (!/^fcgs-gate-bridge\/\d+\.\d+\.\d+$/.test(version||'')) throw new Error('Expected version: fcgs-gate-bridge/X.Y.Z');
if (!/^[A-Za-z0-9_-]{5,100}$/.test(releaseId||'')) throw new Error('Invalid immutable release ID');
if (!source || !target) throw new Error('Usage: node script/gate-bridge-create-release-manifest.mjs fcgs-gate-bridge/1.2.0 bridge-120 PATH_TO_ASSETS OUT_DIR');
const names=['node.exe','FCGSGateBridgeService.exe','gate-bridge.cjs','Start-GateBridge.ps1','Update-GateBridge.ps1','LICENSE-Node.txt','LICENSE-WinSW.txt','THIRD_PARTY_NOTICES.md'];
const assets=[];for(const name of names){const buffer=await readFile(resolve(source,name));if(buffer.length<8)throw new Error(`Incomplete ${name}`);assets.push({name,size:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')});}
const manifest={releaseId,version,platform:'win32-x64',protocolVersion:1,assets};
const data=Buffer.from(JSON.stringify(manifest)+'\n','utf8');
if(data.length>6144)throw new Error('AWS KMS signing payload too large');
await mkdir(resolve(target),{recursive:true});
await writeFile(resolve(target,'manifest.json'),data,{flag:'wx'});
console.log(`Created unsigned release manifest for ${version}. Signing required before publishing. SHA-256 ${createHash('sha256').update(data).digest('hex')}`);
