/**
 * Protocol public parameters, obtained despite an Ika wire-format bump the shipped wasm predates.
 *
 * THE BREAKAGE
 * ------------
 * `ikaClient.getProtocolPublicParameters()` reads the network encryption key's
 * `reconfiguration_public_outputs` table — a `Table<u64, TableVec<vector<u8>>>` keyed by Sui epoch —
 * picks one entry, and hands the bytes to `dwallet_mpc_wasm::reconfiguration_public_output_to_protocol_pp`.
 * Those bytes are a BCS-tagged `VersionedDecryptionKeyReconfigurationOutput`. Ika mainnet reached
 * protocol v5 at epoch 360 and began writing the `V4` variant (tag 3); `@ika.xyz/ika-wasm@0.2.1` — the
 * newest published build, from 2025-11-13 — was compiled when that enum had only two variants, so it
 * refuses tag 3:
 *
 *     invalid value: integer `3`, expected variant index 0 <= i < 2
 *
 * The SDK deliberately reads the *second-newest* epoch (`.at(-2)` in `fetchEncryptionKeysFromNetwork`),
 * which is why nothing broke the moment epoch 360 was written: through all of epoch 360 the SDK was
 * still reading epoch 359's `V2` output. Signing died when epoch 361 opened and `.at(-2)` moved onto
 * 360. Every curve fails identically, because the tag is in the payload, not in the dWallet.
 *
 * WHY AN OLDER EPOCH'S OUTPUT IS THE SAME VALUE, NOT AN APPROXIMATION OF IT
 * ------------------------------------------------------------------------
 * This is the part that had to be *established*, not assumed — parameters that differ in anything
 * load-bearing would yield a silently invalid signature, which on a mainnet wallet is far worse than
 * the clear error above.
 *
 *   1. Ika's own converter proves it by construction. `protocol_public_parameters_from_reconfiguration_output`
 *      reads the parameters out of the payload's `PublicOutputCore` prefix via the same
 *      `<curve>_protocol_public_parameters()` accessors for V2, V3 and V4 alike. V4's only change is
 *      the *trailing* `threshold_encryption_to_sharing_output` field, restated in an aggregated shape
 *      (one summed ciphertext per receiver instead of every dealer's PVSS dealing). The accessors never
 *      touch it. Ika's source says so in as many words: "Aggregated shape — same `PublicOutputCore`
 *      prefix, so the same core-level protocol-public-parameter accessors apply."
 *   2. Measured against mainnet, the parameters are byte-identical across every epoch from 200 to 359
 *      inclusive — 160 consecutive reconfigurations, i.e. 160 different validator committees. That is
 *      the expected result: reconfiguration re-shares the network's *secret* among a new committee and
 *      leaves the public key material alone, which is precisely why existing dWallets keep signing
 *      across epochs.
 *   3. All three of this wallet's Active dWallets were created *during epoch 360* — after the format
 *      bump — using parameters derived from epoch 359, and the Ika committee verified and activated
 *      them on chain. `decryptUserShare` + `verifyUserShare` both succeed against them with these
 *      parameters, and a full client-side `createUserSignMessage` runs cleanly against a presignature
 *      the network produced at epoch 360.
 *
 * WHAT IS DELIBERATELY *NOT* USED
 * -------------------------------
 * `getProtocolPublicParameters` has a second branch, `networkDkgPublicOutputToProtocolPublicParameters`
 * over `network_dkg_public_output`, and it parses fine (that anchor is still `V1`-tagged from mainnet
 * genesis). It is a trap: it yields a 19,135,576-byte parameter set, whereas every epoch from 200
 * onward yields 44,642,7xx bytes. Mainnet changed protocol parameters once, somewhere between epoch
 * 100 and 200, and the genesis anchor still describes the *pre*-change protocol. So this module only
 * ever accepts a genuine reconfiguration output, and never falls back to the DKG anchor.
 *
 * WHY IT REACHES INTO A PRIVATE SDK CACHE
 * ---------------------------------------
 * Handing correct parameters to our own call sites is not enough: `IkaTransaction.requestSign` calls
 * `ikaClient.getProtocolPublicParameters(dWallet)` itself, with no parameter to override it. The only
 * seam is the client's own memo — `cachedProtocolPublicParameters` — which that method consults before
 * touching wasm. Writing into another library's private field is genuinely ugly and will break without
 * warning if the SDK renames it. It is still the right trade here: the alternative is no signing at all
 * on any curve, and the failure mode of a rename is a loud crash on the next send rather than anything
 * silent. The cache entry is written with exactly the shape `getProtocolPublicParameters` validates
 * (`networkEncryptionKeyPublicOutputID`, `epoch`, `curve`) so a stale entry can never be served: if any
 * of the three stops matching, the SDK discards ours and takes its normal path.
 *
 * This whole module is designed to evaporate. Step one is always the SDK's own call, so the day Ika
 * publishes a wasm that understands tag 3, the fallback simply stops being reached.
 */

