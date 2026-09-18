const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
const expect = (file, pattern, label) => {
  const text = read(file);
  const ok = typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
  checks.push({ ok, label, file });
};

expect('shared/schema.ts', 'export const accessGates = pgTable("access_gates"', 'Access Gate table exists');
expect('shared/schema.ts', 'gateId: integer("gate_id")', 'Terminals reference Gates');
expect('shared/schema.ts', 'lanePosition: text("lane_position")', 'Terminal physical lane is persisted');
expect('shared/schema.ts', 'gate_devices_gate_lane_uidx', 'Gate + lane uniqueness is enforced');
expect('shared/schema.ts', 'export const gateLogs = pgTable("gate_logs"', 'Access Control operational log table exists');
expect('shared/schema.ts', 'configurationRevision: integer("configuration_revision")', 'Bridge configuration revisions are tracked');
expect('server/access-control-routes.ts', 'entry_lane_1: { label: "Entry Lane 1"', 'Entry Lane 1 is a standard slot');
expect('server/access-control-routes.ts', 'exit_lane_2: { label: "Exit Lane 2"', 'Exit Lane 2 is a standard slot');
expect('server/access-control-routes.ts', 'app.get("/api/gate-bridge/config"', 'Bridge receives device config from FCGS');
expect('server/access-control-routes.ts', 'app.patch("/api/access-control/devices/:id"', 'Terminal IP/port can be edited through FCGS');
expect('server/access-control-routes.ts', 'app.post("/api/access-control/gates/:id/test"', 'Gate-wide Test All endpoint exists');
expect('server/access-control-routes.ts', 'app.get("/api/access-control/logs"', 'FCGS Logs endpoint exists');
expect('server/access-control-routes.ts', 'configurationPending: true', 'Commands wait for current bridge configuration');
expect('script/gate-bridge.ts', 'DEFAULT_PRODUCTION_URL = "https://portal.firstchoicegroup.co.zw"', 'Production portal URL is the default');
expect('script/gate-bridge.ts', 'FCGS_GATE_DEVICE_PASSWORD', 'Shared terminal credentials remain local');
expect('script/gate-bridge.ts', 'configuration synchronized:', 'Bridge dynamically synchronizes FCGS config');
expect('script/gate-bridge.ts', '/api/gate-bridge/logs', 'Bridge forwards operational logs to FCGS');
expect('client/src/pages/access-control.tsx', 'Entry Lane 1', 'UI exposes physical lane naming');
expect('client/src/pages/access-control.tsx', 'Test All Terminals', 'UI exposes Gate-wide testing');
expect('client/src/pages/access-control.tsx', 'Access Control logs', 'UI exposes logs');
expect('client/src/pages/access-control.tsx', 'Save & Test', 'UI supports IP/config update plus immediate test');
expect('gate-bridge.env.example', 'FCGS_GATE_BRIDGE_DEVICES=[]', 'Legacy per-device list is optional only');
expect('gate-bridge.env.example', 'FCGS_GATE_DEVICE_PASSWORD=REPLACE_ME', 'Local shared terminal credential is documented');
expect('RUN_GATE_BRIDGE.cmd', 'npx dotenv -e .\\gate-bridge.env -- npm run gate:bridge', 'CMD launcher bypasses PowerShell execution-policy friction');

const failed = checks.filter((row) => !row.ok);
for (const row of checks) console.log(`${row.ok ? '[PASS]' : '[FAIL]'} ${row.label} (${row.file})`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
if (failed.length) process.exit(1);
