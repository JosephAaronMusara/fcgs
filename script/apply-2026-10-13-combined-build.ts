import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = await readFile(path.resolve(here, "../sql/2026_10_13_attendance_reporting_fee_import_followup.sql"), "utf8");
const client = new pg.Client({ connectionString: databaseUrl });

await client.connect();
try {
  await client.query(sql);
  console.log("2026-10-13 attendance reporting and fee-import schema upgrade applied successfully.");
} finally {
  await client.end();
}
