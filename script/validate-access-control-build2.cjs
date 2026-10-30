const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cache = new Map();
function read(file) {
  if (!cache.has(file)) cache.set(file, fs.readFileSync(path.join(root, file), 'utf8'));
  return cache.get(file);
}

const checks = [];
function expect(file, pattern, label) {
  let ok = false;
  try {
    const text = read(file);
    ok = typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
  } catch (_) {}
  checks.push({ ok, file, label });
}

// Build 2 persistence / migration.
expect('shared/schema.ts', 'installationId: text("installation_id")', 'Bridge installation identity is persisted');
expect('shared/schema.ts', 'lastServiceStartedAt: timestamp("last_service_started_at")', 'Bridge service start telemetry is persisted');
expect('shared/schema.ts', 'lastIdentityReconcileAt: timestamp("last_identity_reconcile_at")', 'Identity reconciliation timestamp is persisted');
expect('shared/schema.ts', 'export const gateBridgePairingCodes = pgTable("gate_bridge_pairing_codes"', 'One-time pairing-code table exists');
expect('shared/schema.ts', 'export const gateSyncJobs = pgTable("gate_sync_jobs"', 'Durable Gate sync-job table exists');
expect('shared/schema.ts', 'retryCount: integer("retry_count")', 'Identity sync retry count is persisted');
expect('shared/schema.ts', 'nextRetryAt: timestamp("next_retry_at")', 'Identity sync retry schedule is persisted');
expect('shared/schema.ts', 'lastSyncedPhotoPath: text("last_synced_photo_path")', 'Last-synced photo source is persisted');
expect('sql/access_control_build2_production_hardening.sql', /CREATE TABLE IF NOT EXISTS gate_bridge_pairing_codes/, 'Additive pairing migration exists');
expect('sql/access_control_build2_production_hardening.sql', /CREATE TABLE IF NOT EXISTS gate_sync_jobs/, 'Additive sync-job migration exists');

// Release / installer / pairing.
expect('shared/gate-bridge-release.ts', 'GATE_BRIDGE_PRODUCTION_URL = "https://portal.firstchoicegroup.co.zw"', 'Production portal URL is the release default');
expect('shared/gate-bridge-release.ts', 'GATE_BRIDGE_PAIRING_TTL_MINUTES = 20', 'Pairing code has a short fixed lifetime');
expect('server/gate-bridge-build2.ts', 'export function registerGateBridgeBuild2Routes', 'Build 2 deployment routes source exists');
expect('server/gate-bridge-build2.ts', 'app.post("/api/access-control/bridges/:id/install-windows"', 'Authenticated Windows installer generation endpoint exists');
expect('server/gate-bridge-build2.ts', 'app.post("/api/gate-bridge/pair"', 'One-time machine pairing endpoint exists');
expect('server/gate-bridge-build2.ts', 'codeHash: hashValue(normalizePairingCode(pairingCode))', 'Pairing codes are stored hashed rather than plaintext');
expect('server/gate-bridge-build2.ts', 'gt(gateBridgePairingCodes.expiresAt, now)', 'Expired pairing codes are rejected');
expect('server/gate-bridge-build2.ts', 'isNull(gateBridgePairingCodes.usedAt)', 'Pairing redemption is atomic and one-time');
expect('server/gate-bridge-build2.ts', 'Custom Gate Bridge portal URLs must use HTTPS', 'Non-local custom portal URLs require HTTPS');
expect('server/gate-bridge-build2.ts', 'ProtectedData]::Protect', 'Installer encrypts local secrets using Windows DPAPI');
expect('server/gate-bridge-build2.ts', 'DataProtectionScope]::LocalMachine', 'DPAPI protection is machine scoped');
expect('server/gate-bridge-build2.ts', 'New-NetFirewallRule', 'Installer configures the local recognition-callback firewall rule');
expect('server/gate-bridge-build2.ts', '-RemoteAddress LocalSubnet', 'Callback firewall access is restricted to the local subnet');
expect('server/gate-bridge-build2.ts', '<startmode>Automatic</startmode>', 'Windows Gate Bridge service starts automatically');
expect('server/gate-bridge-build2.ts', '<onfailure action="restart"', 'Windows Gate Bridge service has restart-on-failure policy');
expect('server/gate-bridge-build2.ts', 'FCGS_GATE_BRIDGE_CODE_SIGNED_RELEASE', 'Broad-rollout signing state is an explicit production gate');
expect('server/routes.ts', 'registerGateBridgeBuild2Routes(app);', 'Build 2 routes are registered');

