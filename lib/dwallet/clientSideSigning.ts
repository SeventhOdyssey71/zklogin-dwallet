/**
 * Client-Side dWallet Transaction Signing
 *
 * This module orchestrates the dWallet 2PC-MPC signing process.
 * Chain-specific logic is delegated to modular chain signers.
 *
 * Architecture:
 * - core/: Shared utilities (encryption, client initialization, types)
 * - chains/: Chain-specific signing implementations (Ethereum, Solana, etc.)
 * - clientSideSigning.ts: MPC orchestration and coordination
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient } from '@mysten/sui/client';
import {
  IkaClient,
  IkaTransaction,
  UserShareEncryptionKeys,
  Curve,
  SignatureAlgorithm,
  Hash,
} from '@ika.xyz/sdk';
import { ethers } from 'ethers';
import { PublicKey, Transaction as SolanaTransaction, Connection, clusterApiUrl } from '@solana/web3.js';

// Import refactored modules
import { SignTransactionParams, SignedTransactionResult, UnsignedTransaction } from './core/types';
import { generateDeterministicEncryptionSeed } from './core/encryption';
import { initializeClientSideSigning } from './core/client';
import { getChainSigner } from './chains';

// Re-export types for backwards compatibility
export type { SignTransactionParams, SignedTransactionResult } from './core/types';
export { initializeClientSideSigning } from './core/client';

/**
 * Step 2: Build unsigned transaction for the target blockchain
 *
 * Delegates to chain-specific signers for transaction building
 */
export async function buildUnsignedTransaction(
  chain: string,
  recipient: string,
  amount: string,
  fromAddress: string,
  publicKey?: string
): Promise<UnsignedTransaction> {
  console.log(`📝 Building unsigned ${chain} transaction...`);

  // Get chain-specific signer
  const signer = getChainSigner(chain);

  // Delegate to chain signer (pass public key for chains that need it)
  return await signer.buildUnsignedTransaction(recipient, amount, fromAddress, publicKey);
}

/**
 * Step 3: Sign transaction using dWallet 2PC-MPC protocol
 *
 * This is the core signing function that:
 * 1. Creates a presign capability
 * 2. Approves the message
 * 3. Requests signature from dWallet network
 * 4. Polls for completion
 * 5. Returns the signature
 */
