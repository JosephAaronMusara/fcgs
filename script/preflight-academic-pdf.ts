import "dotenv/config";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { chromium } from "playwright";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";

const requiredSourceFiles = [
  "client/src/components/academic-reports/report-card-document.tsx",
  "client/src/pages/report-card-pdf-render.tsx",
  "server/pdf-renderer.ts",
  "server/routes.ts",
];

async function sourceCheck(relativePath: string): Promise<boolean> {
  try {
    await access(path.resolve(process.cwd(), relativePath), fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const missingSourceFiles: string[] = [];
  for (const relativePath of requiredSourceFiles) {
    if (!(await sourceCheck(relativePath))) missingSourceFiles.push(relativePath);
  }

  const objectRoot = process.env.LOCAL_OBJECT_DIR
    ? path.resolve(process.env.LOCAL_OBJECT_DIR)
    : path.resolve(process.cwd(), "object_storage");
  const cacheDirectory = path.join(objectRoot, "private", "academic-report-pdf-cache");
  let cacheWritable = false;
  let cacheError: string | null = null;
  const probePath = path.join(cacheDirectory, `.preflight-${process.pid}-${Date.now()}`);
  try {
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(probePath, "ok", { flag: "wx" });
    await rm(probePath, { force: true });
    cacheWritable = true;
  } catch (error) {
    cacheError = error instanceof Error ? error.message : String(error);
  }

  let chromiumReady = false;
  let chromiumExecutable = "";
  let chromiumError: string | null = null;
  try {
    chromiumExecutable = chromium.executablePath();
    await access(chromiumExecutable, fsConstants.X_OK);
    chromiumReady = true;
  } catch (error) {
    chromiumError = error instanceof Error ? error.message : String(error);
  }

  let publicationTableReady = false;
  let publicationColumnsMissing: string[] = [];
  if (process.env.DATABASE_URL) {
    const tableResult = await db.execute(sql`select to_regclass('public.assessment_publications') as table_name`);
    publicationTableReady = Boolean(tableResult.rows[0]?.table_name);
    if (publicationTableReady) {
      const requiredColumns = ["school_id", "exam_id", "class_id", "is_published", "publication_version"];
      const columnResult = await db.execute(sql`
        select column_name
        from information_schema.columns
        where table_schema = 'public' and table_name = 'assessment_publications'
      `);
      const present = new Set((columnResult.rows as Array<{ column_name: string }>).map((row) => row.column_name));
      publicationColumnsMissing = requiredColumns.filter((column) => !present.has(column));
    }
  }

  const result = {
    missingSourceFiles,
    cacheDirectory,
    cacheWritable,
    cacheError,
    chromiumReady,
    chromiumExecutable,
    chromiumError,
    databaseChecked: Boolean(process.env.DATABASE_URL),
    publicationTableReady: process.env.DATABASE_URL ? publicationTableReady : null,
    publicationColumnsMissing,
    status: missingSourceFiles.length || !cacheWritable || !chromiumReady || (process.env.DATABASE_URL && (!publicationTableReady || publicationColumnsMissing.length))
      ? "BLOCKED"
      : "READY",
  };

  console.log(JSON.stringify(result, null, 2));
  if (!chromiumReady) {
    console.error("Chromium is not installed for Playwright. Run: npm run pdf:install-browser (Windows/macOS) or npm run pdf:install-browser:linux (Ubuntu).\n");
  }
  if (result.status !== "READY") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
