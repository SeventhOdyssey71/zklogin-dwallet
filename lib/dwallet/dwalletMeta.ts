'use client';

/**
 * Cached, immutable per-dWallet facts.
 *
 * Every send re-derived the same four things from scratch:
 *
 *   1. the dWallet object                              (1 RPC)
 *   2. its public key, via wasm `publicKeyFromDWalletOutput`
 *   3. the target-chain address derived from that key
 *   4. the id of the encrypted user share              (3 sequential RPCs — see below)
 *
 * None of them can change for an Active dWallet: the public key is fixed at DKG, the address is a pure
 * function of the key and chain, and the share id is written once. So paying ~1.1s of round-trips for
 * them on every single transfer was pure waste.
 *
 * The share id was the worst of it — `encrypted_user_secret_key_shares` is an ObjectTable, so reading
 * it means `getDynamicFields` → `getDynamicFieldObject` → `getEncryptedUserSecretKeyShare`, three
 * strictly sequential round-trips (~640ms measured) for a value that never changes.
 *
 * Cached in `sessionStorage`: none of it is secret (all of it is readable on chain by anyone), but
 * scoping it to the tab keeps a shared machine clean, and it means a stale entry cannot outlive a
 * sign-out. Anything unreadable is silently re-derived, so a bad cache can never break access.
 */

import { Curve } from '@ika.xyz/sdk';
import type { AppSuiClient } from '@/lib/sui/client';
import { getIkaClient } from '@/lib/ika/ikaClient';

/** Bumped if the derivation or stored shape changes. */
const CACHE_VERSION = 'v1';

export interface DWalletMeta {
  /** `0x`-prefixed public key from the dWallet's DKG output. */
  publicKeyHex: string;
  /** Address on the requested chain, derived from that public key. */
  address: string;
  /** Object id of the encrypted user secret key share, if the dWallet has one. */
  encryptedShareId?: string;
  /** The network encryption key the dWallet belongs to (needed to buy presignatures). */
  networkEncryptionKeyId: string;
  /** True for imported-key dWallets, which use a different approve/sign pair. */
  isImportedKey: boolean;
  /** True when the user share is public on chain, so no encrypted share is needed. */
  isShared: boolean;
}

const memory = new Map<string, DWalletMeta>();

const keyFor = (dwalletId: string, chain: string) =>
  `ika.dwmeta.${CACHE_VERSION}.${dwalletId}.${chain}`;

