import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const here = path.dirname(fileURLToPath(import.meta.url));
const sql = await readFile(path.resolve(here, "../sql/2026_10_11_comprehensive_build.sql"), "utf8");
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query(sql);
  console.log("2026-10-11 comprehensive build schema upgrade applied successfully.");
} finally {
  await client.end();
}