import { Curve, reconfigurationPublicOutputToProtocolPublicParameters } from '@ika.xyz/sdk';
import type { IkaClient } from '@ika.xyz/sdk';
import type { AppSuiClient } from '@/lib/sui/client';

/**
 * Move curve discriminants, mirrored from `lib/ika/presignPool.ts`.
 *
 * Needed because the SDK's own `fromNumberToCurve` lives in an internal module that its `exports` map
 * does not expose. The direction matters: this is only ever used to reproduce the curve the SDK's
 * *internal* `getProtocolPublicParameters(dWallet)` call will derive from `dWallet.curve`, so that the
 * cache key we write is the key it will look up. Getting it wrong means a cache miss and the original
 * error — never parameters served for the wrong curve.
 */
const CURVE_BY_NUMBER: Record<number, Curve> = {
  0: Curve.SECP256K1,
  1: Curve.SECP256R1,
  2: Curve.ED25519,
  3: Curve.RISTRETTO,
};

/** The SDK's private cache entry shape, from `IkaClient.getProtocolPublicParameters`. */
interface CachedParams {
  networkEncryptionKeyPublicOutputID: string;
  epoch: number;
  curve: Curve;
  protocolPublicParameters: Uint8Array;
}

/**
 * How far back to look for a parseable reconfiguration output.
 *
 * Today the answer is one epoch back, so this is slack rather than a budget. It exists because the gap
 * grows by one every epoch for as long as the wasm stays behind the network, and an unbounded walk
 * would turn a broken send into a minutes-long hang against the fullnode. Hitting the limit raises the
 * original wasm error, which is the honest outcome.
 */
const MAX_EPOCHS_SCANNED = 64;

/** Concurrency for the cheap per-epoch version probes. Modest, to stay friendly to the public RPC. */
const PROBE_CONCURRENCY = 8;

/**
 * One resolved payload per network encryption key, for the session.
 *
 * The three curves each need their own conversion but share the same on-chain bytes, and fetching them
 * is ~40 chunk reads plus a scan. Memoising the bytes rather than the parameters keeps this small — the
 * 44MB conversion results are already memoised by the SDK cache we prime.
 */
const payloadCache = new Map<string, { epoch: number; reconfig: Uint8Array; dkg: Uint8Array }>();

/**
 * The parameters `getProtocolPublicParameters` would return if the wasm could read the current epoch.
 *
 * Also primes the SDK's cache, so the call `IkaTransaction.requestSign` makes internally is satisfied
 * from memory and never reaches wasm. Call it once per (dWallet, curve) before signing.
 *
 * `curve` is used only when `dWallet` is omitted — mirroring the SDK, which derives the curve from
 * `dWallet.curve` whenever a dWallet is supplied. Following it exactly is what makes the primed key
 * match the one the internal call looks up.
 */
