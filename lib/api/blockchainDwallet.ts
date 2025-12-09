/**
 * Blockchain-based dWallet API
 * Fetches dWallet info directly from Sui blockchain using IkaClient
 */

import { SuiClient } from '@mysten/sui/client';
import { IkaClient, getNetworkConfig, publicKeyFromDWalletOutput, Curve } from '@ika.xyz/sdk';

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

    // Fetch ALL objects with pagination
    let allObjects: any[] = [];
    let hasNextPage = true;
    let cursor: string | null | undefined = null;

    console.log('📦 Fetching all owned objects with pagination...');

    while (hasNextPage) {
      const response = await suiClient.getOwnedObjects({
        owner: ownerAddress,
        options: {
          showType: true,
          showContent: true,
          showOwner: true,
        },
        limit: 50, // Fetch 50 objects per page
        cursor: cursor,
      });

      allObjects = allObjects.concat(response.data);
      hasNextPage = response.hasNextPage;
      cursor = response.nextCursor;

      console.log(`📄 Fetched page: ${response.data.length} objects (total so far: ${allObjects.length})`);

      if (hasNextPage && cursor) {
        console.log(`➡️ Fetching next page with cursor: ${cursor}`);
      }
    }

    console.log('📦 Total owned objects (all pages):', allObjects.length);

    // Filter for DWalletCap objects
    const dWalletCaps = allObjects.filter((obj) => {
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

    console.log('🔍 dWallet state:', dWallet.state.$kind);
    console.log('🔍 Full dWallet object:', JSON.stringify(dWallet, null, 2));

    // Extract public key using official Ika SDK method
    let publicKey: string | undefined = undefined;

    // Extract public_output bytes from state
    if (dWallet.state.$kind === 'AwaitingKeyHolderSignature') {
      const stateData = dWallet.state as any;
      const pubOutputBytes = stateData.AwaitingKeyHolderSignature?.public_output;

      if (pubOutputBytes && Array.isArray(pubOutputBytes)) {
        // Use official Ika SDK method to extract actual public key
        const curve = dWallet.curve === 0 ? Curve.SECP256K1 : Curve.ED25519;
        console.log('🔬 public_output bytes length:', pubOutputBytes.length);

        const actualPublicKey = await publicKeyFromDWalletOutput(
          curve,
          Uint8Array.from(pubOutputBytes)
        );
        publicKey = '0x' + Buffer.from(actualPublicKey).toString('hex');
        console.log('✅ Extracted public key using Ika SDK');
        console.log('🔑 Public key:', publicKey);
        console.log('🔑 Public key length:', publicKey.length, 'bytes:', actualPublicKey.length);
      }
    } else if (dWallet.state.$kind === 'Active') {
      const stateData = dWallet.state as any;
      const pubOutputBytes = stateData.Active?.public_output;

      if (pubOutputBytes && Array.isArray(pubOutputBytes)) {
        // Use official Ika SDK method to extract actual public key
        const curve = dWallet.curve === 0 ? Curve.SECP256K1 : Curve.ED25519;
        console.log('🔬 public_output bytes length:', pubOutputBytes.length);

        const actualPublicKey = await publicKeyFromDWalletOutput(
          curve,
          Uint8Array.from(pubOutputBytes)
        );
        publicKey = '0x' + Buffer.from(actualPublicKey).toString('hex');
        console.log('✅ Extracted public key using Ika SDK');
        console.log('🔑 Public key:', publicKey);
        console.log('🔑 Public key length:', publicKey.length, 'bytes:', actualPublicKey.length);
      }
    }

    // For zero-trust dWallets, we need to find the encrypted share
    // The encrypted share is typically created as a separate object during DKG
    let encryptedShareId: string | undefined = undefined;

    // First, try to get it from the dWallet object itself
    const dWalletObj = await suiClient.getObject({
      id: dWalletId,
      options: { showContent: true, showType: true },
    });

    console.log('🔍 dWallet object type:', dWalletObj.data?.type);
    console.log('🔍 dWallet object content:', JSON.stringify((dWalletObj.data?.content as any)?.fields, null, 2));

    // Try multiple strategies to find the encrypted share
    const content = (dWalletObj.data?.content as any)?.fields;

    // Strategy 1: Check if it's in encrypted_user_secret_key_shares field
    if (content?.encrypted_user_secret_key_shares) {
      const shares = content.encrypted_user_secret_key_shares;
      console.log('📦 Found encrypted_user_secret_key_shares:', shares);

      // Check if it's a Table with an id field
      if (shares.type?.includes('Table') && shares.fields?.id?.id) {
        const tableId = shares.fields.id.id;
        console.log('📋 Table ID:', tableId);

        // Query dynamic fields of the table
        try {
          const dynamicFields = await suiClient.getDynamicFields({
            parentId: tableId,
          });

          console.log('🔍 Dynamic fields:', dynamicFields);

          if (dynamicFields.data.length > 0) {
            // Get the first dynamic field value
            const firstField = dynamicFields.data[0];
            const fieldObject = await suiClient.getDynamicFieldObject({
              parentId: tableId,
              name: firstField.name,
            });

            console.log('📄 Field object:', fieldObject);

            // Extract the encrypted share ID from the field value
            const fieldContent = (fieldObject.data?.content as any)?.fields?.value;
            if (fieldContent?.fields?.id?.id) {
              encryptedShareId = fieldContent.fields.id.id;
            } else if (typeof fieldContent === 'string') {
              encryptedShareId = fieldContent;
            }
          }
        } catch (err) {
          console.warn('Could not query table dynamic fields:', err);
        }
      }
    }

    console.log('📝 Final encrypted share ID:', encryptedShareId);

    return {
      id: dWalletId,
      state: dWallet.state.$kind,
      curve: dWallet.curve,
      publicKey,
      createdAt: (dWallet as any).created_at_epoch,
      dwalletCapId: dWallet.dwallet_cap_id,
      encryptedShareId,
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
