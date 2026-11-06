import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { migrationFiles } from "./migrations.js";

// Прогоняет db/tests/016_checks.sql на отдельной временной базе со всеми миграциями.
// Запуск: npm run test:db (нужен DATABASE_URL с правом создавать базы).
test(
  "database logic from migration 016",
  { skip: process.env.RUN_DB_CHECKS !== "1" },
  async () => {
    const source = new URL(
      process.env.DATABASE_URL || "postgres://isad:isad@db:5432/isad",
    );
    const admin = new pg.Pool({ connectionString: source.href });
    const name = `isad_dbcheck_${Date.now()}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(source);
    url.pathname = "/" + name;
    const db = new pg.Pool({ connectionString: url.href });
    try {
      for (const file of await migrationFiles())
        await db.query(
          await readFile(new URL("../db/" + file, import.meta.url), "utf8"),
        );
      // если какая-то проверка не прошла, скрипт сам падает со списком ошибок
      const results = await db.query(
        await readFile(
          new URL("../db/tests/016_checks.sql", import.meta.url),
          "utf8",
        ),
      );
      const table = results.find((r) => r.fields?.some((f) => f.name === "итог"));
      assert.ok(table.rows.length > 0);
      assert.deepEqual(table.rows.filter((r) => r["итог"] !== "OK"), []);
    } finally {
      await db.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      await admin.end();
    }
  },
);
