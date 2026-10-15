import { createHash, timingSafeEqual } from "crypto";
import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import os from "os";
import http from "http";

import { GATE_BRIDGE_RELEASE_VERSION } from "../shared/gate-bridge-release";

const BRIDGE_VERSION = process.env.FCGS_SIGNED_BRIDGE_BUILD_VERSION || GATE_BRIDGE_RELEASE_VERSION;
const DEFAULT_PRODUCTION_URL = "https://portal.firstchoicegroup.co.zw";
const serverUrl = String(process.env.FCGS_GATE_BRIDGE_URL || DEFAULT_PRODUCTION_URL).replace(/\/$/, "");
const bridgeToken = String(process.env.FCGS_GATE_BRIDGE_TOKEN || "").trim();
const installationId = String(process.env.FCGS_GATE_BRIDGE_INSTALLATION_ID || "").trim();
const machineName = String(process.env.FCGS_GATE_BRIDGE_MACHINE_NAME || os.hostname()).trim() || os.hostname();
const serviceStartedAt = new Date().toISOString();
const defaultUsername = String(process.env.FCGS_GATE_DEVICE_USERNAME || "admin").trim() || "admin";
const defaultPassword = String(process.env.FCGS_GATE_DEVICE_PASSWORD || "");
const defaultPasswordIsMd5 = /^(1|true|yes)$/i.test(String(process.env.FCGS_GATE_DEVICE_PASSWORD_IS_MD5 || ""));
const pollMs = Number(process.env.FCGS_GATE_BRIDGE_POLL_MS || 1500);
const heartbeatMs = Number(process.env.FCGS_GATE_BRIDGE_HEARTBEAT_MS || 15000);
const probeMs = Number(process.env.FCGS_GATE_BRIDGE_PROBE_MS || 30000);
const configMs = Number(process.env.FCGS_GATE_BRIDGE_CONFIG_MS || 5000);
const logDir = String(process.env.FCGS_GATE_BRIDGE_LOG_DIR || path.join(process.cwd(), "gate-bridge-logs"));
const callbackPort = Number(process.env.FCGS_GATE_BRIDGE_LISTEN_PORT || 9191);
const explicitCallbackHost = String(process.env.FCGS_GATE_BRIDGE_CALLBACK_HOST || "").trim();
const explicitCallbackUrl = String(process.env.FCGS_GATE_BRIDGE_CALLBACK_URL || "").trim();
const recognitionQueueFile = String(process.env.FCGS_GATE_BRIDGE_RECOGNITION_QUEUE_FILE || path.join(logDir, "recognition-queue.json"));
const deviceReadTimeoutMs = Math.max(6000, Number(process.env.FCGS_GATE_DEVICE_READ_TIMEOUT_MS || 10_000));
const deviceWriteTimeoutMs = Math.max(deviceReadTimeoutMs, Number(process.env.FCGS_GATE_DEVICE_WRITE_TIMEOUT_MS || 45_000));
const localLogRetentionDays = Math.max(7, Number(process.env.FCGS_GATE_BRIDGE_LOG_RETENTION_DAYS || 30));

type LegacyDeviceConfig = {
  deviceKey: string;
  host: string;
  port?: number;
  username?: string;
  password: string;
  passwordIsMd5?: boolean;
};

type PortalDeviceConfig = {
  deviceKey: string;
  name: string;
  gateId?: number | null;
  gateName?: string | null;
  lanePosition?: string | null;
  direction?: string | null;
  protocol: string;
  host: string;
  port?: number;
  deviceSn?: string | null;
  macAddress?: string | null;
};

type DeviceConfig = PortalDeviceConfig & {
  username: string;
  password: string;
  passwordIsMd5?: boolean;
};

type DeviceHealth = {
  deviceKey: string;
  status: "online" | "offline" | "unknown";
  versionInfo?: Record<string, unknown> | null;
  error?: string | null;
};

type BridgeEvent = {
  eventType: string;
  severity: "info" | "warning" | "error" | "security";
  message: string;
  deviceKey?: string | null;
  details?: Record<string, unknown> | null;
  occurredAt: string;
};

type QueuedRecognition = {
  deviceKey: string;
  record: Record<string, unknown>;
  receivedAt: string;
};

function failStartup(message: string): never {
  console.error(`[gate-bridge] ${message}`);
  process.exit(1);
}

if (!bridgeToken) failStartup("FCGS_GATE_BRIDGE_TOKEN is required");

