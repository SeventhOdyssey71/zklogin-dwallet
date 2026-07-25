'use client';

/**
 * A standing pool of 2PC-MPC v4 presignatures, so the presign leg costs *nothing* on the send path.
 *
 * WHY A POOL RATHER THAN A WARM-UP
 * --------------------------------
 * The previous version started a warm-up on the first amount keystroke and then `await`ed it at send
 * time. That only helps if the user spends longer filling the form than the warm-up takes (~15s: one
 * zkLogin Sui transaction plus network completion). Send quickly — which is the normal case — and you
 * simply wait out the same 15s, just relabelled "using pre-warmed presignature". That is exactly the
 * near-minute the send was taking.
 *
 * A pool fixes the ordering properly: presignatures are prepared *ahead of intent* and only ever
 * handed out once they have actually settled. `takeReady` is synchronous and returns null rather than
 * a promise, so the send path can never accidentally block on unfinished work again.
 *
 * WHY THIS IS SOUND
 * -----------------
 * v4 presignatures are **client-independent**, hence public-key- and message-independent: one bought
 * from the network's pool is valid for any dWallet on that (curve, algorithm) and any message. So
 * banking them before we know the recipient, the amount, or even which dWallet will sign is not a
 * shortcut — it is the property the v4 upgrade added.
 *
 * ADOPTING ORPHANS FIRST
 * ----------------------
 * A presign that was bought but never consumed stays on chain as a `UnverifiedPresignCap` the user
 * owns, already paid for (0.0209 SUI + 0.12 IKA each). Every abandoned send left one behind, and the
 * old code bought a fresh one regardless — so the wasted spend accumulated silently. The pool scans
 * for these and uses them before spending anything, which both makes the first send instant and
 * recovers money already committed.
 *
 * COST
 * ----
 * `TARGET_DEPTH` presignatures per (curve, algorithm) are held ready, refilled in the background
 * after each use. Depth 1 is deliberate: it makes the steady state instant while keeping at most one
 * unused presignature's worth of IKA parked per curve.
 */

import { Transaction } from '@mysten/sui/transactions';
import { IkaTransaction, Curve, SignatureAlgorithm } from '@ika.xyz/sdk';
import type { AppSuiClient } from '@/lib/sui/client';
import { getIkaClient } from '@/lib/ika/ikaClient';
import { prepareIkaFeeCoin } from '@/lib/ika/ikaFee';
import { getGlobalPresignPolicy, requiresGlobalPresign } from '@/lib/ika/globalPresign';
import { IKA_CONFIG } from '@/lib/config/network';

/**
 * On-chain numbering for (curve, signature algorithm).
 *
 * Move stores the curve absolutely and the signature algorithm *relative to the curve*
 * (secp256k1: ECDSA=0, Taproot=1), which is why a presignature read back from chain shows
 * `curve: 2, signature_algorithm: 0` for ed25519/EdDSA. The SDK has converters for this but does not
 * export them from its package root (only from an internal module absent from its `exports` map), so
 * the table is mirrored here from `@ika.xyz/sdk/dist/esm/client/hash-signature-validation.js`.
 *
 * Note the direction: this maps enum → numbers, and never numbers → enum. Pool entries are keyed by the
 * numbers found on chain, so if this table were ever wrong the only consequence is a missed reuse (we
 * buy a fresh presignature) — never a presignature handed out for the wrong algorithm, which would
 * fail at signing time after the money was spent.
 */
const CURVE_NUMBER: Record<string, number> = {
  [Curve.SECP256K1]: 0,
  [Curve.SECP256R1]: 1,
  [Curve.ED25519]: 2,
  [Curve.RISTRETTO]: 3,
};
const ALGORITHM_NUMBER: Record<string, number> = {
  [SignatureAlgorithm.ECDSASecp256k1]: 0,
  [SignatureAlgorithm.Taproot]: 1,
  [SignatureAlgorithm.ECDSASecp256r1]: 0,
  [SignatureAlgorithm.EdDSA]: 0,
  [SignatureAlgorithm.SchnorrkelSubstrate]: 0,
};

