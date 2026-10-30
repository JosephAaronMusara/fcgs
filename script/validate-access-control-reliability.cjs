const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const checks = [
 ['Forward-only additive schema', 'sql/2026_10_14_access_control_reliability.sql', /BEGIN;[\s\S]*ADD COLUMN IF NOT EXISTS priority[\s\S]*CREATE TABLE IF NOT EXISTS gate_school_settings[\s\S]*COMMIT;/],
 ['Atomic per-device claim', 'server/access-control-routes.ts', /FOR UPDATE OF c SKIP LOCKED/],
 ['One in-flight command per terminal', 'server/access-control-routes.ts', /NOT EXISTS \(SELECT 1 FROM gate_commands active WHERE active.device_id=c.device_id AND active.status='processing'\)/],
 ['Claim token and execution lease', 'server/access-control-routes.ts', /claim_token=\$\{claimToken\}, lease_expires_at/],
 ['Manual gate open deadline', 'server/access-control-routes.ts', /OPEN_COMMAND_TTL_MS = 15_000/],
 ['Manual expiry independently checked by Bridge', 'script/gate-bridge.ts', /Manual open expired before terminal execution/],
 ['Concurrent independent terminal execution', 'script/gate-bridge.ts', /void executeLeasedCommand\(command\)/],
 ['Terminal serial operations', 'script/gate-bridge.ts', /runDeviceExclusive\(config/],
 ['Persisted completion outbox', 'script/gate-bridge.ts', /completion-outbox/],
 ['Recognition persisted before ACK', 'script/gate-bridge.ts', /await persistRecognitionQueue\(\);\s*res.statusCode = 200/],
 ['No silent recognition forwarding failures', 'script/gate-bridge.ts', /recognition delivery failed \(queue retained\)/],
 ['Desired-state fingerprint', 'server/access-control-operations.ts', /createHash\("sha256"\)\.update\(JSON\.stringify/],
 ['Skip unchanged terminal state', 'server/access-control-operations.ts', /samePending \|\| sameConfirmed \|\| sameDeleted/],
 ['Firmware compatible individual verification', 'script/gate-bridge.ts', /getDeviceWhiteListDetailByIdNum/],
 ['Partial inventory disclaimer', 'server/access-control-operations.ts', /Full terminal inventory enumeration is unsupported/],
 ['Once-per-day school schedule', 'server/access-control-operations.ts', /ensureAutomaticReconciliationJobs/],
 ['Manual vs automatic callback address', 'server/access-control-routes.ts', /callbackMode: z\.enum\(\["automatic", "manual"\]\)/],
 ['Bridge callback host read from configuration', 'script/gate-bridge.ts', /currentCallbackConfig = \{ mode: callbackMode, host: callbackHost, port: callbackPortFromPortal \}/],
 ['Health dashboard first tab', 'client/src/pages/access-control.tsx', /TabsTrigger value="health"[\s\S]*TabsTrigger value="people"/],
 ['Settings after Logs', 'client/src/pages/access-control.tsx', /TabsTrigger value="logs"[\s\S]*TabsTrigger value="settings"/],
 ['Reconciliation job per-person reports', 'server/access-control-operations.ts', /sync-jobs\/:id\/items/],
 ['Finance Button variant errors corrected', 'client/src/pages/school-finance.tsx', /variant="ghost"/],
 ['Attendance report typed array mapper', 'server/attendance-reporting.ts', /function exportRows<T>/],
 ['Fee installments typed parser', 'server/fees-schedule.ts', /map\(\(row: /],
 ];
let passed = 0;
for (const [label,file,pattern] of checks) {
  const ok = pattern.test(read(file));
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (ok) passed++;
}
console.log(`${passed}/${checks.length} source invariants passed`);
if (passed !== checks.length) process.exitCode=1;
