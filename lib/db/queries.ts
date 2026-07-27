import "server-only";

/**
 * Every statement the app runs against Postgres, in one file.
 *
 * The routes above this stay thin — authenticate, validate, call one function here — and the SQL stays
 * somewhere it can be read as a whole rather than hunted for across handlers. Nothing here throws: each
 * function returns a value that means "it didn't happen", because `dbQuery` collapses an outage into
 * `null` and this layer keeps that property rather than reintroducing exceptions the callers would then
 * have to catch.
 *
 * PARAMETERS, ALWAYS
 * ------------------
 * Every value reaches Postgres as $1/$2/…. Not one string here is interpolated into SQL, including the
 * ones that look harmless — `chain` and `symbol` arrive from a client and a client is not a friend.
 */

import { dbQuery } from "./client";

/** The only kinds the ledger records. Receives are detected, not observed — see schema.sql. */
export type TxKind = "send" | "swap";

export interface DerivedAddress {
  chain: string;
  address: string;
  /** Curve name, already mapped from Ika's integer by the caller. */
  curve: string | null;
}

export interface TransactionRecord {
  kind: TxKind;
  chain: string;
  symbol: string;
  /** Decimal string exactly as displayed. Kept as a string all the way to `numeric`, never parsed. */
  amount: string;
  /** Null when the transfer could not be priced — see schema.sql. */
  usdValue: number | null;
  txHash: string | null;
  counterparty: string | null;
}

export interface UserStats {
  suiAddress: string;
  txCount: number;
  pricedCount: number;
  usdVolume: number;
  sendCount: number;
  swapCount: number;
  lastTxAt: string | null;
  addressCount: number;
}

/**
 * Record a sign-in.
 *
 * An upsert, because this runs on every sign-in and every dashboard load: the first one creates the
 * account, the rest only move `last_seen`. `first_seen` is never touched on conflict — it is the one
 * fact about a user that a later visit cannot improve on.
 *
 * Email and name use COALESCE so a session that happens to lack them cannot blank out what an earlier
 * one supplied. The alternative — plain assignment — turns one profile-less token into permanent data
 * loss.
 */
export async function upsertUser(
  suiAddress: string,
  email: string | null,
  name: string | null
): Promise<boolean> {
  const res = await dbQuery(
    `INSERT INTO users (sui_address, email, name)
          VALUES ($1, $2, $3)
     ON CONFLICT (sui_address) DO UPDATE
             SET last_seen = now(),
                 email     = COALESCE(EXCLUDED.email, users.email),
                 name      = COALESCE(EXCLUDED.name, users.name)`,
    [suiAddress, email, name]
  );
  return res !== null;
}

/**
 * Record the addresses a user's dWallets derive.
 *
 * One statement for the whole set rather than a loop of inserts: address discovery yields a dozen chains
 * at once, and a dozen round trips to price a page load is a dozen chances to be slow. `unnest` expands
 * three parallel arrays into rows, so the entire batch is still a single parameterised query.
 *
 * ON CONFLICT touches `address` as well as `last_seen`, because a re-derivation can legitimately produce
 * a different address for a chain — a user who creates a new dWallet of the same curve. The row tracks
 * the account's CURRENT address for that chain, not a history of them.
 */
export async function upsertAddresses(
  suiAddress: string,
  addresses: readonly DerivedAddress[]
): Promise<number> {
  if (addresses.length === 0) return 0;

  const res = await dbQuery(
    `INSERT INTO user_addresses (sui_address, chain, address, curve)
          SELECT $1, chain, address, curve
            FROM unnest($2::text[], $3::text[], $4::text[]) AS t(chain, address, curve)
     ON CONFLICT (sui_address, chain) DO UPDATE
             SET address   = EXCLUDED.address,
                 curve     = COALESCE(EXCLUDED.curve, user_addresses.curve),
                 last_seen = now()`,
    [
      suiAddress,
      addresses.map((a) => a.chain),
      addresses.map((a) => a.address),
      addresses.map((a) => a.curve),
    ]
  );
  return res ? addresses.length : 0;
}

