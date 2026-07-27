/**
 * Apply `lib/db/schema.sql` to the database.
 *
 *   pnpm db:migrate
 *
 * Safe to run repeatedly and safe to run on every deploy: the schema is written entirely from
 * `IF NOT EXISTS` / `CREATE OR REPLACE` statements, so this is "make the database look like the file"
 * rather than "apply the next change". No migrations table, nothing to get out of step.
 *
 * WHY THIS IS PLAIN JAVASCRIPT, AND NOT `lib/db/client.ts`
 * -------------------------------------------------------
 * Two reasons, and they pull the same way. It runs under bare `node`, which cannot load TypeScript and
 * cannot resolve the `@/` alias, so a shared module would need a build step to run a migration. And it
 * must use the DIRECT connection: `client.ts` is deliberately hard-wired to the pooled endpoint, and
 * DDL through a transaction pooler is exactly the thing poolers handle badly. The ~15 lines of
 * connection setup below are duplicated on purpose; keep them in step with `resolveConfig` in
 * `lib/db/client.ts`.
 */

import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// `pg` is a CommonJS package with no named ESM exports; a default import is the supported shape.
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(here, "..", "lib", "db", "schema.sql");

/**
 * Prefer the direct endpoint, fall back to the pooled one.
 *
 * DDL wants a real session. A transaction pooler multiplexes statements across backends and will happily
 * run these, but the direct URL is the honest choice for schema changes and is what the provider hands
 * out for exactly this.
 */
const raw = process.env.POSTGRES_URL_NON_POOLING?.trim() || process.env.POSTGRES_URL?.trim();
if (!raw) {
  console.error(
    "[migrate] POSTGRES_URL_NON_POOLING is not set.\n" +
      "          Run with the project env loaded: node --env-file=.env.local scripts/migrate.mjs"
  );
  process.exit(1);
}

/**
 * Strip `sslmode` and pass `ssl` explicitly.
 *
 * The provider's URL ends `?sslmode=require`, which pg 8.22 now interprets as `verify-full` — and that
 * fails against Supabase with "self-signed certificate in certificate chain", because its certificate
 * chains to a root Node does not bundle. The connection stays encrypted either way; this only drops the
 * chain verification that cannot succeed.
 */
const url = new URL(raw);
url.searchParams.delete("sslmode");

const client = new Client({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: false },
});

const schema = await readFile(SCHEMA_PATH, "utf8");

await client.connect();
try {
  /**
   * One transaction for the whole file.
   *
   * Postgres runs DDL transactionally, so a syntax error halfway down rolls back the tables above it
   * rather than leaving the database in a state that is neither the old schema nor the new one.
   */
  await client.query("BEGIN");
  await client.query(schema);
  await client.query("COMMIT");

  const { rows } = await client.query(
    `SELECT table_name, table_type
       FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_type, table_name`
  );
  console.log("[migrate] applied lib/db/schema.sql");
  for (const r of rows) {
    console.log(`           ${r.table_type === "VIEW" ? "view " : "table"}  ${r.table_name}`);
  }
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`[migrate] failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
