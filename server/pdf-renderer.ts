import type { Request } from "express";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";
import { acquireDistributedSemaphore } from "./distributed-semaphore";

type PDFOptions = NonNullable<Parameters<Page["pdf"]>[0]>;
export type PdfRenderPriority = "interactive" | "background";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_ASSET_CACHE_TTL_MS = 15 * 60_000;
const DEFAULT_ASSET_CACHE_MB = 64;

type RenderWaiter = {
  resolve: (queueWaitMs: number) => void;
  priority: PdfRenderPriority;
  queuedAt: number;
  sequence: number;
};

type CachedAsset = {
  body: Buffer;
  headers: Record<string, string>;
  status: number;
  expiresAt: number;
  lastUsedAt: number;
};

let browserPromise: Promise<Browser> | null = null;
let activeJobs = 0;
let waiterSequence = 0;
const waiters: RenderWaiter[] = [];
const assetCache = new Map<string, CachedAsset>();
let assetCacheBytes = 0;

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function acquireGlobalPdfSlot(): Promise<(() => Promise<void>) | null> {
  const workerCount = numberFromEnv("FCGS_WORKER_COUNT", 1);
  const globalLimit = numberFromEnv("FCGS_PDF_GLOBAL_CONCURRENCY", 0);
  if (workerCount <= 1 || globalLimit <= 0) return null;
  return acquireDistributedSemaphore(globalLimit, { label: "pdf-render" });
}

function selectNextWaiter(): RenderWaiter | undefined {
  if (!waiters.length) return undefined;
  let selectedIndex = 0;
  for (let index = 1; index < waiters.length; index++) {
    const candidate = waiters[index];
    const selected = waiters[selectedIndex];
    if (candidate.priority === "interactive" && selected.priority !== "interactive") {
      selectedIndex = index;
      continue;
    }
    if (candidate.priority === selected.priority && candidate.sequence < selected.sequence) {
      selectedIndex = index;
    }
  }
  return waiters.splice(selectedIndex, 1)[0];
}

async function acquireSlot(priority: PdfRenderPriority = "interactive"): Promise<number> {
  const queuedAt = Date.now();
  const limit = numberFromEnv("PDF_RENDER_CONCURRENCY", DEFAULT_CONCURRENCY);
  if (activeJobs < limit) {
    activeJobs += 1;
    return 0;
  }
  return new Promise<number>((resolve) => {
    waiters.push({ resolve, priority, queuedAt, sequence: ++waiterSequence });
  });
}

function releaseSlot(): void {
  activeJobs = Math.max(0, activeJobs - 1);
  const next = selectNextWaiter();
  if (!next) return;
  activeJobs += 1;
  next.resolve(Date.now() - next.queuedAt);
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    }).then((browser) => {
      browser.on("disconnected", () => {
        browserPromise = null;
      });
      return browser;
    }).catch((error) => {
      browserPromise = null;
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Unable to start the PDF renderer. Install the pinned Chromium build with "npx playwright install chromium" or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. ${detail}`,
      );
    });
  }
  return browserPromise;
}

function parseCookieHeader(cookieHeader: string | undefined): Array<{ name: string; value: string }> {
  if (!cookieHeader) return [];
  return cookieHeader.split(";").map((entry) => entry.trim()).filter(Boolean).flatMap((entry) => {
    const separator = entry.indexOf("=");
    if (separator <= 0) return [];
    return [{ name: entry.slice(0, separator).trim(), value: entry.slice(separator + 1).trim() }];
  });
}

async function createContext(args?: {
  cookieHeader?: string;
  baseUrl?: string;
  schoolId?: number | null;
}): Promise<{ context: BrowserContext; baseUrl: string }> {
  const browser = await getBrowser();
  const baseUrl = args?.baseUrl || process.env.PDF_RENDER_BASE_URL || `http://127.0.0.1:${process.env.PORT || "5000"}`;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 },
    deviceScaleFactor: 1,
  });

  const cookies = parseCookieHeader(args?.cookieHeader);
  if (cookies.length) {
    await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseUrl })));
  }

  if (args?.schoolId) {
    await context.addInitScript((schoolId) => {
      window.localStorage.setItem("currentSchoolId", String(schoolId));
    }, args.schoolId);
  }

  return { context, baseUrl };
}

const A4_TWO_MM: PDFOptions = {
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: "2mm", right: "2mm", bottom: "2mm", left: "2mm" },
};

