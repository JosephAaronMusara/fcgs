import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "crypto";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { requirePermission } from "./auth";
import {
  accessIdentities,
  gateBridgePairingCodes,
  gateBridges,
  gateCommands,
  gateLogs,
  gateSyncJobs,
  schools,
} from "@shared/schema";
import {
  GATE_BRIDGE_CALLBACK_PORT,
  GATE_BRIDGE_PAIRING_TTL_MINUTES,
  GATE_BRIDGE_PRODUCTION_URL,
  GATE_BRIDGE_RELEASE_SEMVER,
  GATE_BRIDGE_RELEASE_VERSION,
} from "@shared/gate-bridge-release";

type AppUser = { id: number; role?: string; schoolId?: number | null; organizationId?: number | null };
type Scope = { organizationId: number; schoolId: number; userId: number };

const WINDOWS_ASSETS = [
  "node.exe",
  "FCGSGateBridgeService.exe",
  "gate-bridge.cjs",
  "Start-GateBridge.ps1",
  "Update-GateBridge.ps1",
  "LICENSE-Node.txt",
  "LICENSE-WinSW.txt",
  "THIRD_PARTY_NOTICES.md",
] as const;

const installRequestSchema = z.object({
  portalUrl: z.string().trim().url().optional(),
});

const pairSchema = z.object({
  pairingCode: z.string().trim().min(8).max(40),
  installationId: z.string().uuid(),
  machineName: z.string().trim().min(1).max(120),
  installerVersion: z.string().trim().max(100).optional().nullable(),
});

function fail(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected Gate Bridge deployment error";
  const status = /not found/i.test(message) ? 404 : /expired|used|invalid|inactive/i.test(message) ? 409 : /context|denied|outside/i.test(message) ? 403 : 400;
  return res.status(status).json({ message });
}

async function scopeOf(req: Request): Promise<Scope> {
  const current = req.user as AppUser;
  let schoolId = current.schoolId ?? null;
  let organizationId = current.organizationId ?? null;
  if (current.role === "org_admin") {
    const requestedSchool = Number(req.header("X-School-Id") || "");
    if (Number.isFinite(requestedSchool) && requestedSchool > 0) schoolId = requestedSchool;
  }
  if (!schoolId) throw new Error("School context is required for Access Control");
  const [school] = await db.select({ id: schools.id, organizationId: schools.organizationId }).from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) throw new Error("School context was not found");
  organizationId = organizationId ?? school.organizationId ?? null;
  if (!organizationId || organizationId !== school.organizationId) throw new Error("Access denied outside your organisation");
  return { organizationId, schoolId, userId: current.id };
}

function hashValue(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function createBridgeToken() {
  return `fcgs_gb_${randomBytes(32).toString("base64url")}`;
}

function pairingAlphabetCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

function normalizePairingCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function allowedPortalUrl(value: string | undefined) {
  const url = String(value || GATE_BRIDGE_PRODUCTION_URL).replace(/\/$/, "");
  const parsed = new URL(url);
  const localDev = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localDev) throw new Error("Custom Gate Bridge portal URLs must use HTTPS except localhost development URLs");
  return url;
}

function assetRoot() {
  return path.resolve(process.cwd(), "gate-bridge-windows", "assets");
}

type ReleaseDigestCacheEntry = { size: number; mtimeMs: number; sha256: string };
const releaseDigestCache = new Map<string, ReleaseDigestCacheEntry>();

