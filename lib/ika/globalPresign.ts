/**
 * 2PC-MPC v4 — pooled, client-independent presignatures.
 *
 * WHAT V4 CHANGED
 * ---------------
 * An MPC signature has offline rounds (presignature) and online rounds (signature). Presignatures
 * are *message-independent*, so they can be computed before anyone knows what will be signed.
 * v4 ("fast Schnorr") goes further: the Ika network now produces **client-independent** — and
 * therefore public-key-independent — presignatures, for ECDSA as well as Schnorr/EdDSA (Schnorr
 * has had this since v3). A client-independent presignature is valid for *any* dWallet and *any*
 * message.
 *
 * The practical consequence: the network computes presignatures continuously in the background and
 * banks them in a pool, so it is never idle. A signer buys one out of the pool and performs a
 * single online round (~400ms) instead of waiting out the offline phase. That is what removes the
 * latency and lets the network absorb demand spikes without bottlenecking.
 *
 * WHAT THAT MEANS FOR THIS FILE
 * -----------------------------
 * On-chain, "use a pooled presignature" is `requestGlobalPresign` (global == not bound to one
 * dWallet). Which curve/algorithm pairs are pool-served is not a client-side guess — the
 * coordinator publishes it as a `GlobalPresignConfig`, and for the pairs listed there global
 * presign is *mandatory*: a dWallet-specific `requestPresign` aborts with EOnlyGlobalPresignAllowed.
 *
 * The config lives in the coordinator's `extra_fields` bag under the key `global_presign_config`
 * (a Bag, so v4 could add it without changing the `DWalletCoordinatorInner` struct layout). The
 * older `support_config.signature_algorithms_allowed_global_presign` vector is deprecated and is
 * empty on mainnet — reading that one and concluding "no global presign support" is the trap here.
 *
 * As read from mainnet coordinator 0x5ea59bce…c75f3, DKG-created dWallets (what this app makes)
 * must use pooled global presign for every pair the app touches:
 *
 *   SECP256K1 → ECDSASecp256k1   (Ethereum/EVM, Bitcoin)   ← new in v4
 *   SECP256K1 → Taproot          (Bitcoin Taproot)
 *   SECP256R1 → ECDSASecp256r1
 *   ED25519   → EdDSA            (Solana, NEAR, Cardano)
 *   RISTRETTO → SchnorrkelSubstrate (Polkadot)
 *
 * We still read it live rather than hardcoding, so a policy change on chain doesn't silently
 * break signing.
 */

import { Curve, SignatureAlgorithm } from '@ika.xyz/sdk';
import type { AppSuiClient } from '@/lib/sui/client';
import { IKA_CONFIG } from '@/lib/config/network';
import { warn } from '@/lib/utils/log';

/** Bag key under `DWalletCoordinatorInner.extra_fields`. */
const GLOBAL_PRESIGN_CONFIG_KEY = 'global_presign_config';

/**
 * Move enum discriminants. These are the on-chain `u32` values; the SDK's exported `Curve` /
 * `SignatureAlgorithm` are string enums, so we map between the two here.
 *
 * Signature-algorithm numbers are *relative to the curve* (both ECDSASecp256k1 on secp256k1 and
 * EdDSA on ed25519 are 0), which is why the maps below are nested per curve.
 */
const CURVE_NUMBER: Record<Curve, number> = {
  [Curve.SECP256K1]: 0,
  [Curve.SECP256R1]: 1,
  [Curve.ED25519]: 2,
  [Curve.RISTRETTO]: 3,
};

const SIGNATURE_ALGORITHM_NUMBER: Record<number, Record<number, SignatureAlgorithm>> = {
  0: { 0: SignatureAlgorithm.ECDSASecp256k1, 1: SignatureAlgorithm.Taproot },
  1: { 0: SignatureAlgorithm.ECDSASecp256r1 },
  2: { 0: SignatureAlgorithm.EdDSA },
  3: { 0: SignatureAlgorithm.SchnorrkelSubstrate },
};

/** Which signature algorithms are pool-served, per curve, for each dWallet origin. */
export interface GlobalPresignPolicy {
  /** dWallets created through DKG — what this app creates. */
  dkg: Map<Curve, Set<SignatureAlgorithm>>;
  /** dWallets created by importing an existing private key. */
  importedKey: Map<Curve, Set<SignatureAlgorithm>>;
}

type VecMapEntry = { fields: { key: number; value: number[] } };

function parseCurveToAlgorithms(vecMap: unknown): Map<Curve, Set<SignatureAlgorithm>> {
  const out = new Map<Curve, Set<SignatureAlgorithm>>();
  const contents = (vecMap as { fields?: { contents?: VecMapEntry[] } })?.fields?.contents;
  if (!Array.isArray(contents)) return out;

  for (const entry of contents) {
    const curveNumber = entry?.fields?.key;
    const algorithmNumbers = entry?.fields?.value;
    if (typeof curveNumber !== 'number' || !Array.isArray(algorithmNumbers)) continue;

    const curve = (Object.keys(CURVE_NUMBER) as Curve[]).find(
      (c) => CURVE_NUMBER[c] === curveNumber
    );
    if (!curve) continue;

    const algorithms = new Set<SignatureAlgorithm>();
    for (const n of algorithmNumbers) {
      const algorithm = SIGNATURE_ALGORITHM_NUMBER[curveNumber]?.[n];
      if (algorithm) algorithms.add(algorithm);
    }
    out.set(curve, algorithms);
  }
  return out;
}

