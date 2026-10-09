import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";

const ROOT = path.resolve(process.cwd(), "gate-bridge-windows", "assets");

const downloads = [
  {
    name: "node.exe",
    url: "https://nodejs.org/dist/v22.16.0/win-x64/node.exe",
    sha256: "c5ff4c736112dd483c750fd4149d30c8a116db1a49b8b3ec88be4b65e6c86c19",
  },
  {
    name: "FCGSGateBridgeService.exe",
    url: "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe",
    sha256: "05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da",
  },
] as const;

const textDownloads = [
  {
    name: "LICENSE-Node.txt",
    url: "https://raw.githubusercontent.com/nodejs/node/v22.16.0/LICENSE",
  },
  {
    name: "LICENSE-WinSW.txt",
    url: "https://raw.githubusercontent.com/winsw/winsw/v2.12.0/LICENSE.txt",
  },
] as const;

function digest(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function fetchBuffer(url: string) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function ensureBinary(item: (typeof downloads)[number]) {
  const target = path.join(ROOT, item.name);
  try {
    const existing = await fs.readFile(target);
    if (digest(existing) === item.sha256) {
      console.log(`[gate-bridge-runtime] verified existing ${item.name}`);
      return;
    }
    console.warn(`[gate-bridge-runtime] replacing ${item.name}: checksum does not match pinned release`);
  } catch {
    // Missing asset is downloaded below.
  }

  console.log(`[gate-bridge-runtime] downloading ${item.name}`);
  const buffer = await fetchBuffer(item.url);
  const actual = digest(buffer);
  if (actual !== item.sha256) throw new Error(`SHA-256 mismatch for ${item.name}. Expected ${item.sha256}; received ${actual}`);
  const temp = `${target}.tmp-${process.pid}`;
  await fs.writeFile(temp, buffer);
  await fs.rename(temp, target);
  console.log(`[gate-bridge-runtime] installed ${item.name} (${buffer.length} bytes)`);
}

async function ensureText(item: (typeof textDownloads)[number]) {
  const target = path.join(ROOT, item.name);
  try {
    const existing = await fs.readFile(target, "utf8");
    if (existing.trim().length > 100) return;
  } catch {
    // Download below.
  }
  console.log(`[gate-bridge-runtime] downloading ${item.name}`);
  const buffer = await fetchBuffer(item.url);
  await fs.writeFile(target, buffer);
}

async function main() {
  await fs.mkdir(ROOT, { recursive: true });
  for (const item of downloads) await ensureBinary(item);
  for (const item of textDownloads) await ensureText(item);
  console.log("[gate-bridge-runtime] Windows x64 runtime assets are prepared.");
  console.log("[gate-bridge-runtime] Build the portal next so gate-bridge.cjs matches the current source release.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