/**
 * Record an outbound transaction.
 *
 * The user upsert is folded in as a CTE rather than run as a separate statement. `transactions` has a
 * foreign key to `users`, and the ordering hazard is real: a user can broadcast before any code path has
 * written their row (a swap on a fresh session, discovery still in flight), and a bare insert would then
 * fail the constraint and lose the transaction. Doing both in one statement makes it one round trip and
 * one atomic unit — there is no window in which the row exists without its owner.
 *
 * Returns false for a duplicate as well as for an outage. That is fine, and the reason nothing is built
 * on the return value: the caller is fire-and-forget, and "already recorded" is a success from every
 * perspective that matters.
 */
export async function insertTransaction(
  suiAddress: string,
  email: string | null,
  name: string | null,
  tx: TransactionRecord
): Promise<boolean> {
  const res = await dbQuery(
    `WITH owner AS (
       INSERT INTO users (sui_address, email, name)
            VALUES ($1, $2, $3)
       ON CONFLICT (sui_address) DO UPDATE
               SET last_seen = now(),
                   email     = COALESCE(EXCLUDED.email, users.email),
                   name      = COALESCE(EXCLUDED.name, users.name)
         RETURNING sui_address
     )
     INSERT INTO transactions (sui_address, kind, chain, symbol, amount, usd_value, tx_hash, counterparty)
          SELECT owner.sui_address, $4, $5, $6, $7::numeric, $8::numeric, $9, $10
            FROM owner
     ON CONFLICT DO NOTHING
       RETURNING id`,
    [
      suiAddress,
      email,
      name,
      tx.kind,
      tx.chain,
      tx.symbol,
      tx.amount,
      tx.usdValue,
      tx.txHash,
      tx.counterparty,
    ]
  );
  return (res?.rowCount ?? 0) > 0;
}

/**
 * A user's own totals.
 *
 * Reads the `user_volume` view so the definition of volume lives in exactly one place — a second copy of
 * this arithmetic inlined here is how a dashboard and an admin report end up disagreeing about the same
 * number. Null means the database had nothing to say; an unknown address returns zeroes, because a
 * signed-in user who has never transacted is a legitimate state and not an error.
 */
export async function readUserStats(suiAddress: string): Promise<UserStats | null> {
  const res = await dbQuery<{
    tx_count: string;
    priced_count: string;
    usd_volume: string;
    send_count: string;
    swap_count: string;
    last_tx_at: Date | null;
    address_count: string;
  }>(
    `SELECT v.tx_count,
            v.priced_count,
            v.usd_volume,
            v.send_count,
            v.swap_count,
            v.last_tx_at,
            (SELECT count(*) FROM user_addresses a WHERE a.sui_address = $1) AS address_count
       FROM user_volume v
      WHERE v.sui_address = $1`,
    [suiAddress]
  );
  if (!res) return null;

  const row = res.rows[0];
  if (!row) {
    return {
      suiAddress,
      txCount: 0,
      pricedCount: 0,
      usdVolume: 0,
      sendCount: 0,
      swapCount: 0,
      lastTxAt: null,
      addressCount: 0,
    };
  }

  /**
   * `count` and `numeric` both arrive as strings.
   *
   * `pg` does that deliberately — a bigint or an arbitrary-precision numeric can hold values a JS number
   * cannot represent exactly, so the driver refuses to lose precision on your behalf. These particular
   * columns are small enough to convert safely, and the API's callers want numbers.
   */
  return {
    suiAddress,
    txCount: Number(row.tx_count),
    pricedCount: Number(row.priced_count),
    usdVolume: Number(row.usd_volume),
    sendCount: Number(row.send_count),
    swapCount: Number(row.swap_count),
    lastTxAt: row.last_tx_at ? row.last_tx_at.toISOString() : null,
    addressCount: Number(row.address_count),
  };
}

/** Totals across every account. For an admin view or a health check, never for a signed-in user's page. */
export async function readOverallVolume(): Promise<{
  users: number;
  txCount: number;
  usdVolume: number;
} | null> {
  const res = await dbQuery<{ users: string; tx_count: string; usd_volume: string }>(
    `SELECT count(*)                    AS users,
            coalesce(sum(tx_count), 0)  AS tx_count,
            coalesce(sum(usd_volume), 0) AS usd_volume
       FROM user_volume`
  );
  const row = res?.rows[0];
  if (!row) return null;
  return {
    users: Number(row.users),
    txCount: Number(row.tx_count),
    usdVolume: Number(row.usd_volume),
  };
}
