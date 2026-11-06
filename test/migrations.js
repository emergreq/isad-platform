import { readdir } from "node:fs/promises";

// Все миграции из db/ в порядке номеров — по тому же правилу, что и server/migrate.js.
// Тесты берут список отсюда, чтобы новая миграция (016, 017, ...) применялась сама.
export async function migrationFiles() {
  return (await readdir(new URL("../db/", import.meta.url)))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();
}