export async function ensureProtocolPublicParameters(
  ikaClient: IkaClient,
  suiClient: AppSuiClient,
  dWallet: unknown | undefined,
  curve: Curve
): Promise<Uint8Array> {
  // Step one is always the SDK's own path — both so a fixed wasm makes this module inert, and so a
  // cache we primed earlier is reused rather than rebuilt.
  try {
    return await ikaClient.getProtocolPublicParameters(dWallet as never, curve);
  } catch (error) {
    if (!isUnsupportedVariantError(error)) throw error;

    const encryptionKey = dWallet
      ? await ikaClient.getDWalletNetworkEncryptionKey((dWallet as { id: string }).id)
      : await ikaClient.getConfiguredNetworkEncryptionKey();

    // The curve the SDK's internal call will resolve, so the cache key matches.
    const selectedCurve = dWallet ? curveOf(dWallet) : curve;

    const { epoch, reconfig, dkg, params } = await resolvePayload(
      ikaClient,
      suiClient,
      encryptionKey.id,
      selectedCurve
    );

    // `params` is set when this call did the scan: proving a payload readable *is* a conversion, so
    // doing it for the curve we need means the ~5s of wasm is spent once rather than twice.
    const protocolPublicParameters =
      params ??
      (await reconfigurationPublicOutputToProtocolPublicParameters(selectedCurve, reconfig, dkg));

    console.warn(
      `[ika] ${(error as Error).message} — @ika.xyz/ika-wasm@0.2.1 cannot read the current ` +
        `reconfiguration output format. Using epoch ${epoch}, the newest this build can read; its ` +
        `protocol public parameters are the same value (see lib/ika/protocolParams.ts).`
    );

    const cache = (
      ikaClient as unknown as { cachedProtocolPublicParameters: Map<string, CachedParams> }
    ).cachedProtocolPublicParameters;
    // `getCacheKey` is `${encryptionKeyID}-${curve}`, replicated rather than called because it is a
    // private method and genuinely unreachable, unlike the field.
    cache.set(`${encryptionKey.id}-${selectedCurve}`, {
      networkEncryptionKeyPublicOutputID: encryptionKey.networkDKGOutputID,
      epoch: encryptionKey.epoch,
      curve: selectedCurve,
      protocolPublicParameters,
    });

    return protocolPublicParameters;
  }
}

/** True for the wasm's "this variant is newer than I am" BCS error, and nothing else. */
function isUnsupportedVariantError(error: unknown): boolean {
  // Anything else — an unreachable fullnode, a missing object — must surface as itself. A fallback
  // that also swallowed transient failures would pin the session to an older epoch's payload for a
  // reason that had nothing to do with version skew.
  return /expected variant index/.test((error as Error)?.message ?? '');
}

function curveOf(dWallet: unknown): Curve {
  const curveNumber = Number((dWallet as { curve?: number }).curve);
  const resolved = CURVE_BY_NUMBER[curveNumber];
  if (!resolved) throw new Error(`Unknown dWallet curve discriminant: ${curveNumber}`);
  return resolved;
}

/**
 * The newest reconfiguration output this wasm build can actually parse, plus the DKG anchor it needs
 * as its second argument.
 *
 * Walks epochs newest-first. Each candidate is first probed cheaply — one read of chunk 0 of its
 * `TableVec`, whose first byte is the BCS variant tag — and a tag already known to fail is skipped
 * without downloading the ~180KB payload again. That keeps the cost flat as the network moves further
 * ahead of the wasm: only a *change* of tag is worth a full attempt.
 *
 * `probeCurve` is the curve the caller actually wants: the only way to prove a payload readable is to
 * convert it, so converting for that curve makes the proof and the answer the same piece of work.
 */
/**
 * Ask the server which epoch worked last time.
 *
 * Cheap and entirely optional: on a hit we read that one dynamic field instead of paging through every
 * epoch in the table, which is where most of a cold resolve's time goes. A stale or wrong hint costs
 * nothing — it is verified by actually parsing that epoch, and a failure falls through to the full walk.
 */
