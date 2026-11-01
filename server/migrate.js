import { pool, transaction } from "./db.js";
import { readFile, readdir } from "node:fs/promises";
await pool.query(
  "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
);
for (const file of (await readdir(new URL("../db/", import.meta.url)))
  .filter((x) => /^\d+.*\.sql$/.test(x))
  .sort()) {
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(472315)");
    if (
      !(await c.query("SELECT 1 FROM schema_migrations WHERE name=$1", [file]))
        .rowCount
    ) {
      await c.query(
        await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
      );
      await c.query("INSERT INTO schema_migrations(name) VALUES($1)", [file]);
      console.log("Applied", file);
    }
  });
}
await pool.end();
