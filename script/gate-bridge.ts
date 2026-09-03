import { createHash } from "crypto";

const BRIDGE_VERSION = "fcgs-gate-bridge/0.1.0";
const serverUrl = String(process.env.FCGS_GATE_BRIDGE_URL || "").replace(/\/$/, "");
const bridgeToken = String(process.env.FCGS_GATE_BRIDGE_TOKEN || "").trim();
const pollMs = Number(process.env.FCGS_GATE_BRIDGE_POLL_MS || 1500);
const heartbeatMs = Number(process.env.FCGS_GATE_BRIDGE_HEARTBEAT_MS || 15000);
const probeMs = Number(process.env.FCGS_GATE_BRIDGE_PROBE_MS || 30000);

type DeviceConfig = {
  deviceKey: string;
  host: string;
  port?: number;
  username?: string;
  password: string;
  passwordIsMd5?: boolean;
};

type DeviceHealth = {
  deviceKey: string;
  status: "online" | "offline" | "unknown";
  versionInfo?: Record<string, unknown> | null;
  error?: string | null;
};

function failStartup(message: string): never {
  console.error(`[gate-bridge] ${message}`);
  process.exit(1);
}

if (!serverUrl) failStartup("FCGS_GATE_BRIDGE_URL is required");
if (!bridgeToken) failStartup("FCGS_GATE_BRIDGE_TOKEN is required");