/** A presignature that has reached `Completed` and is ready to be verified and consumed. */
export interface ReadyPresign {
  /** The on-chain presign object, in `Completed` state. */
  presign: unknown;
  /** Object id of the unverified presign capability owned by the user. */
  presignCapId: string;
}

export interface PoolParams {
  suiClient: AppSuiClient;
  owner: string;
  curve: Curve;
  signatureAlgorithm: SignatureAlgorithm;
  /** The network encryption key the dWallet belongs to. */
  dwalletNetworkEncryptionKeyId: string;
  /**
   * The dWallet object, enabling the per-dWallet fallback.
   *
   * Only needed if the coordinator does not pool this (curve, algorithm): `requestPresign` is bound to
   * a specific dWallet, so it cannot be prepared in advance and cannot be shared. Supplying it keeps
   * such a pair working (just without the speed benefit) rather than failing outright.
   */
  dWallet?: unknown;
  signAndExecuteAsync: (input: {
    transaction: Transaction;
  }) => Promise<{ digest: string; effects?: unknown; events?: unknown; objectChanges?: unknown }>;
}

/** How many settled presignatures to keep banked per (curve, algorithm). */
const TARGET_DEPTH = 1;

/** Poll cadence while a freshly bought presignature settles. */
const POLL = { timeout: 60_000, interval: 250 } as const;

/** Pool key: owner plus the *on-chain* numbering of the pair. */
const keyOf = (owner: string, curve: Curve, algo: SignatureAlgorithm) =>
  numericKey(owner, CURVE_NUMBER[curve], ALGORITHM_NUMBER[algo]);

const numericKey = (owner: string, curveNumber: number, algoNumber: number) =>
  `${owner}:${curveNumber}:${algoNumber}`;

/** Settled, ready-to-use presignatures. */
const ready = new Map<string, ReadyPresign[]>();
/** In-flight purchases, so concurrent primes don't buy several. */
const inflight = new Map<string, Promise<ReadyPresign>>();
/** Owners whose on-chain orphans have already been scanned this session. */
const adopted = new Set<string>();

/**
 * Take a settled presignature, or null.
 *
 * Synchronous and non-blocking *by design*: there is no way for a caller to accidentally wait on a
 * purchase that hasn't finished. If this returns null the caller should proceed inline.
 */
export function takeReady(
  owner: string,
  curve: Curve,
  signatureAlgorithm: SignatureAlgorithm
): ReadyPresign | null {
  const list = ready.get(keyOf(owner, curve, signatureAlgorithm));
  return list && list.length > 0 ? (list.shift() ?? null) : null;
}

/**
 * A purchase already in flight for this combination, if any.
 *
 * Awaiting this is still better than starting a fresh presignature inline — both cost the same, and
 * the in-flight one has a head start. The caller decides; the pool never decides to block for it.
 */
export function pendingPresign(
  owner: string,
  curve: Curve,
  signatureAlgorithm: SignatureAlgorithm
): Promise<ReadyPresign> | null {
  return inflight.get(keyOf(owner, curve, signatureAlgorithm)) ?? null;
}

/** How many settled presignatures are banked for this combination. */
export function readyCount(
  owner: string,
  curve: Curve,
  signatureAlgorithm: SignatureAlgorithm
): number {
  return ready.get(keyOf(owner, curve, signatureAlgorithm))?.length ?? 0;
}

/**
 * Bring the pool up to `TARGET_DEPTH` for one (curve, algorithm), adopting on-chain orphans before
 * spending anything.
 *
 * Safe to call often — it returns immediately when the pool is already full. Resolves when the pool
 * is topped up; callers that just want the side effect can ignore the promise, but must not let it
 * reject unhandled.
 */