async function sha256File(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function releaseManifest() {
  const assets = [] as Array<{ name: string; size: number; sha256: string }>;
  for (const name of WINDOWS_ASSETS) {
    const filePath = path.join(assetRoot(), name);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      const cached = releaseDigestCache.get(name);
      const sha256 = cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs
        ? cached.sha256
        : await sha256File(filePath);
      if (!cached || cached.size !== stat.size || cached.mtimeMs !== stat.mtimeMs) {
        releaseDigestCache.set(name, { size: stat.size, mtimeMs: stat.mtimeMs, sha256 });
      }
      assets.push({ name, size: stat.size, sha256 });
    } catch {
      releaseDigestCache.delete(name);
      // Missing assets are exposed through ready=false so deployment cannot silently proceed.
    }
  }
  return {
    version: GATE_BRIDGE_RELEASE_VERSION,
    semver: GATE_BRIDGE_RELEASE_SEMVER,
    platform: "win32-x64",
    callbackPort: GATE_BRIDGE_CALLBACK_PORT,
    assets,
    ready: assets.length === WINDOWS_ASSETS.length,
    expectedAssets: [...WINDOWS_ASSETS],
    signing: {
      requiredBeforeBroadRollout: true,
      configured: process.env.FCGS_GATE_BRIDGE_CODE_SIGNED_RELEASE === "true",
      note: "Apply the FCGS Windows code-signing certificate and set FCGS_GATE_BRIDGE_CODE_SIGNED_RELEASE=true only after release-signing verification, before broad production rollout.",
    },
  };
}

