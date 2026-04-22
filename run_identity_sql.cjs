const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

(async () => {
  const sql = fs.readFileSync(path.resolve("identity_numbering_password_reset_additive.sql"), "utf8");

  const client = new Client({
    host: "127.0.0.1",
    port: 5432,
    user: "fcgs_admin",
    password: "1De@goras",
    database: "fcgs_local",
  });

  await client.connect();
  await client.query(sql);
  await client.end();
  console.log("SQL applied successfully");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
