import type { Express, Request, Response } from "express";
import { createHash, randomBytes, randomUUID } from "crypto";
import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { requirePermission } from "./auth";
import {
  accessGates,
  accessIdentities,
  activityLogs,
  gateBridges,
  gateCommands,
  gateDevices,
  gateIdentitySync,
  gateLogs,
  schools,
  users,
} from "@shared/schema";

type AppUser = {
  id: number;
  role?: string;
  schoolId?: number | null;
  organizationId?: number | null;
  firstName?: string | null;
  lastName?: string | null;
};

type PortalScope = {
  organizationId: number;
  schoolId: number;
  userId: number;
};

const ONLINE_WINDOW_MS = 45_000;
const DEVICE_ONLINE_WINDOW_MS = 90_000;
const OPEN_COMMAND_TTL_MS = 20_000;
const TEST_COMMAND_TTL_MS = 60_000;
const STANDARD_GATE_TEMPLATE = "standard_4_lane";

const LANE_DEFINITIONS = {
  entry_lane_1: { label: "Entry Lane 1", direction: "entry" },
  entry_lane_2: { label: "Entry Lane 2", direction: "entry" },
  exit_lane_1: { label: "Exit Lane 1", direction: "exit" },
  exit_lane_2: { label: "Exit Lane 2", direction: "exit" },
} as const;

type LanePosition = keyof typeof LANE_DEFINITIONS;

const lanePositionSchema = z.enum(["entry_lane_1", "entry_lane_2", "exit_lane_1", "exit_lane_2"]);

const bridgeCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
});

const gateCreateSchema = z.object({
  bridgeId: z.coerce.number().int().positive(),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(240).optional().nullable(),
});

const gateUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(240).optional().nullable(),
  isActive: z.boolean().default(true),
});

const deviceCreateSchema = z.object({
  gateId: z.coerce.number().int().positive(),
  lanePosition: lanePositionSchema,
  protocol: z.enum(["http"]).default("http"),
  localAddress: z.string().trim().min(1).max(120),
  localPort: z.coerce.number().int().min(1).max(65535).default(9090),
  isActive: z.boolean().default(true),
});

const deviceUpdateSchema = z.object({
  gateId: z.coerce.number().int().positive(),
  lanePosition: lanePositionSchema,
  protocol: z.enum(["http"]).default("http"),
  localAddress: z.string().trim().min(1).max(120),
  localPort: z.coerce.number().int().min(1).max(65535).default(9090),
  isActive: z.boolean().default(true),
});

const manualOpenSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

const heartbeatSchema = z.object({
  softwareVersion: z.string().trim().max(100).optional().nullable(),
  installationId: z.string().uuid().optional().nullable(),
  machineName: z.string().trim().max(120).optional().nullable(),
  serviceStartedAt: z.string().datetime().optional().nullable(),
  configRevision: z.coerce.number().int().nonnegative().optional().nullable(),
  error: z.string().trim().max(1000).optional().nullable(),
  devices: z.array(z.object({
    deviceKey: z.string().uuid(),
    status: z.enum(["online", "offline", "unknown"]),
    versionInfo: z.record(z.unknown()).optional().nullable(),
    error: z.string().trim().max(1000).optional().nullable(),
  })).max(250).default([]),
});

const bridgeLogsSchema = z.object({
  events: z.array(z.object({
    eventType: z.string().trim().min(2).max(120),
    severity: z.enum(["info", "warning", "error", "security"]).default("info"),
    message: z.string().trim().min(1).max(1000),
    deviceKey: z.string().uuid().optional().nullable(),
    details: z.record(z.unknown()).optional().nullable(),
    occurredAt: z.string().datetime().optional().nullable(),
  })).min(1).max(50),
});

const completeCommandSchema = z.object({
  success: z.boolean(),
  result: z.record(z.unknown()).optional().nullable(),
  error: z.string().trim().max(2000).optional().nullable(),
});

function hashBridgeToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function createBridgeToken() {
  return `fcgs_gb_${randomBytes(32).toString("base64url")}`;
}

function identityRetryDelayMs(retryCount: number) {
  const schedule = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
  return schedule[Math.min(Math.max(0, retryCount - 1), schedule.length - 1)];
}

function isRecent(value: Date | string | null | undefined, windowMs = ONLINE_WINDOW_MS) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() <= windowMs;
}

function clientIp(req: Request) {
  return req.ip || req.socket.remoteAddress || null;
}

function laneDefinition(value: LanePosition) {
  return LANE_DEFINITIONS[value];
}

function stringField(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

async function portalScope(req: Request): Promise<PortalScope> {
  const current = req.user as AppUser;
  let schoolId = current.schoolId ?? null;
  let organizationId = current.organizationId ?? null;

  if (current.role === "org_admin") {
    const requestedSchool = Number(req.header("X-School-Id") || "");
    if (Number.isFinite(requestedSchool) && requestedSchool > 0) schoolId = requestedSchool;
  }

  if (!schoolId) throw new Error("School context is required for Access Control");
  const [school] = await db
    .select({ id: schools.id, organizationId: schools.organizationId })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);
  if (!school) throw new Error("School context was not found");

  organizationId = organizationId ?? school.organizationId ?? null;
  if (!organizationId || school.organizationId !== organizationId) {
    throw new Error("Access denied outside your organisation");
  }

  return { organizationId, schoolId, userId: current.id };
}

async function logPortalAction(
  req: Request,
  scope: PortalScope,
  action: string,
  description: string,
  targetType?: string,
  targetId?: number,
  targetName?: string,
  metadata?: Record<string, unknown>,
) {
  const current = req.user as AppUser;
  await db.insert(activityLogs).values({
    schoolId: scope.schoolId,
    organizationId: scope.organizationId,
    userId: current.id,
    userName: `${current.firstName || ""} ${current.lastName || ""}`.trim() || null,
    userRole: current.role || null,
    action,
    category: "Access Control",
    description,
    targetType: targetType || null,
    targetId: targetId || null,
    targetName: targetName || null,
    metadata: metadata || null,
    ipAddress: clientIp(req),
  }).catch(() => undefined);
}

