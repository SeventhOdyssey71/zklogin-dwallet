/**
 * Full zero-trust dWallet creation (DKG), batched across every Ika curve.
 *
 * Implements the canonical Ika flow proven in the SDK integration tests:
 *   prepareDKGAsync → registerEncryptionKey + requestDWalletDKG (tx #1)
 *   → wait AwaitingKeyHolderSignature → acceptEncryptedUserShare (tx #2) → wait Active
 *
 * CRITICAL: acceptEncryptedUserShare must reuse the EXACT `userPublicOutput` from prepareDKGAsync.
 * It is verified cryptographically against the on-chain output (`userAndNetworkDKGOutputMatch`), so a
 * regenerated output always fails with "User public output does not match the DWallet public output".
 * We keep it in memory and chain straight into accept — no localStorage round-trip, no regeneration.
 *
 * `createBothDWallets` is the only entry point; pass `skip` to create a subset. A separate
 * single-curve function used to exist and resolved the encrypted-share id by parsing the DKG event —
 * which never worked (see the note on `shareByDWallet`) — so it was removed rather than left as a
 * second copy of the same bug.
 */

import { Transaction } from '@mysten/sui/transactions';
import {
  IkaClient,
  IkaTransaction,
  Curve,
  prepareDKGAsync,
  createRandomSessionIdentifier,
  publicKeyFromDWalletOutput,
} from '@ika.xyz/sdk';
import { ethers } from 'ethers';
import type { AppSuiClient } from '@/lib/sui/client';
import { prepareIkaFeeCoin } from '@/lib/ika/ikaFee';
import { getIkaClient } from '@/lib/ika/ikaClient';
import { getShareEncryptionKeys } from '@/lib/ika/shareKeys';

/**
 * A dWallet kind is really just "which Ika curve".
 *
 * Ika exposes four on mainnet, all pool-served under 2PC-MPC v4. Three are wired up here:
 *   ECDSA      secp256k1  → Bitcoin + every EVM chain (Ethereum, Base, Arbitrum, OP, Polygon,
 *                             Avalanche, BSC, Linea, Scroll)
 *   EdDSA      ed25519    → Solana, NEAR, Cardano
 *   Schnorrkel ristretto  → Polkadot / Substrate with its NATIVE sr25519 scheme
 *
 * SECP256R1 (P-256) is the fourth. It is live and pool-served, but no chain this app targets uses
 * it natively — it is the WebAuthn/passkey curve, and on-chain its main use is Sui's own secp256r1
 * accounts. It is intentionally omitted rather than shipped as a wallet with no chains behind it.
 */
// Re-exported so existing imports keep working; defined in `./curves`, which has no dependencies and
// can therefore be imported without pulling this module's ethers/SDK weight into the page bundle.
export type { DWalletKind } from './curves';
export { ALL_KINDS } from './curves';
import { ALL_KINDS, type DWalletKind } from './curves';
import { ensureProtocolPublicParameters } from '@/lib/ika/protocolParams';

/**
 * dWallet state polling.
 *
 * The DKG rounds are network-bound (real MPC across 100+ validators), not client-bound, so this is
 * a genuine wait rather than dead time — but 2s granularity meant routinely overshooting completion
 * by a second or two. 400ms tracks it closely without hammering the RPC.
 */
const STATE_POLL = { timeout: 300000, interval: 400 } as const;

export type CreateStep =
  | 'init'
  | 'prepare'
  | 'request'
  | 'awaiting-network'
  | 'accept'
  | 'activating'
  | 'done';

export interface CreatedDWallet {
  dwalletId: string;
  dwalletCapId: string;
  curve: DWalletKind;
  publicKey: string;
  /** Primary derived address (ETH for ECDSA, Solana for EdDSA). */
  address: string;
}

/** Minimal base58 (Bitcoin alphabet) encoder — a Solana address is its 32-byte pubkey in base58. */
function base58Encode(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = '';
  for (let k = 0; bytes[k] === 0 && k < bytes.length - 1; k++) result += '1';
  for (let q = digits.length - 1; q >= 0; q--) result += ALPHABET[digits[q]];
  return result;
}

