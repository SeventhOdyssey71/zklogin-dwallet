/**
 * One shared, initialized `IkaClient` for the whole session.
 *
 * `new IkaClient(...)` + `initialize()` costs a measured **~1.5s**, and it was being paid on every
 * send and every balance-driven read because each call site built its own. The config is constant
 * (mainnet), so a single instance is correct — and its internal caches (network objects, protocol
 * public parameters, encryption keys) only pay off if the instance is actually reused.
 *
 * Concurrent callers share one in-flight initialization rather than racing several.
 */

import { IkaClient, Curve, SignatureAlgorithm, Hash } from '@ika.xyz/sdk';
import type { AppSuiClient } from '@/lib/sui/client';
import { IKA_CONFIG } from '@/lib/config/network';
import { CHAIN_BY_ID } from '@/lib/config/chainRegistry';

let instance: IkaClient | null = null;
let inflight: Promise<IkaClient> | null = null;

export async function getIkaClient(suiClient: AppSuiClient): Promise<IkaClient> {
  if (instance) return instance;
  if (!inflight) {
    inflight = (async () => {
      const client = new IkaClient({ suiClient, config: IKA_CONFIG, cache: true });
      await client.initialize();
      instance = client;
      return client;
    })().catch((e) => {
      inflight = null; // let the next caller retry
      throw e;
    });
  }
  return inflight;
}

/** Drop the shared client (e.g. on sign-out) so nothing is retained across users. */
export function resetIkaClient(): void {
  instance = null;
  inflight = null;
}

/**
 * The curve / signature-algorithm / hash triple for a chain.
 *
 * Shared so the presign warm-up and the signing path can't disagree — a presign requested for the
 * wrong algorithm is unusable, and the mismatch would only surface at signing time.
 */
export interface ChainCrypto {
  curve: Curve;
  signatureAlgorithm: SignatureAlgorithm;
  hashScheme: Hash;
}

export function chainCrypto(chainId: string): ChainCrypto {
  const def = CHAIN_BY_ID[chainId];

  // Bitcoin uses Taproot (BIP340 Schnorr) — the SDK's documented "Taproot (Bitcoin)" algorithm and
  // the one 2PC-MPC v4 accelerates. SHA256 is its only valid hash.
  if (chainId === 'Bitcoin') {
    return {
      curve: Curve.SECP256K1,
      signatureAlgorithm: SignatureAlgorithm.Taproot,
      hashScheme: Hash.SHA256,
    };
  }

  if (def?.curve === 'Schnorrkel') {
    return {
      curve: Curve.RISTRETTO,
      signatureAlgorithm: SignatureAlgorithm.SchnorrkelSubstrate,
      hashScheme: Hash.Merlin,
    };
  }

  if (def?.curve === 'EdDSA') {
    return {
      curve: Curve.ED25519,
      signatureAlgorithm: SignatureAlgorithm.EdDSA,
      hashScheme: Hash.SHA512,
    };
  }

  // EVM: keccak over the RLP payload.
  return {
    curve: Curve.SECP256K1,
    signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
    hashScheme: Hash.KECCAK256,
  };
}