let legacyDeviceConfigs: LegacyDeviceConfig[] = [];
try {
  const raw = String(process.env.FCGS_GATE_BRIDGE_DEVICES || "[]");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("must be a JSON array");
  legacyDeviceConfigs = parsed;
} catch (error) {
  failStartup(`FCGS_GATE_BRIDGE_DEVICES is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

const legacyByKey = new Map(legacyDeviceConfigs.map((device) => [device.deviceKey, device]));
let deviceConfigs: DeviceConfig[] = legacyDeviceConfigs.map((device) => ({
  deviceKey: device.deviceKey,
  name: device.deviceKey,
  gateId: null,
  gateName: null,
  lanePosition: null,
  direction: null,
  protocol: "http",
  host: device.host,
  port: device.port || 9090,
  username: device.username || defaultUsername,
  password: device.password,
  passwordIsMd5: device.passwordIsMd5,
}));
let byKey = new Map(deviceConfigs.map((device) => [device.deviceKey, device]));
const health = new Map<string, DeviceHealth>(deviceConfigs.map((device) => [device.deviceKey, { deviceKey: device.deviceKey, status: "unknown" }]));
let currentConfigRevision = 0;
let stopped = false;
let commandLoopRunning = false;
let probeLoopRunning = false;
let configLoopRunning = false;
let pendingEvents: BridgeEvent[] = [];
let portalConnectionState: "unknown" | "online" | "offline" = "unknown";
let localLogReady = false;
let recognitionQueue: QueuedRecognition[] = [];
let recognitionFlushRunning = false;
let recognitionWriteTail: Promise<void> = Promise.resolve();
const completionDir = path.join(logDir, "completion-outbox");
let currentCallbackConfig: { mode: "automatic" | "manual"; host: string | null; port: number } = { mode: "automatic", host: null, port: callbackPort };
let activeCallbackUrl: string | null = null;
let callbackError: string | null = null;
const activeCommands = new Set<number>();
let updateQuiescing = false;
let localUpdateSecret = "";
function isLocalUpdateRequest(req: http.IncomingMessage) {
  const ip = String(req.socket.remoteAddress||"");
  if (ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1") return false;
  const candidate = String(req.headers["x-fcgs-update-secret"]||"");
  if (!localUpdateSecret || !candidate) return false;
  const a=Buffer.from(localUpdateSecret,"utf8"),b=Buffer.from(candidate,"utf8");
  return a.length===b.length && timingSafeEqual(a,b);
}


// Linux face terminals have a small HTTP service and their login token/session can
// be disturbed by overlapping requests. Keep every conversation with a given
// terminal strictly serial while still allowing different terminals to work in
// parallel.
const deviceOperationTails = new Map<string, Promise<void>>();

async function runDeviceExclusive<T>(config: DeviceConfig, operation: () => Promise<T>): Promise<T> {
  const key = config.deviceKey;
  const previous = deviceOperationTails.get(key) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => gate);
  deviceOperationTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (deviceOperationTails.get(key) === tail) deviceOperationTails.delete(key);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const FACE_TARGET_MAX_BYTES = Math.max(80_000, Number(process.env.FCGS_GATE_FACE_TARGET_MAX_BYTES || 300_000));

function stripDataUrl(value: string) {
  return value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "").replace(/\s+/g, "");
}

function prepareFacePhoto(base64Value: string, idno: string) {
  const base64 = stripDataUrl(base64Value);
  let source: Buffer;
  try {
    source = Buffer.from(base64, "base64");
  } catch {
    throw new Error(`FCGS profile photo for ${idno} is not valid Base64`);
  }
  if (!source.length) throw new Error(`FCGS profile photo for ${idno} is empty`);
  if (source.length > FACE_TARGET_MAX_BYTES) {
    throw new Error(`Prepared FCGS profile photo for ${idno} is ${source.length} bytes; portal normalization must keep it below ${FACE_TARGET_MAX_BYTES} bytes`);
  }
  return { base64, outputBytes: source.length };
}

function normalizeIp(value: string | undefined | null) {
  return String(value || "").replace(/^::ffff:/, "").split("%")[0];
}

function detectCallbackHost() {
  if (explicitCallbackHost) return explicitCallbackHost;
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254.")) return entry.address;
    }
  }
  return "127.0.0.1";
}

function callbackUrl() {
  if (currentCallbackConfig.mode === "manual" && currentCallbackConfig.host) {
    const configured = currentCallbackConfig.host;
    const ips = Object.values(os.networkInterfaces()).flatMap((entries) => entries || [])
      .filter((entry) => entry.family === "IPv4").map((entry) => entry.address);
    if (!ips.includes(configured)) throw new Error(`Manually configured callback IPv4 address ${configured} is not assigned to this Windows computer`);
    if (currentCallbackConfig.port !== callbackPort) throw new Error(`Callback port ${currentCallbackConfig.port} does not match active listener port ${callbackPort}`);
    return `http://${configured}:${callbackPort}/uploadDeviceRecogRecord`;
  }
  return explicitCallbackUrl || `http://${detectCallbackHost()}:${callbackPort}/uploadDeviceRecogRecord`;
}

async function persistRecognitionQueue() {
  // Serialize writes and atomically replace the durable queue file. Never ACK a
  // terminal before fs persistence succeeds.
  const previous = recognitionWriteTail;
  let release!: () => void;
  recognitionWriteTail = new Promise<void>((resolve) => { release = resolve; });
  await previous.catch(() => undefined);
  try {
    await mkdir(path.dirname(recognitionQueueFile), { recursive: true });
    const tempFile = `${recognitionQueueFile}.${process.pid}.tmp`;
    await writeFile(tempFile, JSON.stringify(recognitionQueue), "utf8");
    await rename(tempFile, recognitionQueueFile);
  } finally { release(); }
}

async function loadRecognitionQueue() {
  try {
    const raw = await readFile(recognitionQueueFile, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) recognitionQueue = parsed.filter((row) => row && row.deviceKey && row.record);
  } catch (error: any) {
    if (error?.code !== "ENOENT") logError(`failed to load recognition queue: ${error instanceof Error ? error.message : String(error)}`);
  }
}

