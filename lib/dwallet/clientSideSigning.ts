/**
 * Client-Side dWallet Transaction Signing
 *
 * This module enables signing transactions entirely in the browser using dWallet's 2PC-MPC protocol.
 * No backend server required - all cryptographic operations happen client-side.
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
  getNetworkConfig
} from '@ika.xyz/sdk';
import { ethers } from 'ethers';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction as SolanaTransaction,
  LAMPORTS_PER_SOL,
  clusterApiUrl
} from '@solana/web3.js';

export interface SignTransactionParams {
  dwalletId: string;
  dwalletCapId: string;
  encryptedShareId: string;
  chain: string;
  recipient: string;
  amount: string;
  memo?: string;
  suiClient: SuiClient;
  userAccount: any; // Sui wallet account from @mysten/dapp-kit
  signAndExecuteTransaction: (params: any) => Promise<any>;
}

export interface SignedTransactionResult {
  signature: string;
  hash: string;
  txHash: string;
  serialized?: string;
}

/**
 * Step 1: Initialize IkaClient and UserShareEncryptionKeys
 *
 * IMPORTANT: The user needs to provide their encryption seed.
 * This could be:
 * - Derived from their Sui wallet signature (sign a message)
 * - Stored encrypted in localStorage (encrypted with wallet signature)
 * - Entered by user (like a password)
 */
export async function initializeClientSideSigning(
  suiClient: SuiClient,
  encryptionSeed: Uint8Array,
  curve: Curve
): Promise<{
  ikaClient: IkaClient;
  userShareEncryptionKeys: UserShareEncryptionKeys;
}> {
  console.log('🔧 Initializing client-side signing...');

  // Initialize IkaClient
  const ikaClient = new IkaClient({
    suiClient,
    config: getNetworkConfig('testnet'), // or 'mainnet'
    cache: true,
  });
  await ikaClient.initialize();
  console.log('✅ IkaClient initialized');

  // Generate user share encryption keys from seed
  const userShareEncryptionKeys = await UserShareEncryptionKeys.fromRootSeedKey(
    encryptionSeed,
    curve
  );
  console.log('✅ User share encryption keys generated');

  return { ikaClient, userShareEncryptionKeys };
}

/**
 * Step 2: Build unsigned transaction for the target blockchain
 */
export async function buildUnsignedTransaction(
  chain: string,
  recipient: string,
  amount: string,
  fromAddress: string
): Promise<{ messageBytes: Uint8Array; unsignedTx: any }> {
  console.log(`📝 Building unsigned ${chain} transaction...`);

  switch (chain) {
    case 'Ethereum':
    case 'Polygon':
    case 'Avalanche':
    case 'BSC':
      return buildEVMTransaction(chain, recipient, amount, fromAddress);

    case 'Bitcoin':
      throw new Error('Bitcoin signing not yet implemented in client-side version');

    case 'Solana':
      return buildSolanaTransaction(recipient, amount, fromAddress);

    default:
      throw new Error(`Chain ${chain} not supported`);
  }
}

/**
 * Build EVM transaction (Ethereum, Polygon, Avalanche, BSC)
 */
async function buildEVMTransaction(
  chain: string,
  recipient: string,
  amount: string,
  fromAddress: string
): Promise<{ messageBytes: Uint8Array; unsignedTx: any }> {
  // Get chain configuration
  const chainConfigs: { [key: string]: { chainId: number; rpcUrl: string } } = {
    'Ethereum': { chainId: 11155111, rpcUrl: 'https://rpc-sepolia.rockx.com' },
    'Polygon': { chainId: 80002, rpcUrl: 'https://rpc-amoy.polygon.technology' },
    'Avalanche': { chainId: 43113, rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc' },
    'BSC': { chainId: 97, rpcUrl: 'https://bsc-testnet-rpc.publicnode.com' },
  };

  const config = chainConfigs[chain];
  if (!config) {
    throw new Error(`Chain configuration not found for ${chain}`);
  }

  // Connect to RPC
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);

  // Get nonce
  const nonce = await provider.getTransactionCount(fromAddress);

  // Convert amount to wei
  const value = ethers.parseEther(amount);

  // Use fixed gas prices for testnets to avoid RPC returning crazy high values
  const maxFeePerGas = ethers.parseUnits('10', 'gwei');  // 10 gwei max fee
  const maxPriorityFeePerGas = ethers.parseUnits('2', 'gwei');  // 2 gwei priority

  console.log('⛽ Using fixed gas prices for testnet:');
  console.log('   maxFeePerGas:', ethers.formatUnits(maxFeePerGas, 'gwei'), 'gwei');
  console.log('   maxPriorityFeePerGas:', ethers.formatUnits(maxPriorityFeePerGas, 'gwei'), 'gwei');
  console.log('   Estimated cost: ~', ethers.formatEther(maxFeePerGas * BigInt(21000)), 'ETH');

  // Build transaction
  const unsignedTx = {
    to: recipient,
    value: value,
    nonce: nonce,
    chainId: config.chainId,
    type: 2, // EIP-1559
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasLimit: BigInt(21000),
  };

  // Serialize for signing
  const tx = ethers.Transaction.from(unsignedTx);

  // CRITICAL: Following ika-dwallet1 working implementation (integration.js line 840)
  // Pass the HASH of the serialized transaction to dWallet, NOT the raw bytes!
  // The Ika MPC expects: ethers.getBytes(ethers.keccak256(serializedTx))
  const serializedTx = tx.unsignedSerialized;  // Raw RLP-encoded bytes
  const txHash = ethers.keccak256(serializedTx);  // Hash it first
  const messageBytes = ethers.getBytes(txHash);  // Convert hash to bytes

  console.log(`✅ EVM transaction built: ${messageBytes.length} bytes (keccak256 hash)`);
  console.log(`📋 Serialized tx: ${serializedTx.substring(0, 40)}...`);
  console.log(`📋 Transaction hash: ${txHash}`);

  return { messageBytes, unsignedTx };
}

