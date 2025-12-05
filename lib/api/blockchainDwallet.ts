/**
 * Blockchain-based dWallet API
 * Fetches dWallet info directly from Sui blockchain using IkaClient
 */

import { SuiClient } from '@mysten/sui/client';
import { IkaClient, getNetworkConfig } from '@ika.xyz/sdk';

const TESTNET_RPC = 'https://fullnode.testnet.sui.io:443';

/**
 * Get dWallets owned by a specific address
 */
export async function getDWalletsFromBlockchain(ownerAddress: string) {
  try {
    const suiClient = new SuiClient({ url: TESTNET_RPC });
    const ikaClient = new IkaClient({
      suiClient,
      config: getNetworkConfig('testnet'),
    });

    await ikaClient.initialize();

    // Get all objects owned by the address
    const ownedObjects = await suiClient.getOwnedObjects({
      owner: ownerAddress,
      options: {
        showType: true,
        showContent: true,
        showOwner: true,
      },
    });

    console.log('📦 Total owned objects:', ownedObjects.data.length);

    // Filter for DWalletCap objects
    const dWalletCaps = ownedObjects.data.filter((obj) => {
      const type = obj.data?.type;
      return type && type.includes('DWalletCap');
    });

    console.log('🎯 Found DWalletCaps:', dWalletCaps.length);

    // Extract dWallet IDs from DWalletCap objects
    const dWallets = [];
    for (const cap of dWalletCaps) {
      try {
        const content = cap.data?.content as any;
        if (content?.dataType === 'moveObject' && content.fields) {
          const dWalletId = content.fields.dwallet_id || content.fields.dwallet;

          if (dWalletId) {
            console.log('🔍 Fetching dWallet details for:', dWalletId);

            // Get full dWallet details from IkaClient
            const dWallet = await ikaClient.getDWallet(dWalletId);

            dWallets.push({
              id: dWalletId,
              capId: cap.data!.objectId,
              state: dWallet.state.$kind,
              curve: dWallet.curve,
              owner: ownerAddress,
            });
          }
        }
      } catch (error) {
        console.error('Error fetching dWallet details:', error);
      }
    }

    return dWallets;
  } catch (error) {
    console.error('Error fetching dWallets from blockchain:', error);
    throw error;
  }
}

/**
 * Get specific dWallet details by ID
 */
export async function getDWalletById(dWalletId: string) {
  try {
    const suiClient = new SuiClient({ url: TESTNET_RPC });
    const ikaClient = new IkaClient({
      suiClient,
      config: getNetworkConfig('testnet'),
    });

    await ikaClient.initialize();

    const dWallet = await ikaClient.getDWallet(dWalletId);

    return {
      id: dWalletId,
      state: dWallet.state.$kind,
      curve: dWallet.curve,
      publicKey: dWallet.publicKeyCommitment,
      createdAt: dWallet.createdAt,
    };
  } catch (error) {
    console.error('Error fetching dWallet by ID:', error);
    throw error;
  }
}

/**
 * Check if dWallet is active
 */
export async function isDWalletActive(dWalletId: string): Promise<boolean> {
  try {
    const dwallet = await getDWalletById(dWalletId);
    return dwallet.state === 'Active';
  } catch (error) {
    return false;
  }
}