let lastLogPruneDay = "";

async function pruneLocalLogs() {
  const day = new Date().toISOString().slice(0, 10);
  if (lastLogPruneDay === day) return;
  lastLogPruneDay = day;
  const cutoff = Date.now() - localLogRetentionDays * 24 * 60 * 60 * 1000;
  try {
    const names = await readdir(logDir);
    for (const name of names) {
      if (!/^gate-bridge-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
      const filePath = path.join(logDir, name);
      const info = await stat(filePath);
      if (info.mtimeMs < cutoff) await unlink(filePath).catch(() => undefined);
    }
  } catch {
    // Retention cleanup must never interrupt gate operation.
  }
}

async function writeLocalLog(level: string, message: string, details?: Record<string, unknown>) {
  try {
    if (!localLogReady) {
      await mkdir(logDir, { recursive: true });
      localLogReady = true;
    }
    await pruneLocalLogs();
    const day = new Date().toISOString().slice(0, 10);
    await appendFile(path.join(logDir, `gate-bridge-${day}.log`), `${JSON.stringify({ time: new Date().toISOString(), level, message, details: details || null })}\n`, "utf8");
  } catch {
    // Local file logging must never interrupt gate operation.
  }
}

function logInfo(message: string, details?: Record<string, unknown>) {
  console.log(`[gate-bridge] ${message}`);
  void writeLocalLog("info", message, details);
}

function logError(message: string, details?: Record<string, unknown>) {
  console.error(`[gate-bridge] ${message}`);
  void writeLocalLog("error", message, details);
}

function queueEvent(eventType: string, severity: BridgeEvent["severity"], message: string, deviceKey?: string | null, details?: Record<string, unknown> | null) {
  pendingEvents.push({ eventType, severity, message, deviceKey: deviceKey || null, details: details || null, occurredAt: new Date().toISOString() });
  if (pendingEvents.length > 100) pendingEvents = pendingEvents.slice(-100);
}

function credentialFor(deviceKey: string) {
  const legacy = legacyByKey.get(deviceKey);
  if (legacy) {
    return {
      username: legacy.username || defaultUsername,
      password: String(legacy.password || ""),
      passwordIsMd5: legacy.passwordIsMd5,
    };
  }
  return { username: defaultUsername, password: defaultPassword, passwordIsMd5: defaultPasswordIsMd5 };
}

function passwordDigest(config: DeviceConfig) {
  const password = String(config.password || "");
  if (!password) throw new Error("Terminal credentials are not configured on this Gate Bridge");
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

async function portalRequest(pathname: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${bridgeToken}`);
  headers.set("Content-Type", "application/json");
  return fetchJson(`${serverUrl}${pathname}`, { ...init, headers }, 10_000);
}

function deviceBase(config: DeviceConfig) {
  const host = config.host.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return `http://${host}:${config.port || 9090}`;
}

function transportErrorDetails(error: unknown) {
  const err = error as any;
  const cause = err?.cause as any;
  const pieces = [String(err?.message || error || "unknown transport error")];
  if (cause?.code) pieces.push(String(cause.code));
  if (cause?.message && cause?.message !== err?.message) pieces.push(String(cause.message));
  return pieces.filter(Boolean).join(": ");
}

async function devicePost(config: DeviceConfig, pathname: string, body: Record<string, unknown>, timeoutMs = deviceReadTimeoutMs) {
  const bodyText = JSON.stringify(body);
  try {
    return await fetchJson(`${deviceBase(config)}${pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        // These embedded terminals have a small HTTP server. Avoid reusing a
        // socket that the firmware may already have closed after the prior API call.
        "Connection": "close",
        "Content-Length": String(Buffer.byteLength(bodyText, "utf8")),
      },
      body: bodyText,
    }, timeoutMs);
  } catch (error) {
    throw new Error(`${pathname} transport failed on ${config.host}:${config.port || 9090}: ${transportErrorDetails(error)}`);
  }
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
  return runDeviceExclusive(config, async () => {
    const token = await login(config);
    const payload = await devicePost(config, "/getDeviceVersion", { token });
    if (Number(payload?.result) !== 0) throw new Error(payload?.message || "Device version query failed");
    return normalizeDeviceData(payload?.data);
  });
}

async function openGate(config: DeviceConfig, deadline?: number) {
  return runDeviceExclusive(config, async () => {
    if (deadline && Date.now() >= deadline) throw new Error("Manual open expired before terminal execution");
    const token = await login(config);
    if (deadline && Date.now() >= deadline) throw new Error("Manual open expired before terminal execution");
    const payload = await devicePost(config, "/setDeviceRemoteOpen", { token });
    if (Number(payload?.result) !== 0) throw new Error(payload?.message || "Remote gate-open command failed");
    return { message: payload?.message || "OK", result: Number(payload?.result) };
  });
}

async function getPersonnelIdList(config: DeviceConfig) {
  return runDeviceExclusive(config, async () => {
    const token = await login(config);
    const ids: string[] = [];
    const seen = new Set<string>();
    let page = 1;
    let faceCount = 0;
    // Vendor HTTP V3.1: getPersonnelIDList uses one-based pages with max 100 IDs/page.
    while (page <= 1000) {
      const payload = await devicePost(config, "/getPersonnelIDList", { token, page }, Math.max(deviceReadTimeoutMs, 12_000));
      if (Number(payload?.result) !== 0) throw new Error(payload?.message || "Personnel ID list query failed");
      faceCount = Number(payload?.faceCount || faceCount || 0);
      const data = normalizeDeviceData(payload?.data);
      const pageIds = Array.isArray((data as any).idList) ? (data as any).idList.map((value: unknown) => String(value || "").trim()).filter(Boolean) : [];
      for (const id of pageIds) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
      if (pageIds.length < 100 || (faceCount > 0 && ids.length >= faceCount)) break;
      page += 1;
    }
    return { idList: ids, faceCount: faceCount || ids.length, pagesRead: page };
  });
}

async function verifyIdentity(config: DeviceConfig, idno: string) {
  return runDeviceExclusive(config, async () => {
    const token = await login(config);
    const identity = await getExistingIdentity(config, token, idno);
    const group = identity?.data?.TimeGroupId ?? identity?.data?.timeGroupId ?? identity?.data?.timegroupid;
    return { idno, found: Boolean(identity), usertype: identity?.usertype || null,
      TimeGroupId: group === undefined || group === null ? null : Number(group) };
  });
}

async function deleteIdentity(config: DeviceConfig, idno: string) {
  return runDeviceExclusive(config, async () => {
    const token = await login(config);
    let deleted = false;
    for (const usertype of ["white", "black"]) {
      try {
        const payload = await devicePost(config, "/deleteDeviceWhiteList", { token, data: { idno, usertype } }, deviceReadTimeoutMs);
        if (Number(payload?.result) === 0) deleted = true;
      } catch {
        // Deletion is idempotent: absence from one list is not a failure.
      }
    }
    return { deleted };
  });
}

async function getExistingIdentity(config: DeviceConfig, token: string, idno: string) {
  const payload = await devicePost(
    config,
    "/getDeviceWhiteListDetailByIdNum",
    { token, data: { idno } },
    deviceReadTimeoutMs,
  );
  if (Number(payload?.result) !== 0) return null;
  const data = normalizeDeviceData(payload?.data);
  const usertype = String(data?.usertype || "").trim().toLowerCase();
  return { data, usertype };
}

async function syncIdentity(config: DeviceConfig, payloadData: Record<string, any>) {
  const idno = String(payloadData.idno || "").trim();
  if (!idno) throw new Error("Identity synchronization is missing idno");
  const picData1 = String(payloadData.picData1 || "");
  if (!picData1) throw new Error(`No FCGS profile photo is available for ${idno}`);

  // FCGS profile photos are retained at their original quality. The terminal,
  // however, is an embedded device with a small HTTP service and can reset its
  // API process when multi-megabyte Base64 JSON bodies are posted. Normalize
  // only the copy sent to the terminal.
  const facePhoto = prepareFacePhoto(picData1, idno);

  return runDeviceExclusive(config, async () => {
    const token = await login(config);

    // Do not blindly delete both white and black entries. Some terminal firmware
    // becomes temporarily unavailable when asked to delete a non-existent list
    // record. Query first, then delete only the record that really exists.
    let existing: { data: Record<string, unknown>; usertype: string } | null = null;
    try {
      existing = await getExistingIdentity(config, token, idno);
    } catch (error) {
      // Detail lookup is an optimization/safety step. If this firmware does not
      // support it, an initial add is still preferable to two blind deletes.
      logInfo(`identity lookup unavailable for ${idno} on ${config.name}; attempting direct enrollment`, {
        deviceKey: config.deviceKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (existing && ["white", "black", "visitor"].includes(existing.usertype)) {
      const removal = await devicePost(
        config,
        "/deleteDeviceWhiteList",
        { token, data: { idno, usertype: existing.usertype } },
        deviceReadTimeoutMs,
      );
      if (Number(removal?.result) !== 0) {
        throw new Error(removal?.message || `Could not replace existing ${existing.usertype} identity ${idno}`);
      }
      // Give the embedded list/face service a short moment to commit the delete
      // before sending a comparatively large image payload.
      await sleep(350);
    }

    const data = {
      usertype: String(payloadData.usertype || "white"),
      name: String(payloadData.name || idno),
      idno,
      // The terminal has separate Personnel ID (idNum/idno) and ID Number
      // (identityNo) fields in recognition callbacks. Populate both with the
      // canonical FCGS Admission No / Staff No so firmware that rewrites idNum
      // can still report a stable FCGS identity in identityNo.
      identityNo: idno,
      passAlgo: payloadData.passAlgo === true,
      TimeGroupId: Number(payloadData.TimeGroupId || 0),
      picData1: facePhoto.base64,
    };

    logInfo(`prepared face for ${idno}: ${facePhoto.outputBytes} normalized JPEG bytes`);
    logInfo(`uploading face for ${idno} to ${config.name} (${facePhoto.outputBytes} image bytes; ${Buffer.byteLength(JSON.stringify({ token, data }), "utf8")} request bytes)`);

    // Face-image validation/feature extraction is substantially slower than the
    // terminal's normal status/open-gate APIs, so it needs a separate timeout.
    const result = await devicePost(config, "/addDeviceWhiteList", { token, data }, deviceWriteTimeoutMs);
    if (Number(result?.result) !== 0) throw new Error(result?.message || `Identity enrollment failed for ${idno}`);
    return { idno, usertype: data.usertype, TimeGroupId: data.TimeGroupId, result: Number(result?.result), photoBytes: facePhoto.outputBytes };
  });
}

async function setTimeGroups(config: DeviceConfig, data: Record<string, unknown>) {
  return runDeviceExclusive(config, async () => {
    const token = await login(config);
    const payload = await devicePost(config, "/setDeviceTimeAccessGroups", { token, data }, Math.min(deviceWriteTimeoutMs, 20_000));
    if (Number(payload?.result) !== 0) throw new Error(payload?.message || "Time-group synchronization failed");
    return { result: Number(payload?.result), message: payload?.message || "OK" };
  });
}

async function configureRecognitionCallback(config: DeviceConfig) {
  return runDeviceExclusive(config, async () => {
    const url = callbackUrl();
    const token = await login(config);
    const payload = await devicePost(config, "/setDeviceParameter", { token, data: { platformEnable: 0, platformIp: url } }, Math.min(deviceWriteTimeoutMs, 15_000));
    if (Number(payload?.result) !== 0) throw new Error(payload?.message || "Recognition callback configuration failed");
    return url;
  });
}

async function flushEvents() {
  if (!pendingEvents.length) return;
  const batch = pendingEvents.slice(0, 50);
  try {
    await portalRequest("/api/gate-bridge/logs", {
      method: "POST",
      body: JSON.stringify({ events: batch }),
    });
    pendingEvents = pendingEvents.slice(batch.length);
  } catch {
    // Keep events queued; heartbeat/config polling will retry later.
  }
}

async function flushRecognitionQueue() {
  if (recognitionFlushRunning || !recognitionQueue.length) return;
  recognitionFlushRunning = true;
  try {
    while (recognitionQueue.length && !stopped) {
      const batch = recognitionQueue.slice(0, 50);
      await portalRequest("/api/gate-bridge/recognition-events", { method: "POST", body: JSON.stringify({ events: batch }) });
      recognitionQueue = recognitionQueue.slice(batch.length);
      await persistRecognitionQueue();
    }
  } catch (error) {
    logError(`recognition delivery failed (queue retained): ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    recognitionFlushRunning = false;
  }
}

function findDeviceForCallback(remoteAddress: string, record: Record<string, any>) {
  const remote = normalizeIp(remoteAddress);
  const byHost = deviceConfigs.find((device) => normalizeIp(device.host) === remote);
  if (byHost) return byHost;
  const sn = String(record.sn || record.deviceSn || "").trim().toLowerCase();
  if (sn) {
    const bySn = deviceConfigs.find((device) => String(device.deviceSn || "").trim().toLowerCase() === sn);
    if (bySn) return bySn;
  }
  const mac = String(record.mac || record.macaddr || "").replace(/[:-]/g, "").toLowerCase();
  if (mac) return deviceConfigs.find((device) => String(device.macAddress || "").replace(/[:-]/g, "").toLowerCase() === mac) || null;
  return null;
}

function startRecognitionServer() {
  const server = http.createServer((req, res) => {
    const updatePath = String(req.url || "").split("?")[0];
    if (updatePath.startsWith("/__fcgs_update/")) {
      if (!isLocalUpdateRequest(req)) { res.statusCode=403; res.end("Forbidden"); return; }
      if (req.method === "POST" && updatePath === "/__fcgs_update/quiesce") updateQuiescing=true;
      if (req.method === "POST" && updatePath === "/__fcgs_update/resume") updateQuiescing=false;
      if (["/__fcgs_update/quiesce","/__fcgs_update/resume","/__fcgs_update/ready"].includes(updatePath)) {
        const safe = updateQuiescing && activeCommands.size===0 && deviceOperationTails.size===0 && !recognitionFlushRunning && recognitionQueue.length===0;
        res.statusCode=200;res.setHeader("Content-Type","application/json");res.end(JSON.stringify({quiescing:updateQuiescing,safe,activeCommands:activeCommands.size,terminalOperations:deviceOperationTails.size,pendingRecognitions:recognitionQueue.length}));return;
      }
      res.statusCode=404;res.end("Unknown update API");return;
    }
    if (req.method !== "POST" || !["/uploadDeviceRecogRecord", "/recognition", "/"].includes(String(req.url || "").split("?")[0])) {
      res.statusCode = 404; res.end("Not Found"); return;
    }
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; if (raw.length > 10_000_000) req.destroy(); });
    req.on("end", async () => {
      try {
        const parsed = raw ? JSON.parse(raw) : {};
        const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : [parsed?.data && typeof parsed.data === "object" ? parsed.data : parsed];
        const incoming: QueuedRecognition[] = [];
        for (const record of records) {
          if (!record || typeof record !== "object") throw new Error("Malformed recognition record");
          const device = findDeviceForCallback(String(req.socket.remoteAddress || ""), record);
          if (!device) {
            queueEvent("recognition.unmapped_terminal", "warning", "A recognition callback arrived from an unmapped terminal.", null, { remoteAddress: normalizeIp(req.socket.remoteAddress), sn: record.sn || null, mac: record.mac || null });
            throw new Error("Recognition callback could not be matched to a registered terminal");
          }
          incoming.push({ deviceKey: device.deviceKey, record, receivedAt: new Date().toISOString() });
        }
        if (!incoming.length || recognitionQueue.length + incoming.length > 50_000) throw new Error("Recognition queue unavailable or full; terminal must retry callback");
        recognitionQueue.push(...incoming);
        // Persist before acknowledging so terminal retries are not needed after a portal outage.
        await persistRecognitionQueue();
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ message: "Success", result: 0 }));
        void flushRecognitionQueue();
      } catch (error) {
        logError(`recognition callback rejected: ${error instanceof Error ? error.message : String(error)}`);
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ message: "Recognition callback not durably accepted; retry required", result: 1 }));
      }
    });
  });
  server.listen(callbackPort, "0.0.0.0", () => {
    try { logInfo(`recognition callback listener: ${callbackUrl()}`); }
    catch (error) { logError(`recognition listener active, but callback address configuration is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  });
  server.on("error", (error) => logError(`recognition callback listener failed: ${error.message}`));
  return server;
}

async function syncConfig() {
  try {
    const payload = await portalRequest("/api/gate-bridge/config", { method: "GET" });
    const revision = Number(payload?.revision || 0);
    const portalDevices: PortalDeviceConfig[] = Array.isArray(payload?.devices) ? payload.devices : [];
    const next = portalDevices.map((device) => ({ ...device, ...credentialFor(String(device.deviceKey)) }));
    const oldSignature = JSON.stringify(deviceConfigs.map((device) => [device.deviceKey, device.host, device.port, device.name]).sort());
    const newSignature = JSON.stringify(next.map((device) => [device.deviceKey, device.host, device.port, device.name]).sort());
    const incomingCallback = payload?.bridge || {};
    const callbackMode = incomingCallback.callbackMode === "manual" ? "manual" : "automatic";
    const callbackHost = String(incomingCallback.callbackHost || "").trim() || null;
    const callbackPortFromPortal = Number(incomingCallback.callbackPort || callbackPort);
    const lastCallbackUrl = callbackUrl();
    currentCallbackConfig = { mode: callbackMode, host: callbackHost, port: callbackPortFromPortal };
    const changed = revision !== currentConfigRevision || oldSignature !== newSignature || lastCallbackUrl !== callbackUrl() || activeCallbackUrl !== callbackUrl() || callbackError !== null;

    deviceConfigs = next;
    byKey = new Map(deviceConfigs.map((device) => [device.deviceKey, device]));
    for (const device of deviceConfigs) {
      if (!health.has(device.deviceKey)) health.set(device.deviceKey, { deviceKey: device.deviceKey, status: "unknown" });
    }
    for (const key of Array.from(health.keys())) {
      if (!byKey.has(key)) health.delete(key);
    }
    currentConfigRevision = revision;

    if (changed) {
      logInfo(`configuration synchronized: revision ${currentConfigRevision}, ${deviceConfigs.length} device(s)`);
      const failures: string[] = [];
      for (const device of deviceConfigs) {
        try {
          const configuredUrl = await configureRecognitionCallback(device);
          logInfo(`recognition callback configured for ${device.gateName ? `${device.gateName} · ` : ""}${device.name} -> ${configuredUrl}`);
        } catch (error) {
          const failure = `Callback configuration failed on ${device.name}: ${error instanceof Error ? error.message : String(error)}`;
          failures.push(failure);
          logError(failure);
        }
      }
      callbackError = failures.length ? failures.join("; ").slice(0, 1000) : null;
      if (!failures.length) activeCallbackUrl = callbackUrl();
      queueEvent(failures.length ? "bridge.configuration_partial" : "bridge.configuration_synchronized", failures.length ? "warning" : "info", failures.length ? `${failures.length} terminal callback configuration(s) failed.` : `Configuration revision ${currentConfigRevision} synchronized with ${deviceConfigs.length} terminal(s).`, null, { revision: currentConfigRevision, devices: deviceConfigs.length, failures });
      await sendHeartbeat();
    }
    await flushEvents();
    await flushRecognitionQueue();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    callbackError = `Configuration sync failed: ${message}`;
    logError(callbackError);
    return false;
  }
}

async function configLoop() {
  if (configLoopRunning) return;
  configLoopRunning = true;
  try {
    while (!stopped) {
      await syncConfig();
      await sleep(callbackError ? Math.max(30_000, configMs) : Math.max(3000, configMs));
    }
  } finally {
    configLoopRunning = false;
  }
}

async function probeDevice(config: DeviceConfig) {
  const previous = health.get(config.deviceKey);
  try {
    const versionInfo = await getVersion(config);
    health.set(config.deviceKey, { deviceKey: config.deviceKey, status: "online", versionInfo, error: null });
    if (previous?.status === "offline") logInfo(`${config.gateName ? `${config.gateName} · ` : ""}${config.name} is back online`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    health.set(config.deviceKey, {
      deviceKey: config.deviceKey,
      status: "offline",
      versionInfo: previous?.versionInfo || null,
      error: message,
    });
    if (previous?.status !== "offline" || previous?.error !== message) logError(`${config.gateName ? `${config.gateName} · ` : ""}${config.name} offline: ${message}`);
  }
}

async function probeLoop() {
  if (probeLoopRunning) return;
  probeLoopRunning = true;
  try {
    while (!stopped) {
      const snapshot = [...deviceConfigs];
      await Promise.all(snapshot.map(async (config) => { if (!stopped) await probeDevice(config); }));
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
      body: JSON.stringify({ softwareVersion: BRIDGE_VERSION, installationId: installationId || null, machineName, serviceStartedAt, configRevision: currentConfigRevision, activeCallbackUrl, callbackError,
        availableCallbackHosts: Object.entries(os.networkInterfaces()).flatMap(([interfaceName, list]) =>
          (list || []).filter((item) => item.family === "IPv4" && !item.internal)
            .map((item) => ({ address: item.address, interfaceName }))),
        devices: Array.from(health.values()) }),
    });
    if (portalConnectionState === "offline") {
      queueEvent("bridge.portal_connection_restored", "warning", "Connection from the Gate Bridge to FCGS was restored.");
      logInfo("connection to FCGS restored");
    }
    portalConnectionState = "online";
    await flushEvents();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (portalConnectionState !== "offline") {
      queueEvent("bridge.portal_connection_lost", "error", "The Gate Bridge lost its connection to FCGS.", null, { error: message });
    }
    portalConnectionState = "offline";
    logError(`heartbeat failed: ${message}`);
  }
}

type CompletionOutboxRecord = { commandId: number; claimToken: string; success: boolean; result: Record<string, unknown> | null; error: string | null };
async function submitCompletion(row: CompletionOutboxRecord) {
  await portalRequest(`/api/gate-bridge/commands/${row.commandId}/complete`, {
    method: "POST", body: JSON.stringify({ success: row.success, result: row.result, error: row.error, claimToken: row.claimToken }),
  });
  await unlink(path.join(completionDir, `${row.commandId}.json`)).catch((error) => logError(`completion outbox cleanup failed: ${String(error)}`));
}
async function completeCommand(commandId: number, success: boolean, result?: Record<string, unknown>, error?: string, claimToken = "") {
  const row: CompletionOutboxRecord = { commandId, success, result: result || null, error: error || null, claimToken };
  await mkdir(completionDir, { recursive: true });
  const destination = path.join(completionDir, `${commandId}.json`);
  const tempFile = `${destination}.${process.pid}.tmp`;
  await writeFile(tempFile, JSON.stringify(row), "utf8");
  await rename(tempFile, destination);
  try { await submitCompletion(row); }
  catch (error) { logError(`completion ${commandId} awaiting durable retry: ${error instanceof Error ? error.message : String(error)}`); }
}
async function flushCompletionOutbox() {
  try {
    await mkdir(completionDir, { recursive: true });
    const files = (await readdir(completionDir)).filter((name) => /^\d+\.json$/.test(name)).slice(0, 100);
    for (const file of files) {
      const row = JSON.parse(await readFile(path.join(completionDir, file), "utf8")) as CompletionOutboxRecord;
      try { await submitCompletion(row); } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/HTTP 409/.test(message)) {
          // The server's lease may have expired while offline. Never overwrite a
          // newer execution. Quarantine the evidence instead of retrying forever.
          await mkdir(path.join(logDir, "completion-conflicts"), { recursive: true });
          await rename(path.join(completionDir, file), path.join(logDir, "completion-conflicts", file));
          logError(`completion ${row.commandId} rejected by server; quarantined for operator verification: ${message}`);
          continue;
        }
        logError(`completion retry ${row.commandId} failed: ${message}`);
        break;
      }
    }
  } catch (error) { logError(`completion outbox unavailable: ${error instanceof Error ? error.message : String(error)}`); }
}

async function executeCommand(command: any) {
  const reportCompletion = (success: boolean, result?: Record<string, unknown>, error?: string) => completeCommand(Number(command.id), success, result, error, String(command.claimToken || ""));
  const key = String(command?.device?.deviceKey || "");
  const config = byKey.get(key);
  if (!config) {
    await reportCompletion(false, undefined, `Device ${key || "(missing key)"} is not in the current portal configuration for this Gate Bridge`);
    return;
  }
  if (command.expiresAt && new Date(command.expiresAt).getTime() <= Date.now()) {
    await reportCompletion(false, undefined, "Command expired before execution");
    return;
  }

  try {
    if (command.commandType === "open_gate") {
      const result = await openGate(config, command.expiresAt ? new Date(command.expiresAt).getTime() : undefined);
      health.set(key, { ...health.get(key), deviceKey: key, status: "online", error: null });
      await reportCompletion(true, result);
      logInfo(`opened ${config.gateName ? `${config.gateName} · ` : ""}${config.name} for command ${command.id}`);
      return;
    }
    if (command.commandType === "get_version") {
      const versionInfo = await getVersion(config);
      health.set(key, { deviceKey: key, status: "online", versionInfo, error: null });
      await reportCompletion(true, versionInfo);
      logInfo(`connection test passed for ${config.gateName ? `${config.gateName} · ` : ""}${config.name}`);
      return;
    }
    if (command.commandType === "verify_identity") {
      const result = await verifyIdentity(config, String(command.payload?.idno || ""));
      await reportCompletion(true, result);
      return;
    }
    if (command.commandType === "get_personnel_id_list") {
      const result = await getPersonnelIdList(config);
      health.set(key, { ...health.get(key), deviceKey: key, status: "online", error: null });
      await reportCompletion(true, result);
      logInfo(`read ${result.idList.length} personnel ID(s) from ${config.gateName ? `${config.gateName} · ` : ""}${config.name}`);
      return;
    }
    if (command.commandType === "sync_identity") {
      const identityNo = String(command.payload?.idno || "(missing id)");
      logInfo(`synchronizing identity ${identityNo} to ${config.gateName ? `${config.gateName} · ` : ""}${config.name} for command ${command.id}`);
      const result = await syncIdentity(config, command.payload || {});
      health.set(key, { ...health.get(key), deviceKey: key, status: "online", error: null });
      await reportCompletion(true, result);
      logInfo(`identity ${identityNo} synchronized to ${config.gateName ? `${config.gateName} · ` : ""}${config.name}`);
      return;
    }
    if (command.commandType === "delete_identity") {
      const result = await deleteIdentity(config, String(command.payload?.idno || ""));
      health.set(key, { ...health.get(key), deviceKey: key, status: "online", error: null });
      await reportCompletion(true, result as any);
      return;
    }
    if (command.commandType === "set_time_groups") {
      const result = await setTimeGroups(config, command.payload || {});
      health.set(key, { ...health.get(key), deviceKey: key, status: "online", error: null });
      await reportCompletion(true, result);
      return;
    }
    await reportCompletion(false, undefined, `Unsupported command type: ${String(command.commandType)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A command failure is not proof that a terminal is offline. In particular,
    // face-image processing can fail/timeout while the terminal remains reachable.
    // Only the dedicated probe loop owns online/offline state.
    await reportCompletion(false, undefined, message);
    logError(`command ${command.id} failed for ${config.name}: ${message}`);
  }
}

async function executeLeasedCommand(command: any) {
  const id = Number(command.id);
  activeCommands.add(id);
  const leaseRenewal = setInterval(() => {
    void portalRequest(`/api/gate-bridge/commands/${id}/lease`, { method: "POST", body: JSON.stringify({ claimToken: command.claimToken }) })
      .catch((error) => logError(`command lease ${id} renewal failed: ${error instanceof Error ? error.message : String(error)}`));
  }, 15_000);
  try { await executeCommand(command); }
  finally { clearInterval(leaseRenewal); activeCommands.delete(id); }
}

async function commandLoop() {
  if (commandLoopRunning) return;
  commandLoopRunning = true;
  try {
    while (!stopped) {
      try {
        await flushCompletionOutbox();
        if (!updateQuiescing && activeCommands.size < 16) {
          const payload = await portalRequest("/api/gate-bridge/commands/claim", { method: "POST", body: "{}" });
          const commands = Array.isArray(payload?.commands) ? payload.commands : [];
          for (const command of commands) {
            if (stopped) break;
            void executeLeasedCommand(command).catch((error) => logError(`command ${command.id} execution failed: ${error instanceof Error ? error.message : String(error)}`));
          }
        }
      } catch (error) { logError(`command poll failed: ${error instanceof Error ? error.message : String(error)}`); }
      await sleep(Math.max(500, pollMs));
    }
  } finally { commandLoopRunning = false; }
}

function stop(signal: string) {
  if (stopped) return;
  stopped = true;
  logInfo(`${signal} received; stopping`);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

async function main() {
  logInfo(`starting ${BRIDGE_VERSION}`);
  try {
    const secretPath=String(process.env.FCGS_GATE_BRIDGE_UPDATE_SECRET_PATH||"");
    if(secretPath) localUpdateSecret=(await readFile(secretPath,"utf8")).trim();
  } catch (error) { logError("Update quiescence token could not be loaded; unattended updates cannot proceed"); }

  logInfo(`portal: ${serverUrl}`);
  logInfo(`legacy credential/device overrides: ${legacyDeviceConfigs.length}`);
  logInfo(`terminal HTTP timeouts: read ${deviceReadTimeoutMs}ms, face/write ${deviceWriteTimeoutMs}ms`);
  logInfo("identity sync mode: query-before-replace; fresh HTTP connection per terminal request");
  logInfo(`face payload mode: portal-normalized JPEG, maximum ${FACE_TARGET_MAX_BYTES} bytes`);
  queueEvent("bridge.service_started", "info", `${BRIDGE_VERSION} started.`, null, { portal: serverUrl, installationId: installationId || null, machineName, legacyOverrides: legacyDeviceConfigs.length });
  await loadRecognitionQueue();
  const recognitionServer = startRecognitionServer();

  const synced = await syncConfig();
  if (!synced && legacyDeviceConfigs.length) {
    logInfo(`portal configuration unavailable at startup; temporarily retaining ${legacyDeviceConfigs.length} legacy configured device(s)`);
  }
  logInfo(`configured devices: ${deviceConfigs.length}`);

  const heartbeatTimer = setInterval(() => { void sendHeartbeat(); }, Math.max(5000, heartbeatMs));
  void configLoop();
  void probeLoop();
  void commandLoop();

  while (!stopped) await sleep(1000);
  clearInterval(heartbeatTimer);
  recognitionServer.close();
  await flushRecognitionQueue();
  await flushEvents();
}

void main().catch((error) => failStartup(error instanceof Error ? error.message : String(error)));