async function waitForPdfReady(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => document.documentElement.dataset.pdfReady === "true",
    undefined,
    { timeout: timeoutMs },
  );
}

function pruneAssetCache(now = Date.now()): void {
  for (const [key, entry] of assetCache) {
    if (entry.expiresAt <= now) {
      assetCache.delete(key);
      assetCacheBytes -= entry.body.length;
    }
  }
  const maxBytes = numberFromEnv("PDF_ASSET_CACHE_MB", DEFAULT_ASSET_CACHE_MB) * 1024 * 1024;
  if (assetCacheBytes <= maxBytes) return;
  const oldest = [...assetCache.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
  for (const [key, entry] of oldest) {
    assetCache.delete(key);
    assetCacheBytes -= entry.body.length;
    if (assetCacheBytes <= maxBytes) break;
  }
}

async function handleCachedImageRoute(route: Route, baseOrigin: string, schoolId?: number | null): Promise<void> {
  const request = route.request();
  if (request.method() !== "GET" || request.resourceType() !== "image") {
    await route.continue();
    return;
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url());
  } catch {
    await route.continue();
    return;
  }
  if (requestUrl.origin !== baseOrigin) {
    await route.continue();
    return;
  }

  const cacheKey = `${schoolId || 0}|${requestUrl.href}`;
  const now = Date.now();
  const cached = assetCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    cached.lastUsedAt = now;
    await route.fulfill({ status: cached.status, headers: cached.headers, body: cached.body });
    return;
  }
  if (cached) {
    assetCache.delete(cacheKey);
    assetCacheBytes -= cached.body.length;
  }

  try {
    const response = await route.fetch();
    const body = Buffer.from(await response.body());
    const headers = { ...response.headers() };
    // Playwright returns the decoded response body. Do not replay transport
    // encoding or a stale length when fulfilling from memory.
    delete headers["content-encoding"];
    delete headers["content-length"];
    const status = response.status();
    const contentType = String(headers["content-type"] || "").toLowerCase();
    const maxSingleAssetBytes = numberFromEnv("PDF_ASSET_CACHE_SINGLE_MB", 8) * 1024 * 1024;
    if (status >= 200 && status < 300 && contentType.startsWith("image/") && body.length <= maxSingleAssetBytes) {
      const ttlMs = numberFromEnv("PDF_ASSET_CACHE_TTL_MS", DEFAULT_ASSET_CACHE_TTL_MS);
      assetCache.set(cacheKey, { body, headers, status, expiresAt: now + ttlMs, lastUsedAt: now });
      assetCacheBytes += body.length;
      pruneAssetCache(now);
    }
    await route.fulfill({ response, body });
  } catch {
    await route.continue();
  }
}

async function installAssetCache(page: Page, baseUrl: string, schoolId?: number | null): Promise<void> {
  const enabled = process.env.PDF_ASSET_CACHE_ENABLED !== "false";
  if (!enabled) return;
  const baseOrigin = new URL(baseUrl).origin;
  await page.route("**/*", (route) => handleCachedImageRoute(route, baseOrigin, schoolId));
}

export async function prewarmPdfRenderer(): Promise<void> {
  const startedAt = Date.now();
  await getBrowser();
  console.info(`[pdf-renderer] Chromium prewarmed in ${Date.now() - startedAt}ms`);
}

export async function shutdownPdfRenderer(): Promise<void> {
  const current = browserPromise;
  browserPromise = null;
  if (!current) return;
  const browser = await current.catch(() => null);
  if (browser) await browser.close().catch(() => undefined);
}