export async function primePresignPool(params: PoolParams): Promise<void> {
  const { owner, curve, signatureAlgorithm } = params;
  const key = keyOf(owner, curve, signatureAlgorithm);

  // Free before paid: reclaim anything already bought and never used.
  if (!adopted.has(owner)) {
    adopted.add(owner);
    try {
      await adoptOrphanedPresigns(params);
    } catch (e) {
      // Adoption is an optimisation; never let it block the ability to buy one.
      console.warn('[presign] could not scan for reusable presignatures:', e);
    }
  }

  const have = (ready.get(key)?.length ?? 0) + (inflight.has(key) ? 1 : 0);
  if (have >= TARGET_DEPTH) return;

  const job = buyPresign(params)
    .then((p) => {
      const list = ready.get(key) ?? [];
      list.push(p);
      ready.set(key, list);
      inflight.delete(key);
      return p;
    })
    .catch((e) => {
      inflight.delete(key); // a failed purchase must not be cached
      throw e;
    });

  inflight.set(key, job);
  await job;
}

/**
 * Refill in the background, after a send has consumed one.
 *
 * Errors are swallowed: a refill failure must never surface as a send failure, since the send it
 * would have accelerated has already succeeded.
 */
export function refillInBackground(params: PoolParams): void {
  void primePresignPool(params).catch((e) => {
    console.warn('[presign] background refill failed (harmless):', (e as Error).message);
  });
}

/** Discard pooled presignatures (e.g. on sign-out). Does not destroy the on-chain caps. */
export function clearPresignPool(owner?: string): void {
  for (const k of [...ready.keys()]) if (!owner || k.startsWith(`${owner}:`)) ready.delete(k);
  for (const k of [...inflight.keys()]) if (!owner || k.startsWith(`${owner}:`)) inflight.delete(k);
  if (owner) adopted.delete(owner);
  else adopted.clear();
}

/**
 * Find `UnverifiedPresignCap`s the user already owns whose presignature is `Completed`, and bank them.
 *
 * These are pre-paid: each represents 0.0209 SUI + 0.12 IKA already spent by an earlier attempt that
 * never got as far as signing.
 */
async function adoptOrphanedPresigns(params: PoolParams): Promise<void> {
  const { suiClient, owner } = params;
  const ikaClient = await getIkaClient(suiClient);

  // The cap type lives in the *original* package — object types keep the address of the package that
  // first defined them across upgrades.
  const capType = `${IKA_CONFIG.packages.ikaDwallet2pcMpcOriginalPackage}::coordinator_inner::UnverifiedPresignCap`;

  const page = await suiClient.getOwnedObjects({
    owner,
    filter: { StructType: capType },
    options: { showContent: true },
    limit: 50,
  });

  const candidates = page.data
    .map((o) => {
      const fields = (o.data?.content as { dataType?: string; fields?: Record<string, unknown> })
        ?.fields;
      const presignId = fields?.presign_id;
      return o.data?.objectId && typeof presignId === 'string'
        ? { capId: o.data.objectId, presignId }
        : null;
    })
    .filter((x): x is { capId: string; presignId: string } => x !== null);

  if (candidates.length === 0) return;

  // Resolve concurrently; a cap whose presignature is gone or unfinished is simply skipped.
  const resolved = await Promise.all(
    candidates.map(async ({ capId, presignId }) => {
      try {
        const presign = (await ikaClient.getPresign(presignId)) as {
          state?: Record<string, unknown> & { $kind?: string };
          curve?: number;
          signature_algorithm?: number;
        };
        const kind = presign.state?.$kind ?? Object.keys(presign.state ?? {})[0];
        if (kind !== 'Completed') return null;
        if (typeof presign.curve !== 'number' || typeof presign.signature_algorithm !== 'number') {
          return null;
        }
        // Keyed by the numbers as stored on chain — no reverse conversion, so no chance of banking a
        // presignature under the wrong algorithm.
        return {
          key: numericKey(owner, presign.curve, presign.signature_algorithm),
          entry: { presign, presignCapId: capId } satisfies ReadyPresign,
        };
      } catch {
        return null;
      }
    })
  );

  let banked = 0;
  for (const r of resolved) {
    if (!r) continue;
    const list = ready.get(r.key) ?? [];
    list.push(r.entry);
    ready.set(r.key, list);
    banked++;
  }

  if (banked > 0) {
    console.log(
      `♻️ Reclaimed ${banked} pre-paid presignature${banked === 1 ? '' : 's'} from earlier attempts ` +
        `(~${(banked * 0.0209).toFixed(3)} SUI + ${(banked * 0.12).toFixed(2)} IKA already spent).`
    );
  }
}