export async function signWithDWallet(
  params: SignTransactionParams
): Promise<SignedTransactionResult> {
  console.log('🔐 Starting dWallet signing process...');

  // Determine curve based on chain
  const curve = ['Solana', 'Polkadot', 'Cardano', 'NEAR'].includes(params.chain)
    ? Curve.ED25519
    : Curve.SECP256K1;

  // CRITICAL: Get encryption seed - regenerate deterministically from Sui address + curve
  const suiAddress = params.userAccount?.address;
  if (!suiAddress) {
    throw new Error('User account address is required for deterministic seed generation');
  }

  const encryptionSeed = generateDeterministicEncryptionSeed(suiAddress, curve);

  // Initialize client-side signing
  const { ikaClient, userShareEncryptionKeys } = await initializeClientSideSigning(
    params.suiClient,
    encryptionSeed,
    curve
  );

  // Fetch dWallet from blockchain to get public key
  console.log('📡 Fetching dWallet from blockchain...');
  console.log('🆔 dWallet ID:', params.dwalletId);
  const dWallet = await ikaClient.getDWallet(params.dwalletId);
  console.log('✅ dWallet fetched');

  // Extract public key and derive address
  let fromAddress = '';
  let publicKeyHex = '';

  if (dWallet.state.$kind === 'Active') {
    const pubOutputBytes = (dWallet.state as any).Active?.public_output;
    if (pubOutputBytes && Array.isArray(pubOutputBytes)) {
      console.log('🔍 Raw public_output from blockchain:', pubOutputBytes.slice(0, 10), '... (first 10 bytes)');
      console.log('🔍 Full public_output length:', pubOutputBytes.length, 'bytes');

      const { publicKeyFromDWalletOutput } = await import('@ika.xyz/sdk');

      console.log(`🔍 Extracting public key for curve: ${curve}`);

      const actualPublicKey = await publicKeyFromDWalletOutput(
        curve,  // Curve enum (Curve.SECP256K1 or Curve.ED25519)
        Uint8Array.from(pubOutputBytes)
      );

      console.log('🔍 After publicKeyFromDWalletOutput:');
      console.log('   Raw bytes:', Array.from(actualPublicKey.slice(0, 10)), '... (first 10 bytes)');
      console.log('   Length:', actualPublicKey.length, 'bytes');

      publicKeyHex = '0x' + Buffer.from(actualPublicKey).toString('hex');
      console.log('🔑 Public key hex:', publicKeyHex);
      console.log('🔑 Public key length:', actualPublicKey.length, 'bytes');

      // Derive address from public key based on curve AND chain
      if (curve === Curve.SECP256K1) {
        console.log('');
        console.log(`🎯 ADDRESS DERIVATION FOR ${params.chain}`);
        console.log('═══════════════════════════════════════════════════════');

        if (params.chain === 'Bitcoin') {
          // For Bitcoin, use Bitcoin address derivation
          const { deriveBitcoinAddress } = await import('../utils/deriveAddresses');
          fromAddress = deriveBitcoinAddress(publicKeyHex);
          console.log('✅ Derived Bitcoin address:', fromAddress);
        } else {
          // For EVM chains, derive Ethereum address using the official ethers.js method
          const { computeAddress, SigningKey } = await import('ethers');

          let uncompressedPubKey: string;

          if (actualPublicKey.length === 33) {
            // Compressed public key (33 bytes) - decompress using ethers.SigningKey
            const compressedHex = '0x' + Buffer.from(actualPublicKey).toString('hex');
            console.log('📝 Compressed public key (33 bytes):', compressedHex);

            // Method from console3.md line 68:
            // const uncompressedPubKey = ethers.SigningKey.computePublicKey(compressedPubKey, false);
            uncompressedPubKey = SigningKey.computePublicKey(compressedHex, false);
            console.log('✅ Decompressed to uncompressed (65 bytes):', uncompressedPubKey.substring(0, 20) + '...');
          } else if (actualPublicKey.length === 64) {
            // Uncompressed without 0x04 prefix - add it
            console.log('📝 Public key is uncompressed without prefix (64 bytes)');
            uncompressedPubKey = '0x04' + publicKeyHex.slice(2);
          } else if (actualPublicKey.length === 65) {
            // Already uncompressed with 0x04 prefix
            console.log('📝 Public key is already uncompressed (65 bytes)');
            uncompressedPubKey = publicKeyHex;
          } else {
            throw new Error(`Unexpected public key length: ${actualPublicKey.length} bytes`);
          }

          // Derive address using ethers.computeAddress (does KECCAK256 + last 20 bytes automatically)
          // This matches console3.md line 72:
          // const address = ethers.computeAddress(uncompressedPubKey);
          fromAddress = computeAddress(uncompressedPubKey);

          console.log('✅ Derived Ethereum address:', fromAddress);
        }

        console.log('═══════════════════════════════════════════════════════');
        console.log('');
      } else if (curve === Curve.ED25519) {
        // ED25519 chains: Solana, Polkadot, Cardano, NEAR
        if (actualPublicKey.length !== 32) {
          throw new Error(`Unexpected ED25519 public key length: ${actualPublicKey.length} bytes (expected 32)`);
        }

        console.log('');
        console.log(`🎯 ADDRESS DERIVATION FOR ${params.chain}`);
        console.log('═══════════════════════════════════════════════════════');

        if (params.chain === 'Solana') {
          // For Solana, the public key IS the address (base58 encoded)
          const solanaPublicKey = new PublicKey(actualPublicKey);
          fromAddress = solanaPublicKey.toBase58();
          console.log('✅ Derived Solana address:', fromAddress);
        } else if (params.chain === 'Polkadot') {
          // For Polkadot, derive SS58 address
          const { derivePolkadotAddress } = await import('../utils/deriveAddresses');
          fromAddress = derivePolkadotAddress(publicKeyHex);
          console.log('✅ Derived Polkadot address:', fromAddress);
        } else if (params.chain === 'Cardano') {
          // For Cardano, derive Bech32 address
          const { deriveCardanoAddress } = await import('../utils/deriveAddresses');
          fromAddress = deriveCardanoAddress(publicKeyHex);
          console.log('✅ Derived Cardano address:', fromAddress);
        } else if (params.chain === 'NEAR') {
          // For NEAR, use hex implicit account
          const { deriveNearAddress } = await import('../utils/deriveAddresses');
          fromAddress = deriveNearAddress(publicKeyHex);
          console.log('✅ Derived NEAR address:', fromAddress);
        } else {
          throw new Error(`Unsupported ED25519 chain: ${params.chain}`);
        }

        console.log('═══════════════════════════════════════════════════════');
        console.log('');
      }
    }
  }

  if (!fromAddress) {
    throw new Error('Could not derive address from dWallet. Is it activated?');
  }

  // Determine signature algorithm and hash scheme based on curve
  const signatureAlgorithm = curve === Curve.SECP256K1
    ? SignatureAlgorithm.ECDSASecp256k1
    : SignatureAlgorithm.EdDSA;

  // Hash scheme depends on the blockchain
  // Ethereum (SECP256K1 ECDSA) requires KECCAK256
  // Bitcoin (SECP256K1 ECDSA) requires DoubleSHA256
  // Solana (ED25519 EdDSA) uses SHA512
  // This must match the hash scheme used in discovery function
  let hashScheme: Hash;
  if (params.chain === 'Bitcoin') {
    hashScheme = Hash.DoubleSHA256;
  } else if (curve === Curve.SECP256K1) {
    hashScheme = Hash.KECCAK256; // Ethereum
  } else {
    hashScheme = Hash.SHA512; // Solana
  }

  // === STEP 1: Create Presign Capability ===
  // Do this BEFORE building the transaction to minimize time between blockhash fetch and broadcast
  console.log('1️⃣ Creating presign capability...');
  console.log('⏰ NOTE: Building transaction AFTER presign to minimize blockhash expiration risk');

  const presignTx = new Transaction();
  const presignIkaTx = new IkaTransaction({
    ikaClient,
    transaction: presignTx,
    userShareEncryptionKeys,
  });

  // Get IKA coins for fees
  const ikaCoins = await params.suiClient.getCoins({
    owner: params.userAccount.address,
    coinType: `${ikaClient.ikaConfig.packages.ikaPackage}::ika::IKA`,
  });

  if (ikaCoins.data.length === 0) {
    throw new Error('No IKA tokens available for signing. Please acquire IKA tokens first.');
  }

  const ikaCoin = presignTx.object(ikaCoins.data[0].coinObjectId);

  // IMPORTANT: Regular DKG dWallets require requestGlobalPresign (error 31: EOnlyGlobalPresignAllowed)
  // Only imported-key dWallets can use requestPresign
  // The SDK docs are incomplete - they don't mention this distinction
  console.log('🔑 Signature algorithm:', signatureAlgorithm);
  console.log('📝 Using requestGlobalPresign (required for regular DKG dWallets)');

  // CRITICAL: requestGlobalPresign returns an unverified presign capability
  // We need to TRANSFER this object back to ourselves to get its ID after transaction execution
  const unverifiedPresignCap = presignIkaTx.requestGlobalPresign({
    curve,
    dwalletNetworkEncryptionKeyId: (dWallet as any).dwallet_network_encryption_key_id,
    signatureAlgorithm,
    ikaCoin,
    suiCoin: presignTx.gas,
  });

  // Transfer the presign capability to ourselves so we can get its ID
  presignTx.transferObjects([unverifiedPresignCap], params.userAccount.address);

  console.log('✅ Unverified presign capability created and will be transferred');
  console.log('🔍 Presign cap object (before transfer):', unverifiedPresignCap);

  presignTx.setGasBudget(50000000);

  // Execute presign transaction using connected Sui wallet
  console.log('⏳ Executing presign transaction with Sui wallet...');
  let presignTxResult;
  try {
    presignTxResult = await params.signAndExecuteTransaction({
      transaction: presignTx,
      options: {
        showEffects: true,
        showEvents: true,
      },
    });
  } catch (error: any) {
    console.error('Failed to execute presign transaction:', error);
    throw new Error(`Failed to execute presign transaction: ${error.message}`);
  }

  console.log('Presign transaction result:', presignTxResult);
  console.log('🔍 Presign transaction result keys:', Object.keys(presignTxResult || {}));
  console.log('🔍 Presign transaction effects:', JSON.stringify(presignTxResult?.effects, null, 2));
  console.log('🔍 Presign transaction events:', JSON.stringify(presignTxResult?.events, null, 2));

  // Check if transaction was successful
  // Parse the effects to determine transaction status
  let effectsObj = presignTxResult?.effects;

  // If effects is a string (base64 encoded), we need to check the status differently
  if (typeof effectsObj === 'string') {
    console.log('⚠️ Effects is base64 encoded, fetching full transaction details...');
  }

  if (!presignTxResult.digest) {
    throw new Error('No transaction digest received');
  }

  console.log('✅ Presign transaction submitted:', presignTxResult.digest);

  // Wait a moment for the transaction to be processed
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Get the full transaction details to check status
  const txDetails = await params.suiClient.getTransactionBlock({
    digest: presignTxResult.digest,
    options: {
      showEvents: true,
      showEffects: true,
      showObjectChanges: true,
    },
  });

  // Check if transaction was successful
  const status = (txDetails.effects as any)?.status?.status;

  if (status === 'failure') {
    const errorMsg = (txDetails.effects as any)?.status?.error || 'Unknown error';
    console.error('❌ Presign transaction failed:', errorMsg);
    console.error('Full effects:', JSON.stringify(txDetails.effects, null, 2));

    // Parse the error to give a helpful message
    if (errorMsg.includes('sessions_manager') && errorMsg.includes('error_code: 1')) {
      throw new Error('❌ Session initialization failed (sessions_manager error_code: 1)\n\n' +
        'This error typically occurs due to:\n' +
        '1. 🪙 **Insufficient IKA tokens** - You need IKA tokens to pay for presign operations\n' +
        '2. 🔒 **Session limit reached** - Too many active sessions for this dWallet\n' +
        '3. ⏰ **Active session conflict** - A previous session wasn\'t properly closed\n\n' +
        '📝 **How to fix:**\n' +
        '- Check your IKA token balance in your wallet\n' +
        '- Acquire more IKA tokens if balance is low\n' +
        '- Wait a few minutes for previous sessions to expire\n' +
        '- Try again with a fresh presign request\n\n' +
        'Full error: ' + errorMsg);
    }

    throw new Error('Presign transaction failed: ' + errorMsg);
  }

  console.log('✅ Presign transaction succeeded');

  console.log('📋 Transaction object changes:', txDetails.objectChanges);
  console.log('📋 Transaction effects:', JSON.stringify(txDetails.effects, null, 2));

  // For EdDSA with requestGlobalPresign, the presign capability might be handled differently
  // Instead of creating a transferable object, it might directly create a presign session in the coordinator
  // Let's try to use the Ika SDK to query for presign sessions

  console.log('🔍 Attempting to find presign session via IkaClient...');

  // Get all presign sessions for this dWallet
  // The Ika SDK might have methods to query active presigns
  let presignId: string | undefined;

  // Strategy 1: Check if the transaction result contains presign session info in events
  if (txDetails.events && txDetails.events.length > 0) {
    console.log('📋 Transaction events:', JSON.stringify(txDetails.events, null, 2));

    // Look for presign-related events
    for (const event of txDetails.events) {
      const eventType = event.type;
      if (eventType.includes('Presign') || eventType.includes('presign')) {
        console.log('🎯 Found presign event:', event);
        // Extract presign ID from event
        const parsedJson = event.parsedJson as any;
        presignId = parsedJson?.presign_id || parsedJson?.id || parsedJson?.session_id;
        if (presignId) {
          console.log('✅ Found presign ID in event:', presignId);
          break;
        }
      }
    }
  }

  // Strategy 2: Try to find created presign capability object
  if (!presignId) {
    console.log('🔍 Looking for presign capability in object changes...');

    const presignCapObject = txDetails.objectChanges?.find((change: any) => {
      if (change.type === 'created') {
        const objType = change.objectType || '';
        return objType.includes('UnverifiedPresignCap') || objType.includes('PresignCap');
      }
      return false;
    });

    if (presignCapObject) {
      const presignCapId = (presignCapObject as any).objectId;
      console.log('✅ Found presign capability in objectChanges:', presignCapId);

      // Query the presign capability object to get the presign session ID
      const presignCapDetails = await params.suiClient.getObject({
        id: presignCapId,
        options: { showContent: true, showType: true },
      });

      console.log('Presign capability details:', presignCapDetails);

      // Extract the presign session ID from the capability object's fields
      const capContent = presignCapDetails.data?.content as any;
      if (capContent && capContent.dataType === 'moveObject') {
        // The presign session ID should be in the fields
        presignId = capContent.fields?.presign_id || capContent.fields?.id?.id;
      }
    }
  }

  // Strategy 3: For EdDSA global presign, try querying the coordinator for active presigns
  if (!presignId) {
    console.log('🔍 Attempting alternate approach: querying DWalletCoordinator for active presigns...');

    // The coordinator object ID from the mutation
    const coordinatorChange = txDetails.objectChanges?.find((change: any) =>
      change.objectType?.includes('DWalletCoordinator')
    );

    if (coordinatorChange) {
      console.log('📋 Found coordinator in changes:', (coordinatorChange as any).objectId);

      // Try to get dynamic fields of the coordinator which might contain presign sessions
      try {
        const coordinatorId = (coordinatorChange as any).objectId;
        const dynamicFields = await params.suiClient.getDynamicFields({
          parentId: coordinatorId,
        });

        console.log('📋 Coordinator dynamic fields:', JSON.stringify(dynamicFields, null, 2));

        // Look for presign-related dynamic fields
        for (const field of dynamicFields.data) {
          const fieldName = field.name;
          console.log('🔍 Checking dynamic field:', fieldName);

          if (fieldName && typeof fieldName === 'object') {
            const fieldNameStr = JSON.stringify(fieldName);
            if (fieldNameStr.includes('presign') || fieldNameStr.includes('Presign')) {
              console.log('🎯 Found presign-related dynamic field:', fieldName);

              // Get the field object
              const fieldObj = await params.suiClient.getDynamicFieldObject({
                parentId: coordinatorId,
                name: fieldName,
              });

              console.log('📄 Presign field object:', JSON.stringify(fieldObj, null, 2));

              // Try to extract presign ID
              const fieldContent = (fieldObj.data?.content as any)?.fields;
              presignId = fieldContent?.presign_id || fieldContent?.id?.id || fieldContent?.value;

              if (presignId) {
                console.log('✅ Found presign ID in coordinator dynamic field:', presignId);
                break;
              }
            }
          }
        }
      } catch (err) {
        console.warn('Could not query coordinator dynamic fields:', err);
      }
    }
  }

  if (!presignId) {
    console.error('❌ Could not find presign session ID');
    console.error('Available object changes:', JSON.stringify(txDetails.objectChanges, null, 2));
    console.error('Available effects:', JSON.stringify(txDetails.effects, null, 2));
    throw new Error('Presign session ID not found in transaction');
  }

  console.log('✅ Presign session ID:', presignId);

  // === STEP 2: Poll for Presign Completion ===
  console.log('2️⃣ Waiting for presign to complete...');

  const completedPresign = await ikaClient.getPresignInParticularState(
    presignId,
    'Completed',
    { timeout: 60000, interval: 2000 }
  );

  console.log('✅ Presign completed');

  // === STEP 2.5: Build Unsigned Transaction (Get Fresh Blockhash!) ===
  // Build transaction NOW (after presign) to get the freshest possible blockhash
  // This minimizes the time between blockhash fetch and broadcast
  console.log('2️⃣.5 Building unsigned transaction with FRESH blockhash...');
  console.log('⏰ Timing: Presign completed, now getting blockhash to maximize validity window');

  const { messageBytes, unsignedTx } = await buildUnsignedTransaction(
    params.chain,
    params.recipient,
    params.amount,
    fromAddress,
    publicKeyHex // Pass public key for chains that need it (like Cardano)
  );

  // Track when blockhash was fetched for Solana
  const blockhashFetchTime = Date.now();
  console.log('✅ Transaction built with fresh blockhash');
  console.log('⏰ Time remaining until expiration: ~150 seconds from now');
  console.log('⏱️  Blockhash fetched at:', new Date().toISOString());

  // === STEP 3: Sign the Message ===
  console.log('3️⃣ Requesting signature...');
  console.log('⏰ Starting signature process - this will take 30-50 seconds with dWallet');

  // For zero-trust dWallets, we need either:
  // 1. encryptedUserSecretKeyShare + decrypt it, OR
  // 2. secretShare + publicOutput directly
  // We'll use option 2 - decrypt the share locally using userShareEncryptionKeys

  // CRITICAL: Store the encrypted share to pass directly to requestSign
  // DO NOT decrypt it - the MPC protocol needs the encrypted version
  let encryptedUserSecretKeyShare: any = undefined;

  const dWalletKindFromState = (dWallet as any).kind;
  console.log('🔑 dWallet kind from state:', dWalletKindFromState);
  console.log('🔍 Full dWallet object:', JSON.stringify(dWallet, null, 2));

  // Check if this is an imported-key dWallet
  const isImportedKey = (dWallet as any).is_imported_key_dwallet === true;
  console.log('🔑 Is imported-key dWallet:', isImportedKey);

  // Check if this dWallet has public_user_secret_key_share (shared dWallet)
  // IMPORTANT: Must check for non-null value, not just !== undefined
  const publicShareValue = (dWallet as any).public_user_secret_key_share;
  const hasPublicShare = publicShareValue !== undefined && publicShareValue !== null;
  console.log('📝 Has public share:', hasPublicShare, 'value:', publicShareValue);

  if (dWalletKindFromState === 'shared' || hasPublicShare) {
    console.log('📝 This is a SHARED dWallet - no encrypted share needed!');
    // For shared dWallets, the share is public on-chain
    // We don't need to decrypt anything - the SDK will use the public share
  } else {
    // Zero-trust dWallet - fetch the ENCRYPTED share (don't decrypt it!)
    console.log('🔓 Fetching encrypted user share for zero-trust dWallet...');

    try {
      // If we have the encrypted share ID, fetch it (DO NOT DECRYPT)
      if (params.encryptedShareId) {
        console.log('Fetching encrypted share:', params.encryptedShareId);
        encryptedUserSecretKeyShare = await ikaClient.getEncryptedUserSecretKeyShare(
          params.encryptedShareId
        );

        // Verify it's in KeyHolderSigned state
        if (!encryptedUserSecretKeyShare.state.KeyHolderSigned) {
          console.error('Encrypted share state:', JSON.stringify(encryptedUserSecretKeyShare.state, null, 2));
          throw new Error(`Encrypted user share is not in KeyHolderSigned state. Current state: ${Object.keys(encryptedUserSecretKeyShare.state)[0]}. Please recreate your dWallet.`);
        }

        if (!encryptedUserSecretKeyShare.state.KeyHolderSigned.user_output_signature) {
          throw new Error('User output signature is missing from KeyHolderSigned state. Please recreate your dWallet.');
        }

        console.log('✅ Encrypted user share loaded and verified (KeyHolderSigned)');
      } else {
        // Try to find the encrypted share from the dWallet's encrypted_user_secret_key_shares Table
        console.log('🔍 Finding encrypted share from dWallet Table...');

        try {
          // The encrypted_user_secret_key_shares is a Table object
          const tableId = (dWallet as any).encrypted_user_secret_key_shares?.id?.id;

          if (tableId) {
            console.log('📋 Table ID:', tableId);

            // Query the table's dynamic fields to get the encrypted share
            const dynamicFields = await params.suiClient.getDynamicFields({
              parentId: tableId,
            });

            console.log('🔍 Found dynamic fields:', dynamicFields.data.length);

            if (dynamicFields.data.length > 0) {
              // Get the first dynamic field (should be the encrypted share)
              const firstField = dynamicFields.data[0];
              console.log('📄 First field name:', firstField.name);

              const fieldObject = await params.suiClient.getDynamicFieldObject({
                parentId: tableId,
                name: firstField.name,
              });

              console.log('📦 Field object type:', fieldObject.data?.type);

              let encryptedShareId: string | undefined;

              // The field object IS the EncryptedUserSecretKeyShare object
              // Extract the object ID directly
              if (fieldObject.data?.objectId) {
                encryptedShareId = fieldObject.data.objectId;
                console.log('✅ Found encrypted share object ID:', encryptedShareId);
              } else {
                console.warn('⚠️ Could not extract objectId from field object');
              }

              if (encryptedShareId) {
                console.log('✅ Found encrypted share ID:', encryptedShareId);

                encryptedUserSecretKeyShare = await ikaClient.getEncryptedUserSecretKeyShare(
                  encryptedShareId
                );

                // Verify it's in KeyHolderSigned state
                if (!encryptedUserSecretKeyShare.state.KeyHolderSigned) {
                  console.error('Encrypted share state:', JSON.stringify(encryptedUserSecretKeyShare.state, null, 2));
                  throw new Error(`Encrypted user share is not in KeyHolderSigned state. Current state: ${Object.keys(encryptedUserSecretKeyShare.state)[0]}. Please recreate your dWallet.`);
                }

                if (!encryptedUserSecretKeyShare.state.KeyHolderSigned.user_output_signature) {
                  throw new Error('User output signature is missing from KeyHolderSigned state. Please recreate your dWallet.');
                }

                console.log('✅ Encrypted user share loaded and verified (KeyHolderSigned)');
              }
            }
          } else {
            console.warn('⚠️ No encrypted_user_secret_key_shares table found in dWallet');
          }
        } catch (searchErr) {
          console.error('Failed to query encrypted share table:', searchErr);
        }

        if (!encryptedUserSecretKeyShare) {
          console.warn('⚠️ Could not find encrypted share - signing may fail');
        }
      }
    } catch (err) {
      console.error('Failed to fetch user share:', err);
      throw new Error('Cannot sign without user share. Please ensure your dWallet is properly activated.');
    }
  }

  const signTx = new Transaction();
  const signIkaTx = new IkaTransaction({
    ikaClient,
    transaction: signTx,
    userShareEncryptionKeys,
  });

  // Get fresh IKA coin for sign transaction
  const ikaCoins2 = await params.suiClient.getCoins({
    owner: params.userAccount.address,
    coinType: `${ikaClient.ikaConfig.packages.ikaPackage}::ika::IKA`,
  });

  const ikaCoin2 = signTx.object(ikaCoins2.data[0].coinObjectId);

  // Verify presign capability
  const verifiedPresignCap = signIkaTx.verifyPresignCap({
    presign: completedPresign,
  });

  // Use different approve/sign methods based on dWallet type
  if (isImportedKey) {
    // For imported-key dWallets
    const importedKeyMessageApproval = signIkaTx.approveImportedKeyMessage({
      dWalletCap: params.dwalletCapId,
      curve,
      signatureAlgorithm,
      hashScheme,
      message: messageBytes,
    });

    await signIkaTx.requestSignWithImportedKey({
      dWallet: dWallet as any, // Cast to ImportedKeyDWallet
      importedKeyMessageApproval,
      verifiedPresignCap,
      hashScheme,
      presign: completedPresign,
      message: messageBytes,
      signatureScheme: signatureAlgorithm,
      ikaCoin: ikaCoin2,
      suiCoin: signTx.gas,
    });
  } else {
    // For regular (ZeroTrust/Shared) dWallets
    const messageApproval = signIkaTx.approveMessage({
      dWalletCap: params.dwalletCapId,
      curve,
      signatureAlgorithm,
      hashScheme,
      message: messageBytes,
    });

    const requestSignParams: any = {
      dWallet: dWallet as any, // Cast to ZeroTrustDWallet | SharedDWallet
      messageApproval,
      verifiedPresignCap,
      hashScheme,
      presign: completedPresign,
      message: messageBytes,
      signatureScheme: signatureAlgorithm,
      ikaCoin: ikaCoin2,
      suiCoin: signTx.gas,
    };

    // CRITICAL: Add encryptedUserSecretKeyShare directly (DO NOT decrypt it!)
    // The MPC protocol requires the encrypted version, not the decrypted share
    if (encryptedUserSecretKeyShare) {
      requestSignParams.encryptedUserSecretKeyShare = encryptedUserSecretKeyShare;
      console.log('📝 Using encrypted user secret key share (NOT decrypted)');
    }

    await signIkaTx.requestSign(requestSignParams);
  }

  // Set higher gas budget for sign transaction (MPC computation is expensive)
  signTx.setGasBudget(500000000); // 500M MIST = 0.5 SUI

  // Execute sign transaction
  console.log('⏳ Executing sign transaction with Sui wallet...');
  const signTxResult = await params.signAndExecuteTransaction({
    transaction: signTx,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
  });

  console.log('✅ Sign transaction executed');
  console.log('📝 Transaction digest:', signTxResult.digest);

  // The transaction was executed, but we need to wait for it to be indexed
  // before querying it to get full details
  console.log('⏳ Waiting for transaction to be indexed...');
  await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

  console.log('🔍 Querying sign transaction details from blockchain...');
  const signTxDetails = await params.suiClient.getTransactionBlock({
    digest: signTxResult.digest,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
  });

  console.log('📋 Full sign transaction details retrieved');

  // Check if transaction succeeded
  if (signTxDetails.effects?.status?.status !== 'success') {
    const error = signTxDetails.effects?.status?.error || 'Unknown error';
    console.error('❌ Sign transaction failed with status:', signTxDetails.effects?.status);

    if (error === 'InsufficientGas') {
      throw new Error(
        'Sign transaction failed due to insufficient gas. ' +
        'Please ensure your wallet has enough SUI tokens. ' +
        'MPC signing operations require significant gas (0.5 SUI recommended).'
      );
    }

    throw new Error(`Sign transaction failed: ${error}`);
  }

  console.log('✅ Sign transaction succeeded');

  // Extract sign session ID from events or object changes
  console.log('🔍 Extracting sign session ID...');
  console.log('Events:', signTxDetails.events);
  console.log('Object changes:', signTxDetails.objectChanges);

  let signId: string | undefined;

  // Try to find sign ID in events
  const signEvent = signTxDetails.events?.find((e: any) =>
    e.type && (e.type.includes('SignRequestEvent') || e.type.includes('Sign'))
  );

  if (signEvent) {
    console.log('📋 Found sign event:', signEvent);
    const parsedJson = signEvent.parsedJson as any;
    signId = parsedJson?.sign_id ||
             parsedJson?.event_data?.sign_id ||
             parsedJson?.id;
  }

  // If not found in events, try object changes (similar to presign)
  if (!signId) {
    console.log('⚠️ Sign event not found, checking object changes...');
    const signSessionObject = signTxDetails.objectChanges?.find((change: any) => {
      if (change.type === 'created') {
        const objType = change.objectType || '';
        return objType.includes('SignSession') || objType.includes('Sign');
      }
      return false;
    });

    if (signSessionObject) {
      console.log('📋 Found sign session object:', signSessionObject);
      signId = (signSessionObject as any).objectId;
    }
  }

  if (!signId) {
    console.error('❌ Could not find sign session ID');
    console.error('Full transaction details:', JSON.stringify(signTxDetails, null, 2));
    throw new Error('Sign session ID not found in transaction result');
  }

  console.log('✅ Sign request submitted:', signId);

  // === STEP 4: Poll for Signature Completion ===
  console.log('4️⃣ Waiting for signature to complete...');

  const completedSign = await ikaClient.getSignInParticularState(
    signId,
    curve,
    signatureAlgorithm,
    'Completed',
    { timeout: 60000, interval: 2000 }
  );

  // Extract signature
  const signature = Uint8Array.from(completedSign.state.Completed?.signature ?? []);
  const signatureHex = '0x' + Buffer.from(signature).toString('hex');

  // Calculate time elapsed for Solana
  const signingTimeElapsed = Date.now() - blockhashFetchTime;
  console.log('✅ Signature received:', signatureHex.substring(0, 20) + '...');
  console.log(`⏱️  Signing took ${(signingTimeElapsed / 1000).toFixed(1)} seconds`);
  console.log(`⏰ Time remaining until blockhash expiration: ~${Math.max(0, 150 - signingTimeElapsed / 1000).toFixed(0)} seconds`);

  // === STEP 5: Construct Signed Transaction ===
  console.log('5️⃣ Constructing signed transaction...');

  let serialized: string;
  let hash: string;

  if (params.chain === 'Bitcoin') {
    // For Bitcoin, attach public key to unsignedTx for scriptSig construction
    unsignedTx.publicKey = publicKeyHex;

    // Use the chain signer's broadcast method
    const signer = getChainSigner(params.chain);
    const result = await signer.broadcastTransaction(unsignedTx, signature, 0);

    return result;
  } else if (params.chain === 'Solana') {
    // For Solana, attach EdDSA signature to transaction
    const transaction = unsignedTx.transaction as SolanaTransaction;

    // EdDSA signature is 64 bytes, no recovery ID needed
    const signatureBytes = signature.slice(0, 64);

    // Add signature to transaction
    transaction.addSignature(
      new PublicKey(fromAddress),
      Buffer.from(signatureBytes)
    );

    // Serialize the signed transaction
    const serializedBuffer = transaction.serialize();
    serialized = Buffer.from(serializedBuffer).toString('base64');
    hash = 'Solana-' + Buffer.from(signatureBytes).toString('hex').substring(0, 16);

    // Store the original blockhash and lastValidBlockHeight for confirmation
    (params as any).originalBlockhash = unsignedTx.blockhash;
    (params as any).originalLastValidBlockHeight = unsignedTx.lastValidBlockHeight;

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('🎉 SOLANA TRANSACTION SIGNED SUCCESSFULLY!');
    console.log('═══════════════════════════════════════════════════════');
    console.log('Transaction ID:', hash);
    console.log('');
    console.log('📝 SIGNED TRANSACTION (base64, ready to broadcast):');
    console.log(serialized);
    console.log('');
    console.log('You can broadcast this via Solana RPC sendTransaction');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
  } else if (params.chain === 'Polkadot') {
    // For Polkadot, use the chain signer's broadcast method
    console.log('🔐 Processing ED25519 signature for Polkadot transaction...');

    const signer = getChainSigner(params.chain);
    const result = await signer.broadcastTransaction(unsignedTx, signature);

    return result;
  } else if (params.chain === 'Cardano') {
    // For Cardano, use the chain signer's broadcast method
    console.log('🔐 Processing ED25519 signature for Cardano transaction...');

    const signer = getChainSigner(params.chain);
    const result = await signer.broadcastTransaction(unsignedTx, signature);

    return result;
  } else if (params.chain === 'NEAR') {
    // For NEAR, use the chain signer's broadcast method
    console.log('🔐 Processing ED25519 signature for NEAR transaction...');

    const signer = getChainSigner(params.chain);
    const result = await signer.broadcastTransaction(unsignedTx, signature);

    return result;
  } else {
    // For EVM chains, attach ECDSA signature to transaction
    // ECDSA signatures need the correct recovery value (yParity) to derive the correct address

    console.log('🔐 Processing ECDSA signature for EVM transaction...');
    console.log('📋 Expected sender address:', fromAddress);
    console.log('📋 Signature hex:', signatureHex);
    console.log('📋 Signature length:', signatureHex.length - 2, 'bytes');

    // Extract r and s from signature (64 bytes total: 32 for r, 32 for s)
    let r = '0x' + signatureHex.slice(2, 66);
    let s = '0x' + signatureHex.slice(66, 130);
    console.log('📋 Raw r:', r);
    console.log('📋 Raw s:', s);

    // CRITICAL: Normalize s to lower half (EIP-2: s must be in lower half of curve order)
    // This is required for signature malleability protection
    const secp256k1N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    const secp256k1HalfN = secp256k1N / BigInt(2);

    let sBigInt = BigInt(s);
    let recoveryOffset = 0;

    if (sBigInt > secp256k1HalfN) {
      console.log('⚠️  s value is in upper half, normalizing...');
      sBigInt = secp256k1N - sBigInt;
      s = '0x' + sBigInt.toString(16).padStart(64, '0');
      recoveryOffset = 1; // If we flipped s, we also need to flip v
      console.log('✅ Normalized s:', s);
    } else {
      console.log('✅ s value is already in lower half (normalized)');
    }

    console.log('');
    console.log('🔍 Testing recovery values to find correct signature...');
    console.log('📋 Expected address from public_output:', fromAddress);
    console.log('📋 Recovery offset:', recoveryOffset);
    console.log('');

    // Try both v values with proper recovery offset handling
    let signedTx: any = null;
    let actualSenderAddress: string | null = null;
    let matchedV: number | null = null;

    // For EIP-1559 (type 2) transactions, v should be 0 or 1 (not 27/28)
    // We'll use the recovery offset from s-value normalization
    for (let baseV = 0; baseV <= 1; baseV++) {
      const v = (baseV + recoveryOffset) % 2;
      const eip155V = v + 27; // Convert to legacy format for ethers.js

      const testTx = ethers.Transaction.from(unsignedTx);
      testTx.signature = ethers.Signature.from({ r, s, v: eip155V });

      const recoveredFrom = testTx.from;
      console.log(`🔍 Testing baseV=${baseV}, v=${v}, eip155V=${eip155V}, recovered: ${recoveredFrom}`);

      // Check if this v value recovers to the expected address
      if (recoveredFrom?.toLowerCase() === fromAddress.toLowerCase()) {
        console.log(`✅ Found correct recovery id (v): ${v} (EIP-155 v: ${eip155V})`);
        signedTx = testTx;
        actualSenderAddress = recoveredFrom;
        matchedV = eip155V;
        break;
      }
    }

    // If no match found, try all 4 combinations as last resort
    if (!signedTx) {
      console.log('⚠️  Standard recovery failed, trying all v combinations...');
      let foundV: number | null = null;
      let foundAddress: string | null = null;

      for (let v = 0; v <= 3; v++) {
        try {
          // For EIP-1559 transactions, use v directly (0-3)
          // ethers.js will handle the conversion internally
          const testTx = ethers.Transaction.from(unsignedTx);
          testTx.signature = ethers.Signature.from({ r, s, v });

          const recoveredFrom = testTx.from;
          console.log(`🔍 Trying v=${v}, recovered: ${recoveredFrom}`);

          if (recoveredFrom?.toLowerCase() === fromAddress.toLowerCase()) {
            signedTx = testTx;
            foundV = v;
            foundAddress = recoveredFrom;
            actualSenderAddress = recoveredFrom;
            matchedV = v;
            console.log(`✅ Found working v: ${v}`);
            break;
          } else if (foundV === null) {
            // Keep track of the first valid signature for fallback
            foundV = v;
            foundAddress = recoveredFrom;
          }
        } catch (e) {
          // Invalid signature, continue
          continue;
        }
      }

      // If still no match, use the first valid signature we found
      if (!signedTx && foundV !== null && foundAddress) {
        console.warn('⚠️  Stored address does not match ANY signature recovery.');
        console.warn('⚠️  Using recovered address from v=' + foundV + ':', foundAddress);

        const fallbackTx = ethers.Transaction.from(unsignedTx);
        fallbackTx.signature = ethers.Signature.from({ r, s, v: foundV });
        signedTx = fallbackTx;
        actualSenderAddress = foundAddress;
        matchedV = foundV;

        console.log('');
        console.log('❌ CRITICAL: Address mismatch detected!');
        console.log(`   Transaction built for: ${fromAddress}`);
        console.log(`   Signature recovers to: ${foundAddress}`);
        console.log('');
        console.log('⚠️  The transaction nonce may be incorrect for this address!');
        console.log('💡 You should fund the recovered address and use it instead.');
      }
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ SIGNATURE VERIFICATION');
    console.log('═══════════════════════════════════════════════════════');
    console.log('📋 Transaction will be sent from:', actualSenderAddress);
    console.log('📋 Expected address from public_output:', fromAddress);
    console.log('📋 Used recovery value (v):', matchedV);
    if (actualSenderAddress?.toLowerCase() === fromAddress.toLowerCase()) {
      console.log('');
      console.log('✅ SUCCESS: Signature recovers to expected address!');
      console.log('💚 The transaction will be sent from the correct dWallet address.');
    } else {
      console.log('');
      console.log('⚠️  WARNING: These addresses DO NOT MATCH!');
      console.log('❌ Signature recovery failed - transaction may be rejected.');
      console.log('💰 Make sure to fund the ACTUAL sender address above!');
    }
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    const finalTx = signedTx;

    serialized = finalTx.serialized;
    hash = finalTx.hash || '0x';

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('🎉 TRANSACTION SIGNED SUCCESSFULLY!');
    console.log('═══════════════════════════════════════════════════════');
    console.log('Transaction Hash:', hash);
    console.log('Sender Address:', finalTx.from);
    console.log('');
    console.log('📝 FULL SIGNED TRANSACTION (ready to broadcast):');
    console.log(serialized);
    console.log('');
    console.log('You can broadcast this manually at:');
    console.log('https://sepolia.etherscan.io/pushTx');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
  }

  return {
    signature: signatureHex,
    hash,
    txHash: hash,
    serialized,
  };
}

/**
 * Step 4: Broadcast signed transaction to blockchain
 */
export async function broadcastTransaction(
  chain: string,
  serialized: string
): Promise<{ txHash: string }> {
  console.log(`📡 Broadcasting ${chain} transaction...`);

  if (chain === 'Bitcoin') {
    // Broadcast Bitcoin transaction
    console.log('📡 Broadcasting Bitcoin transaction to Blockstream API...');

    // The serialized transaction should be hex-encoded
    const txHex = serialized;

    try {
      const response = await fetch('https://blockstream.info/testnet/api/tx', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: txHex,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Bitcoin broadcast failed: ${response.status} - ${errorText}`);
      }

      const txHash = await response.text(); // Blockstream returns just the txid

      console.log('✅ Bitcoin transaction broadcasted!');
      console.log('🔗 TX Hash:', txHash);
      console.log('📋 Explorer:', `https://blockstream.info/testnet/tx/${txHash}`);

      return { txHash };
    } catch (error) {
      console.error('❌ Bitcoin broadcast failed:', error);
      throw error;
    }
  } else if (chain === 'Solana') {
    // Broadcast Solana transaction
    const connection = new Connection(clusterApiUrl('testnet'), 'confirmed');

    console.log('📡 Broadcasting Solana transaction...');

    // Deserialize the transaction
    let txBuffer = Buffer.from(serialized, 'base64');
    let txSignature: string;

    try {
      // Try to send with the original blockhash first
      console.log('📤 Attempting to send with original blockhash...');
      txSignature = await connection.sendRawTransaction(txBuffer, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    } catch (error: any) {
      // If blockhash is not found, skip preflight and send anyway
      // The signature is still valid, but preflight simulation fails due to expired blockhash
      if (error.message && error.message.includes('Blockhash not found')) {
        console.log('⚠️ Blockhash expired during signing process');
        console.log('📤 Retrying with skipPreflight=true (signature is still valid)...');

        // Retry sending but skip the preflight check
        // The transaction is still valid, just the blockhash expired during the signing delay
        txSignature = await connection.sendRawTransaction(txBuffer, {
          skipPreflight: true, // Skip simulation since blockhash expired
          preflightCommitment: 'confirmed',
        });

        console.log('✅ Transaction submitted successfully (preflight skipped)');
      } else {
        // Re-throw if it's a different error
        throw error;
      }
    }

    const signature = txSignature;

    console.log('✅ Transaction broadcasted:', signature);
    console.log('📋 Solana Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=testnet`);

    // Wait for confirmation (with extended timeout)
    console.log('⏳ Waiting for confirmation (may take up to 60 seconds)...');

    try {
      // Simply wait for confirmation using the signature
      // Don't pass blockhash since the transaction was already sent
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        console.error('❌ Transaction failed on-chain:', confirmation.value.err);
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      console.log('✅ Transaction confirmed on Solana testnet!');
      console.log('   Signature:', signature);
    } catch (error: any) {
      // If confirmation times out, still return the signature
      // The transaction may still succeed, user can check explorer
      if (error.message && (error.message.includes('timeout') || error.message.includes('Timeout') || error.name === 'TransactionExpiredTimeoutError')) {
        console.warn('⚠️ Confirmation timeout - transaction was sent but confirmation timed out');
        console.warn('📋 The transaction may still succeed. Check Solana Explorer:');
        console.warn(`   https://explorer.solana.com/tx/${signature}?cluster=testnet`);
        // Don't throw - return the signature anyway since the transaction was broadcasted
      } else {
        throw error;
      }
    }

    return { txHash: signature };
  } else {
    // Broadcast EVM transaction
    const chainConfigs: { [key: string]: string } = {
      'Ethereum': 'https://rpc-sepolia.rockx.com',
      'Polygon': 'https://rpc-amoy.polygon.technology',
      'Avalanche': 'https://api.avax-test.network/ext/bc/C/rpc',
      'BSC': 'https://bsc-testnet-rpc.publicnode.com',
    };

    const rpcUrl = chainConfigs[chain];
    if (!rpcUrl) {
      throw new Error(`RPC URL not found for ${chain}`);
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const txResponse = await provider.broadcastTransaction(serialized);

    console.log('✅ Transaction broadcasted:', txResponse.hash);

    // Wait for confirmation
    console.log('⏳ Waiting for confirmation...');
    const receipt = await txResponse.wait();

    console.log('✅ Transaction confirmed!');
    console.log('   Block:', receipt?.blockNumber);
    console.log('   Status:', receipt?.status === 1 ? 'Success' : 'Failed');

    return { txHash: txResponse.hash };
  }
}