/**
 * Read the live v4 pooled-presign policy off the mainnet coordinator.
 *
 * Returns `null` when the coordinator exposes no `global_presign_config` at all (a pre-v4
 * deployment). Callers treat that as "fall back to per-dWallet presign".
 */
export async function fetchGlobalPresignPolicy(
  suiClient: AppSuiClient
): Promise<GlobalPresignPolicy | null> {
  const coordinatorId = IKA_CONFIG.objects.ikaDWalletCoordinator.objectID;

  // coordinator → versioned inner (a dynamic field) → extra_fields Bag → global_presign_config
  const innerFields = await suiClient.getDynamicFields({ parentId: coordinatorId });
  const inner = innerFields.data[0];
  if (!inner) return null;

  const innerObject = await suiClient.getObject({
    id: inner.objectId,
    options: { showContent: true },
  });
  const innerContent = innerObject.data?.content;
  if (!innerContent || innerContent.dataType !== 'moveObject') return null;

  const bagId = (
    innerContent.fields as {
      value?: { fields?: { extra_fields?: { fields?: { id?: { id?: string } } } } };
    }
  )?.value?.fields?.extra_fields?.fields?.id?.id;
  if (!bagId) return null;

  let configObjectId: string | undefined;
  const bagFields = await suiClient.getDynamicFields({ parentId: bagId });
  for (const field of bagFields.data) {
    // The Bag key is a `vector<u8>`; the JSON-RPC layer may hand it back as a byte array or as
    // the decoded string, so accept either.
    const raw = field.name?.value;
    const name = Array.isArray(raw)
      ? String.fromCharCode(...(raw as number[]))
      : typeof raw === 'string'
        ? raw
        : '';
    if (name === GLOBAL_PRESIGN_CONFIG_KEY || field.objectType?.includes('GlobalPresignConfig')) {
      configObjectId = field.objectId;
      break;
    }
  }
  if (!configObjectId) return null;

  const configObject = await suiClient.getObject({
    id: configObjectId,
    options: { showContent: true },
  });
  const configContent = configObject.data?.content;
  if (!configContent || configContent.dataType !== 'moveObject') return null;

  const value = (configContent.fields as { value?: { fields?: Record<string, unknown> } })?.value
    ?.fields;
  if (!value) return null;

  return {
    dkg: parseCurveToAlgorithms(value.curve_to_signature_algorithms_for_dkg),
    importedKey: parseCurveToAlgorithms(value.curve_to_signature_algorithms_for_imported_key),
  };
}

export type DWalletOrigin = 'dkg' | 'imported-key';

/**
 * Does this curve/algorithm pair have to go through the v4 presignature pool?
 *
 * `null` policy (pre-v4 coordinator) → false, i.e. use the classic per-dWallet presign.
 */
export function requiresGlobalPresign(
  policy: GlobalPresignPolicy | null,
  curve: Curve,
  signatureAlgorithm: SignatureAlgorithm,
  origin: DWalletOrigin = 'dkg'
): boolean {
  if (!policy) return false;
  const table = origin === 'dkg' ? policy.dkg : policy.importedKey;
  return table.get(curve)?.has(signatureAlgorithm) ?? false;
}

/**
 * How deep the network's presignature pool currently is.
 *
 * Purely informational — surfaced in the UI so the v4 pool is visible rather than implied. This is
 * the size of the coordinator's `presign_sessions` table, i.e. presignatures banked and ready.
 */
export async function fetchPresignPoolSize(suiClient: AppSuiClient): Promise<number | null> {
  try {
    const coordinatorId = IKA_CONFIG.objects.ikaDWalletCoordinator.objectID;
    const innerFields = await suiClient.getDynamicFields({ parentId: coordinatorId });
    const inner = innerFields.data[0];
    if (!inner) return null;

    const innerObject = await suiClient.getObject({
      id: inner.objectId,
      options: { showContent: true },
    });
    const content = innerObject.data?.content;
    if (!content || content.dataType !== 'moveObject') return null;

    const size = (
      content.fields as {
        value?: { fields?: { presign_sessions?: { fields?: { size?: string } } } };
      }
    )?.value?.fields?.presign_sessions?.fields?.size;

    return size === undefined ? null : Number(size);
  } catch {
    return null;
  }
}

/**
 * Resolve the pooled-presign policy, preferring a cached read.
 *
 * The policy changes only when Ika governance changes it, so one read per page load is plenty.
 */
let cachedPolicy: { policy: GlobalPresignPolicy | null; at: number } | null = null;
const POLICY_TTL_MS = 5 * 60 * 1000;

export async function getGlobalPresignPolicy(
  suiClient: AppSuiClient
): Promise<GlobalPresignPolicy | null> {
  if (cachedPolicy && Date.now() - cachedPolicy.at < POLICY_TTL_MS) {
    return cachedPolicy.policy;
  }
  try {
    const policy = await fetchGlobalPresignPolicy(suiClient);
    cachedPolicy = { policy, at: Date.now() };
    return policy;
  } catch (e) {
    warn('[ika/v4] could not read global presign policy, falling back:', e);
    return null;
  }
}
