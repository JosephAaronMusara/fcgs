import { randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import type { Response } from "express";

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".dll", ".com", ".bat", ".cmd", ".ps1", ".psm1", ".sh", ".bash",
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".html", ".htm", ".xhtml",
  ".php", ".phtml", ".py", ".rb", ".pl", ".jar", ".msi", ".scr", ".vbs",
]);

const BLOCKED_MIME_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "application/javascript",
  "text/javascript",
  "application/x-msdownload",
  "application/x-sh",
  "application/x-httpd-php",
]);

export type PrivateFileRecord = {
  storageKey: string;
  storedName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
};

function storageRoot(): string {
  const configured = process.env.LOCAL_OBJECT_DIR?.trim();
  return path.resolve(configured || path.join(process.cwd(), "object_storage"), "private");
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
}

export function assertSafePrivateUpload(file: { originalname: string; mimetype?: string }): void {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const mime = String(file.mimetype || "application/octet-stream").toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext) || BLOCKED_MIME_TYPES.has(mime)) {
    const error = new Error("This file type is not permitted for secure document storage.") as Error & { status?: number };
    error.status = 400;
    throw error;
  }
}

export async function savePrivateBuffer(args: {
  namespace: string;
  scopeId: number | string;
  originalName: string;
  mimeType?: string;
  buffer: Buffer;
}): Promise<PrivateFileRecord> {
  assertSafePrivateUpload({ originalname: args.originalName, mimetype: args.mimeType });
  const extension = path.extname(args.originalName).toLowerCase();
  const storedName = `${Date.now()}-${randomUUID()}${extension}`;
  const namespace = safeSegment(args.namespace);
  const scope = safeSegment(String(args.scopeId));
  const relativePath = path.posix.join(namespace, scope, storedName);
  const absolutePath = path.resolve(storageRoot(), relativePath);
  const expectedRoot = storageRoot() + path.sep;
  if (!absolutePath.startsWith(expectedRoot)) throw new Error("Invalid private storage path");
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, args.buffer, { flag: "wx" });
  return {
    storageKey: relativePath,
    storedName,
    originalName: path.basename(args.originalName),
    mimeType: args.mimeType || "application/octet-stream",
    fileSize: args.buffer.byteLength,
  };
}

export function privateFilePath(storageKey: string): string {
  const normalized = storageKey.replace(/\\/g, "/").replace(/^\/+/, "");
  const absolutePath = path.resolve(storageRoot(), normalized);
  const expectedRoot = storageRoot() + path.sep;
  if (!absolutePath.startsWith(expectedRoot)) throw new Error("Invalid private storage path");
  return absolutePath;
}

export async function privateFileExists(storageKey: string): Promise<boolean> {
  try {
    await fs.access(privateFilePath(storageKey));
    return true;
  } catch {
    return false;
  }
}

export async function deletePrivateFile(storageKey: string): Promise<void> {
  await fs.unlink(privateFilePath(storageKey)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function streamPrivateFile(args: {
  res: Response;
  storageKey: string;
  mimeType: string;
  originalName: string;
  disposition?: "inline" | "attachment";
}): Promise<void> {
  const absolutePath = privateFilePath(args.storageKey);
  const stat = await fs.stat(absolutePath);
  const disposition = args.disposition || "attachment";
  const encodedName = encodeURIComponent(path.basename(args.originalName));
  args.res.set({
    "Content-Type": args.mimeType || "application/octet-stream",
    "Content-Length": String(stat.size),
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(absolutePath);
    stream.on("error", reject);
    stream.on("end", resolve);
    stream.pipe(args.res);
  });
}
