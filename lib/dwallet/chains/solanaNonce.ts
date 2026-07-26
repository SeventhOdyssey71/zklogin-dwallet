'use client';

/**
 * Durable nonces for Solana, so a signature that takes ~13s cannot expire before it lands.
 *
 * THE PROBLEM THIS REMOVES
 * ------------------------
 * A normal Solana transaction commits to a `recent_blockhash` that is valid for ~150 slots (~60-90s).
 * Signing here takes ~13s, which is a race the wallet was managing rather than winning: the transaction was
 * built as late as possible, rebuilt if the presignature took over 5s, and broadcast with
 * `skipPreflight: true` when the blockhash had expired anyway (the signature stays valid — only simulation
 * fails). All of that is scaffolding around a deadline.
 *
 * A durable nonce replaces the blockhash with a value stored in an account we own. It does not expire. A
 * transaction signed against it stays valid until it lands, or until we advance the nonce ourselves. The
 * 13s stops being a deadline and becomes just latency.
 *
 * WHY `createNonceAccountWithSeed` AND NOT `createNonceAccount`
 * ------------------------------------------------------------
 * This is the detail the whole feature turns on. `SystemProgram.createNonceAccount` generates a fresh
 * keypair for the nonce account, so the transaction needs TWO signatures — the funder's and the new
 * account's. We have exactly one key and physically cannot produce a second, so that path is unusable.
 *
 * `createNonceAccountWithSeed` derives the address from a base we already control, so the account is not a
 * signer and ONE signature covers everything. Measured on the compiled messages:
 *
 *     createNonceAccount          → numRequiredSignatures = 2   (unusable here)
 *     createNonceAccountWithSeed  → numRequiredSignatures = 1
 *
 * Deriving from our own address also makes the address deterministic, so there is no keypair to store and
 * nothing to lose. Incrementing the seed index yields further accounts if concurrent sends are ever needed.
 *
 * WHAT IT COSTS
 * -------------
 * A nonce account is 80 bytes, so rent-exemption is 1,447,680 lamports (~0.00145 SOL), verified against
 * mainnet. It is **recoverable** — `withdrawNonce` returns the full deposit. Using the nonce costs nothing
 * extra: `nonceAdvance` is one more instruction in a transaction already paying its 5,000-lamport fee.
 *
 * THE RULES THE RUNTIME ENFORCES
 * ------------------------------
 *   1. `nonceAdvance` MUST be instruction index 0 — the runtime looks for it at a fixed marker index, and
 *      anything before it means the transaction is treated as a normal one and rejected on an unknown
 *      blockhash. Passing `nonceInfo` to the `Transaction` constructor is what guarantees this, rather than
 *      adding the instruction by hand and hoping about ordering.
 *   2. The nonce account must be the first account of that instruction, and writable.
 *   3. The nonce authority must sign. We set it to our own address, which is also the fee payer, so the
 *      total is still one signature.
 *   4. One in-flight transaction per nonce account: landing one advances the nonce, which invalidates every
 *      other transaction signed against the old value.
 *   5. Failure semantics differ from a normal transaction, and it matters here. Failed *validation* (nonce
 *      already used, authority absent) drops the transaction with no fee and no state change. Passing
 *      validation but failing *execution* still advances the nonce and still charges the fee. So after any
 *      failure the nonce must be re-read before rebuilding — never reused from memory.
 */

