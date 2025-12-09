/**
 * Discover the actual Ethereum address for a dWallet by signing a test message
 *
 * This function creates a presign and signs a test message to discover which
 * Ethereum address the dWallet's signatures will recover to.
 *
 * NOTE: This requires IKA and SUI tokens but NO ETH!
 * - IKA tokens: for presign and sign operations
 * - SUI tokens: for Sui blockchain transaction fees
 * - NO ETH needed: we're just signing, not broadcasting to Ethereum
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

export interface DiscoverAddressParams {
  dwalletId: string;
  suiClient: SuiClient;
  ikaClient: IkaClient;
  userAccount: any;
  signAndExecuteTransaction: any;
  userShareEncryptionKeys: UserShareEncryptionKeys;
  expectedAddress?: string; // Optional: address from public_output[0] to validate against
}

export async function discoverDWalletEthereumAddress(
  params: DiscoverAddressParams
): Promise<string> {
  console.log('🔍 Discovering actual dWallet Ethereum address via test signature...');
  console.log('💰 This requires IKA + SUI tokens, but NO ETH!');
  console.log('');

  // Get dWallet from blockchain
  const dWallet = await params.ikaClient.getDWalletInParticularState(
    params.dwalletId,
    'Active',
    { timeout: 60000 }
  );

  const curve = Curve.SECP256K1;
  const signatureAlgorithm = SignatureAlgorithm.ECDSASecp256k1;
  const hashScheme = Hash.KECCAK256;

  // Create a simple test message to sign
  const testMessage = ethers.toUtf8Bytes('Test message to discover dWallet address');
  console.log('📝 Test message:', ethers.hexlify(testMessage));

  // === STEP 1: Create presign ===
  console.log('');
  console.log('1️⃣ Creating presign...');

  const presignTx = new Transaction();
  presignTx.setSender(params.userAccount.address);

  const presignIkaTx = new IkaTransaction({
    ikaClient: params.ikaClient,
    transaction: presignTx,
    userShareEncryptionKeys: params.userShareEncryptionKeys,
  });

  // Get IKA coins for presign
  const ikaCoinsForPresign = await params.suiClient.getCoins({
    owner: params.userAccount.address,
    coinType: `${params.ikaClient.ikaConfig.packages.ikaPackage}::ika::IKA`,
  });

  if (ikaCoinsForPresign.data.length === 0) {
    throw new Error('No IKA tokens available. Get IKA from https://faucet.ika.xyz/');
  }

  const presignIkaCoin = presignTx.object(ikaCoinsForPresign.data[0].coinObjectId);

  const unverifiedPresignCap = presignIkaTx.requestGlobalPresign({
    curve,
    dwalletNetworkEncryptionKeyId: (dWallet as any).dwallet_network_encryption_key_id,
    signatureAlgorithm,
    ikaCoin: presignIkaCoin,
    suiCoin: presignTx.gas,
  });

  presignTx.transferObjects([unverifiedPresignCap], params.userAccount.address);
  presignTx.setGasBudget(50000000);

  const presignResult = await params.signAndExecuteTransaction({
    transaction: presignTx,
  });

  if (presignResult.effects?.status?.status !== 'success') {
    throw new Error('Presign failed: ' + presignResult.effects?.status?.error);
  }

  // Find presign ID from events
  const presignEvent = presignResult.events?.find((e: any) =>
    e.type.includes('PresignRequestEvent')
  );

  if (!presignEvent) {
    throw new Error('Presign event not found');
  }

  const presignId = presignEvent.parsedJson?.event_data?.presign_id || presignEvent.parsedJson?.presign_id;
  console.log('✅ Presign ID:', presignId);

  // Wait for presign to complete
  const completedPresign = await params.ikaClient.getPresignInParticularState(
    presignId,
    'Completed',
    { timeout: 120000, interval: 2000 }
  );

  console.log('✅ Presign completed');

  // === STEP 2: Sign the test message ===
  console.log('');
  console.log('2️⃣ Signing test message...');

  const signTx = new Transaction();
  signTx.setSender(params.userAccount.address);

  const signIkaTx = new IkaTransaction({
    ikaClient: params.ikaClient,
    transaction: signTx,
    userShareEncryptionKeys: params.userShareEncryptionKeys,
  });

  // Get encrypted user secret key share
  const tableId = (dWallet as any).encrypted_user_secret_key_shares?.id?.id;
  const dynamicFields = await params.suiClient.getDynamicFields({
    parentId: tableId,
  });

  const firstField = dynamicFields.data[0];
  const fieldObject = await params.suiClient.getDynamicFieldObject({
    parentId: tableId,
    name: firstField.name,
  });

  const encryptedShareId = fieldObject.data?.objectId;
  const encryptedUserSecretKeyShare = await params.ikaClient.getEncryptedUserSecretKeyShare(encryptedShareId!);

  const messageApproval = signIkaTx.approveMessage({
    dWalletCap: (dWallet as any).dwallet_cap_id,
    curve,
    signatureAlgorithm,
    hashScheme,
    message: testMessage,
  });

  const verifiedPresignCap = signIkaTx.verifyPresignCap({ presign: completedPresign });

  // Get IKA coins for signing
  const ikaCoinsForSign = await params.suiClient.getCoins({
    owner: params.userAccount.address,
    coinType: `${params.ikaClient.ikaConfig.packages.ikaPackage}::ika::IKA`,
  });

  const signIkaCoin = signTx.object(ikaCoinsForSign.data[0].coinObjectId);

  await signIkaTx.requestSign({
    dWallet: dWallet as any,
    messageApproval,
    verifiedPresignCap,
    hashScheme,
    presign: completedPresign,
    encryptedUserSecretKeyShare,
    message: testMessage,
    signatureScheme: signatureAlgorithm,
    ikaCoin: signIkaCoin,
    suiCoin: signTx.gas,
  });

  signTx.setGasBudget(500000000);

  const signResult = await params.signAndExecuteTransaction({
    transaction: signTx,
  });

  if (signResult.effects?.status?.status !== 'success') {
    throw new Error('Signing failed: ' + signResult.effects?.status?.error);
  }

  // Find sign ID from events
  const signEvent = signResult.events?.find((e: any) =>
    e.type.includes('SignRequestEvent')
  );

  if (!signEvent) {
    throw new Error('Sign event not found');
  }

  const signId = signEvent.parsedJson?.event_data?.sign_id || signEvent.parsedJson?.sign_id;
  console.log('✅ Sign ID:', signId);

  // Wait for signature
  const signatureResult = await params.ikaClient.getSignInParticularState(
    signId,
    curve,
    signatureAlgorithm,
    'Completed',
    { timeout: 120000, interval: 2000 }
  );

  const signatureBytes = Uint8Array.from(signatureResult.state.Completed?.signature ?? []);
  console.log('✅ Signature received:', signatureBytes.length, 'bytes');

  // === STEP 3: Recover address from signature ===
  console.log('');
  console.log('3️⃣ Recovering Ethereum address from signature...');

  let r = '0x' + Buffer.from(signatureBytes.slice(0, 32)).toString('hex');
  let s = '0x' + Buffer.from(signatureBytes.slice(32, 64)).toString('hex');

  // Normalize s to lower half
  const secp256k1N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
  const secp256k1HalfN = secp256k1N / BigInt(2);
  let sBigInt = BigInt(s);
  let recoveryOffset = 0;

  if (sBigInt > secp256k1HalfN) {
    sBigInt = secp256k1N - sBigInt;
    s = '0x' + sBigInt.toString(16).padStart(64, '0');
    recoveryOffset = 1;
  }

  // Hash the test message with KECCAK256 (since we used Hash.KECCAK256)
  const messageHash = ethers.keccak256(testMessage);

  // Try both recovery values and collect all valid addresses
  const validAddresses: { v: number; address: string }[] = [];

  for (let baseV = 0; baseV <= 1; baseV++) {
    const v = (baseV + recoveryOffset) % 2;
    try {
      const recoveredAddress = ethers.recoverAddress(messageHash, {
        r,
        s,
        v,
      });

      console.log(`  Testing v=${v}: ${recoveredAddress}`);
      validAddresses.push({ v, address: recoveredAddress });
    } catch (e) {
      // Invalid recovery, try next
    }
  }

  // CRITICAL: requestGlobalPresign uses RANDOM ephemeral keys!
  // Each signing produces different addresses for v=0 and v=1
  // The CORRECT address is the one that matches public_output[0]
  let discoveredAddress: string | null = null;

  if (params.expectedAddress) {
    // We have the expected address from public_output[0] - find which v matches
    const expectedLower = params.expectedAddress.toLowerCase();
    const matchingRecovery = validAddresses.find(
      a => a.address.toLowerCase() === expectedLower
    );

    if (matchingRecovery) {
      discoveredAddress = matchingRecovery.address;
      console.log(`  ✅ Found matching recovery: v=${matchingRecovery.v} matches public_output[0]`);
      console.log(`  📍 Expected: ${params.expectedAddress}`);
      console.log(`  📍 Recovered: ${discoveredAddress}`);
    } else {
      // This shouldn't happen, but log both for debugging
      console.error(`  ❌ Neither v=0 nor v=1 matches expected address!`);
      console.error(`  Expected: ${params.expectedAddress}`);
      console.error(`  Got v=0: ${validAddresses.find(a => a.v === 0)?.address}`);
      console.error(`  Got v=1: ${validAddresses.find(a => a.v === 1)?.address}`);
      throw new Error(
        `Signature recovery mismatch! Neither v=0 nor v=1 recovered to expected address ${params.expectedAddress}. ` +
        `This indicates a fundamental issue with the dWallet's key or signing process.`
      );
    }
  } else {
    // No expected address provided - this is dangerous!
    // We can't know which address is correct since each signing is random
    console.warn(`  ⚠️  WARNING: No expected address provided!`);
    console.warn(`  ⚠️  requestGlobalPresign uses random ephemeral keys`);
    console.warn(`  ⚠️  Cannot determine which recovered address is correct`);
    console.warn(`  ⚠️  Returning v=0 recovery by default (may be wrong!)`);

    if (validAddresses.length > 0) {
      discoveredAddress = validAddresses[0].address;
      console.log(`  ⚠️  Using v=${validAddresses[0].v} recovery (NO VALIDATION)`);
    }
  }

  if (!discoveredAddress) {
    throw new Error('Could not recover address from test signature');
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('✅ DISCOVERED ETHEREUM ADDRESS');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`📍 Address: ${discoveredAddress}`);
  console.log('');
  console.log('💡 This is the address you need to fund with ETH!');
  console.log('💡 All future transactions will be sent from this address.');
  console.log('═══════════════════════════════════════════════════════');

  return discoveredAddress;
}