async function readEpochHint(encryptionKeyId: string): Promise<number | null> {
  if (typeof window === 'undefined') return null;
  try {
    const res = await fetch(
      `/api/ika/params-epoch?encryptionKeyId=${encodeURIComponent(encryptionKeyId)}`,
      { cache: 'no-store' }
    );
    if (!res.ok) return null;
    const { epoch } = (await res.json()) as { epoch?: number | null };
    return typeof epoch === 'number' ? epoch : null;
  } catch {
    return null;
  }
}

/** Record a working epoch so the next cold start skips the walk. Fire-and-forget. */
function writeEpochHint(encryptionKeyId: string, epoch: number): void {
  if (typeof window === 'undefined') return;
  void fetch('/api/ika/params-epoch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encryptionKeyId, epoch }),
  }).catch(() => {
    // Signed out or offline; the next resolve simply pays the walk again.
  });
}

/** Read one epoch's entry directly, without enumerating the table. */
async function fieldIdForEpoch(
  suiClient: AppSuiClient,
  reconfigTableId: string,
  epoch: number
): Promise<string | null> {
  try {
    const field = await suiClient.getDynamicFieldObject({
      parentId: reconfigTableId,
      name: { type: 'u64', value: String(epoch) },
    });
    return field.data?.objectId ?? null;
  } catch {
    return null;
  }
}

async function resolvePayload(
  ikaClient: IkaClient,
  suiClient: AppSuiClient,
  encryptionKeyId: string,
  probeCurve: Curve
): Promise<{ epoch: number; reconfig: Uint8Array; dkg: Uint8Array; params?: Uint8Array }> {
  const memo = payloadCache.get(encryptionKeyId);
  if (memo) return memo;

  const content = await suiClient.getObject({
    id: encryptionKeyId,
    options: { showContent: true },
  });
  const fields = (content.data?.content as { dataType?: string; fields?: EncryptionKeyFields })
    ?.fields;
  const reconfigTableId = fields?.reconfiguration_public_outputs?.fields?.id?.id;
  const dkgTableId = fields?.network_dkg_public_output?.fields?.contents?.fields?.id?.id;
  if (!reconfigTableId || !dkgTableId) {
    throw new Error(`Could not read reconfiguration tables from encryption key ${encryptionKeyId}`);
  }

  const dkg = await ikaClient.readTableVecAsRawBytes(dkgTableId);

  /**
   * Try the cached hint first.
   *
   * One `getDynamicFieldObject` instead of paging the whole table. Verified by parsing, so a wrong hint
   * just falls through to the walk below.
   */
  const hinted = await readEpochHint(encryptionKeyId);
  if (hinted !== null) {
    /**
     * The whole attempt is inside one try, including `probe`, which throws when a field cannot be read.
     * A stale hint must FALL THROUGH to the walk, never escape — otherwise caching an answer would make
     * the module fail where it previously succeeded, which is the opposite of an optimisation.
     */
    try {
      const fieldId = await fieldIdForEpoch(suiClient, reconfigTableId, hinted);
      if (fieldId) {
        const { tableVecId } = await probe(suiClient, fieldId);
        const reconfig = await ikaClient.readTableVecAsRawBytes(tableVecId);
        const params = await reconfigurationPublicOutputToProtocolPublicParameters(
          probeCurve,
          reconfig,
          dkg
        );
        // Memoised without `params`, matching the walk below: the bytes are shared by every curve, the
        // 44MB conversion is not.
        const resolved = { epoch: hinted, reconfig, dkg };
        payloadCache.set(encryptionKeyId, resolved);
        return { ...resolved, params };
      }
    } catch {
      // Hint no longer usable — Ika moved on, or it was never right. The walk below finds and records a
      // fresh one.
    }
  }

  // Newest epoch first.
  const epochs: { epoch: number; fieldId: string }[] = [];
  let cursor: string | null | undefined = null;
  for (;;) {
    const page: Awaited<ReturnType<typeof suiClient.getDynamicFields>> =
      await suiClient.getDynamicFields({ parentId: reconfigTableId, cursor, limit: 50 });
    for (const df of page.data) {
      epochs.push({ epoch: Number(df.name.value), fieldId: df.objectId });
    }
    if (!page.hasNextPage) break;
    cursor = page.nextCursor;
  }
  epochs.sort((a, b) => b.epoch - a.epoch);

  const failedTags = new Set<number>();
  let firstError: unknown;

  for (let i = 0; i < Math.min(epochs.length, MAX_EPOCHS_SCANNED); i += PROBE_CONCURRENCY) {
    const batch = epochs.slice(i, i + PROBE_CONCURRENCY);
    const probed = await Promise.all(
      batch.map(async (row) => ({ ...row, ...(await probe(suiClient, row.fieldId)) }))
    );

    for (const candidate of probed) {
      // `undefined` means the probe itself failed; try the payload anyway rather than skip an epoch
      // that might be the only usable one.
      if (candidate.tag !== undefined && failedTags.has(candidate.tag)) continue;

      const reconfig = await ikaClient.readTableVecAsRawBytes(candidate.tableVecId);
      let params: Uint8Array;
      try {
        params = await reconfigurationPublicOutputToProtocolPublicParameters(
          probeCurve,
          reconfig,
          dkg
        );
      } catch (error) {
        firstError ??= error;
        if (candidate.tag !== undefined) failedTags.add(candidate.tag);
        continue;
      }

      // Memoised without `params`: the bytes are shared by every curve, the 44MB conversion is not.
      const resolved = { epoch: candidate.epoch, reconfig, dkg };
      payloadCache.set(encryptionKeyId, resolved);
      // Share the answer so no other client, tab or cold start has to page the whole table again.
      writeEpochHint(encryptionKeyId, candidate.epoch);
      return { ...resolved, params };
    }
  }

  throw new Error(
    `No reconfiguration output in the last ${MAX_EPOCHS_SCANNED} epochs could be read by ` +
      `@ika.xyz/ika-wasm@0.2.1 (last error: ${(firstError as Error)?.message ?? 'none'}). ` +
      `Upgrading @ika.xyz/ika-wasm is the only fix.`
  );
}

