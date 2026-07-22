import type { Request } from "express";
import { chromium, type Browser, type BrowserContext, type PDFOptions } from "playwright";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_CONCURRENCY = 2;

let browserPromise: Promise<Browser> | null = null;
let activeJobs = 0;
const waiters: Array<() => void> = [];

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function acquireSlot(): Promise<void> {
  const limit = numberFromEnv("PDF_RENDER_CONCURRENCY", DEFAULT_CONCURRENCY);
  if (activeJobs < limit) {
    activeJobs += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  activeJobs += 1;
}

function releaseSlot(): void {
  activeJobs = Math.max(0, activeJobs - 1);
  waiters.shift()?.();
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
        `Unable to start the PDF renderer. Install the pinned Chromium build with \"npx playwright install chromium\" or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. ${detail}`,
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

async function waitForPdfReady(page: import("playwright").Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => document.documentElement.dataset.pdfReady === "true",
    undefined,
    { timeout: timeoutMs },
  );
  await page.evaluate(async () => {
    if ("fonts" in document) await (document as any).fonts.ready;
  });
}

export async function renderAppRoutePdf(args: {
  req?: Request;
  schoolId?: number | null;
  route: string;
  pdfOptions?: PDFOptions;
  timeoutMs?: number;
}): Promise<Buffer> {
  await acquireSlot();
  let context: BrowserContext | null = null;
  try {
    const created = await createContext({
      cookieHeader: args.req?.headers.cookie,
      schoolId: args.schoolId,
    });
    context = created.context;
    const page = await context.newPage();
    const timeoutMs = args.timeoutMs || numberFromEnv("PDF_RENDER_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    page.setDefaultTimeout(timeoutMs);
    await page.emulateMedia({ media: "print" });

    const url = new URL(args.route, created.baseUrl).toString();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (!response || !response.ok()) {
      throw new Error(`PDF render page failed with HTTP ${response?.status() ?? "unknown"}`);
    }

    await waitForPdfReady(page, timeoutMs);
    const renderError = await page.evaluate(() => document.documentElement.dataset.pdfError || "");
    if (renderError) throw new Error(renderError);
    return Buffer.from(await page.pdf({ ...A4_TWO_MM, ...args.pdfOptions }));
  } finally {
    await context?.close().catch(() => undefined);
    releaseSlot();
  }
}

export async function renderHtmlPdf(args: {
  html: string;
  pdfOptions?: PDFOptions;
  timeoutMs?: number;
}): Promise<Buffer> {
  await acquireSlot();
  let context: BrowserContext | null = null;
  try {
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
          window.setTimeout(finish, 10_000);
        });
      }));
    });
    return Buffer.from(await page.pdf({ ...A4_TWO_MM, ...args.pdfOptions }));
  } finally {
    await context?.close().catch(() => undefined);
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