function readCache(k: string): DWalletMeta | null {
  const hit = memory.get(k);
  if (hit) return hit;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(k);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DWalletMeta;
    if (!parsed?.publicKeyHex || !parsed?.address) return null;
    memory.set(k, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(k: string, meta: DWalletMeta): void {
  memory.set(k, meta);
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(k, JSON.stringify(meta));
  } catch {
    // Quota or private-mode failure just means we re-derive next time.
  }
}

/** Drop cached metadata — used on sign-out. */
export function clearDWalletMeta(): void {
  memory.clear();
  if (typeof window === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k?.startsWith('ika.dwmeta.')) doomed.push(k);
    }
    for (const k of doomed) window.sessionStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Resolve (and cache) everything the signing path needs to know about a dWallet.
 *
 * `dWallet` may be passed in when the caller already has it, to avoid a duplicate fetch.
 */
export async function getDWalletMeta(params: {
  suiClient: AppSuiClient;
  dwalletId: string;
  chain: string;
  curve: Curve;
  /** Already-fetched dWallet object, if the caller has one. */
  dWallet?: unknown;
}): Promise<DWalletMeta> {
  const { suiClient, dwalletId, chain, curve } = params;
  const cacheKey = keyFor(dwalletId, chain);

  const cached = readCache(cacheKey);
  if (cached) return cached;

  const ikaClient = await getIkaClient(suiClient);
  const dWallet = (params.dWallet ?? (await ikaClient.getDWallet(dwalletId))) as Record<
    string,
    unknown
  > & { state: { $kind?: string; Active?: { public_output?: number[] } } };

  if (dWallet.state?.$kind !== 'Active') {
    throw new Error(
      `dWallet is not Active (state: ${dWallet.state?.$kind ?? 'unknown'}). It cannot sign yet.`
    );
  }

  const pubOutput = dWallet.state.Active?.public_output;
  if (!pubOutput || !Array.isArray(pubOutput)) {
    throw new Error('dWallet has no public output — it is not activated.');
  }

  const { publicKeyFromDWalletOutput } = await import('@ika.xyz/sdk');
  const publicKey = await publicKeyFromDWalletOutput(curve, Uint8Array.from(pubOutput));
  const publicKeyHex = '0x' + Buffer.from(publicKey).toString('hex');

  const address = await deriveAddress({ chain, curve, publicKey, publicKeyHex });

  const isImportedKey = dWallet.is_imported_key_dwallet === true;
  const publicShare = dWallet.public_user_secret_key_share;
  const isShared =
    dWallet.kind === 'shared' || (publicShare !== undefined && publicShare !== null);

  let encryptedShareId: string | undefined;
  if (!isShared && !isImportedKey) {
    encryptedShareId = await findEncryptedShareId(suiClient, dWallet);
  }

  const meta: DWalletMeta = {
    publicKeyHex,
    address,
    encryptedShareId,
    networkEncryptionKeyId: String(dWallet.dwallet_network_encryption_key_id ?? ''),
    isImportedKey,
    isShared,
  };
  writeCache(cacheKey, meta);
  return meta;
}

/** Derive the chain's address from the dWallet public key. */
async function deriveAddress(params: {
  chain: string;
  curve: Curve;
  publicKey: Uint8Array;
  publicKeyHex: string;
}): Promise<string> {
  const { chain, curve, publicKey, publicKeyHex } = params;

  if (curve === Curve.SECP256K1) {
    if (chain === 'Bitcoin') {
      // Taproot P2TR (bc1p…) from the x-only key.
      const { deriveBitcoinAddress } = await import('../utils/deriveAddresses');
      return deriveBitcoinAddress(publicKeyHex);
    }
    // Every EVM chain shares one address, so the derivation is chain-independent here.
    const { computeAddress, SigningKey } = await import('ethers');
    let uncompressed: string;
    if (publicKey.length === 33) {
      uncompressed = SigningKey.computePublicKey(publicKeyHex, false);
    } else if (publicKey.length === 64) {
      uncompressed = '0x04' + publicKeyHex.slice(2);
    } else if (publicKey.length === 65) {
      uncompressed = publicKeyHex;
    } else {
      throw new Error(`Unexpected secp256k1 public key length: ${publicKey.length} bytes`);
    }
    return computeAddress(uncompressed);
  }

  if (curve === Curve.ED25519) {
    if (publicKey.length !== 32) {
      throw new Error(`Unexpected ED25519 public key length: ${publicKey.length} bytes (expected 32)`);
    }
    if (chain === 'Solana') {
      const { PublicKey } = await import('@solana/web3.js');
      return new PublicKey(publicKey).toBase58();
    }
    const derive = await import('../utils/deriveAddresses');
    if (chain === 'Polkadot') return derive.derivePolkadotAddress(publicKeyHex);
    if (chain === 'Cardano') return derive.deriveCardanoAddress(publicKeyHex);
    if (chain === 'NEAR') return derive.deriveNearAddress(publicKeyHex);
    throw new Error(`Unsupported ED25519 chain: ${chain}`);
  }

  /**
   * Ristretto — Polkadot's native sr25519/Schnorrkel curve.
   *
   * This branch was missing, so `getDWalletMeta` threw for the Schnorrkel dWallet. It surfaced only as a
   * swallowed "pre-decryption skipped" warning, which then pushed the send onto the slower inline path —
   * so Polkadot appeared to work while quietly losing the optimisation, and would have failed outright
   * once inline decryption started needing the same parameters. SS58 encodes the 32-byte public key
   * directly, exactly as for the ed25519 account.
   */
  if (publicKey.length !== 32) {
    throw new Error(`Unexpected ristretto public key length: ${publicKey.length} bytes (expected 32)`);
  }
  if (chain === 'Polkadot') {
    const { derivePolkadotAddress } = await import('../utils/deriveAddresses');
    return derivePolkadotAddress(publicKeyHex);
  }

  throw new Error(`Unsupported chain ${chain} for curve ${String(curve)}`);
}

/**
 * Find the encrypted user share id in the dWallet's `encrypted_user_secret_key_shares` ObjectTable.
 *
 * The SDK parses the table as `{ id: "0x…", size: "1" }` — `id` is a plain STRING, not `{ id: { id } }`.
 * Reading `.id?.id` yielded undefined, so the table was never found and signing silently proceeded
 * without the user share. Both shapes are accepted so a future SDK change can't quietly break it.
 */
async function findEncryptedShareId(
  suiClient: AppSuiClient,
  dWallet: Record<string, unknown>
): Promise<string | undefined> {
  const shares = dWallet.encrypted_user_secret_key_shares as
    | { id?: string | { id?: string } }
    | undefined;
  const tableId = typeof shares?.id === 'string' ? shares.id : shares?.id?.id;
  if (!tableId) {
    console.warn('[dwallet] no encrypted_user_secret_key_shares table found');
    return undefined;
  }

  const fields = await suiClient.getDynamicFields({ parentId: tableId });
  if (fields.data.length === 0) return undefined;

  const fieldObject = await suiClient.getDynamicFieldObject({
    parentId: tableId,
    name: fields.data[0].name,
  });
  return fieldObject.data?.objectId;
}