function powershellString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildInstallerPowerShell(pairingCode: string, portalUrl: string) {
  return String.raw`# FCGS Gate Bridge production bootstrap
$ErrorActionPreference = "Stop"
$PortalUrl = ${powershellString(portalUrl)}
$PairingCode = ${powershellString(pairingCode)}
$InstallRoot = Join-Path $env:ProgramFiles "FCGS\Gate Bridge"
$DataRoot = Join-Path $env:ProgramData "FCGS\Gate Bridge"
$ServiceName = "FCGSGateBridgeService"
$CallbackPort = ${GATE_BRIDGE_CALLBACK_PORT}

function Require-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "This installer must be run as Administrator. Right-click the downloaded installer and choose Run as administrator."
  }
}

function SecureString-ToPlainText([Security.SecureString]$Secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

Require-Administrator
Write-Host "FCGS Gate Bridge Service installer" -ForegroundColor Cyan
Write-Host "Portal: $PortalUrl"
Write-Host "Pairing code expires shortly and can only be used once."

$manifest = Invoke-RestMethod -UseBasicParsing -Uri "$PortalUrl/api/gate-bridge/release" -Method Get
if (-not $manifest.ready) { throw "The FCGS Windows Gate Bridge release is not ready on the portal. Contact FCGS IT." }
$tmp = Join-Path $env:TEMP ("fcgs-gate-bridge-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  Write-Host "Downloading verified Gate Bridge runtime $($manifest.version)..."
  foreach ($asset in $manifest.assets) {
    $name = [string]$asset.name
    $target = Join-Path $tmp $name
    Invoke-WebRequest -UseBasicParsing -Uri "$PortalUrl/api/gate-bridge/windows-assets/$name" -OutFile $target
    $actual = (Get-FileHash -Algorithm SHA256 -Path $target).Hash.ToLowerInvariant()
    if ($actual -ne ([string]$asset.sha256).ToLowerInvariant()) { throw "Checksum validation failed for $name" }
  }

  $terminalUser = Read-Host "Face-terminal administrator username [admin]"
  if ([string]::IsNullOrWhiteSpace($terminalUser)) { $terminalUser = "admin" }
  $terminalSecure = Read-Host "Face-terminal administrator password" -AsSecureString
  $terminalPassword = SecureString-ToPlainText $terminalSecure
  if ([string]::IsNullOrEmpty($terminalPassword)) { throw "The face-terminal administrator password is required." }
  $md5Answer = Read-Host "Is that password already the terminal's 32-character MD5 digest? [y/N]"
  $passwordIsMd5 = $md5Answer -match '^(y|yes)$'

  $installationId = [guid]::NewGuid().ToString()
  $pairBody = @{
    pairingCode = $PairingCode
    installationId = $installationId
    machineName = $env:COMPUTERNAME
    installerVersion = "fcgs-gate-bridge-installer/${GATE_BRIDGE_RELEASE_SEMVER}"
  } | ConvertTo-Json -Compress
  Write-Host "Pairing this computer with FCGS..."
  $pair = Invoke-RestMethod -UseBasicParsing -Uri "$PortalUrl/api/gate-bridge/pair" -Method Post -ContentType "application/json" -Body $pairBody

  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot "logs") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot "service-logs") | Out-Null

  $existingExe = Join-Path $InstallRoot "FCGSGateBridgeService.exe"
  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    if (Test-Path $existingExe) { & $existingExe uninstall | Out-Null }
  }

  foreach ($asset in $manifest.assets) {
    Copy-Item -Force (Join-Path $tmp ([string]$asset.name)) (Join-Path $InstallRoot ([string]$asset.name))
  }

  $config = @{
    portalUrl = $PortalUrl
    installationId = $installationId
    bridgeId = $pair.bridgeId
    bridgeName = $pair.bridgeName
    callbackPort = $CallbackPort
    releaseVersion = $manifest.version
  } | ConvertTo-Json -Depth 4
  Set-Content -Encoding UTF8 -Path (Join-Path $DataRoot "config.json") -Value $config

  $secretObject = @{
    bridgeToken = [string]$pair.bridgeToken
    terminalUsername = $terminalUser
    terminalPassword = $terminalPassword
    terminalPasswordIsMd5 = [bool]$passwordIsMd5
  } | ConvertTo-Json -Compress
  Add-Type -AssemblyName System.Security
  $plainBytes = [Text.Encoding]::UTF8.GetBytes($secretObject)
  $protected = [Security.Cryptography.ProtectedData]::Protect($plainBytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
  $secretsPath = Join-Path $DataRoot "secrets.bin"
  [IO.File]::WriteAllBytes($secretsPath, $protected)
  & icacls.exe $secretsPath /inheritance:r /grant:r "SYSTEM:F" "Administrators:F" | Out-Null
  $secretObject = $null; $plainBytes = $null; $terminalPassword = $null

  $serviceXml = @"
<service>
  <id>FCGSGateBridgeService</id>
  <name>FCGS Gate Bridge Service</name>
  <description>Secure local bridge between the FCGS Portal and school access-control terminals.</description>
  <executable>powershell.exe</executable>
  <arguments>-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File &quot;$InstallRoot\Start-GateBridge.ps1&quot;</arguments>
  <workingdirectory>$DataRoot</workingdirectory>
  <startmode>Automatic</startmode>
  <stoptimeout>20sec</stoptimeout>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <onfailure action="restart" delay="60 sec" />
  <resetfailure>1 hour</resetfailure>
  <logpath>$DataRoot\service-logs</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10485760</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
</service>
"@
  Set-Content -Encoding UTF8 -Path (Join-Path $InstallRoot "FCGSGateBridgeService.xml") -Value $serviceXml

  $firewallName = "FCGS Gate Bridge Recognition Callback"
  Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $CallbackPort -RemoteAddress LocalSubnet -Profile Domain,Private | Out-Null

  $serviceExe = Join-Path $InstallRoot "FCGSGateBridgeService.exe"
  & $serviceExe install | Out-Null
  & sc.exe failure $ServiceName reset= 3600 actions= restart/10000/restart/30000/restart/60000 | Out-Null
  & sc.exe failureflag $ServiceName 1 | Out-Null
  Start-Service -Name $ServiceName

  Start-Sleep -Seconds 4
  $service = Get-Service -Name $ServiceName
  if ($service.Status -ne "Running") { throw "The Gate Bridge service was installed but is not running. Review $DataRoot\service-logs." }
  Write-Host ""; Write-Host "FCGS Gate Bridge Service installed and started successfully." -ForegroundColor Green
  Write-Host "Bridge: $($pair.bridgeName)"
  Write-Host "Machine: $env:COMPUTERNAME"
  Write-Host "Local logs: $DataRoot\logs"
  Write-Host "Return to FCGS Access Control > Gate Bridges to confirm Online status."
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
Read-Host "Press Enter to close"
`;
}

