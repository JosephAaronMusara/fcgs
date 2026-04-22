const { Client } = require("pg");

(async () => {
  const client = new Client({
    host: "127.0.0.1",
    port: 5432,
    user: "fcgs_admin",
    password: "1De@goras",
    database: "fcgs_local",
  });

  await client.connect();
  console.log("DB login successful");
  await client.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
