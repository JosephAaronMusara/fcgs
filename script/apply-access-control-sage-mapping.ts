import "dotenv/config";
import pg from "pg";
import { readFile } from "node:fs/promises";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const sql = await readFile(new URL("../sql/2026_10_15_access_control_sage_mapping.sql", import.meta.url), "utf8");
  await client.query(sql);
  console.log("FCGS Sage mapping additive migration applied.");
} catch (error) {
  console.error("Migration failed, transaction rolled back:", error);
  process.exitCode = 1;
} finally { await client.end().catch(() => undefined); }
