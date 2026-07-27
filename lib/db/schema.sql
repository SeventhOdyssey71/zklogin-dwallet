-- The wallet's durable record: who signed in, which addresses their dWallets derive, and what moved.
--
-- IDEMPOTENT BY CONSTRUCTION
-- --------------------------
-- Every statement here is `IF NOT EXISTS` or `CREATE OR REPLACE`, so this file is the schema rather than
-- a one-shot migration: running it against a fresh database creates everything, running it against a
-- live one is a no-op. That is what lets `scripts/migrate.mjs` be safe to run on every deploy without a
-- migrations table or a version counter to get out of step.
--
-- Adding a column later means adding an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` line at the bottom,
-- not editing a `CREATE TABLE` above — an edited CREATE never runs again on a database that already has
-- the table, so the change would silently apply to new environments only.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- Keyed by the zkLogin Sui address because that IS the account: it is derived deterministically from the
-- Google subject plus the salt, so the same person signing in on a new device lands on the same row.
-- Email and name are conveniences carried over from the OIDC token and may be absent; neither is an
-- identifier, and neither is trusted for authorization anywhere.
CREATE TABLE IF NOT EXISTS users (
  sui_address text PRIMARY KEY,
  email       text,
  name        text,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- user_addresses
-- ---------------------------------------------------------------------------
-- The per-chain addresses derived from a user's Ika dWallets. One row per (account, chain).
--
-- The uniqueness is on (sui_address, chain) and NOT on the address itself: an account has exactly one
-- address per chain, but the same derived address legitimately appears on several chains — every EVM
-- chain shares one secp256k1 address, so a unique constraint on `address` would reject Base the moment
-- Ethereum was recorded.
--
-- `curve` is stored as its name rather than the on-chain integer so the table reads without a decoder
-- ring; the API does the mapping on the way in.
CREATE TABLE IF NOT EXISTS user_addresses (
  id          bigserial PRIMARY KEY,
  sui_address text NOT NULL REFERENCES users (sui_address) ON DELETE CASCADE,
  chain       text NOT NULL,
  address     text NOT NULL,
  curve       text,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sui_address, chain)
);

CREATE INDEX IF NOT EXISTS user_addresses_sui_address_idx ON user_addresses (sui_address);

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
-- Outbound value only — sends and swaps. Receives are deliberately absent: the wallet detects deposits
-- from a balance increase rather than indexing them, so it knows an amount arrived but not in which
-- transaction, and a volume figure built on inferred rows would be a guess presented as a number.
--
-- `amount` is `numeric`, unconstrained, and written from the decimal string the user saw. Unconstrained
-- because the scale differs per chain (8 for Bitcoin, 18 for EVM) and a fixed one would reject the other;
-- numeric rather than double precision because these are exact quantities of money and binary floating
-- point cannot represent 0.1.
--
-- `usd_value` is nullable and means "not priced", never "zero". Only the chain's gas token can be priced
-- server-side from the shared CoinGecko cache, so a transfer of some arbitrary Sui coin type records the
-- amount and leaves the valuation empty rather than inventing one.
CREATE TABLE IF NOT EXISTS transactions (
  id           bigserial PRIMARY KEY,
  sui_address  text NOT NULL REFERENCES users (sui_address) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('send', 'swap')),
  chain        text NOT NULL,
  symbol       text NOT NULL,
  amount       numeric NOT NULL,
  usd_value    numeric,
  tx_hash      text,
  counterparty text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_sui_address_idx ON transactions (sui_address);

-- Descending: every query that touches time wants the most recent rows.
CREATE INDEX IF NOT EXISTS transactions_created_at_idx ON transactions (created_at DESC);

-- Idempotency for writes, not just for reads.
--
-- The client posts fire-and-forget and retries nothing, but a component that re-renders or a user who
-- refreshes mid-flight can post the same broadcast twice. (chain, tx_hash) is what makes a transaction
-- unique on-chain, so the second insert is dropped by ON CONFLICT instead of doubling the volume figure.
-- Partial, because a row without a hash is not a duplicate of every other hashless row.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_chain_tx_hash_key
  ON transactions (chain, tx_hash)
  WHERE tx_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- user_volume
-- ---------------------------------------------------------------------------
-- Volume per user, and — by summing this view — overall.
--
-- A LEFT JOIN so a user who has signed in but not yet transacted appears with zero rather than vanishing;
-- "how many accounts have never sent anything" is exactly the question this table exists to answer.
--
-- `usd_volume` sums only the rows that could be priced, so it is a floor, not a total. `priced_count`
-- against `tx_count` is what tells you how much of the ledger that floor actually covers — without it a
-- low number is indistinguishable from a quiet week.
CREATE OR REPLACE VIEW user_volume AS
SELECT
  u.sui_address,
  u.email,
  u.name,
  u.first_seen,
  u.last_seen,
  count(t.id)                                        AS tx_count,
  count(t.usd_value)                                 AS priced_count,
  coalesce(sum(t.usd_value), 0)                      AS usd_volume,
  count(t.id) FILTER (WHERE t.kind = 'send')         AS send_count,
  count(t.id) FILTER (WHERE t.kind = 'swap')         AS swap_count,
  max(t.created_at)                                  AS last_tx_at
FROM users u
LEFT JOIN transactions t ON t.sui_address = u.sui_address
GROUP BY u.sui_address, u.email, u.name, u.first_seen, u.last_seen;
