import type { Express } from "express";
import express from "express";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import { requireAuth } from "../../auth";

const OBJECT_ROOT = process.env.LOCAL_OBJECT_DIR || "/var/lib/fcgs/object_storage";
const UPLOAD_DIR = path.join(OBJECT_ROOT, "uploads");
const MAX_UPLOAD_BYTES =
  (parseInt(process.env.MAX_UPLOAD_MB || "25", 10) || 25) * 1024 * 1024;

function safeExt(filename: string): string {
  const ext = path.extname(filename || "").toLowerCase();
  if (!ext) return "";
  if (!/^\.[a-z0-9]{1,10}$/.test(ext)) return "";
  return ext;
}

function safeFileName(fileName: string): string {
  if (!/^[a-f0-9-]{36}(\.[a-z0-9]{1,10})?$/.test(fileName)) {
    throw new Error("Invalid file name");
  }
  return fileName;
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function registerObjectStorageRoutes(app: Express): void {
  // Ensure the uploads directory exists
  fsp.mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {});

  // Public file serving: /objects/... -> ${LOCAL_OBJECT_DIR}/...
  app.use("/objects", express.static(OBJECT_ROOT));

  // Step 1: request an upload URL (client sends metadata only)
  app.post("/api/uploads/request-url", requireAuth, async (req, res) => {
    try {
      const { name, size, contentType } = req.body ?? {};

      if (!name) {
        return res.status(400).json({ error: "Missing required field: name" });
      }

      if (typeof size === "number" && size > MAX_UPLOAD_BYTES) {
        return res.status(413).json({
          error: `File too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB)`,
        });
      }

      const fileName = `${randomUUID()}${safeExt(String(name))}`;
      const uploadURL = `/api/uploads/put/${fileName}`;
      const objectPath = `/objects/uploads/${fileName}`;

      res.json({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  // Step 2: PUT the bytes to the uploadURL
  app.put("/api/uploads/put/:fileName", requireAuth, async (req, res) => {
    try {
      const fileName = safeFileName(routeParam(req.params.fileName));

      await fsp.mkdir(UPLOAD_DIR, { recursive: true });
      const dest = path.join(UPLOAD_DIR, fileName);

      let bytes = 0;
      req.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_UPLOAD_BYTES) req.destroy();
      });

      const out = fs.createWriteStream(dest, { flags: "wx" }); // avoid overwrite
      await pipeline(req, out);

      res.status(200).end();
    } catch (error: any) {
      if (error?.code === "EEXIST") {
        return res.status(409).json({ error: "Upload already exists" });
      }
      console.error("Upload error:", error);
      res.status(500).json({ error: "Upload failed" });
    }
  });
}
