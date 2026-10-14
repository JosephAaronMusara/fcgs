import "dotenv/config";
import pg from "pg";
import { readFile } from "node:fs/promises";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const sql = await readFile(new URL("../sql/2026_10_14_access_control_reliability.sql", import.meta.url), "utf8");
  await client.query(sql);
  console.log("FCGS Access Control reliability schema applied successfully.");
} catch (error) {
  console.error("FCGS Access Control schema upgrade FAILED:", error);
  process.exitCode = 1;
} finally { await client.end().catch(() => undefined); }