/** The `TableVec`'s inner table id, and the BCS variant tag sitting in the first byte of chunk 0. */
async function probe(
  suiClient: AppSuiClient,
  fieldId: string
): Promise<{ tableVecId: string; tag: number | undefined }> {
  const entry = await suiClient.getObject({ id: fieldId, options: { showContent: true } });
  const tableVecId = (
    entry.data?.content as { fields?: TableVecEntryFields } | undefined
  )?.fields?.value?.fields?.contents?.fields?.id?.id;
  if (!tableVecId) throw new Error(`Could not read reconfiguration TableVec from ${fieldId}`);

  try {
    const chunk = await suiClient.getDynamicFieldObject({
      parentId: tableVecId,
      name: { type: 'u64', value: '0' },
    });
    const value = (chunk.data?.content as { fields?: { value?: number[] } } | undefined)?.fields
      ?.value;
    return { tableVecId, tag: Array.isArray(value) ? value[0] : undefined };
  } catch {
    // The probe is only an optimisation — losing it costs a redundant download, not correctness.
    return { tableVecId, tag: undefined };
  }
}

/** Just enough of the on-chain JSON shape to reach the two table ids. */
interface EncryptionKeyFields {
  reconfiguration_public_outputs?: { fields?: { id?: { id?: string } } };
  network_dkg_public_output?: { fields?: { contents?: { fields?: { id?: { id?: string } } } } };
}

interface TableVecEntryFields {
  value?: { fields?: { contents?: { fields?: { id?: { id?: string } } } } };
}
