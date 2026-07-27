import "server-only";

/**
 * The app's shared Postgres connection.
 *
 * One pool, one place that knows how to degrade. Anything server-side that wants durable relational
 * storage — the user directory, the per-chain derived addresses, the transaction ledger that volume is
 * computed from — goes through here rather than opening its own client.
 *
 * POSTGRES IS ALWAYS OPTIONAL
 * ---------------------------
 * With no `POSTGRES_URL`, an unreachable host, or a table that hasn't been migrated yet, every function
 * here behaves as "no rows" and the caller carries on. This database is a record of what happened, not a
 * dependency of the wallet: a send must still be signed, broadcast and shown in History when Postgres is
 * down. Failures are logged once per process, not per call, because per-call logging is what turns one
 * bad connection into a wall of console noise on every request.
 *
 * This deliberately mirrors `lib/cache/redis.ts` — same optionality, same warn-once, same
 * `globalThis` singleton — so there is one shape to learn for "external service the app can live
 * without".
 */

import type { Pool, QueryResult, QueryResultRow } from "pg";

/**
 * Hang the pool off `globalThis`.
 *
 * A module-level value is discarded whenever this module is re-evaluated — every Fast Refresh in
 * development — which would leak a pool per edit and eventually exhaust the server's connection slots.
 * Serverless invocations that reuse a warm container also reuse this pool rather than paying a fresh TLS
 * handshake per request, which is the whole reason to use a pool in a function runtime at all.
 */
const g = globalThis as typeof globalThis & {
  __appPg?: Pool | null;
  __appPgWarned?: boolean;
};

function warnOnce(message: string): void {
  if (g.__appPgWarned) return;
  g.__appPgWarned = true;
  console.warn(`[db] ${message} — continuing without durable storage.`);
}

/**
 * Build the connection config.
 *
 * `POSTGRES_URL` is the POOLED connection string, which is the one serverless code must use: the direct
 * (`POSTGRES_URL_NON_POOLING`) endpoint allows a few dozen connections in total, and a function runtime
 * that scales to a hundred instances would exhaust it immediately. The direct URL is for migrations,
 * which run once from one place — see `scripts/migrate.mjs`.
 *
 * WHY `sslmode` IS STRIPPED
 * ------------------------
 * The provider hands out a URL ending `?sslmode=require`. Historically `pg` read that as "encrypt, don't
 * verify"; as of pg 8.22 it is treated as `verify-full`, so the same string that worked last release now
 * fails every connection with "self-signed certificate in certificate chain" — Supabase terminates TLS
 * with a certificate chained to its own root, which isn't in Node's bundled CA store. Removing the
 * parameter and passing `ssl` explicitly is what keeps the connection encrypted while accepting that
 * chain. `rejectUnauthorized: false` is doing real work here and must not be "tidied up".
 */
function resolveConfig(): { connectionString: string; ssl: { rejectUnauthorized: boolean } } | null {
  const raw = process.env.POSTGRES_URL?.trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    parsed.searchParams.delete("sslmode");
    return { connectionString: parsed.toString(), ssl: { rejectUnauthorized: false } };
  } catch {
    // Not a parseable URL — treat it as unconfigured rather than handing `pg` something it will choke on.
    return null;
  }
}

/** The shared pool, or null when Postgres isn't configured or couldn't be created. */
export function db(): Pool | null {
  if (g.__appPg !== undefined) return g.__appPg;

  const config = resolveConfig();
  if (!config) {
    g.__appPg = null;
    return null;
  }

  try {
    // Required at call time so a deployment without Postgres never loads the driver at all.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool: PgPool } = require("pg") as typeof import("pg");
    const pool = new PgPool({
      ...config,
      /**
       * Small per-instance ceiling.
       *
       * The limit that matters is the provider's, and it is shared across every running instance — so the
       * arithmetic is `max × instances`, not `max`. A handful of connections per instance is plenty for
       * the write-mostly, single-statement work this pool does, and leaves headroom for a scale-up.
       */
      max: 3,
      /** Release idle sockets quickly; a serverless container that goes quiet shouldn't hold slots. */
      idleTimeoutMillis: 10_000,
      /** Bounded wait, so an unreachable database costs one slow request rather than a hung one. */
      connectionTimeoutMillis: 5_000,
      /** Never let a lingering idle socket keep a process alive after its work is done. */
      allowExitOnIdle: true,
    });
    /**
     * An idle client that dies — a pooler recycling connections, a network blip — emits 'error' on the
     * pool. Without a listener that is an unhandled 'error' event, which takes the whole process down.
     */
    pool.on("error", (e: Error) => warnOnce(`pool error: ${e.message}`));
    g.__appPg = pool;
    return pool;
  } catch (e) {
    warnOnce(`could not initialise: ${(e as Error).message}`);
    g.__appPg = null;
    return null;
  }
}

/** True when durable storage is active. Callers use this to skip cleanly rather than to branch on errors. */
export function dbEnabled(): boolean {
  return db() !== null;
}

/**
 * Run a parameterised statement, or return null.
 *
 * Null means "no answer" for every reason there can be one — not configured, unreachable, syntax error,
 * table not migrated yet. Collapsing those into one value is intentional: no caller in this app has a
 * useful different response to "the database is missing" versus "the database refused", and giving them
 * one thing to check is what keeps a DB outage from turning into a 500 on the wallet.
 *
 * `params` is not optional by accident. Every value must arrive as a parameter ($1, $2, …); interpolating
 * a user-supplied string into `text` is how a signed-in user's chain name becomes SQL.
 */
export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = []
): Promise<QueryResult<T> | null> {
  const pool = db();
  if (!pool) return null;
  try {
    return await pool.query<T>(text, params as unknown[]);
  } catch (e) {
    warnOnce(`query failed: ${(e as Error).message}`);
    return null;
  }
}

/** Round-trip the server, for diagnostics. Null when Postgres isn't configured. */
export async function dbPing(): Promise<{ ok: boolean; detail: string } | null> {
  if (!dbEnabled()) return null;
  const started = Date.now();
  const res = await dbQuery<{ ok: number }>("SELECT 1 AS ok");
  if (!res) return { ok: false, detail: "query failed — see the [db] warning above" };
  return { ok: res.rows[0]?.ok === 1, detail: `SELECT 1 in ${Date.now() - started}ms` };
}
