import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { initializeCommunication } from "./communication";
import { storage } from "./storage";
import { ensureRbacBaseline } from "./rbac-bootstrap";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { prewarmPdfRenderer, shutdownPdfRenderer } from "./pdf-renderer";
import { scanAllTransportCompliance } from "./transport-compliance";
import { runAccessControlSchedulers } from "./access-control-operations";
import { runFeeImportProcessorTick } from "./fees-import-routes";
import { pool } from "./db";
import { FCGS_LOCK_KEYS, withDistributedLock } from "./distributed-lock";
import { getWorkerIdentity, registerHealthRoutes, setApplicationReady } from "./health";

const app = express();
const httpServer = createServer(app);
const schedulerHandles: NodeJS.Timeout[] = [];
let shuttingDown = false;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  frameguard: process.env.NODE_ENV === "production" ? undefined : false,
}));

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : undefined;

app.use(cors({
  origin: allowedOrigins || true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-School-Id"],
}));

app.set("trust proxy", 1);
registerHealthRoutes(app);

function positiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(String(process.env[name] || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const configuredWorkerCount = positiveIntegerEnv("FCGS_WORKER_COUNT", 1);
const loginGlobalMax = positiveIntegerEnv("FCGS_LOGIN_RATE_LIMIT_MAX", 20);
const apiGlobalMax = positiveIntegerEnv("FCGS_API_RATE_LIMIT_MAX", 200);

// In multi-worker production, each worker receives an equal share of the
// existing global request budget. Nginx is the only externally reachable
// ingress and distributes requests across the workers, so the aggregate limit
// remains close to the single-process limits instead of multiplying by four.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Math.max(1, Math.ceil(loginGlobalMax / configuredWorkerCount)),
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: Math.max(1, Math.ceil(apiGlobalMax / configuredWorkerCount)),
  message: { message: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/auth/login", loginLimiter);
app.use("/api/", apiLimiter);

app.use(
  express.json({
    limit: "25mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "25mb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const { workerId } = getWorkerIdentity();
  console.log(`${formattedTime} [${source}] [${workerId}] ${message}`);
}

function sanitizeApiLogPayload(value: unknown): unknown {
  const sensitiveKeys = new Set([
    "password", "token", "bridgeToken", "setupCredential", "secret", "apiKey", "apikey",
    "sessionSecret", "authorization",
  ]);
  if (Array.isArray(value)) return value.map(sanitizeApiLogPayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    key,
    sensitiveKeys.has(key) ? "<REDACTED>" : sanitizeApiLogPayload(entry),
  ]));
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const quietSuccessfulHeartbeat = path === "/api/gate-bridge/heartbeat" && res.statusCode < 400;
      const quietEmptyBridgePoll = path === "/api/gate-bridge/commands/claim"
        && req.method === "POST"
        && res.statusCode < 400
        && Array.isArray(capturedJsonResponse?.commands)
        && capturedJsonResponse.commands.length === 0;
      const quietHealthCheck = path === "/api/health/live" || path === "/api/health/ready";
      if (quietSuccessfulHeartbeat || quietEmptyBridgePoll || quietHealthCheck) return;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(sanitizeApiLogPayload(capturedJsonResponse))}`;
      }

      log(logLine);
    }
  });

  next();
});

function scheduleJob(callback: () => void, delayMs: number, recurring = false) {
  const handle = recurring ? setInterval(callback, delayMs) : setTimeout(callback, delayMs);
  schedulerHandles.push(handle);
  return handle;
}

function startSchedulers() {
  const runTransportCompliance = () => {
    void withDistributedLock(
      FCGS_LOCK_KEYS.transportCompliance,
      () => scanAllTransportCompliance(),
    ).catch((error) => console.error("Transport compliance scan failed:", error));
  };
  scheduleJob(runTransportCompliance, 30_000);
  scheduleJob(runTransportCompliance, 24 * 60 * 60 * 1000, true);

  const runSchoolTerminationCleanup = () => {
    void withDistributedLock(FCGS_LOCK_KEYS.schoolTerminationCleanup, async () => {
      const pendingSchools = await storage.getSchoolsPendingTermination();
      const now = Date.now();
      for (const school of pendingSchools) {
        if (school.terminationAt && new Date(school.terminationAt).getTime() <= now) {
          log(`Archiving school: ${school.name} (ID: ${school.id})`);
          await storage.archiveSchool(school.id);
          log(`School archived: ${school.name}`);
        }
      }
    }).catch((err) => console.error("School cleanup job error:", err));
  };
  scheduleJob(runSchoolTerminationCleanup, 5 * 60 * 1000, true);

  const runAccessControlJobs = () => {
    void withDistributedLock(
      FCGS_LOCK_KEYS.accessControlScheduler,
      () => runAccessControlSchedulers(),
    ).catch((err) => console.error("Access Control scheduler error:", err));
  };
  scheduleJob(runAccessControlJobs, 15_000);
  scheduleJob(runAccessControlJobs, 60 * 1000, true);

  const runFeeImportJobs = () => {
    void runFeeImportProcessorTick().catch((error) => console.error("Fee balance import processor error:", error));
  };
  scheduleJob(runFeeImportJobs, 1_500);
  scheduleJob(runFeeImportJobs, 3_000, true);
}

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  setApplicationReady(false);
  log(`received ${signal}; draining worker`, "shutdown");

  for (const handle of schedulerHandles.splice(0)) clearTimeout(handle);

  const forceExit = setTimeout(() => {
    console.error(`[shutdown] ${signal} grace period expired; forcing worker exit`);
    httpServer.closeAllConnections?.();
    process.exit(1);
  }, 30_000);
  forceExit.unref();

  try {
    await new Promise<void>((resolve) => {
      if (!httpServer.listening) return resolve();
      httpServer.close(() => resolve());
      httpServer.closeIdleConnections?.();
    });
    await shutdownPdfRenderer().catch((error) => console.warn("PDF renderer shutdown warning:", error));
    await pool.end();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    console.error("Graceful shutdown failed:", error);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

async function main() {
  initializeCommunication();
  await withDistributedLock(FCGS_LOCK_KEYS.rbacBaseline, ensureRbacBaseline, { wait: true });
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // Each production worker receives its own loopback port from systemd.
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";
  httpServer.listen(
    {
      port,
      host,
      reusePort: true,
    },
    () => {
      setApplicationReady(true);
      log(`serving on ${host}:${port}`);
      if (process.env.FCGS_PDF_PREWARM !== "false") {
        void prewarmPdfRenderer().catch((error) => {
          console.warn("PDF renderer prewarm was skipped:", error instanceof Error ? error.message : error);
        });
      }
      startSchedulers();
    },
  );
}

void main().catch((error) => {
  setApplicationReady(false);
  console.error("FCGS worker failed to start:", error);
  process.exit(1);
});
