import type { Express } from "express";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import { pool } from "./db";

let applicationReady = false;

const workerId = process.env.FCGS_WORKER_ID || `pid-${process.pid}`;
const releaseId = (() => {
  if (process.env.FCGS_RELEASE_ID) return process.env.FCGS_RELEASE_ID;
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    }).trim() || "unknown";
  } catch {
    return "unknown";
  }
})();

export function setApplicationReady(value: boolean) {
  applicationReady = value;
}

export function getWorkerIdentity() {
  return { workerId, releaseId };
}

export function registerHealthRoutes(app: Express) {
  app.use((_req, res, next) => {
    res.setHeader("X-FCGS-Worker", workerId);
    res.setHeader("X-FCGS-Release", releaseId);
    next();
  });

  app.get("/api/health/live", (_req, res) => {
    res.json({
      status: "live",
      workerId,
      releaseId,
      pid: process.pid,
      hostname: os.hostname(),
      port: Number(process.env.PORT || 5000),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.get("/api/health/ready", async (_req, res) => {
    const checks: Record<string, boolean> = {
      startupComplete: applicationReady,
      database: false,
      productionAssets: process.env.NODE_ENV !== "production"
        || existsSync(path.resolve(process.cwd(), "dist", "public", "index.html")),
    };

    if (applicationReady) {
      try {
        await pool.query("SELECT 1 AS ok");
        checks.database = true;
      } catch (error) {
        console.error(`[health] ${workerId} database readiness check failed:`, error);
      }
    }

    const ready = Object.values(checks).every(Boolean);
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      workerId,
      releaseId,
      pid: process.pid,
      port: Number(process.env.PORT || 5000),
      checks,
    });
  });
}