async function logGateEvent(input: {
  organizationId: number;
  schoolId: number;
  bridgeId?: number | null;
  gateId?: number | null;
  deviceId?: number | null;
  severity?: "info" | "warning" | "error" | "security";
  sourceType?: string;
  eventType: string;
  message: string;
  details?: Record<string, unknown> | null;
  occurredAt?: Date;
}) {
  await db.insert(gateLogs).values({
    organizationId: input.organizationId,
    schoolId: input.schoolId,
    bridgeId: input.bridgeId || null,
    gateId: input.gateId || null,
    deviceId: input.deviceId || null,
    severity: input.severity || "info",
    sourceType: input.sourceType || "system",
    eventType: input.eventType,
    message: input.message,
    details: input.details || null,
    occurredAt: input.occurredAt || new Date(),
  }).catch(() => undefined);
}

async function requireBridge(req: Request, res: Response) {
  const authorization = req.header("Authorization") || "";
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  const token = (req.header("X-FCGS-Bridge-Key") || bearer).trim();
  if (!token) {
    res.status(401).json({ message: "Gate Bridge authentication required" });
    return null;
  }

  const keyHash = hashBridgeToken(token);
  const [bridge] = await db
    .select()
    .from(gateBridges)
    .where(and(eq(gateBridges.bridgeKeyHash, keyHash), eq(gateBridges.isActive, true)))
    .limit(1);
  if (!bridge) {
    res.status(401).json({ message: "Invalid Gate Bridge credential" });
    return null;
  }
  return bridge;
}

async function deviceInScope(scope: PortalScope, deviceId: number) {
  const [device] = await db
    .select()
    .from(gateDevices)
    .where(and(
      eq(gateDevices.id, deviceId),
      eq(gateDevices.schoolId, scope.schoolId),
      eq(gateDevices.organizationId, scope.organizationId),
    ))
    .limit(1);
  return device || null;
}

async function bridgeInScope(scope: PortalScope, bridgeId: number) {
  const [bridge] = await db
    .select()
    .from(gateBridges)
    .where(and(
      eq(gateBridges.id, bridgeId),
      eq(gateBridges.schoolId, scope.schoolId),
      eq(gateBridges.organizationId, scope.organizationId),
    ))
    .limit(1);
  return bridge || null;
}

async function gateInScope(scope: PortalScope, gateId: number) {
  const [gate] = await db
    .select()
    .from(accessGates)
    .where(and(
      eq(accessGates.id, gateId),
      eq(accessGates.schoolId, scope.schoolId),
      eq(accessGates.organizationId, scope.organizationId),
    ))
    .limit(1);
  return gate || null;
}

async function bumpBridgeRevision(bridgeId: number) {
  await db.update(gateBridges).set({
    configurationRevision: sql`${gateBridges.configurationRevision} + 1`,
    updatedAt: new Date(),
  }).where(eq(gateBridges.id, bridgeId));
}

async function ensureAddressAvailable(scope: PortalScope, localAddress: string, localPort: number, excludeDeviceId?: number) {
  const candidates = await db.select({
    id: gateDevices.id,
    name: gateDevices.name,
    localAddress: gateDevices.localAddress,
    localPort: gateDevices.localPort,
  }).from(gateDevices).where(and(
    eq(gateDevices.schoolId, scope.schoolId),
    eq(gateDevices.isActive, true),
    eq(gateDevices.localAddress, localAddress),
    eq(gateDevices.localPort, localPort),
  ));
  const duplicate = candidates.find((row) => row.id !== excludeDeviceId);
  if (duplicate) throw new Error(`${localAddress}:${localPort} is already assigned to ${duplicate.name}`);
}

async function ensureLaneAvailable(gateId: number, lanePosition: LanePosition, excludeDeviceId?: number) {
  const candidates = await db.select({ id: gateDevices.id, name: gateDevices.name }).from(gateDevices).where(and(
    eq(gateDevices.gateId, gateId),
    eq(gateDevices.lanePosition, lanePosition),
  ));
  const duplicate = candidates.find((row) => row.id !== excludeDeviceId);
  if (duplicate) throw new Error(`${laneDefinition(lanePosition).label} is already configured for this Gate`);
}

function fail(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected Access Control error";
  const status = /not found/i.test(message) ? 404 : /denied|context|permission/i.test(message) ? 403 : /already|duplicate|assigned/i.test(message) ? 409 : 400;
  return res.status(status).json({ message });
}