function buildInstallerCmd(pairingCode: string, portalUrl: string) {
  const ps = buildInstallerPowerShell(pairingCode, portalUrl);
  const encoded = Buffer.from(ps, "utf16le").toString("base64");
  return `@echo off\r\nsetlocal\r\nfltmc >nul 2>&1\r\nif not %errorlevel%==0 (\r\n  powershell.exe -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"\r\n  exit /b\r\n)\r\npowershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}\r\nif not %errorlevel%==0 pause\r\n`;
}

export function registerGateBridgeBuild2Routes(app: Express) {
  app.get("/api/gate-bridge/release", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await releaseManifest());
  });

  app.get("/api/gate-bridge/windows-assets/:name", async (req, res) => {
    const name = String(req.params.name || "");
    if (!(WINDOWS_ASSETS as readonly string[]).includes(name)) return res.status(404).json({ message: "Gate Bridge asset not found" });
    const filePath = path.join(assetRoot(), name);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) throw new Error("not file");
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.sendFile(filePath);
    } catch {
      return res.status(503).json({ message: `Gate Bridge Windows asset is not available: ${name}` });
    }
  });

  app.get("/api/access-control/gate-bridge-release", requirePermission("access_control.view"), async (req, res) => {
    try {
      await scopeOf(req);
      res.json(await releaseManifest());
    } catch (error) { fail(res, error); }
  });

  app.post("/api/access-control/bridges/:id/install-windows", requirePermission("access_control.manage_devices"), async (req, res) => {
    try {
      const scope = await scopeOf(req);
      const bridgeId = Number(req.params.id);
      const [bridge] = await db.select().from(gateBridges).where(and(eq(gateBridges.id, bridgeId), eq(gateBridges.schoolId, scope.schoolId), eq(gateBridges.organizationId, scope.organizationId))).limit(1);
      if (!bridge) throw new Error("Gate Bridge not found");
      if (!bridge.isActive) throw new Error("Gate Bridge is inactive");
      const input = installRequestSchema.parse(req.body || {});
      const portalUrl = allowedPortalUrl(input.portalUrl);
      const manifest = await releaseManifest();
      if (!manifest.ready) return res.status(503).json({ message: "The Windows Gate Bridge release assets are incomplete on the FCGS server", release: manifest });

      const pairingCode = pairingAlphabetCode();
      const expiresAt = new Date(Date.now() + GATE_BRIDGE_PAIRING_TTL_MINUTES * 60_000);
      // Only the newest installer issued for a Bridge may pair it. This prevents an
      // older still-unexpired download from rotating the Bridge credential later.
      await db.update(gateBridgePairingCodes).set({ usedAt: new Date() }).where(and(
        eq(gateBridgePairingCodes.bridgeId, bridge.id),
        isNull(gateBridgePairingCodes.usedAt),
      ));
      await db.insert(gateBridgePairingCodes).values({
        organizationId: scope.organizationId,
        schoolId: scope.schoolId,
        bridgeId: bridge.id,
        codeHash: hashValue(normalizePairingCode(pairingCode)),
        expiresAt,
        createdByUserId: scope.userId,
      });
      await db.insert(gateLogs).values({
        organizationId: scope.organizationId,
        schoolId: scope.schoolId,
        bridgeId: bridge.id,
        sourceType: "portal",
        eventType: "bridge.pairing_code_created",
        severity: "security",
        message: `A one-time Windows installation pairing code was created for ${bridge.name}.`,
        details: { expiresAt: expiresAt.toISOString(), releaseVersion: manifest.version },
      });

      res.status(201).json({
        bridge: { id: bridge.id, name: bridge.name, machineName: bridge.machineName, pairedAt: bridge.pairedAt },
        pairingCode,
        expiresAt: expiresAt.toISOString(),
        portalUrl,
        release: manifest,
        installerFileName: `Install-FCGS-Gate-Bridge-${bridge.id}.cmd`,
        installerContent: buildInstallerCmd(pairingCode, portalUrl),
        instructions: "Download the installer to the target Windows mini-PC, right-click it, and choose Run as administrator. The pairing code is embedded and can only be redeemed once.",
      });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/gate-bridge/pair", async (req, res) => {
    try {
      const input = pairSchema.parse(req.body);
      const now = new Date();
      const codeHash = hashValue(normalizePairingCode(input.pairingCode));
      const [pairing] = await db.select().from(gateBridgePairingCodes).where(and(
        eq(gateBridgePairingCodes.codeHash, codeHash),
        gt(gateBridgePairingCodes.expiresAt, now),
        isNull(gateBridgePairingCodes.usedAt),
      )).limit(1);
      if (!pairing) throw new Error("Pairing code is invalid or expired");
      if (pairing.usedAt) throw new Error("Pairing code has already been used");
      const [bridge] = await db.select().from(gateBridges).where(eq(gateBridges.id, pairing.bridgeId)).limit(1);
      if (!bridge || !bridge.isActive) throw new Error("Gate Bridge is inactive or no longer exists");

      const rawToken = createBridgeToken();
      await db.transaction(async (tx) => {
        const [redeemed] = await tx.update(gateBridgePairingCodes).set({ usedAt: now }).where(and(eq(gateBridgePairingCodes.id, pairing.id), isNull(gateBridgePairingCodes.usedAt))).returning({ id: gateBridgePairingCodes.id });
        if (!redeemed) throw new Error("Pairing code has already been used");
        await tx.update(gateBridges).set({
          bridgeKeyHash: hashValue(rawToken),
          installationId: input.installationId,
          machineName: input.machineName,
          pairedAt: now,
          lastHeartbeatAt: null,
          lastServiceStartedAt: null,
          lastError: null,
          updatedAt: now,
        }).where(eq(gateBridges.id, bridge.id));
        await tx.update(gateCommands).set({ status: "superseded", completedAt: now, errorMessage: "Superseded by Gate Bridge re-pairing" }).where(and(
          eq(gateCommands.bridgeId, bridge.id),
          inArray(gateCommands.status, ["pending", "processing"]),
        ));
      });

      const activeReconcile = await db.select({ id: gateSyncJobs.id }).from(gateSyncJobs).where(and(eq(gateSyncJobs.schoolId, bridge.schoolId), eq(gateSyncJobs.jobType, "reconcile"), inArray(gateSyncJobs.status, ["pending", "running"]))).limit(1);
      if (!activeReconcile.length) {
        const totalItems = (await db.select({ id: accessIdentities.id }).from(accessIdentities).where(eq(accessIdentities.schoolId, bridge.schoolId))).length;
        await db.insert(gateSyncJobs).values({ organizationId: bridge.organizationId, schoolId: bridge.schoolId, jobType: "reconcile", personType: "all", totalItems, details: { automatic: true, reason: "bridge_paired" } });
      }
      await db.insert(gateLogs).values({
        organizationId: bridge.organizationId,
        schoolId: bridge.schoolId,
        bridgeId: bridge.id,
        sourceType: "bridge",
        eventType: bridge.pairedAt ? "bridge.repaired" : "bridge.paired",
        severity: "security",
        message: `${bridge.name} was paired to Windows computer ${input.machineName}.`,
        details: { installationId: input.installationId, installerVersion: input.installerVersion || null },
      });

      res.json({
        bridgeId: bridge.id,
        bridgeName: bridge.name,
        bridgeToken: rawToken,
        portalUrl: GATE_BRIDGE_PRODUCTION_URL,
        releaseVersion: GATE_BRIDGE_RELEASE_VERSION,
        callbackPort: GATE_BRIDGE_CALLBACK_PORT,
      });
    } catch (error) { fail(res, error); }
  });
}
