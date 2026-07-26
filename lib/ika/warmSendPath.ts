'use client';

/**
 * Everything a signature needs that does NOT depend on the recipient or the amount, resolved ahead of time.
 *
 * WHY THIS EXISTS AS A MODULE
 * --------------------------
 * The send dialog worked this out and the swap flow did not, so the same signature cost 28.2s from the
 * swap page and rather less from the dialog. The measured swap showed exactly what was missing:
 *
 *     423 ms   presign (bought inline)     ← the pool was never primed
 *     12384 ms sign tx (zkLogin submit)    ← includes minting the Groth16 proof, never pre-warmed
 *     3513 ms  protocol params             ← in the prologue, but cold
 *
 * None of that work depends on where the money is going, so none of it belongs between pressing Confirm
 * and the transaction going out. Sharing it means a second entry point cannot quietly skip it again.
 *
 * WHAT IS SAFE TO ASSUME
 * ----------------------
 * Nothing. Every step here is an optimisation and every failure is swallowed: the signing path still
 * buys its own presignature, decrypts its own share and mints its own proof if this has not finished.
 * Warming can only make a signature faster, never possible or impossible.
 */

import type { AppSuiClient } from '@/lib/sui/client';
import type { Curve } from '@ika.xyz/sdk';
import { zkLoginSignAndExecute } from '@/lib/zklogin/execute';

export interface WarmSendPathParams {
  suiClient: AppSuiClient;
  /** The zkLogin address that owns the dWallet and pays for everything. */
  zkAddress: string;
  dwalletId: string;
  /** Chain the signature is for — decides the curve and the signature algorithm. */
  chain: string;
}

/**
 * Decrypt this dWallet's key share ahead of the signature.
 *
 * This was the largest single cost in a send (~19s measured) and, like the presignature, it depends on
 * neither the recipient nor the amount. Reuses the cached dWallet metadata rather than re-deriving it.
 */
async function decryptShareAhead(
  { suiClient, zkAddress, dwalletId, chain }: WarmSendPathParams,
  curve: Curve
): Promise<void> {
  try {
    const [
      { getDWalletMeta },
      { prepareUserShare },
      { generateEncryptionKeys, generateDeterministicEncryptionSeed },
      { getIkaClient },
    ] = await Promise.all([
      import('@/lib/dwallet/dwalletMeta'),
      import('@/lib/ika/userShare'),
      import('@/lib/dwallet/core/encryption'),
      import('@/lib/ika/ikaClient'),
    ]);

    const ika = await getIkaClient(suiClient);
    const meta = await getDWalletMeta({ suiClient, dwalletId, chain, curve });
    if (!meta.encryptedShareId) return; // shared or imported-key dWallet: nothing to decrypt

    const [dWallet, encryptedShare, keys] = await Promise.all([
      ika.getDWallet(dwalletId),
      ika.getEncryptedUserSecretKeyShare(meta.encryptedShareId),
      generateEncryptionKeys(
        generateDeterministicEncryptionSeed(zkAddress, curve),
        curve,
        zkAddress
      ),
    ]);

    await prepareUserShare({
      suiClient,
      dwalletId,
      shareId: meta.encryptedShareId,
      curve,
      dWallet,
      encryptedShare,
      userShareEncryptionKeys: keys as never,
    });
  } catch (e) {
    // Non-fatal: the send path decrypts inline if this hasn't finished.
    console.warn('[share] pre-decryption skipped:', e instanceof Error ? e.message : e);
  }
}

/**
 * Bank a presignature, pre-decrypt the key share and mint the zkLogin proof.
 *
 * 2PC-MPC v4 presignatures are client-independent, so this needs neither the amount nor the recipient and
 * can run the moment a user shows intent — opening the dialog, or landing on the swap page. That timing is
 * the whole point: an earlier version started on the first keystroke and then *awaited* the result at send
 * time, so anyone who typed quickly waited out the presign leg anyway.
 *
 * It also reclaims presignatures bought by earlier abandoned attempts before spending anything new — each
 * is 0.0209 SUI + 0.12 IKA already paid for.
 *
 * Resolves when the presignature has been requested. The other two legs are fire-and-forget by design:
 * they are independent, and making the caller wait on them would rebuild the very stall this removes.
 */
export async function warmSendPath(params: WarmSendPathParams): Promise<void> {
  const { suiClient, zkAddress, dwalletId, chain } = params;
  try {
    const [{ primePresignPool }, { chainCrypto, getIkaClient }, { prewarmZkLoginProof }] =
      await Promise.all([
        import('@/lib/ika/presignPool'),
        import('@/lib/ika/ikaClient'),
        import('@/lib/zklogin/execute'),
      ]);

    /**
     * The Groth16 proof is session-scoped and transaction-independent, and it is minted inside the
     * transaction that requests the signature — which is why the measured `sign tx (zkLogin submit)` was
     * 12.4s, 44% of the whole swap. Doing it now takes that out of the critical path.
     */
    void prewarmZkLoginProof();

    const { curve, signatureAlgorithm } = chainCrypto(chain);
    const ika = await getIkaClient(suiClient);
    const dWallet = (await ika.getDWallet(dwalletId)) as {
      dwallet_network_encryption_key_id?: string;
    };
    const keyId = dWallet.dwallet_network_encryption_key_id;
    if (!keyId) return;

    // Runs concurrently and independently: if it fails, the send simply decrypts inline as before.
    void decryptShareAhead(params, curve);

    await primePresignPool({
      suiClient,
      owner: zkAddress,
      curve,
      signatureAlgorithm,
      dwalletNetworkEncryptionKeyId: keyId,
      dWallet,
      signAndExecuteAsync: (p) => zkLoginSignAndExecute(suiClient, zkAddress, p),
    });
  } catch (e) {
    // Non-fatal: the send path buys its own presignature if the pool is empty.
    console.warn('[presign] pool priming skipped:', e instanceof Error ? e.message : e);
  }
}