export function registerAccessControlRoutes(app: Express) {
  // Portal UI/API -----------------------------------------------------------
  app.get("/api/access-control/bootstrap", requirePermission("access_control.view"), async (req, res) => {
    try {
      const scope = await portalScope(req);
      const staleProcessingBefore = new Date(Date.now() - 2 * 60_000);
      const staleInventoryBefore = new Date(Date.now() - 20 * 60_000);
      await db.update(gateCommands).set({
        status: "failed",
        errorMessage: "Gate Bridge did not complete the command before the processing timeout.",
        completedAt: new Date(),
      }).where(and(
        eq(gateCommands.schoolId, scope.schoolId),
        eq(gateCommands.status, "processing"),
        sql`${gateCommands.commandType} <> 'get_personnel_id_list'`,
        lt(gateCommands.claimedAt, staleProcessingBefore),
      ));
      await db.update(gateCommands).set({
        status: "failed",
        errorMessage: "Gate Bridge did not complete the terminal enrollment inventory before the extended processing timeout.",
        completedAt: new Date(),
      }).where(and(
        eq(gateCommands.schoolId, scope.schoolId),
        eq(gateCommands.status, "processing"),
        eq(gateCommands.commandType, "get_personnel_id_list"),
        lt(gateCommands.claimedAt, staleInventoryBefore),
      ));
      await db.update(gateCommands).set({ status: "expired", completedAt: new Date() }).where(and(
        eq(gateCommands.schoolId, scope.schoolId),
        eq(gateCommands.status, "pending"),
        lt(gateCommands.expiresAt, new Date()),
      ));

      const [bridges, gates, devices, commands] = await Promise.all([
        db.select().from(gateBridges).where(eq(gateBridges.schoolId, scope.schoolId)).orderBy(asc(gateBridges.name)),
        db.select().from(accessGates).where(eq(accessGates.schoolId, scope.schoolId)).orderBy(asc(accessGates.name)),
        db.select().from(gateDevices).where(eq(gateDevices.schoolId, scope.schoolId)).orderBy(asc(gateDevices.name)),
        db.select().from(gateCommands).where(eq(gateCommands.schoolId, scope.schoolId)).orderBy(desc(gateCommands.requestedAt)).limit(150),
      ]);

      const requesterIds = Array.from(new Set(commands.map((row) => row.requestedByUserId).filter((id): id is number => !!id)));
      const requesters = requesterIds.length
        ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, username: users.username }).from(users).where(inArray(users.id, requesterIds))
        : [];
      const requesterMap = new Map(requesters.map((row) => [row.id, row]));
      const bridgeMap = new Map(bridges.map((row) => [row.id, row]));
      const gateMap = new Map(gates.map((row) => [row.id, row]));
      const deviceMap = new Map(devices.map((row) => [row.id, row]));

      res.json({
        scope,
        laneDefinitions: Object.entries(LANE_DEFINITIONS).map(([value, definition]) => ({ value, ...definition })),
        bridges: bridges.map((bridge) => ({
          ...bridge,
          bridgeKeyHash: undefined,
          isOnline: bridge.isActive && isRecent(bridge.lastHeartbeatAt),
          configSynchronized: bridge.isActive && isRecent(bridge.lastHeartbeatAt) && bridge.lastSyncedRevision === bridge.configurationRevision,
        })),
        gates: gates.map((gate) => ({
          ...gate,
          bridgeOnline: !!bridgeMap.get(gate.bridgeId)?.isActive && isRecent(bridgeMap.get(gate.bridgeId)?.lastHeartbeatAt),
        })),
        devices: devices.map((device) => {
          const bridge = bridgeMap.get(device.bridgeId);
          const bridgeOnline = !!bridge?.isActive && isRecent(bridge.lastHeartbeatAt);
          return {
            ...device,
            gateName: device.gateId ? gateMap.get(device.gateId)?.name || null : null,
            isOnline: bridgeOnline && device.isActive && device.lastConnectionStatus === "online" && isRecent(device.lastSeenAt, DEVICE_ONLINE_WINDOW_MS),
            bridgeOnline,
          };
        }),
        commands: commands.map((command) => {
          const requester = command.requestedByUserId ? requesterMap.get(command.requestedByUserId) : null;
          const device = deviceMap.get(command.deviceId);
          return {
            ...command,
            deviceName: device?.name || `Device #${command.deviceId}`,
            gateName: device?.gateId ? gateMap.get(device.gateId)?.name || null : null,
            bridgeName: bridgeMap.get(command.bridgeId)?.name || `Bridge #${command.bridgeId}`,
            requestedByName: requester ? `${requester.firstName || ""} ${requester.lastName || ""}`.trim() || requester.username : "System",
          };
        }),
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/access-control/logs", requirePermission("access_control.audit.view"), async (req, res) => {
    try {
      const scope = await portalScope(req);
      const requestedLimit = Number(req.query.limit || 250);
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(500, Math.trunc(requestedLimit))) : 250;
      const rows = await db.select().from(gateLogs).where(eq(gateLogs.schoolId, scope.schoolId)).orderBy(desc(gateLogs.occurredAt)).limit(500);
      const bridgeIds = Array.from(new Set(rows.map((row) => row.bridgeId).filter((id): id is number => !!id)));
      const gateIds = Array.from(new Set(rows.map((row) => row.gateId).filter((id): id is number => !!id)));
      const deviceIds = Array.from(new Set(rows.map((row) => row.deviceId).filter((id): id is number => !!id)));
      const [bridges, gates, devices] = await Promise.all([
        bridgeIds.length ? db.select({ id: gateBridges.id, name: gateBridges.name }).from(gateBridges).where(inArray(gateBridges.id, bridgeIds)) : [],
        gateIds.length ? db.select({ id: accessGates.id, name: accessGates.name }).from(accessGates).where(inArray(accessGates.id, gateIds)) : [],
        deviceIds.length ? db.select({ id: gateDevices.id, name: gateDevices.name }).from(gateDevices).where(inArray(gateDevices.id, deviceIds)) : [],
      ]);
      const bridgeMap = new Map(bridges.map((row) => [row.id, row.name]));
      const gateMap = new Map(gates.map((row) => [row.id, row.name]));
      const deviceMap = new Map(devices.map((row) => [row.id, row.name]));
      res.json({
        logs: rows.slice(0, limit).map((row) => ({
          ...row,
          bridgeName: row.bridgeId ? bridgeMap.get(row.bridgeId) || null : null,
          gateName: row.gateId ? gateMap.get(row.gateId) || null : null,
          deviceName: row.deviceId ? deviceMap.get(row.deviceId) || null : null,
        })),
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/access-control/bridges", requirePermission("access_control.manage_devices"), async (req, res) => {
    try {
      const scope = await portalScope(req);
      const input = bridgeCreateSchema.parse(req.body);
      const rawToken = createBridgeToken();
      const [bridge] = await db.insert(gateBridges).values({
        organizationId: scope.organizationId,
        schoolId: scope.schoolId,
        name: input.name,
        bridgeKeyHash: hashBridgeToken(rawToken),
        createdByUserId: scope.userId,
      }).returning();
      await logPortalAction(req, scope, "gate_bridge.create", `Created Gate Bridge ${bridge.name}`, "gate_bridge", bridge.id, bridge.name);
      await logGateEvent({ organizationId: scope.organizationId, schoolId: scope.schoolId, bridgeId: bridge.id, sourceType: "portal", eventType: "bridge.created", message: `Gate Bridge ${bridge.name} was created.` });
      res.status(201).json({
        bridge: { ...bridge, bridgeKeyHash: undefined, isOnline: false },
        token: rawToken,
        message: "Save this Gate Bridge token now. For security it will not be shown again.",
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/access-control/bridges/:id/rotate-key", requirePermission("access_control.manage_devices"), async (req, res) => {
    try {
      const scope = await portalScope(req);
      const bridgeId = Number(req.params.id);
      const bridge = await bridgeInScope(scope, bridgeId);
      if (!bridge) return res.status(404).json({ message: "Gate Bridge not found" });
      const rawToken = createBridgeToken();
      const [updated] = await db.update(gateBridges).set({
        bridgeKeyHash: hashBridgeToken(rawToken),
        updatedAt: new Date(),
      }).where(eq(gateBridges.id, bridge.id)).returning();
      await logPortalAction(req, scope, "gate_bridge.rotate_key", `Rotated Gate Bridge credential for ${bridge.name}`, "gate_bridge", bridge.id, bridge.name);
      await logGateEvent({ organizationId: scope.organizationId, schoolId: scope.schoolId, bridgeId: bridge.id, sourceType: "portal", eventType: "bridge.token_rotated", severity: "warning", message: `Authentication token rotated for ${bridge.name}.` });
      res.json({
        bridge: { ...updated, bridgeKeyHash: undefined },
        token: rawToken,
        message: "The old Gate Bridge token is now invalid. Save this replacement token now.",
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/access-control/gates", requirePermission("access_control.manage_devices"), async (req, res) => {
    try {
      const scope = await portalScope(req);
      const input = gateCreateSchema.parse(req.body);
      const bridge = await bridgeInScope(scope, input.bridgeId);
      if (!bridge || !bridge.isActive) return res.status(400).json({ message: "Select an active Gate Bridge in this school" });
      const [gate] = await db.insert(accessGates).values({
        organizationId: scope.organizationId,
        schoolId: scope.schoolId,
        bridgeId: bridge.id,
        name: input.name,
        description: input.description || null,
        gateTemplate: STANDARD_GATE_TEMPLATE,
        expectedTerminalCount: 4,
        createdByUserId: scope.userId,
      }).returning();
      await bumpBridgeRevision(bridge.id);
      await logPortalAction(req, scope, "access_gate.create", `Created access gate ${gate.name}`, "access_gate", gate.id, gate.name, { bridgeId: bridge.id });
      await logGateEvent({ organizationId: scope.organizationId, schoolId: scope.schoolId, bridgeId: bridge.id, gateId: gate.id, sourceType: "portal", eventType: "gate.created", message: `${gate.name} was created with the standard four terminal positions.` });
      res.status(201).json({ gate });
    } catch (error) {
      fail(res, error);
    }
  });

  app.patch("/api/access-control/gates/:id", requirePermission("access_control.manage_devices"), async (req, res) => {
    try {
      const scope = await portalScope(req);
      const gateId = Number(req.params.id);
      const existing = await gateInScope(scope, gateId);
      if (!existing) return res.status(404).json({ message: "Gate not found" });
      const input = gateUpdateSchema.parse(req.body);
      const [gate] = await db.update(accessGates).set({
        name: input.name,
        description: input.description || null,
        isActive: input.isActive,
        updatedAt: new Date(),
      }).where(eq(accessGates.id, existing.id)).returning();
      await bumpBridgeRevision(existing.bridgeId);
      await logPortalAction(req, scope, "access_gate.update", `Updated access gate ${gate.name}`, "access_gate", gate.id, gate.name);
      await logGateEvent({ organizationId: scope.organizationId, schoolId: scope.schoolId, bridgeId: existing.bridgeId, gateId: existing.id, sourceType: "portal", eventType: "gate.configuration_changed", message: `${gate.name} configuration was updated.` });
      res.json({ gate });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/access-control/devices", requirePermission("access_control.manage_devices"), async (req, res) => {
    try {
      const scope = await portalScope(req);
      const input = deviceCreateSchema.parse(req.body);
      const gate = await gateInScope(scope, input.gateId);
      if (!gate || !gate.isActive) return res.status(400).json({ message: "Select an active Gate in this school" });
      const bridge = await bridgeInScope(scope, gate.bridgeId);
      if (!bridge || !bridge.isActive) return res.status(400).json({ message: "The selected Gate does not have an active Gate Bridge" });
      await ensureAddressAvailable(scope, input.localAddress, input.localPort);
      await ensureLaneAvailable(gate.id, input.lanePosition);
      const lane = laneDefinition(input.lanePosition);
      const [device] = await db.insert(gateDevices).values({
        organizationId: scope.organizationId,
        schoolId: scope.schoolId,
        bridgeId: bridge.id,
        gateId: gate.id,
        deviceKey: randomUUID(),
        name: lane.label,
        lanePosition: input.lanePosition,
        location: gate.name,
        direction: lane.direction,
        protocol: input.protocol,
        localAddress: input.localAddress,
        localPort: input.localPort,
        isActive: input.isActive,
        createdByUserId: scope.userId,
      }).returning();
      await bumpBridgeRevision(bridge.id);
      await logPortalAction(req, scope, "gate_device.create", `Registered ${gate.name} · ${device.name}`, "gate_device", device.id, device.name, { bridgeId: bridge.id, gateId: gate.id, lanePosition: input.lanePosition });
      await logGateEvent({ organizationId: scope.organizationId, schoolId: scope.schoolId, bridgeId: bridge.id, gateId: gate.id, deviceId: device.id, sourceType: "portal", eventType: "terminal.registered", message: `${gate.name} · ${device.name} was registered at ${device.localAddress}:${device.localPort}.` });
      res.status(201).json({ device });
    } catch (error) {
      fail(res, error);
    }
  });

  app.patch("/api/access-control/devices/:id", requirePermission("access_control.manage_devices"), async (req, res) => {
    try {
      const scope = await portalScope(req);
      const deviceId = Number(req.params.id);
      const existing = await deviceInScope(scope, deviceId);
      if (!existing) return res.status(404).json({ message: "Face terminal not found" });
      const input = deviceUpdateSchema.parse(req.body);
      const gate = await gateInScope(scope, input.gateId);
      if (!gate || !gate.isActive) return res.status(400).json({ message: "Select an active Gate in this school" });
      await ensureAddressAvailable(scope, input.localAddress, input.localPort, existing.id);
      await ensureLaneAvailable(gate.id, input.lanePosition, existing.id);
      const lane = laneDefinition(input.lanePosition);
      const oldBridgeId = existing.bridgeId;
      const [device] = await db.update(gateDevices).set({
        bridgeId: gate.bridgeId,
        gateId: gate.id,
        name: lane.label,
        lanePosition: input.lanePosition,
        location: gate.name,
        direction: lane.direction,
        protocol: input.protocol,
        localAddress: input.localAddress,
        localPort: input.localPort,
        isActive: input.isActive,
        updatedAt: new Date(),
      }).where(eq(gateDevices.id, existing.id)).returning();
      await bumpBridgeRevision(gate.bridgeId);
      if (oldBridgeId !== gate.bridgeId) await bumpBridgeRevision(oldBridgeId);
      await logPortalAction(req, scope, "gate_device.update", `Updated ${gate.name} · ${device.name}`, "gate_device", device.id, device.name, { gateId: gate.id, localAddress: input.localAddress, localPort: input.localPort });
      await logGateEvent({ organizationId: scope.organizationId, schoolId: scope.schoolId, bridgeId: gate.bridgeId, gateId: gate.id, deviceId: device.id, sourceType: "portal", eventType: "terminal.configuration_changed", message: `${gate.name} · ${device.name} configuration changed to ${device.localAddress}:${device.localPort}.`, details: { previousAddress: existing.localAddress, previousPort: existing.localPort, active: device.isActive } });
      res.json({ device });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/access-control/gates/:id/test", requirePermission("access_control.control_gates"), async (req, res) => {
    try {
      const scope = await portalScope(req);
      const gateId = Number(req.params.id);
      const gate = await gateInScope(scope, gateId);
      if (!gate || !gate.isActive) return res.status(404).json({ message: "Active Gate not found" });
      const bridge = await bridgeInScope(scope, gate.bridgeId);
      if (!bridge?.isActive || !isRecent(bridge.lastHeartbeatAt)) return res.status(409).json({ message: "Gate Bridge is offline. No terminal tests were created." });
      const devices = await db.select().from(gateDevices).where(and(eq(gateDevices.gateId, gate.id), eq(gateDevices.isActive, true))).orderBy(asc(gateDevices.name));
      if (!devices.length) return res.status(400).json({ message: "This Gate has no configured active terminals" });
      const queued: number[] = [];
      const skipped: number[] = [];
      for (const device of devices) {
        const [existingCommand] = await db.select({ id: gateCommands.id }).from(gateCommands).where(and(
          eq(gateCommands.deviceId, device.id),
          inArray(gateCommands.status, ["pending", "processing"]),
          gt(gateCommands.expiresAt, new Date()),
        )).limit(1);
        if (existingCommand) {
          skipped.push(device.id);
          continue;
        }
        const [command] = await db.insert(gateCommands).values({
          organizationId: scope.organizationId,
          schoolId: scope.schoolId,
          bridgeId: device.bridgeId,
          deviceId: device.id,
          commandType: "get_version",
          status: "pending",
          requestedByUserId: scope.userId,
          requestReason: `Test all terminals for ${gate.name}`,
          expiresAt: new Date(Date.now() + TEST_COMMAND_TTL_MS),
        }).returning();
        queued.push(command.id);
      }
      await logPortalAction(req, scope, "gate.command.test_all", `Requested connection tests for ${gate.name}`, "access_gate", gate.id, gate.name, { queued: queued.length, skipped: skipped.length });
      await logGateEvent({ organizationId: scope.organizationId, schoolId: scope.schoolId, bridgeId: gate.bridgeId, gateId: gate.id, sourceType: "portal", eventType: "gate.test_all_requested", message: `Connection tests requested for ${queued.length} terminal(s) at ${gate.name}.`, details: { queued, skipped } });
      res.status(202).json({ queued, skipped });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/access-control/devices/:id/open", requirePermission("access_control.control_gates"), async (req, res) => {
    try {
      const scope = await portalScope(req);
      const input = manualOpenSchema.parse(req.body);
      const deviceId = Number(req.params.id);
      const device = await deviceInScope(scope, deviceId);
      if (!device || !device.isActive) return res.status(404).json({ message: "Active gate device not found" });
      const bridge = await bridgeInScope(scope, device.bridgeId);
      if (!bridge?.isActive || !isRecent(bridge.lastHeartbeatAt)) {
        return res.status(409).json({ message: "Gate Bridge is offline. No open command was created." });
      }
      if (bridge.lastSyncedRevision !== bridge.configurationRevision) {
        return res.status(409).json({ message: "Gate Bridge configuration is still synchronizing. Wait a few seconds before sending a physical open command." });
      }
      const [existingCommand] = await db.select({ id: gateCommands.id }).from(gateCommands).where(and(
        eq(gateCommands.deviceId, device.id),
        inArray(gateCommands.status, ["pending", "processing"]),
        gt(gateCommands.expiresAt, new Date()),
      )).limit(1);
      if (existingCommand) return res.status(409).json({ message: "A gate command is already in progress for this terminal." });
      const [command] = await db.insert(gateCommands).values({
        organizationId: scope.organizationId,
        schoolId: scope.schoolId,
        bridgeId: device.bridgeId,
        deviceId: device.id,
        commandType: "open_gate",
        status: "pending",
        requestedByUserId: scope.userId,
        requestReason: input.reason,
        expiresAt: new Date(Date.now() + OPEN_COMMAND_TTL_MS),
      }).returning();
      await logPortalAction(req, scope, "gate.command.open", `Requested manual opening of ${device.name}`, "gate_device", device.id, device.name, { commandId: command.id, reason: input.reason });
      await logGateEvent({ organizationId: scope.organizationId, schoolId: scope.schoolId, bridgeId: device.bridgeId, gateId: device.gateId, deviceId: device.id, sourceType: "portal", eventType: "terminal.manual_open_requested", severity: "security", message: `Manual open requested for ${device.name}.`, details: { commandId: command.id, reason: input.reason, requestedByUserId: scope.userId } });
      res.status(202).json({ command });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/access-control/devices/:id/test", requirePermission("access_control.control_gates"), async (req, res) => {
    try {
      const scope = await portalScope(req);
      const deviceId = Number(req.params.id);
      const device = await deviceInScope(scope, deviceId);
      if (!device || !device.isActive) return res.status(404).json({ message: "Active gate device not found" });
      const bridge = await bridgeInScope(scope, device.bridgeId);
      if (!bridge?.isActive || !isRecent(bridge.lastHeartbeatAt)) return res.status(409).json({ message: "Gate Bridge is offline. No test command was created." });
      const [command] = await db.insert(gateCommands).values({
        organizationId: scope.organizationId,
        schoolId: scope.schoolId,
        bridgeId: device.bridgeId,
        deviceId: device.id,
        commandType: "get_version",
        status: "pending",
        requestedByUserId: scope.userId,
        requestReason: "Manual connection test",
        expiresAt: new Date(Date.now() + TEST_COMMAND_TTL_MS),
      }).returning();
      await logPortalAction(req, scope, "gate.command.test", `Requested connection test for ${device.name}`, "gate_device", device.id, device.name, { commandId: command.id });
      await logGateEvent({ organizationId: scope.organizationId, schoolId: scope.schoolId, bridgeId: device.bridgeId, gateId: device.gateId, deviceId: device.id, sourceType: "portal", eventType: "terminal.test_requested", message: `Connection test requested for ${device.name}.`, details: { commandId: command.id } });
      res.status(202).json({ command });
    } catch (error) {
      fail(res, error);
    }
  });

  // Gate Bridge machine API -------------------------------------------------
  app.get("/api/gate-bridge/config", async (req, res) => {
    const bridge = await requireBridge(req, res);
    if (!bridge) return;
    try {
      const [gates, devices] = await Promise.all([
        db.select().from(accessGates).where(and(eq(accessGates.bridgeId, bridge.id), eq(accessGates.isActive, true))).orderBy(asc(accessGates.name)),
        db.select().from(gateDevices).where(and(eq(gateDevices.bridgeId, bridge.id), eq(gateDevices.isActive, true))).orderBy(asc(gateDevices.name)),
      ]);
      const gateMap = new Map(gates.map((gate) => [gate.id, gate]));
      res.json({
        revision: bridge.configurationRevision,
        bridge: { id: bridge.id, name: bridge.name, schoolId: bridge.schoolId },
        devices: devices.filter((device) => !!device.localAddress && (!device.gateId || gateMap.has(device.gateId))).map((device) => ({
          deviceKey: device.deviceKey,
          name: device.name,
          gateId: device.gateId,
          gateName: device.gateId ? gateMap.get(device.gateId)?.name || null : null,
          lanePosition: device.lanePosition,
          direction: device.direction,
          protocol: device.protocol,
          host: device.localAddress,
          port: device.localPort,
          deviceSn: device.deviceSn,
          macAddress: device.macAddress,
        })),
        serverTime: new Date().toISOString(),
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/gate-bridge/heartbeat", async (req, res) => {
    const bridge = await requireBridge(req, res);
    if (!bridge) return;
    try {
      const input = heartbeatSchema.parse(req.body);
      const now = new Date();
      const bridgeWasOnline = isRecent(bridge.lastHeartbeatAt);
      const reportedRevision = input.configRevision == null ? bridge.lastSyncedRevision : Math.min(input.configRevision, bridge.configurationRevision);
      const revisionSynchronized = reportedRevision === bridge.configurationRevision;
      await db.update(gateBridges).set({
        lastHeartbeatAt: now,
        lastIpAddress: clientIp(req),
        softwareVersion: input.softwareVersion || bridge.softwareVersion,
        installationId: input.installationId || bridge.installationId,
        machineName: input.machineName || bridge.machineName,
        lastServiceStartedAt: input.serviceStartedAt ? new Date(input.serviceStartedAt) : bridge.lastServiceStartedAt,
        lastError: input.error || null,
        lastSyncedRevision: reportedRevision,
        lastConfigSyncAt: revisionSynchronized ? now : bridge.lastConfigSyncAt,
        updatedAt: now,
      }).where(eq(gateBridges.id, bridge.id));

      if (!bridgeWasOnline) {
        await logGateEvent({
          organizationId: bridge.organizationId,
          schoolId: bridge.schoolId,
          bridgeId: bridge.id,
          sourceType: "bridge",
          eventType: bridge.lastHeartbeatAt ? "bridge.recovered" : "bridge.online",
          severity: bridge.lastHeartbeatAt ? "warning" : "info",
          message: bridge.lastHeartbeatAt ? `${bridge.name} reconnected to FCGS.` : `${bridge.name} connected to FCGS for the first time.`,
          details: { softwareVersion: input.softwareVersion || bridge.softwareVersion, configRevision: reportedRevision },
        });
      }

      for (const report of input.devices) {
        const [device] = await db.select().from(gateDevices).where(and(
          eq(gateDevices.bridgeId, bridge.id),
          eq(gateDevices.deviceKey, report.deviceKey),
          eq(gateDevices.isActive, true),
        )).limit(1);
        if (!device) continue;
        const versionInfo = report.versionInfo || undefined;
        const detectedSn = stringField(versionInfo || undefined, "cpuserial", "sn", "deviceSn", "serial");
        const detectedMac = stringField(versionInfo || undefined, "macaddr", "mac", "macAddress");
        await db.update(gateDevices).set({
          lastSeenAt: report.status === "online" ? now : device.lastSeenAt,
          lastConnectionStatus: report.status,
          lastVersionInfo: versionInfo ?? device.lastVersionInfo,
          deviceSn: detectedSn || device.deviceSn,
          macAddress: detectedMac || device.macAddress,
          lastError: report.error || null,
          updatedAt: now,
        }).where(eq(gateDevices.id, device.id));

        if (device.lastConnectionStatus !== report.status) {
          await logGateEvent({
            organizationId: bridge.organizationId,
            schoolId: bridge.schoolId,
            bridgeId: bridge.id,
            gateId: device.gateId,
            deviceId: device.id,
            sourceType: "terminal",
            eventType: report.status === "online" ? "terminal.online" : report.status === "offline" ? "terminal.offline" : "terminal.status_unknown",
            severity: report.status === "online" ? "info" : "warning",
            message: `${device.name} is ${report.status}.`,
            details: { error: report.error || null, address: device.localAddress, port: device.localPort },
          });
        }
      }
      res.json({ ok: true, serverTime: now.toISOString(), configurationRevision: bridge.configurationRevision });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/gate-bridge/logs", async (req, res) => {
    const bridge = await requireBridge(req, res);
    if (!bridge) return;
    try {
      const input = bridgeLogsSchema.parse(req.body);
      for (const event of input.events) {
        let device: typeof gateDevices.$inferSelect | null = null;
        if (event.deviceKey) {
          const [match] = await db.select().from(gateDevices).where(and(eq(gateDevices.bridgeId, bridge.id), eq(gateDevices.deviceKey, event.deviceKey))).limit(1);
          device = match || null;
        }
        await logGateEvent({
          organizationId: bridge.organizationId,
          schoolId: bridge.schoolId,
          bridgeId: bridge.id,
          gateId: device?.gateId || null,
          deviceId: device?.id || null,
          sourceType: device ? "terminal" : "bridge",
          eventType: event.eventType,
          severity: event.severity,
          message: event.message,
          details: event.details || null,
          occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
        });
      }
      res.json({ ok: true });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/gate-bridge/commands/claim", async (req, res) => {
    const bridge = await requireBridge(req, res);
    if (!bridge) return;
    try {
      const now = new Date();
      await db.update(gateCommands).set({ status: "expired", completedAt: now }).where(and(
        eq(gateCommands.bridgeId, bridge.id),
        eq(gateCommands.status, "pending"),
        lt(gateCommands.expiresAt, now),
      ));

      if (bridge.lastSyncedRevision !== bridge.configurationRevision) {
        return res.json({ commands: [], configurationPending: true, configurationRevision: bridge.configurationRevision, serverTime: now.toISOString() });
      }

      const candidates = await db.select().from(gateCommands).where(and(
        eq(gateCommands.bridgeId, bridge.id),
        eq(gateCommands.status, "pending"),
        gt(gateCommands.expiresAt, now),
      )).orderBy(asc(gateCommands.requestedAt)).limit(10);

      const deviceIds = Array.from(new Set(candidates.map((row) => row.deviceId)));
      const devices = deviceIds.length
        ? await db.select({ id: gateDevices.id, deviceKey: gateDevices.deviceKey, name: gateDevices.name, gateId: gateDevices.gateId, lanePosition: gateDevices.lanePosition }).from(gateDevices).where(inArray(gateDevices.id, deviceIds))
        : [];
      const deviceMap = new Map(devices.map((row) => [row.id, row]));
      const claimed: Array<Record<string, unknown>> = [];

      for (const candidate of candidates) {
        const [row] = await db.update(gateCommands).set({ status: "processing", claimedAt: now }).where(and(
          eq(gateCommands.id, candidate.id),
          eq(gateCommands.status, "pending"),
        )).returning();
        if (!row) continue;
        const device = deviceMap.get(row.deviceId);
        if (!device) {
          await db.update(gateCommands).set({ status: "failed", completedAt: now, errorMessage: "Gate device no longer exists" }).where(eq(gateCommands.id, row.id));
          continue;
        }
        claimed.push({
          id: row.id,
          commandType: row.commandType,
          payload: row.payload,
          expiresAt: row.expiresAt,
          device: { deviceKey: device.deviceKey, name: device.name, gateId: device.gateId, lanePosition: device.lanePosition },
        });
      }

      res.json({ commands: claimed, serverTime: now.toISOString() });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/gate-bridge/commands/:id/complete", async (req, res) => {
    const bridge = await requireBridge(req, res);
    if (!bridge) return;
    try {
      const commandId = Number(req.params.id);
      const input = completeCommandSchema.parse(req.body);
      const [command] = await db.select().from(gateCommands).where(and(eq(gateCommands.id, commandId), eq(gateCommands.bridgeId, bridge.id))).limit(1);
      if (!command) return res.status(404).json({ message: "Gate command not found" });
      if (command.status !== "processing") return res.status(409).json({ message: `Gate command is already ${command.status}` });

      const [device] = await db.select().from(gateDevices).where(eq(gateDevices.id, command.deviceId)).limit(1);
      const now = new Date();
      await db.update(gateCommands).set({
        status: input.success ? "succeeded" : "failed",
        result: input.result || null,
        errorMessage: input.success ? null : input.error || "Gate Bridge reported a command failure",
        completedAt: now,
      }).where(eq(gateCommands.id, command.id));

      if (command.commandType === "get_version") {
        if (input.success) {
          const detectedSn = stringField(input.result || undefined, "cpuserial", "sn", "deviceSn", "serial");
          const detectedMac = stringField(input.result || undefined, "macaddr", "mac", "macAddress");
          await db.update(gateDevices).set({
            lastSeenAt: now,
            lastConnectionStatus: "online",
            lastVersionInfo: input.result || {},
            deviceSn: detectedSn || device?.deviceSn || null,
            macAddress: detectedMac || device?.macAddress || null,
            lastError: null,
            updatedAt: now,
          }).where(eq(gateDevices.id, command.deviceId));
        } else {
          await db.update(gateDevices).set({
            lastConnectionStatus: "offline",
            lastError: input.error || "Connection test failed",
            updatedAt: now,
          }).where(eq(gateDevices.id, command.deviceId));
        }
      } else if (command.commandType === "sync_identity" || command.commandType === "delete_identity") {
        const identityId = Number((command.payload as any)?.identityId || 0);
        if (identityId) {
          const [sync] = await db.select().from(gateIdentitySync).where(and(eq(gateIdentitySync.identityId, identityId), eq(gateIdentitySync.deviceId, command.deviceId))).limit(1);
          if (sync?.lastCommandId === command.id) {
            const [identity] = await db.select({ photoPath: accessIdentities.photoPath }).from(accessIdentities).where(eq(accessIdentities.id, identityId)).limit(1);
            const retryCount = input.success ? 0 : (sync.retryCount || 0) + 1;
            await db.update(gateIdentitySync).set({
              syncStatus: input.success ? (command.commandType === "delete_identity" ? "deleted" : "synced") : "retry_pending",
              lastSyncedAt: input.success ? now : sync.lastSyncedAt,
              lastAttemptAt: now,
              retryCount,
              nextRetryAt: input.success ? null : new Date(now.getTime() + identityRetryDelayMs(retryCount)),
              lastSyncedPhotoPath: input.success && command.commandType === "sync_identity" ? identity?.photoPath || null : command.commandType === "delete_identity" && input.success ? null : sync.lastSyncedPhotoPath,
              lastError: input.success ? null : input.error || "Identity synchronization failed",
              updatedAt: now,
            }).where(eq(gateIdentitySync.id, sync.id));
          }
        }
        if (input.success) {
          await db.update(gateDevices).set({ lastSeenAt: now, lastConnectionStatus: "online", lastError: null, updatedAt: now }).where(eq(gateDevices.id, command.deviceId));
        }
      } else if (command.commandType === "set_time_groups") {
        if (input.success) await db.update(gateDevices).set({ lastSeenAt: now, lastConnectionStatus: "online", lastError: null, updatedAt: now }).where(eq(gateDevices.id, command.deviceId));
      } else if (!input.success && command.commandType === "open_gate") {
        // An open failure is security-relevant, but it does not necessarily mean the terminal is unreachable.
        await db.update(gateDevices).set({ lastError: input.error || "Manual open command failed", updatedAt: now }).where(eq(gateDevices.id, command.deviceId));
      }

      if (device) {
        let eventType: string;
        let message: string;
        if (command.commandType === "open_gate") {
          eventType = input.success ? "terminal.manual_open_succeeded" : "terminal.manual_open_failed";
          message = input.success ? `${device.name} accepted the manual open command.` : `${device.name} manual open failed: ${input.error || "Unknown error"}`;
        } else if (command.commandType === "get_version") {
          eventType = input.success ? "terminal.test_succeeded" : "terminal.test_failed";
          message = input.success ? `${device.name} passed the connection test.` : `${device.name} connection test failed: ${input.error || "Unknown error"}`;
        } else if (command.commandType === "sync_identity" || command.commandType === "delete_identity") {
          eventType = input.success ? "identity.sync_succeeded" : "identity.sync_failed";
          message = input.success ? `${device.name} synchronized an access identity.` : `${device.name} identity synchronization failed: ${input.error || "Unknown error"}`;
        } else {
          eventType = input.success ? "terminal.configuration_succeeded" : "terminal.configuration_failed";
          message = input.success ? `${device.name} accepted configuration.` : `${device.name} configuration failed: ${input.error || "Unknown error"}`;
        }
        await logGateEvent({
          organizationId: bridge.organizationId,
          schoolId: bridge.schoolId,
          bridgeId: bridge.id,
          gateId: device.gateId,
          deviceId: device.id,
          sourceType: "bridge",
          eventType,
          severity: input.success ? (command.commandType === "open_gate" ? "security" : "info") : "error",
          message,
          details: { commandId: command.id, commandType: command.commandType, result: input.result || null, error: input.error || null },
        });
      }

      res.json({ ok: true });
    } catch (error) {
      fail(res, error);
    }
  });
}
