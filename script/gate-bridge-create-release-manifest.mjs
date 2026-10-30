// Prepare an unsigned, deterministic manifest that binds the release to the
// exact source commit and GitHub run. Only a separately MFA-authorized FCGS
// release operator may sign it later. The Portal never receives KMS credentials.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const [version, releaseId, source, target] = process.argv.slice(2);
if (!/^fcgs-gate-bridge\/\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Expected version: fcgs-gate-bridge/X.Y.Z');
if (!/^[A-Za-z0-9_-]{5,100}$/.test(releaseId || '')) throw new Error('Invalid immutable release ID');
if (!source || !target) throw new Error('Usage: node script/gate-bridge-create-release-manifest.mjs VERSION RELEASE_ID ASSETS_DIRECTORY OUTPUT_DIRECTORY');
const sourceCommit = String(process.env.FCGS_RELEASE_SOURCE_COMMIT || '').toLowerCase();
const githubRunId = String(process.env.FCGS_RELEASE_GITHUB_RUN_ID || '');
const githubRunAttempt = String(process.env.FCGS_RELEASE_GITHUB_RUN_ATTEMPT || '');
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Full GitHub source SHA-1 commit is required');
if (!/^[1-9]\d*$/.test(githubRunId) || !/^[1-9]\d*$/.test(githubRunAttempt)) throw new Error('GitHub run ID and attempt are required');

const names = ['node.exe', 'FCGSGateBridgeService.exe', 'gate-bridge.cjs', 'Start-GateBridge.ps1', 'Update-GateBridge.ps1', 'LICENSE-Node.txt', 'LICENSE-WinSW.txt', 'THIRD_PARTY_NOTICES.md'];
const assets = [];
for (const name of names) {
  const buffer = await readFile(resolve(source, name));
  if (buffer.length < 8 || buffer.length > 150_000_000) throw new Error(`Invalid size for ${name}`);
  assets.push({ name, size: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') });
}
const manifest = {
  releaseId, version, platform: 'win32-x64', protocolVersion: 1,
  sourceRepository: 'firstchoicegroupzw/fcgs-portal',
  sourceCommit, githubRunId, githubRunAttempt,
  assets,
};
const data = Buffer.from(JSON.stringify(manifest) + '\n', 'utf8');
if (data.length > 6144) throw new Error('AWS KMS RAW signing payload too large');
await mkdir(resolve(target), { recursive: true });
await writeFile(resolve(target, 'manifest.json'), data, { flag: 'wx' });
console.log(`Unsigned Gate Bridge release ${releaseId}: SHA-256 ${createHash('sha256').update(data).digest('hex')}`);
