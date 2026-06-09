/**
 * List the dWallets owned by an address by reading them directly from Sui.
 *
 * Strategy: paginate the address's owned objects → keep DWalletCap objects → for each cap, read its
 * `dwallet_id` and fetch the dWallet to get its state + curve. No backend involved.
 */

import { SuiClient } from '@mysten/sui/client';
import { IkaClient, getNetworkConfig } from '@ika.xyz/sdk';

export interface OwnedDWallet {
  id: string;
  capId: string;
  state: string; // e.g. 'Active' | 'AwaitingKeyHolderSignature' | 'AwaitingNetworkDKGVerification'
  curve: 'ECDSA' | 'EdDSA';
  /** Sui epoch the dWallet was created at (used to sort newest-first). */
  createdAtEpoch: number;
}

export async function listDWallets(suiClient: SuiClient, ownerAddress: string): Promise<OwnedDWallet[]> {
  const ikaClient = new IkaClient({
    suiClient,
    config: getNetworkConfig('testnet'),
    cache: true,
  });
  await ikaClient.initialize();

  // Paginate all owned objects.
  const owned: any[] = [];
  let cursor: string | null | undefined = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const page = await suiClient.getOwnedObjects({
      owner: ownerAddress,
      options: { showType: true, showContent: true },
      limit: 50,
      cursor,
    });
    owned.push(...page.data);
    hasNextPage = page.hasNextPage;
    cursor = page.nextCursor;
  }

  const caps = owned.filter((o) => o.data?.type?.includes('DWalletCap'));

  const results: OwnedDWallet[] = [];
  for (const cap of caps) {
    try {
      const content = cap.data?.content as any;
      const dwalletId = content?.fields?.dwallet_id;
      if (!dwalletId) continue;

      const dWallet = await ikaClient.getDWallet(dwalletId);
      results.push({
        id: dwalletId,
        capId: cap.data!.objectId,
        state: (dWallet.state as any).$kind ?? 'Unknown',
        curve: dWallet.curve === 0 ? 'ECDSA' : 'EdDSA',
        createdAtEpoch: Number((dWallet as any).created_at_epoch ?? 0),
      });
    } catch (e) {
      console.warn('Could not load dWallet for cap', cap.data?.objectId, e);
    }
  }

  // Newest first — the dWallet you just created shows at the top.
  results.sort((a, b) => b.createdAtEpoch - a.createdAtEpoch);

  return results;
}
