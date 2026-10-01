import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const currentFile = fileURLToPath(import.meta.url);
  const sqlPath = path.resolve(path.dirname(currentFile), "../sql/2026_10_01_transport_receipt_printing.sql");
  const sql = await readFile(sqlPath, "utf8");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
    console.log("2026-10-01 emergency Transport receipt schema upgrade applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