/** Buy one presignature out of the network's pool and wait for it to settle. */
async function buyPresign(params: PoolParams): Promise<ReadyPresign> {
  const { suiClient, owner, curve, signatureAlgorithm, dwalletNetworkEncryptionKeyId } = params;

  const ikaClient = await getIkaClient(suiClient);

  // Honour the coordinator's policy: for pooled pairs the per-dWallet `requestPresign` aborts with
  // EOnlyGlobalPresignAllowed (error 31), and for non-pooled pairs only `requestPresign` works.
  const policy = await getGlobalPresignPolicy(suiClient);
  const pooled = requiresGlobalPresign(policy, curve, signatureAlgorithm, 'dkg');
  if (!pooled && !params.dWallet) {
    throw new Error(
      `${String(curve)}/${String(signatureAlgorithm)} is not pool-served, so a presignature cannot be ` +
        `prepared independently of a dWallet.`
    );
  }

  const tx = new Transaction();
  tx.setSender(owner);
  const fee = await prepareIkaFeeCoin({ tx, suiClient, owner });
  const ikaTx = new IkaTransaction({ ikaClient, transaction: tx });

  const cap = pooled
    ? ikaTx.requestGlobalPresign({
        curve,
        dwalletNetworkEncryptionKeyId,
        signatureAlgorithm,
        ikaCoin: fee.coin,
        suiCoin: tx.gas,
      })
    : ikaTx.requestPresign({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dWallet: params.dWallet as any,
        signatureAlgorithm,
        ikaCoin: fee.coin,
        suiCoin: tx.gas,
      });
  // Transfer the capability to ourselves so its object id is recoverable from the effects — and so an
  // unused one survives as an adoptable orphan rather than being lost.
  tx.transferObjects([cap], owner);
  // The fee coin is only borrowed (&mut), so the remainder must be handed back or the tx aborts.
  fee.settle();

  const { digest, effects, events, objectChanges } = await params.signAndExecuteAsync({
    transaction: tx,
  });

  // The executing endpoint returns full effects, so there is no second round-trip to fetch them.
  type TxOutcome = {
    effects?: unknown;
    events?: { type?: string; parsedJson?: unknown }[] | null;
    objectChanges?: unknown[] | null;
  };
  const result: TxOutcome =
    effects && objectChanges
      ? ({ effects, events, objectChanges } as TxOutcome)
      : ((await suiClient.waitForTransaction({
          digest,
          options: { showEffects: true, showEvents: true, showObjectChanges: true },
        })) as TxOutcome);

  const status = (result.effects as { status?: { status?: string; error?: string } } | undefined)
    ?.status;
  if (status?.status !== 'success') {
    throw new Error(`Presignature purchase failed: ${status?.error ?? 'unknown'}`);
  }

  let presignId: string | undefined;
  for (const e of result.events ?? []) {
    if (!(e.type as string)?.includes('PresignRequestEvent')) continue;
    presignId = (e.parsedJson as { event_data?: { presign_id?: string } })?.event_data?.presign_id;
    if (presignId) break;
  }

  let presignCapId: string | undefined;
  for (const change of result.objectChanges ?? []) {
    const c = change as { type?: string; objectType?: string; objectId?: string };
    if (c.type === 'created' && c.objectType?.includes('PresignCap') && c.objectId) {
      presignCapId = c.objectId;
      break;
    }
  }

  if (!presignId || !presignCapId) {
    throw new Error(
      `Presignature purchase: could not resolve ids (presign=${presignId ?? 'missing'}, cap=${presignCapId ?? 'missing'})`
    );
  }

  const presign = await ikaClient.getPresignInParticularState(presignId, 'Completed', POLL);
  return { presign, presignCapId };
}
