import "dotenv/config";
import pg from "pg";
import { readFile } from "node:fs/promises";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
 await client.connect();
 await client.query(await readFile(new URL("../sql/2026_10_15_access_control_bridge_update.sql",import.meta.url),"utf8"));
 console.log("Gate Bridge Update schema applied. Automatic updates remain DISABLED.");
} catch(error) { console.error("Migration failed:",error);process.exitCode=1; }
finally { await client.end().catch(()=>undefined); }
