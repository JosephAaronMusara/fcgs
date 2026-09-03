import type { Express, Request, Response } from "express";
import { createHash, randomBytes, randomUUID } from "crypto";
import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { requirePermission } from "./auth";
import {
  activityLogs,
  gateBridges,
  gateCommands,
  gateDevices,
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
const OPEN_COMMAND_TTL_MS = 20_000;
const TEST_COMMAND_TTL_MS = 60_000;

const bridgeCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
});

const deviceCreateSchema = z.object({
  bridgeId: z.coerce.number().int().positive(),
  name: z.string().trim().min(2).max(100),
  location: z.string().trim().max(160).optional().nullable(),
  direction: z.enum(["entry", "exit", "bidirectional"]).default("entry"),
  protocol: z.enum(["http"]).default("http"),
  localAddress: z.string().trim().max(120).optional().nullable(),
  localPort: z.coerce.number().int().min(1).max(65535).default(9090),
  deviceSn: z.string().trim().max(120).optional().nullable(),
  macAddress: z.string().trim().max(64).optional().nullable(),
});

const manualOpenSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

const heartbeatSchema = z.object({
  softwareVersion: z.string().trim().max(100).optional().nullable(),
  error: z.string().trim().max(1000).optional().nullable(),
  devices: z.array(z.object({
    deviceKey: z.string().uuid(),
    status: z.enum(["online", "offline", "unknown"]),
    versionInfo: z.record(z.unknown()).optional().nullable(),
    error: z.string().trim().max(1000).optional().nullable(),
  })).max(100).default([]),
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

function isRecent(value: Date | string | null | undefined, windowMs = ONLINE_WINDOW_MS) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() <= windowMs;
}

function clientIp(req: Request) {
  return req.ip || req.socket.remoteAddress || null;
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

function fail(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected Access Control error";
  const status = /not found/i.test(message) ? 404 : /denied|context|permission/i.test(message) ? 403 : 400;
  return res.status(status).json({ message });
}

export function registerAccessControlRoutes(app: Express) {
  // Portal UI/API -----------------------------------------------------------
  app.get("/api/access-control/bootstrap", requirePermission("access_control.view"), async (req, res) => {
    try {
      const scope = await portalScope(req);
      const staleProcessingBefore = new Date(Date.now() - 2 * 60_000);
      await db.update(gateCommands).set({
        status: "failed",
        errorMessage: "Gate Bridge did not complete the command before the processing timeout.",
        completedAt: new Date(),
      }).where(and(
        eq(gateCommands.schoolId, scope.schoolId),
        eq(gateCommands.status, "processing"),
        lt(gateCommands.claimedAt, staleProcessingBefore),
      ));
      await db.update(gateCommands).set({ status: "expired", completedAt: new Date() }).where(and(
        eq(gateCommands.schoolId, scope.schoolId),
        eq(gateCommands.status, "pending"),
        lt(gateCommands.expiresAt, new Date()),
      ));

      const [bridges, devices, commands] = await Promise.all([
        db.select().from(gateBridges).where(eq(gateBridges.schoolId, scope.schoolId)).orderBy(asc(gateBridges.name)),
        db.select().from(gateDevices).where(eq(gateDevices.schoolId, scope.schoolId)).orderBy(asc(gateDevices.name)),
        db.select().from(gateCommands).where(eq(gateCommands.schoolId, scope.schoolId)).orderBy(desc(gateCommands.requestedAt)).limit(100),
      ]);

      const requesterIds = Array.from(new Set(commands.map((row) => row.requestedByUserId).filter((id): id is number => !!id)));
      const requesters = requesterIds.length
        ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, username: users.username }).from(users).where(inArray(users.id, requesterIds))
        : [];
      const requesterMap = new Map(requesters.map((row) => [row.id, row]));
      const bridgeMap = new Map(bridges.map((row) => [row.id, row]));
      const deviceMap = new Map(devices.map((row) => [row.id, row]));

      res.json({
        scope,
        bridges: bridges.map((bridge) => ({
          ...bridge,
          bridgeKeyHash: undefined,
          isOnline: bridge.isActive && isRecent(bridge.lastHeartbeatAt),
        })),
        devices: devices.map((device) => ({
          ...device,
          isOnline: device.isActive && device.lastConnectionStatus === "online" && isRecent(device.lastSeenAt, 90_000),
          bridgeOnline: !!bridgeMap.get(device.bridgeId)?.isActive && isRecent(bridgeMap.get(device.bridgeId)?.lastHeartbeatAt),
        })),
        commands: commands.map((command) => {
          const requester = command.requestedByUserId ? requesterMap.get(command.requestedByUserId) : null;
          return {
            ...command,
            deviceName: deviceMap.get(command.deviceId)?.name || `Device #${command.deviceId}`,
            bridgeName: bridgeMap.get(command.bridgeId)?.name || `Bridge #${command.bridgeId}`,
            requestedByName: requester ? `${requester.firstName || ""} ${requester.lastName || ""}`.trim() || requester.username : "System",
          };
        }),
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
      res.json({
        bridge: { ...updated, bridgeKeyHash: undefined },
        token: rawToken,
        message: "The old Gate Bridge token is now invalid. Save this replacement token now.",
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/access-control/devices", requirePermission("access_control.manage_devices"), async (req, res) => {
    try {
      const scope = await portalScope(req);
      const input = deviceCreateSchema.parse(req.body);
      const bridge = await bridgeInScope(scope, input.bridgeId);
      if (!bridge || !bridge.isActive) return res.status(400).json({ message: "Select an active Gate Bridge in this school" });
      const [device] = await db.insert(gateDevices).values({
        organizationId: scope.organizationId,
        schoolId: scope.schoolId,
        bridgeId: bridge.id,
        deviceKey: randomUUID(),
        name: input.name,
        location: input.location || null,
        direction: input.direction,
        protocol: input.protocol,
        localAddress: input.localAddress || null,
        localPort: input.localPort,
        deviceSn: input.deviceSn || null,
        macAddress: input.macAddress || null,
        createdByUserId: scope.userId,
      }).returning();
      await logPortalAction(req, scope, "gate_device.create", `Registered gate device ${device.name}`, "gate_device", device.id, device.name, { bridgeId: bridge.id, direction: device.direction });
      res.status(201).json({ device });
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
      const [existingCommand] = await db.select({ id: gateCommands.id }).from(gateCommands).where(and(
        eq(gateCommands.deviceId, device.id),
        inArray(gateCommands.status, ["pending", "processing"]),
        gt(gateCommands.expiresAt, new Date()),
      )).limit(1);
      if (existingCommand) {
        return res.status(409).json({ message: "A gate command is already in progress for this device." });
      }
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
      if (!bridge?.isActive || !isRecent(bridge.lastHeartbeatAt)) {
        return res.status(409).json({ message: "Gate Bridge is offline. No test command was created." });
      }
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
      res.status(202).json({ command });
    } catch (error) {
      fail(res, error);
    }
  });

  // Gate Bridge machine API -------------------------------------------------
  app.post("/api/gate-bridge/heartbeat", async (req, res) => {
    const bridge = await requireBridge(req, res);
    if (!bridge) return;
    try {
      const input = heartbeatSchema.parse(req.body);
      const now = new Date();
      await db.update(gateBridges).set({
        lastHeartbeatAt: now,
        lastIpAddress: clientIp(req),
        softwareVersion: input.softwareVersion || bridge.softwareVersion,
        lastError: input.error || null,
        updatedAt: now,
      }).where(eq(gateBridges.id, bridge.id));

      for (const report of input.devices) {
        const [device] = await db.select().from(gateDevices).where(and(
          eq(gateDevices.bridgeId, bridge.id),
          eq(gateDevices.deviceKey, report.deviceKey),
          eq(gateDevices.isActive, true),
        )).limit(1);
        if (!device) continue;
        await db.update(gateDevices).set({
          lastSeenAt: report.status === "online" ? now : device.lastSeenAt,
          lastConnectionStatus: report.status,
          lastVersionInfo: report.versionInfo ?? device.lastVersionInfo,
          lastError: report.error || null,
          updatedAt: now,
        }).where(eq(gateDevices.id, device.id));
      }
      res.json({ ok: true, serverTime: now.toISOString() });
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

      const candidates = await db.select().from(gateCommands).where(and(
        eq(gateCommands.bridgeId, bridge.id),
        eq(gateCommands.status, "pending"),
        gt(gateCommands.expiresAt, now),
      )).orderBy(asc(gateCommands.requestedAt)).limit(5);

      const deviceIds = Array.from(new Set(candidates.map((row) => row.deviceId)));
      const devices = deviceIds.length
        ? await db.select({ id: gateDevices.id, deviceKey: gateDevices.deviceKey, name: gateDevices.name }).from(gateDevices).where(inArray(gateDevices.id, deviceIds))
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
          device: { deviceKey: device.deviceKey, name: device.name },
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
      const [command] = await db.select().from(gateCommands).where(and(
        eq(gateCommands.id, commandId),
        eq(gateCommands.bridgeId, bridge.id),
      )).limit(1);
      if (!command) return res.status(404).json({ message: "Gate command not found" });
      if (command.status !== "processing") {
        return res.status(409).json({ message: `Gate command is already ${command.status}` });
      }

      const now = new Date();
      await db.update(gateCommands).set({
        status: input.success ? "succeeded" : "failed",
        result: input.result || null,
        errorMessage: input.success ? null : input.error || "Gate Bridge reported a command failure",
        completedAt: now,
      }).where(eq(gateCommands.id, command.id));

      if (command.commandType === "get_version") {
        if (input.success) {
          await db.update(gateDevices).set({
            lastSeenAt: now,
            lastConnectionStatus: "online",
            lastVersionInfo: input.result || {},
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
      } else if (!input.success) {
        await db.update(gateDevices).set({
          lastConnectionStatus: "offline",
          lastError: input.error || "Gate command failed",
          updatedAt: now,
        }).where(eq(gateDevices.id, command.deviceId));
      }

      res.json({ ok: true });
    } catch (error) {
      fail(res, error);
    }
  });
}