let deviceConfigs: DeviceConfig[] = [];
try {
  const raw = String(process.env.FCGS_GATE_BRIDGE_DEVICES || "[]");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("must be a JSON array");
  deviceConfigs = parsed;
} catch (error) {
  failStartup(`FCGS_GATE_BRIDGE_DEVICES is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

const byKey = new Map(deviceConfigs.map((device) => [device.deviceKey, device]));
const health = new Map<string, DeviceHealth>(deviceConfigs.map((device) => [device.deviceKey, { deviceKey: device.deviceKey, status: "unknown" }]));
let stopped = false;
let commandLoopRunning = false;
let probeLoopRunning = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function passwordDigest(config: DeviceConfig) {
  const password = String(config.password || "");
  if (config.passwordIsMd5 || /^[a-f0-9]{32}$/i.test(password)) return password.toLowerCase();
  return createHash("md5").update(password, "utf8").digest("hex");
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let payload: any = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${payload?.message || text || response.statusText}`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function portalRequest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${bridgeToken}`);
  headers.set("Content-Type", "application/json");
  return fetchJson(`${serverUrl}${path}`, { ...init, headers }, 10_000);
}

function deviceBase(config: DeviceConfig) {
  const host = config.host.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return `http://${host}:${config.port || 9090}`;
}

async function devicePost(config: DeviceConfig, path: string, body: Record<string, unknown>) {
  return fetchJson(`${deviceBase(config)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 6000);
}

async function login(config: DeviceConfig) {
  const payload = await devicePost(config, "/deviceLogin", {
    username: config.username || "admin",
    password: passwordDigest(config),
  });
  if (Number(payload?.result) !== 0 || !payload?.token) {
    throw new Error(payload?.message || `Device login failed (result ${payload?.result ?? "unknown"})`);
  }
  return String(payload.token);
}

function normalizeDeviceData(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return { raw: value };
    }
  }
  return {};
}

async function getVersion(config: DeviceConfig) {
  const token = await login(config);
  const payload = await devicePost(config, "/getDeviceVersion", { token });
  if (Number(payload?.result) !== 0) throw new Error(payload?.message || "Device version query failed");
  return normalizeDeviceData(payload?.data);
}

async function openGate(config: DeviceConfig) {
  const token = await login(config);
  const payload = await devicePost(config, "/setDeviceRemoteOpen", { token });
  if (Number(payload?.result) !== 0) throw new Error(payload?.message || "Remote gate-open command failed");
  return { message: payload?.message || "OK", result: Number(payload?.result) };
}

async function probeDevice(config: DeviceConfig) {
  try {
    const versionInfo = await getVersion(config);
    health.set(config.deviceKey, { deviceKey: config.deviceKey, status: "online", versionInfo, error: null });
  } catch (error) {
    health.set(config.deviceKey, {
      deviceKey: config.deviceKey,
      status: "offline",
      versionInfo: health.get(config.deviceKey)?.versionInfo || null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function probeLoop() {
  if (probeLoopRunning) return;
  probeLoopRunning = true;
  try {
    while (!stopped) {
      for (const config of deviceConfigs) {
        if (stopped) break;
        await probeDevice(config);
      }
      await sendHeartbeat();
      await sleep(Math.max(10_000, probeMs));
    }
  } finally {
    probeLoopRunning = false;
  }
}

async function sendHeartbeat() {
  try {
    await portalRequest("/api/gate-bridge/heartbeat", {
      method: "POST",
      body: JSON.stringify({ softwareVersion: BRIDGE_VERSION, devices: Array.from(health.values()) }),
    });
  } catch (error) {
    console.error(`[gate-bridge] heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function completeCommand(commandId: number, success: boolean, result?: Record<string, unknown>, error?: string) {
  try {
    await portalRequest(`/api/gate-bridge/commands/${commandId}/complete`, {
      method: "POST",
      body: JSON.stringify({ success, result: result || null, error: error || null }),
    });
  } catch (completionError) {
    console.error(`[gate-bridge] failed to report completion for command ${commandId}: ${completionError instanceof Error ? completionError.message : String(completionError)}`);
  }
}

async function executeCommand(command: any) {
  const key = String(command?.device?.deviceKey || "");
  const config = byKey.get(key);
  if (!config) {
    await completeCommand(Number(command.id), false, undefined, `Device ${key || "(missing key)"} is not configured on this Gate Bridge`);
    return;
  }
  if (command.expiresAt && new Date(command.expiresAt).getTime() <= Date.now()) {
    await completeCommand(Number(command.id), false, undefined, "Command expired before execution");
    return;
  }

  try {
    if (command.commandType === "open_gate") {
      const result = await openGate(config);
      health.set(key, { ...health.get(key), deviceKey: key, status: "online", error: null });
      await completeCommand(Number(command.id), true, result);
      console.log(`[gate-bridge] opened ${command?.device?.name || key} for command ${command.id}`);
      return;
    }
    if (command.commandType === "get_version") {
      const versionInfo = await getVersion(config);
      health.set(key, { deviceKey: key, status: "online", versionInfo, error: null });
      await completeCommand(Number(command.id), true, versionInfo);
      console.log(`[gate-bridge] connection test passed for ${command?.device?.name || key}`);
      return;
    }
    await completeCommand(Number(command.id), false, undefined, `Unsupported command type: ${String(command.commandType)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    health.set(key, { ...health.get(key), deviceKey: key, status: "offline", error: message });
    await completeCommand(Number(command.id), false, undefined, message);
    console.error(`[gate-bridge] command ${command.id} failed: ${message}`);
  }
}

async function commandLoop() {
  if (commandLoopRunning) return;
  commandLoopRunning = true;
  try {
    while (!stopped) {
      try {
        const payload = await portalRequest("/api/gate-bridge/commands/claim", { method: "POST", body: "{}" });
        const commands = Array.isArray(payload?.commands) ? payload.commands : [];
        for (const command of commands) {
          if (stopped) break;
          await executeCommand(command);
        }
      } catch (error) {
        console.error(`[gate-bridge] command poll failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await sleep(Math.max(500, pollMs));
    }
  } finally {
    commandLoopRunning = false;
  }
}

const heartbeatTimer = setInterval(() => { void sendHeartbeat(); }, Math.max(5000, heartbeatMs));

function stop(signal: string) {
  if (stopped) return;
  stopped = true;
  clearInterval(heartbeatTimer);
  console.log(`[gate-bridge] ${signal} received; stopping`);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

console.log(`[gate-bridge] starting ${BRIDGE_VERSION}`);
console.log(`[gate-bridge] portal: ${serverUrl}`);
console.log(`[gate-bridge] configured devices: ${deviceConfigs.length}`);
void sendHeartbeat();
void probeLoop();
void commandLoop();