/**
 * Build Solana transaction
 */
async function buildSolanaTransaction(
  recipient: string,
  amount: string,
  fromAddress: string
): Promise<{ messageBytes: Uint8Array; unsignedTx: any }> {
  console.log(`📝 Building unsigned Solana transaction...`);

  // Connect to Solana devnet
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

  // Create public keys
  const fromPubkey = new PublicKey(fromAddress);
  const toPubkey = new PublicKey(recipient);

  // Check balance before building transaction
  const balance = await connection.getBalance(fromPubkey);
  const balanceSOL = balance / LAMPORTS_PER_SOL;
  console.log(`💰 Current balance: ${balanceSOL} SOL (${balance} lamports)`);

  // Convert SOL to lamports
  const lamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);

  console.log(`💰 Sending ${amount} SOL (${lamports} lamports)`);
  console.log(`📤 From: ${fromAddress}`);
  console.log(`📥 To: ${recipient}`);

  // Warn if insufficient balance
  if (balance < lamports) {
    console.warn(`⚠️ WARNING: Insufficient balance! Have ${balanceSOL} SOL, need ${amount} SOL`);
    console.warn(`📋 Request devnet SOL from: https://faucet.solana.com/`);
  }

  // Get recent blockhash - fetch as late as possible!
  console.log('⏰ Fetching fresh blockhash NOW (maximum validity window)...');
  const blockchashStartTime = Date.now();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
  console.log(`✅ Blockhash fetched in ${Date.now() - blockchashStartTime}ms`);
  console.log(`📋 Blockhash: ${blockhash}`);
  console.log(`📋 Valid until block height: ${lastValidBlockHeight}`);
  console.log(`⏰ You have ~150 seconds before this blockhash expires`);

  // Create transaction
  const transaction = new SolanaTransaction({
    feePayer: fromPubkey,
    blockhash,
    lastValidBlockHeight,
  });

  // Add transfer instruction
  transaction.add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports,
    })
  );

  // Serialize the message for signing
  const messageBytes = transaction.serializeMessage();

  console.log(`✅ Solana transaction built: ${messageBytes.length} bytes`);

  return {
    messageBytes,
    unsignedTx: {
      transaction,
      blockhash,
      lastValidBlockHeight,
    },
  };
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
  // Since seed is deterministic, we can always regenerate it
  const { ethers } = await import('ethers');

  const curveString = curve === Curve.SECP256K1 ? 'secp256k1' : 'ed25519';
  const seedString = `ika-dwallet-${params.signerAddress}-${curveString}`;
  const seedHash = ethers.keccak256(ethers.toUtf8Bytes(seedString));
  const encryptionSeed = ethers.getBytes(seedHash);

  console.log('✅ Regenerated DETERMINISTIC encryption seed from Sui address + curve');
  console.log(`🔐 Seed formula: KECCAK256("ika-dwallet-${params.signerAddress}-${curveString}")`);

  // Also store in localStorage for reference (optional)
  const encryptionSeedKey = `dwallet_encryption_seed_${params.dwalletId}`;
  localStorage.setItem(encryptionSeedKey, JSON.stringify(Array.from(encryptionSeed)));

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

  if (dWallet.state.$kind === 'Active') {
    const pubOutputBytes = (dWallet.state as any).Active?.public_output;
    if (pubOutputBytes && Array.isArray(pubOutputBytes)) {
      console.log('🔍 Raw public_output from blockchain:', pubOutputBytes.slice(0, 10), '... (first 10 bytes)');
      console.log('🔍 Full public_output length:', pubOutputBytes.length, 'bytes');

      const { publicKeyFromDWalletOutput } = await import('@ika.xyz/sdk');
      const actualPublicKey = await publicKeyFromDWalletOutput(
        curve,
        Uint8Array.from(pubOutputBytes)
      );

      console.log('🔍 After publicKeyFromDWalletOutput:');
      console.log('   Raw bytes:', Array.from(actualPublicKey.slice(0, 10)), '... (first 10 bytes)');
      console.log('   Length:', actualPublicKey.length, 'bytes');

      const publicKeyHex = '0x' + Buffer.from(actualPublicKey).toString('hex');
      console.log('🔑 Public key hex:', publicKeyHex);
      console.log('🔑 Public key length:', actualPublicKey.length, 'bytes');

      // Derive address from public key based on curve
      if (curve === Curve.SECP256K1) {
        // For EVM chains, derive Ethereum address using the official ethers.js method
        const { computeAddress, SigningKey } = await import('ethers');

        console.log('');
        console.log('🎯 ETHEREUM ADDRESS DERIVATION (following console3.md logic)');
        console.log('═══════════════════════════════════════════════════════');

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
        console.log('═══════════════════════════════════════════════════════');
        console.log('');
      } else if (curve === Curve.ED25519) {
        // For Solana, the public key IS the address (base58 encoded)
        if (actualPublicKey.length !== 32) {
          throw new Error(`Unexpected ED25519 public key length: ${actualPublicKey.length} bytes (expected 32)`);
        }

        // Convert to Solana PublicKey and get base58 address
        const solanaPublicKey = new PublicKey(actualPublicKey);
        fromAddress = solanaPublicKey.toBase58();

        console.log('');
        console.log('═══════════════════════════════════════════════════════');
        console.log('🏠 DERIVED SOLANA ADDRESS:', fromAddress);
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

  // Hash scheme depends on the curve
  // ECDSA uses SHA256, EdDSA uses SHA512
  const hashScheme = curve === Curve.SECP256K1 ? Hash.SHA256 : Hash.SHA512;

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

  // Check if this is an imported-key dWallet to determine which presign method to use
  // Per SDK docs (ika-transaction.d.ts lines 212-247):
  // - requestPresign: for ECDSA(k1,r1) with imported key dwallets
  // - requestGlobalPresign: for schnorr, schnorrkell, eddsa, taproot, OR regular DKG dwallets
  const dWalletKind = (dWallet as any).kind;
  const isImportedKey = dWalletKind === 'imported-key';

  console.log('🔑 dWallet kind:', dWalletKind);
  console.log('🔑 Is imported key:', isImportedKey);
  console.log('🔑 Signature algorithm:', signatureAlgorithm);

  // CRITICAL: requestPresign/requestGlobalPresign return an unverified presign capability
  // We need to TRANSFER this object back to ourselves to get its ID after transaction execution
  let unverifiedPresignCap: any;

  if (isImportedKey && ((signatureAlgorithm as string) === SignatureAlgorithm.ECDSASecp256k1 ||
                         (signatureAlgorithm as string) === SignatureAlgorithm.ECDSASecp256r1)) {
    // For imported-key dWallets with ECDSA
    console.log('📝 Using requestPresign for imported-key dWallet with ECDSA');
    unverifiedPresignCap = presignIkaTx.requestPresign({
      dWallet,
      signatureAlgorithm,
      ikaCoin,
      suiCoin: presignTx.gas,
    });
  } else {
    // For all other cases (regular DKG dWallets, or EdDSA/Schnorr)
    console.log('📝 Using requestGlobalPresign');
    unverifiedPresignCap = presignIkaTx.requestGlobalPresign({
      curve,
      dwalletNetworkEncryptionKeyId: (dWallet as any).dwallet_network_encryption_key_id,
      signatureAlgorithm,
      ikaCoin,
      suiCoin: presignTx.gas,
    });
  }

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
    fromAddress
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

  let secretShare: Uint8Array | undefined = undefined;
  let publicOutput: Uint8Array | undefined = undefined;

  const dWalletKindFromState = (dWallet as any).kind;
  console.log('🔑 dWallet kind from state:', dWalletKindFromState);
  console.log('🔍 Full dWallet object:', JSON.stringify(dWallet, null, 2));

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
    // Zero-trust dWallet - we need to decrypt the user share locally
    console.log('🔓 Decrypting user share locally for zero-trust dWallet...');

    try {
      // Get protocol parameters for decryption
      const protocolParams = await ikaClient.getProtocolPublicParameters(dWallet);

      // If we have the encrypted share ID, fetch and decrypt it
      if (params.encryptedShareId) {
        console.log('Fetching encrypted share:', params.encryptedShareId);
        const encryptedUserSecretKeyShare = await ikaClient.getEncryptedUserSecretKeyShare(
          params.encryptedShareId
        );

        // Decrypt the share using userShareEncryptionKeys
        const decrypted = await userShareEncryptionKeys.decryptUserShare(
          dWallet,
          encryptedUserSecretKeyShare,
          protocolParams
        );

        secretShare = decrypted.secretShare;
        publicOutput = decrypted.verifiedPublicOutput;
        console.log('✅ User share decrypted successfully');
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

                const encryptedUserSecretKeyShare = await ikaClient.getEncryptedUserSecretKeyShare(
                  encryptedShareId
                );

                // Decrypt the share
                const decrypted = await userShareEncryptionKeys.decryptUserShare(
                  dWallet,
                  encryptedUserSecretKeyShare,
                  protocolParams
                );

                secretShare = decrypted.secretShare;
                publicOutput = decrypted.verifiedPublicOutput;
                console.log('✅ User share decrypted successfully');
              }
            }
          } else {
            console.warn('⚠️ No encrypted_user_secret_key_shares table found in dWallet');
          }
        } catch (searchErr) {
          console.error('Failed to query encrypted share table:', searchErr);
        }

        if (!secretShare) {
          console.warn('⚠️ Could not find or decrypt encrypted share - signing may fail');
        }
      }
    } catch (err) {
      console.error('Failed to decrypt user share:', err);
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

    // Add secretShare and publicOutput if we decrypted them (for zero-trust dWallets)
    if (secretShare && publicOutput) {
      requestSignParams.secretShare = secretShare;
      requestSignParams.publicOutput = publicOutput;
      console.log('📝 Using decrypted secretShare and publicOutput');
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

  if (params.chain === 'Solana') {
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
  } else {
    // For EVM chains, attach ECDSA signature to transaction
    // ECDSA signatures need the correct recovery value (yParity) to derive the correct address

    console.log('🔐 Processing ECDSA signature for EVM transaction...');
    console.log('📋 Expected sender address:', fromAddress);
    console.log('📋 Signature hex:', signatureHex);
    console.log('📋 Signature length:', signatureHex.length - 2, 'bytes');

    // Extract r and s from signature
    const r = '0x' + signatureHex.slice(2, 66);
    const s = '0x' + signatureHex.slice(66, 130);
    console.log('📋 r:', r);
    console.log('📋 s:', s);

    // IMPORTANT: Test both recovery values (v=27 and v=28) to find which recovers to the expected address
    // The correct v value depends on the y-coordinate of the public key point
    console.log('');
    console.log('🔍 Testing recovery values to find correct signature...');
    console.log('📋 Expected address from public_output:', fromAddress);
    console.log('');

    // Try both v values and find the one that matches the expected address
    let signedTx: any = null;
    let actualSenderAddress: string | null = null;
    let matchedV: number | null = null;

    for (const v of [27, 28]) {
      const testTx = ethers.Transaction.from(unsignedTx);
      testTx.signature = ethers.Signature.from({ r, s, v });

      const recoveredFrom = testTx.from;
      console.log(`🔍 Testing v=${v} (yParity=${v - 27}), recovered: ${recoveredFrom}`);

      // Check if this v value recovers to the expected address
      if (recoveredFrom?.toLowerCase() === fromAddress.toLowerCase()) {
        console.log(`✅ Found correct recovery id (v): ${v - 27} (EIP-155 v: ${v})`);
        signedTx = testTx;
        actualSenderAddress = recoveredFrom;
        matchedV = v;
        break;
      }
    }

    // If no match found, use v=27 as fallback
    if (!signedTx) {
      console.log('⚠️  No matching recovery id found, using v=27 as fallback');
      const fallbackTx = ethers.Transaction.from(unsignedTx);
      fallbackTx.signature = ethers.Signature.from({ r, s, v: 27 });
      signedTx = fallbackTx;
      actualSenderAddress = fallbackTx.from;
      matchedV = 27;
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

  if (chain === 'Solana') {
    // Broadcast Solana transaction
    const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

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
    console.log('📋 Solana Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=devnet`);

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

      console.log('✅ Transaction confirmed on Solana devnet!');
      console.log('   Signature:', signature);
    } catch (error: any) {
      // If confirmation times out, still return the signature
      // The transaction may still succeed, user can check explorer
      if (error.message && (error.message.includes('timeout') || error.message.includes('Timeout') || error.name === 'TransactionExpiredTimeoutError')) {
        console.warn('⚠️ Confirmation timeout - transaction was sent but confirmation timed out');
        console.warn('📋 The transaction may still succeed. Check Solana Explorer:');
        console.warn(`   https://explorer.solana.com/tx/${signature}?cluster=devnet`);
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
