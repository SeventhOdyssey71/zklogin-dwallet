'use client';

/**
 * Validate a recipient address for a given chain, before anything is spent.
 *
 * WHY THIS EXISTS
 * ---------------
 * The send flow had no recipient validation at all. A malformed address — or, far more likely, a
 * perfectly valid address for the *wrong chain* — was accepted, and the mistake only surfaced after the
 * MPC signing round had already been paid for (~0.02 SUI + 0.12 IKA) and, on some chains, after the
 * transaction had been broadcast. Pasting an Ethereum address into a Solana send is an ordinary slip,
 * and on a monochrome UI where every chain's row looks alike it is an easy one to make.
 *
 * The checks below decode the real encodings rather than pattern-matching lengths: an EIP-55 checksum, a
 * base58 decode to an on-curve ed25519 point, bech32/bech32m with the right prefix. A regex would happily
 * accept a transposed character and send funds to an address nobody controls.
 *
 * Validators are async and load their crypto libraries on demand — the Solana and Bitcoin libraries are
 * large, and a wallet sending on Base should not pay to parse them. Imports are cached by the bundler
 * after first use, so per-keystroke validation stays instant.
 */

import { CHAIN_BY_ID } from '@/lib/config/chainRegistry';

export interface AddressCheck {
  valid: boolean;
  /** Human-readable explanation when invalid. Absent for an empty input. */
  reason?: string;
}

const ok: AddressCheck = { valid: true };
const bad = (reason: string): AddressCheck => ({ valid: false, reason });

/** Shared: catches the single most common mistake — an EVM address pasted into a non-EVM send. */
function looksLikeEvm(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

/** EVM: 20 bytes of hex, with the EIP-55 checksum enforced whenever the address is mixed-case. */
async function checkEvm(address: string): Promise<AddressCheck> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return bad(
      address.startsWith('0x')
        ? 'An EVM address is 0x followed by exactly 40 hex characters.'
        : 'An EVM address must start with 0x.'
    );
  }
  // A mixed-case address carries an EIP-55 checksum, so a mistyped character is detectable. An
  // all-lowercase or all-uppercase address has no checksum to verify and is accepted as-is.
  const body = address.slice(2);
  if (body !== body.toLowerCase() && body !== body.toUpperCase()) {
    const { getAddress } = await import('ethers');
    try {
      getAddress(address);
    } catch {
      return bad('This address fails its EIP-55 checksum — a character is likely mistyped.');
    }
  }
  return ok;
}

/** Solana: base58, 32 bytes, and a valid ed25519 curve point. */
async function checkSolana(address: string): Promise<AddressCheck> {
  if (looksLikeEvm(address)) return bad('That is an EVM address — this is a Solana send.');
  const { PublicKey } = await import('@solana/web3.js');
  try {
    const key = new PublicKey(address);
    // A well-formed 32-byte base58 string can still be off-curve, and funds sent there are
    // unrecoverable, so this check is not pedantry.
    if (!PublicKey.isOnCurve(key.toBytes())) {
      return bad('Not a usable Solana account — this key is off-curve.');
    }
    return ok;
  } catch {
    return bad('Not a valid Solana address (expected 32 bytes of base58).');
  }
}

/** Bitcoin: whatever the signer library can decode is exactly what we can pay to. */
async function checkBitcoin(address: string): Promise<AddressCheck> {
  if (looksLikeEvm(address)) return bad('That is an EVM address — this is a Bitcoin send.');
  const btc = await import('@scure/btc-signer');
  try {
    // Authoritative by construction: this is the same decoder used to build the output script, so
    // anything it accepts is spendable and anything it rejects would fail at build time anyway.
    btc.Address().decode(address);
    return ok;
  } catch {
    if (/^(tb1|bcrt1)/.test(address) || /^[mn2][1-9A-HJ-NP-Za-km-z]{25,}$/.test(address)) {
      return bad('That is a Bitcoin testnet address; this wallet is on mainnet.');
    }
    return bad('Not a valid Bitcoin address (expected bc1…, 1… or 3…).');
  }
}

/** Cardano: bech32 `addr1…` (Shelley). Length varies, so the prefix and checksum are what matter. */
async function checkCardano(address: string): Promise<AddressCheck> {
  if (address.startsWith('addr_test1')) {
    return bad('That is a Cardano testnet address; this wallet is on mainnet.');
  }
  if (!address.startsWith('addr1')) {
    return bad(
      address.startsWith('stake1')
        ? 'That is a stake address, not a payment address.'
        : 'A Cardano payment address starts with addr1.'
    );
  }
  const { bech32 } = await import('bech32');
  try {
    // Cardano addresses exceed bech32's default 90-character limit, so the cap must be raised.
    bech32.decode(address, 200);
    return ok;
  } catch {
    return bad('This Cardano address fails its bech32 checksum.');
  }
}

/**
 * NEAR: a 64-character hex implicit account, or a named account.
 *
 * Named accounts can only be checked syntactically: whether `alice.near` exists is a network question,
 * and NEAR permits transfers to accounts that do not exist yet.
 */
async function checkNear(address: string): Promise<AddressCheck> {
  if (/^[0-9a-f]{64}$/.test(address)) return ok;
  const named = /^(?=.{2,64}$)[a-z\d]+([-_.][a-z\d]+)*$/.test(address);
  return named
    ? ok
    : bad('Expected a NEAR account (like alice.near) or a 64-character implicit address.');
}

/**
 * Validate `address` as a recipient on `chain`.
 *
 * An empty address is invalid but carries no reason, so the UI can stay quiet until the user has actually
 * typed something instead of shouting at an empty field.
 */
export async function validateAddress(chain: string, address: string): Promise<AddressCheck> {
  const trimmed = address.trim();
  if (!trimmed) return { valid: false };

  const def = CHAIN_BY_ID[chain];
  if (!def) return bad(`Unknown chain: ${chain}`);
  if (def.family === 'evm') return checkEvm(trimmed);

  switch (chain) {
    case 'Solana':
      return checkSolana(trimmed);
    case 'Bitcoin':
      return checkBitcoin(trimmed);
    case 'Cardano':
      return checkCardano(trimmed);
    case 'NEAR':
      return checkNear(trimmed);
    default:
      // Allowing an unrecognised chain through beats blocking a valid send on a missing rule.
      return ok;
  }
}