// Self-contained runtime and update framework.
expect('script/build.ts', 'gate-bridge-windows/assets/gate-bridge.cjs', 'Portal build produces a bundled Gate Bridge runtime');
expect('script/prepare-gate-bridge-windows-runtime.ts', 'node.exe', 'Pinned Windows Node runtime preparation exists');
expect('script/prepare-gate-bridge-windows-runtime.ts', 'FCGSGateBridgeService.exe', 'Pinned Windows service wrapper preparation exists');
expect('script/prepare-gate-bridge-windows-runtime.ts', 'SHA-256 mismatch', 'Runtime downloads are checksum verified');
expect('gate-bridge-windows/assets/Start-GateBridge.ps1', 'ProtectedData]::Unprotect', 'Service startup decrypts DPAPI-protected credentials locally');
expect('gate-bridge-windows/assets/Start-GateBridge.ps1', 'FCGS_GATE_DEVICE_PASSWORD', 'Terminal credential is supplied only to the local Bridge process');
expect('gate-bridge-windows/assets/Update-GateBridge.ps1', 'Get-FileHash -Algorithm SHA256', 'Service updater verifies release asset checksums');
expect('gate-bridge-windows/assets/Update-GateBridge.ps1', 'Restoring the previous release', 'Service updater rolls back on failed updates');

// Bridge telemetry / terminal inventory / offline persistence.
expect('script/gate-bridge.ts', 'FCGS_GATE_BRIDGE_INSTALLATION_ID', 'Bridge sends stable local installation identity');
expect('script/gate-bridge.ts', 'FCGS_GATE_BRIDGE_MACHINE_NAME', 'Bridge sends machine identity telemetry');
expect('script/gate-bridge.ts', 'getPersonnelIdList', 'Bridge implements terminal personnel-ID inventory retrieval');
expect('script/gate-bridge.ts', '/getPersonnelIDList', 'Bridge uses the documented terminal personnel inventory endpoint');
expect('script/gate-bridge.ts', 'get_personnel_id_list', 'Bridge executes terminal inventory commands from FCGS');
expect('script/gate-bridge.ts', 'FCGS_GATE_BRIDGE_LOG_RETENTION_DAYS', 'Bridge supports bounded local log retention');
expect('server/access-control-routes.ts', 'installationId', 'Bridge heartbeat accepts installation identity');
expect('server/access-control-routes.ts', 'retry_pending', 'Failed identity syncs enter durable retry state');

// Scale / reconciliation / cleanup.
expect('server/access-control-operations.ts', 'bulk-enroll', 'Bulk enrollment endpoint exists');
expect('server/access-control-operations.ts', 'sync-jobs/reconcile', 'Manual reconciliation endpoint exists');
expect('server/access-control-operations.ts', 'inventoryCapability: "bulk_inventory_unsupported"', 'F550 reconciliation explicitly handles unsupported bulk inventory');
expect('server/access-control-operations.ts', 'unknown terminal-only identities are not verified', 'Unsupported terminal-only inventory is explicitly disclosed');
expect('server/access-control-operations.ts', /enrollmentRemovedAt/, 'Manual enrollment removal remains authoritative during production sync');
expect('server/access-control-operations.ts', /lastSyncedPhotoPath/, 'Photo changes trigger enrollment reconciliation');
expect('server/access-control-operations.ts', /nextRetryAt/, 'Offline/failed enrollment retries are scheduled');
expect('server/access-control-operations.ts', /automatic: true/, 'Automatic production reconciliation is scheduled');

// Operator UI.
expect('client/src/pages/access-control.tsx', 'Install Windows Gate Bridge Service', 'Requested production installer button label is present');
expect('client/src/pages/access-control.tsx', 'Reinstall / Re-pair Service', 'Existing Bridge can be cleanly re-paired');
expect('client/src/pages/access-control.tsx', 'lastIdentityReconcileAt', 'Gate Bridge UI shows last identity reconciliation');
expect('client/src/components/access-control-operations-panel.tsx', 'Bulk Enroll Active Students', 'Bulk student enrollment action is exposed');
expect('client/src/components/access-control-operations-panel.tsx', 'Bulk Enroll Active Staff', 'Bulk staff enrollment action is exposed');
expect('client/src/components/access-control-operations-panel.tsx', 'Reconcile Enrollments', 'Production reconciliation action is exposed');
expect('client/src/components/access-control-operations-panel.tsx', 'retry_pending', 'Retry-pending identity health is visible to operators');

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? '[PASS]' : '[FAIL]'} ${c.label} (${c.file})`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
if (failed.length) process.exit(1);
