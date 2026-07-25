/**
 * List the dWallets owned by an address.
 *
 * Queries Sui for *only* DWalletCap objects using a server-side `StructType` filter, rather than
 * paging the address's entire object set and string-matching the type. On an account holding coins,
 * NFTs and receipts that is the difference between several pages and one.
 *
 * WHY NOT `ikaClient.getOwnedDWalletCaps()`
 * -----------------------------------------
 * The SDK has exactly this method and it is the obvious choice, but it is broken against
 * `@mysten/sui` 2.22.1. It calls the transport-agnostic `client.core.listOwnedObjects()` and then
 * feeds each result through `objResToBcs`, which requires a populated `content` (BCS bytes) field.
 * In 2.22.1 the *list* endpoint leaves `content` empty, so every call throws:
 *
 *     Invalid Response bcs missing: "…::coordinator_inner::DWalletCap" object: Expected structure not found
 *
 * It is specific to the list path — `ikaClient.getDWallet()` and the other single-object reads still
 * work, which is why only this screen broke. Reading the cap's `dwallet_id` straight out of the JSON
 * content sidesteps the BCS decode entirely and needs nothing from the SDK.
 */

import type { AppSuiClient } from '@/lib/sui/client';
import { IKA_CONFIG } from '@/lib/config/network';
import { getIkaClient } from '@/lib/ika/ikaClient';
import type { DWalletKind } from '@/lib/ika/createDWallet';

export interface OwnedDWallet {
  id: string;
  capId: string;
  state: string; // e.g. 'Active' | 'AwaitingKeyHolderSignature' | 'AwaitingNetworkDKGVerification'
  curve: DWalletKind;
  /** Sui epoch the dWallet was created at (used to sort newest-first). */
  createdAtEpoch: number;
}

/** Move curve discriminants: secp256k1=0, secp256r1=1, ed25519=2, ristretto=3. */
function curveLabel(curveNumber: number): DWalletKind {
  if (curveNumber === 0) return 'ECDSA';
  if (curveNumber === 3) return 'Schnorrkel';
  return 'EdDSA';
}

/**
 * The cap type lives in the *original* package, not the current upgraded one — object types keep the
 * address of the package that first defined them across upgrades.
 */
const DWALLET_CAP_TYPE = `${IKA_CONFIG.packages.ikaDwallet2pcMpcOriginalPackage}::coordinator_inner::DWalletCap`;

export async function listDWallets(
  suiClient: AppSuiClient,
  ownerAddress: string
): Promise<OwnedDWallet[]> {
  const ikaClient = await getIkaClient(suiClient);

  // Server-side filtered, paginated query for DWalletCaps only.
  const caps: { capId: string; dwalletId: string }[] = [];
  let cursor: string | null | undefined = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const page: Awaited<ReturnType<typeof suiClient.getOwnedObjects>> =
      await suiClient.getOwnedObjects({
        owner: ownerAddress,
        filter: { StructType: DWALLET_CAP_TYPE },
        options: { showType: true, showContent: true },
        limit: 50,
        cursor,
      });

    for (const item of page.data) {
      const capId = item.data?.objectId;
      const content = item.data?.content;
      if (!capId || !content || content.dataType !== 'moveObject') continue;
      const dwalletId = (content.fields as { dwallet_id?: string }).dwallet_id;
      if (dwalletId) caps.push({ capId, dwalletId });
    }

    hasNextPage = page.hasNextPage;
    cursor = page.nextCursor;
  }

  // Resolve every dWallet concurrently; one bad entry shouldn't hide the rest. A dWallet whose
  // creation was interrupted can exist without ever reaching Active, so failures here are expected
  // rather than exceptional.
  const settled = await Promise.all(
    caps.map(async ({ capId, dwalletId }): Promise<OwnedDWallet | null> => {
      try {
        const dWallet = await ikaClient.getDWallet(dwalletId);
        return {
          id: dwalletId,
          capId,
          state: (dWallet.state as { $kind?: string }).$kind ?? 'Unknown',
          curve: curveLabel(dWallet.curve as number),
          createdAtEpoch: Number((dWallet as { created_at_epoch?: string }).created_at_epoch ?? 0),
        };
      } catch (e) {
        console.warn('Could not load dWallet for cap', capId, e);
        return null;
      }
    })
  );

  // Newest first — the dWallet you just created shows at the top.
  return settled
    .filter((w): w is OwnedDWallet => w !== null)
    .sort((a, b) => b.createdAtEpoch - a.createdAtEpoch);
}