export async function renderAppRoutePdf(args: {
  req?: Request;
  schoolId?: number | null;
  route: string;
  pdfOptions?: PDFOptions;
  timeoutMs?: number;
  priority?: PdfRenderPriority;
}): Promise<Buffer> {
  const totalStartedAt = Date.now();
  const priority = args.priority || "interactive";
  const localQueueWaitMs = await acquireSlot(priority);
  let releaseGlobalSlot: (() => Promise<void>) | null = null;
  let queueWaitMs = localQueueWaitMs;
  let context: BrowserContext | null = null;
  try {
    const distributedStartedAt = Date.now();
    releaseGlobalSlot = await acquireGlobalPdfSlot();
    if (releaseGlobalSlot) queueWaitMs += Date.now() - distributedStartedAt;
    const contextStartedAt = Date.now();
    const created = await createContext({
      cookieHeader: args.req?.headers.cookie,
      schoolId: args.schoolId,
    });
    context = created.context;
    const contextMs = Date.now() - contextStartedAt;
    const page = await context.newPage();
    await installAssetCache(page, created.baseUrl, args.schoolId);
    const timeoutMs = args.timeoutMs || numberFromEnv("PDF_RENDER_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    page.setDefaultTimeout(timeoutMs);
    await page.emulateMedia({ media: "print" });

    const url = new URL(args.route, created.baseUrl).toString();
    const navigationStartedAt = Date.now();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const navigationMs = Date.now() - navigationStartedAt;
    if (!response || !response.ok()) {
      throw new Error(`PDF render page failed with HTTP ${response?.status() ?? "unknown"}`);
    }

    const readyStartedAt = Date.now();
    await waitForPdfReady(page, timeoutMs);
    const readyMs = Date.now() - readyStartedAt;
    const renderError = await page.evaluate(() => document.documentElement.dataset.pdfError || "");
    if (renderError) throw new Error(renderError);
    const pdfStartedAt = Date.now();
    const buffer = Buffer.from(await page.pdf({ ...A4_TWO_MM, ...args.pdfOptions }));
    const pdfMs = Date.now() - pdfStartedAt;
    console.info(
      `[pdf-renderer] priority=${priority} route=${args.route.split("?")[0]} queueMs=${queueWaitMs} contextMs=${contextMs} navigationMs=${navigationMs} readyMs=${readyMs} pdfMs=${pdfMs} totalMs=${Date.now() - totalStartedAt} bytes=${buffer.length}`,
    );
    return buffer;
  } finally {
    await context?.close().catch(() => undefined);
    if (releaseGlobalSlot) await releaseGlobalSlot().catch(() => undefined);
    releaseSlot();
  }
}

export async function renderHtmlPdf(args: {
  html: string;
  pdfOptions?: PDFOptions;
  timeoutMs?: number;
  priority?: PdfRenderPriority;
  fitToContent?: { width: string; paddingPx?: number };
}): Promise<Buffer> {
  const priority = args.priority || "interactive";
  const localQueueWaitMs = await acquireSlot(priority);
  let releaseGlobalSlot: (() => Promise<void>) | null = null;
  let queueWaitMs = localQueueWaitMs;
  let context: BrowserContext | null = null;
  try {
    const distributedStartedAt = Date.now();
    releaseGlobalSlot = await acquireGlobalPdfSlot();
    if (releaseGlobalSlot) queueWaitMs += Date.now() - distributedStartedAt;
    const created = await createContext();
    context = created.context;
    const page = await context.newPage();
    const timeoutMs = args.timeoutMs || numberFromEnv("PDF_RENDER_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    page.setDefaultTimeout(timeoutMs);
    await page.emulateMedia({ media: "print" });
    await page.setContent(args.html, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.evaluate(async () => {
      if ("fonts" in document) await (document as any).fonts.ready;
      const images = Array.from(document.images);
      await Promise.all(images.map((image) => {
        if (image.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          const finish = () => resolve();
          image.addEventListener("load", finish, { once: true });
          image.addEventListener("error", finish, { once: true });
          window.setTimeout(finish, 5_000);
        });
      }));
    });
    let effectiveOptions: PDFOptions = { ...A4_TWO_MM, ...args.pdfOptions };
    if (args.fitToContent) {
      const contentHeight = await page.evaluate(() => Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0,
        document.documentElement.offsetHeight,
        document.body?.offsetHeight || 0,
      ));
      const paddingPx = Math.max(0, Number(args.fitToContent.paddingPx || 0));
      effectiveOptions = {
        ...effectiveOptions,
        width: args.fitToContent.width,
        height: `${Math.max(1, Math.ceil(contentHeight + paddingPx))}px`,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
        preferCSSPageSize: false,
      };
      delete (effectiveOptions as any).format;
    }
    const buffer = Buffer.from(await page.pdf(effectiveOptions));
    if (queueWaitMs > 0) console.info(`[pdf-renderer] priority=${priority} HTML job waited ${queueWaitMs}ms for a render slot`);
    return buffer;
  } finally {
    await context?.close().catch(() => undefined);
    if (releaseGlobalSlot) await releaseGlobalSlot().catch(() => undefined);
    releaseSlot();
  }
}

export function reportPdfFilename(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "document";
}
