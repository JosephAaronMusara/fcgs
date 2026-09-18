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
import { prewarmPdfRenderer } from "./pdf-renderer";
import { scanAllTransportCompliance } from "./transport-compliance";
import { runAccessControlSchedulers } from "./access-control-operations";

const app = express();
const httpServer = createServer(app);

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

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
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

  console.log(`${formattedTime} [${source}] ${message}`);
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
      if (quietSuccessfulHeartbeat || quietEmptyBridgePoll) return;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(sanitizeApiLogPayload(capturedJsonResponse))}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  initializeCommunication();
  await ensureRbacBaseline();
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

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      void prewarmPdfRenderer().catch((error) => {
        console.warn("PDF renderer prewarm was skipped:", error instanceof Error ? error.message : error);
      });
      const runTransportCompliance = () => {
        void scanAllTransportCompliance().catch((error) => console.error("Transport compliance scan failed:", error));
      };
      setTimeout(runTransportCompliance, 30_000);
      setInterval(runTransportCompliance, 24 * 60 * 60 * 1000);

      setInterval(async () => {
        try {
          const pendingSchools = await storage.getSchoolsPendingTermination();
          const now = Date.now();
          for (const school of pendingSchools) {
            if (school.terminationAt && new Date(school.terminationAt).getTime() <= now) {
              log(`Archiving school: ${school.name} (ID: ${school.id})`);
              await storage.archiveSchool(school.id);
              log(`School archived: ${school.name}`);
            }
          }
        } catch (err) {
          console.error("School cleanup job error:", err);
        }
      }, 5 * 60 * 1000);

      const runAccessControlJobs = () => {
        void runAccessControlSchedulers().catch((err) => console.error("Access Control scheduler error:", err));
      };
      setTimeout(runAccessControlJobs, 15_000);
      setInterval(runAccessControlJobs, 60 * 1000);
    },
  );
})();
