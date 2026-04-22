const { Client } = require("pg");

(async () => {
  const client = new Client({
    host: "127.0.0.1",
    port: 5432,
    user: "fcgs_admin",
    password: "fcgs_local_pw_change_me",
    database: "fcgs_local",
  });

  await client.connect();
  await client.query("ALTER USER fcgs_admin WITH PASSWORD '1De@goras';");
  await client.end();
  console.log("Password changed successfully");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