/** Ika curve for each dWallet kind. */
export const CURVE_FOR: Record<DWalletKind, Curve> = {
  ECDSA: Curve.SECP256K1,
  EdDSA: Curve.ED25519,
  Schnorrkel: Curve.RISTRETTO,
};

/** Move curve discriminants, as read from the coordinator's on-chain config. */
export const CURVE_NUMBER: Record<DWalletKind, number> = {
  ECDSA: 0,
  EdDSA: 2,
  Schnorrkel: 3,
};

/**
 * Curve name used in the encryption-seed formula.
 *
 * IMPORTANT: 'secp256k1' and 'ed25519' must keep their exact historical spellings — the seed is
 * derived from this string, so changing it would derive a different user share and orphan every
 * existing dWallet of that curve.
 */
const CURVE_SEED_NAME: Record<number, string> = {
  [Curve.SECP256K1 as unknown as number]: 'secp256k1',
  [Curve.ED25519 as unknown as number]: 'ed25519',
  [Curve.RISTRETTO as unknown as number]: 'ristretto',
};

/** Deterministic encryption seed — same formula across the app so the user share is recoverable. */
function deterministicSeed(suiAddress: string, curve: Curve): Uint8Array {
  const curveString = CURVE_SEED_NAME[curve as unknown as number] ?? String(curve);
  return ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(`ika-dwallet-${suiAddress}-${curveString}`)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Batched dual-curve creation
// ─────────────────────────────────────────────────────────────────────────────

// ── Narrow shapes for the loosely-typed RPC / SDK values this flow reads ──
/** `effects` comes back as BCS or JSON depending on the node; we only need the status. */
type TxStatus = { status?: { status?: string; error?: string } } | string | null | undefined;
const txFailed = (effects: TxStatus): string | null => {
  if (!effects || typeof effects === 'string') return null;
  return effects.status?.status === 'success' ? null : (effects.status?.error ?? 'transaction failed');
};

type CreatedObjectChange = { type: string; objectType?: string; objectId?: string };
type CapContent = { fields?: { dwallet_id?: string } };
type ActiveState = { Active?: { public_output?: number[] } };


/**
 * Create BOTH dWallets (ECDSA/secp256k1 + EdDSA/ed25519) in two transactions instead of four.
 *
 * A dWallet key lives on exactly one curve, so covering all nine chains needs two of them. Running
 * `createDWallet` twice costs 4 Sui transactions and 4 zkLogin signatures. The two DKGs are wholly
 * independent, so both can be batched into a single programmable transaction block, and likewise
 * both accepts:
 *
 *   tx #1  registerEncryptionKey(k1) + requestDWalletDKG(k1)
 *          registerEncryptionKey(ed) + requestDWalletDKG(ed)
 *   ── wait for both to reach AwaitingKeyHolderSignature (concurrently) ──
 *   tx #2  acceptEncryptedUserShare(k1) + acceptEncryptedUserShare(ed)
 *   ── wait for both Active (concurrently) ──
 *
 * Two details make this safe, both verified against the deployed mainnet package:
 *
 *  • `request_dwallet_dkg` and `register_encryption_key` take the IKA and SUI coins as
 *    `&mut Coin<T>`, not by value (checked via sui_getNormalizedMoveFunction). Fees are deducted
 *    through the mutable reference, so one coin object legitimately funds both calls in the same
 *    PTB. Were they by-value, the first call would consume the coin and the second would abort.
 *
 *  • Each curve needs its own `UserShareEncryptionKeys` (they are derived per-curve) and its own
 *    session identifier. Two `IkaTransaction` builders therefore wrap the *same* `Transaction`;
 *    they only append Move calls, so sharing the underlying tx is fine.
 *
 * The user approves 2 transactions instead of 4, and the two MPC DKGs proceed in parallel on the
 * network rather than one after the other.
 */
/** Every kind this app creates, in display order. */
export interface CreateBothParams {
  suiClient: AppSuiClient;
  account: { address: string };
  signAndExecuteAsync: (input: { transaction: Transaction }) => Promise<{ digest: string }>;
  onStatus?: (step: CreateStep, message: string) => void;
  /** Skip curves the account already has, so this is safe to re-run after a partial failure. */
  skip?: DWalletKind[];
}

export async function createBothDWallets(
  params: CreateBothParams
): Promise<CreatedDWallet[]> {
  const { suiClient, account, signAndExecuteAsync, onStatus, skip = [] } = params;
  const status = (step: CreateStep, message: string) => {
    console.log(`[${step}] ${message}`);
    onStatus?.(step, message);
  };

  const kinds: DWalletKind[] = ALL_KINDS.filter((k) => !skip.includes(k));
  if (kinds.length === 0) return [];

  status('init', 'Connecting to Ika mainnet…');
  const ikaClient = await getIkaClient(suiClient);

  status('prepare', `Preparing key generation for ${kinds.join(' + ')}…`);

  /**
   * Warm the protocol public parameters for every curve concurrently.
   *
   * These are ~44 MB *per curve* (genuinely different data — verified distinct lengths and hashes),
   * and `prepareDKGAsync` fetches them lazily. Left alone they download one after another inside the
   * per-curve work, so three curves serialise ~30s of transfer. Prewarming in parallel overlaps the
   * transfers instead. This only pays off now that key derivation is cached — previously the blocking
   * wasm keygen filled the same wall-clock either way.
   */
  const [latestNetworkKey] = await Promise.all([
    ikaClient.getLatestNetworkEncryptionKey(),
    /**
     * Routed through `ensureProtocolPublicParameters`, not called directly.
     *
     * The direct call throws at epoch 361+ because the shipped wasm cannot read the network's current
     * reconfiguration format, and the `.catch(() => undefined)` below only *looked* like it tolerated
     * that: `prepareDKGAsync` then fetches the parameters itself and hits the identical error, so
     * creation failed outright. The helper resolves them and primes the client's cache, which is what
     * makes that internal fetch succeed. See lib/ika/protocolParams.ts.
     */
    ...kinds.map((k) =>
      ensureProtocolPublicParameters(ikaClient, suiClient, undefined, CURVE_FOR[k]).catch(
        () => undefined
      )
    ),
  ]);

  // Per-curve crypto prep, in parallel — this is CPU/wasm work, not network-bound.
  const prepared = await Promise.all(
    kinds.map(async (kind) => {
      const curve = CURVE_FOR[kind];
      const sessionIdentifierBytes = createRandomSessionIdentifier();
      const userShareEncryptionKeys = await getShareEncryptionKeys({
        suiAddress: account.address,
        curve,
        rootSeed: deterministicSeed(account.address, curve),
      });
      const dkgRequestInput = await prepareDKGAsync(
        ikaClient,
        curve,
        userShareEncryptionKeys,
        sessionIdentifierBytes,
        account.address
      );
      // Only register the encryption key if it isn't already on chain.
      let needsRegistration = true;
      try {
        await ikaClient.getActiveEncryptionKey(userShareEncryptionKeys.getSuiAddress());
        needsRegistration = false;
      } catch {
        needsRegistration = true;
      }
      return {
        kind,
        curve,
        sessionIdentifierBytes,
        userShareEncryptionKeys,
        dkgRequestInput,
        needsRegistration,
      };
    })
  );

  // ── Transaction #1: both DKG requests in one PTB ──
  status('request', `Creating ${kinds.length} dWallets in one transaction — approve in your wallet…`);
  const tx = new Transaction();
  tx.setSender(account.address);
  const ikaFee = await prepareIkaFeeCoin({ tx, suiClient, owner: account.address });
  const ikaCoin = ikaFee.coin;

  for (const p of prepared) {
    // A separate builder per curve (each carries curve-specific encryption keys), same underlying tx.
    const ikaTx = new IkaTransaction({
      ikaClient,
      transaction: tx,
      userShareEncryptionKeys: p.userShareEncryptionKeys,
    });
    const sessionIdentifier = ikaTx.registerSessionIdentifier(p.sessionIdentifierBytes);
    if (p.needsRegistration) {
      await ikaTx.registerEncryptionKey({ curve: p.curve });
    }
    const [dWalletCap] = await ikaTx.requestDWalletDKG({
      dkgRequestInput: p.dkgRequestInput,
      ikaCoin, // &mut Coin<IKA> — safely reused across both calls
      suiCoin: tx.gas,
      sessionIdentifier,
      dwalletNetworkEncryptionKeyId: latestNetworkKey.id,
      curve: p.curve,
    });
    tx.transferObjects([dWalletCap], account.address);
  }
  // Both DKG calls only borrow the fee coin, so return the remainder once, after the loop.
  ikaFee.settle();

  const requestResult = await signAndExecuteAsync({ transaction: tx });
  const requestDetails = await suiClient.waitForTransaction({
    digest: requestResult.digest,
    options: { showObjectChanges: true, showEvents: true, showEffects: true },
  });
  const requestFailure = txFailed(requestDetails.effects as TxStatus);
  if (requestFailure) throw new Error(`Batched dWallet creation failed: ${requestFailure}`);

  // Resolve each created DWalletCap → dwallet_id. Both caps land in this one transaction, so match
  // them back to curves by reading each dWallet's `curve` field rather than relying on ordering.
  const capIds: string[] = [];
  for (const change of requestDetails.objectChanges ?? []) {
    const c = change as CreatedObjectChange;
    if (c.type === 'created' && c.objectType?.includes('DWalletCap') && c.objectId) {
      capIds.push(c.objectId);
    }
  }
  if (capIds.length < prepared.length) {
    throw new Error(`Expected ${prepared.length} DWalletCaps, found ${capIds.length}`);
  }

  const caps = await Promise.all(
    capIds.map(async (capId) => {
      const obj = await suiClient.getObject({ id: capId, options: { showContent: true } });
      const dwalletId = (obj.data?.content as CapContent | undefined)?.fields?.dwallet_id;
      if (!dwalletId) throw new Error(`Could not read dwallet_id from cap ${capId}`);
      const dWallet = await ikaClient.getDWallet(dwalletId);
      return { capId, dwalletId, curveNumber: dWallet.curve as number };
    })
  );

  /**
   * Map each created EncryptedUserSecretKeyShare to its dWallet.
   *
   * Read from `objectChanges` and each share object's own `dwallet_id`, NOT from the DKG event. The
   * event nests the share as `{ variant: 'Encrypted', fields: {...} }` — a BCS enum, not the
   * `{ Encrypted: {...} }` shape a naive accessor expects — and it carries no share id at all, so
   * event-based lookup silently produced `undefined` and only surfaced on the third curve.
   */
  const shareIds: string[] = [];
  for (const change of requestDetails.objectChanges ?? []) {
    const c = change as CreatedObjectChange;
    if (
      c.type === 'created' &&
      c.objectType?.includes('EncryptedUserSecretKeyShare') &&
      c.objectId
    ) {
      shareIds.push(c.objectId);
    }
  }
  const shareByDWallet = new Map<string, string>();
  await Promise.all(
    shareIds.map(async (shareId) => {
      const obj = await suiClient.getObject({ id: shareId, options: { showContent: true } });
      const content = obj.data?.content;
      if (!content || content.dataType !== 'moveObject') return;
      const dwalletId = (content.fields as { dwallet_id?: string }).dwallet_id;
      if (dwalletId) shareByDWallet.set(dwalletId, shareId);
    })
  );
  if (shareByDWallet.size < prepared.length) {
    throw new Error(
      `Expected ${prepared.length} encrypted user shares, resolved ${shareByDWallet.size}`
    );
  }

  // ── Wait for both network DKG rounds, concurrently ──
  status('awaiting-network', 'Network is generating your key shares (2PC-MPC)…');
  const awaiting = await Promise.all(
    prepared.map(async (p) => {
      const match = caps.find((c) => c.curveNumber === CURVE_NUMBER[p.kind]);
      if (!match) throw new Error(`No created dWallet found for ${p.kind}`);

      const dWallet = await ikaClient.getDWalletInParticularState(
        match.dwalletId,
        'AwaitingKeyHolderSignature',
        STATE_POLL
      );

      const encryptedShareId = shareByDWallet.get(match.dwalletId);
      if (!encryptedShareId) {
        throw new Error(
          `Could not resolve the encrypted user share id for ${p.kind} ` +
            `(dWallet ${match.dwalletId}). Shares found: ${[...shareByDWallet.keys()].join(', ') || 'none'}`
        );
      }

      return { ...p, ...match, dWallet, encryptedShareId };
    })
  );

  // ── Transaction #2: both accepts in one PTB ──
  status('accept', 'Finalizing both dWallets — approve in your wallet…');
  const acceptTx = new Transaction();
  for (const a of awaiting) {
    const acceptIkaTx = new IkaTransaction({
      ikaClient,
      transaction: acceptTx,
      userShareEncryptionKeys: a.userShareEncryptionKeys,
    });
    await acceptIkaTx.acceptEncryptedUserShare({
      dWallet: a.dWallet as Parameters<typeof acceptIkaTx.acceptEncryptedUserShare>[0]['dWallet'],
      userPublicOutput: a.dkgRequestInput.userPublicOutput,
      encryptedUserSecretKeyShareId: a.encryptedShareId,
    });
  }
  // No explicit gas budget — the SDK dry-runs for a real estimate. A fixed budget is reserved in
  // full, so it fails on a modest balance even when the true cost is a fraction of it.

  const acceptResult = await signAndExecuteAsync({ transaction: acceptTx });
  const acceptDetails = await suiClient.waitForTransaction({
    digest: acceptResult.digest,
    options: { showEffects: true },
  });
  const acceptFailure = txFailed(acceptDetails.effects as TxStatus);
  if (acceptFailure) throw new Error(`Activation failed: ${acceptFailure}`);

  status('activating', 'Waiting for activation to confirm…');
  const results = await Promise.all(
    awaiting.map(async (a) => {
      const active = await ikaClient.getDWalletInParticularState(a.dwalletId, 'Active', STATE_POLL);
      const { publicKey, address } = await deriveDisplay(active, a.curve);
      return {
        dwalletId: a.dwalletId,
        dwalletCapId: a.capId,
        curve: a.kind,
        publicKey,
        address,
      } satisfies CreatedDWallet;
    })
  );

  status('done', `${results.length} dWallet${results.length > 1 ? 's are' : ' is'} active!`);
  return results;
}

/** Shared display derivation: active dWallet → public key hex + primary chain address. */
async function deriveDisplay(
  activeDWallet: Awaited<ReturnType<IkaClient['getDWallet']>>,
  curve: Curve
): Promise<{ publicKey: string; address: string }> {
  try {
    const pubOutput = (activeDWallet.state as ActiveState).Active?.public_output;
    if (!pubOutput) return { publicKey: '', address: '' };

    const pk = await publicKeyFromDWalletOutput(curve, Uint8Array.from(pubOutput));
    const publicKey = '0x' + Buffer.from(pk).toString('hex');

    if (curve === Curve.SECP256K1) {
      const { SigningKey, computeAddress } = await import('ethers');
      const uncompressed = pk.length === 33 ? SigningKey.computePublicKey(publicKey, false) : publicKey;
      return { publicKey, address: computeAddress(uncompressed) };
    }
    if (curve === Curve.RISTRETTO) {
      // sr25519 public keys are 32 bytes and encode to SS58 exactly like ed25519 ones.
      const { deriveSs58Address } = await import('@/lib/utils/deriveMoreAddresses');
      return { publicKey, address: deriveSs58Address(publicKey, 0) };
    }
    return { publicKey, address: base58Encode(pk) };
  } catch (e) {
    console.warn('Could not derive display address:', e);
    return { publicKey: '', address: '' };
  }
}