import {
  Connection,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';

/**
 * Seed for the derived nonce account.
 *
 * Versioned so a future change of scheme derives a different account rather than colliding with one that
 * already holds rent. The index leaves room for additional accounts if concurrent sends are ever wanted.
 */
export const NONCE_SEED = 'ycos-nonce-v1-0';

/** Rent-exempt minimum for an 80-byte nonce account. Verified against mainnet: 1,447,680 lamports. */
export const NONCE_ACCOUNT_LAMPORTS = 1_447_680;

export interface DurableNonce {
  /** The nonce account's address. */
  account: PublicKey;
  /** The stored nonce, used in place of a recent blockhash. */
  nonce: string;
  /** The `nonceAdvance` instruction that must lead the transaction. */
  advanceInstruction: TransactionInstruction;
}

/**
 * The nonce account address for an owner.
 *
 * Pure and deterministic — same owner, same address, forever. Nothing to persist.
 */
export async function deriveNonceAccount(owner: PublicKey): Promise<PublicKey> {
  return PublicKey.createWithSeed(owner, NONCE_SEED, SystemProgram.programId);
}

/**
 * Read the live nonce, or null when the account does not exist or is not a usable nonce account.
 *
 * Always read fresh. Caching the nonce is precisely the bug rule 5 above warns about: a failed execution
 * advances it, so a remembered value produces a transaction the runtime silently drops.
 */
export async function readDurableNonce(
  connection: Connection,
  owner: PublicKey
): Promise<DurableNonce | null> {
  const account = await deriveNonceAccount(owner);
  const info = await connection.getAccountInfo(account, 'confirmed');
  if (!info) return null;

  // Guard the shape before trusting it: an account at this address that is not owned by the System Program,
  // or is the wrong size, is not a nonce account and would fail deep inside `NonceAccount.fromAccountData`.
  if (!info.owner.equals(SystemProgram.programId) || info.data.length !== NONCE_ACCOUNT_LENGTH) {
    return null;
  }

  let parsed: NonceAccount;
  try {
    parsed = NonceAccount.fromAccountData(info.data);
  } catch {
    return null;
  }

  /**
   * An uninitialised nonce account reads as an all-zero authority and nonce. Using it would build a
   * transaction the runtime rejects, so treat it as absent — the caller falls back to a recent blockhash.
   */
  if (!parsed.nonce || parsed.nonce === PublicKey.default.toBase58()) return null;

  // The authority must be us, or we cannot sign the advance.
  if (!new PublicKey(parsed.authorizedPubkey).equals(owner)) return null;

  return {
    account,
    nonce: parsed.nonce,
    advanceInstruction: SystemProgram.nonceAdvance({
      noncePubkey: account,
      authorizedPubkey: owner,
    }),
  };
}

/**
 * A one-signature transaction that creates the nonce account.
 *
 * Needs a recent blockhash, since the account it is creating does not exist yet — this is the one Solana
 * transaction in the wallet that cannot itself be durable. Its `numRequiredSignatures` is 1 because the
 * account is derived from `owner` rather than a fresh keypair.
 */
export async function buildCreateNonceAccountTransaction(
  connection: Connection,
  owner: PublicKey
): Promise<{ transaction: Transaction; account: PublicKey; lamports: number }> {
  const account = await deriveNonceAccount(owner);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({
    feePayer: owner,
    blockhash,
    lastValidBlockHeight,
  }).add(
    ...SystemProgram.createNonceAccount({
      fromPubkey: owner,
      noncePubkey: account,
      authorizedPubkey: owner,
      lamports: NONCE_ACCOUNT_LAMPORTS,
      basePubkey: owner,
      seed: NONCE_SEED,
    }).instructions
  );

  return { transaction, account, lamports: NONCE_ACCOUNT_LAMPORTS };
}

/**
 * A transaction that closes the nonce account and returns its rent.
 *
 * Included because the deposit being recoverable is part of what makes the one-time cost reasonable, and a
 * feature that takes funds with no way back is not one we should ship.
 */
export async function buildWithdrawNonceTransaction(
  connection: Connection,
  owner: PublicKey
): Promise<Transaction> {
  const account = await deriveNonceAccount(owner);
  const info = await connection.getAccountInfo(account, 'confirmed');
  if (!info) throw new Error('No nonce account to close.');

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  return new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(
    SystemProgram.nonceWithdraw({
      noncePubkey: account,
      authorizedPubkey: owner,
      toPubkey: owner,
      lamports: info.lamports,
    })
  );
}
