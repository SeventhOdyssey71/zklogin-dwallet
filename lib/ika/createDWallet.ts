/**
 * Full zero-trust dWallet creation (DKG) in one call.
 *
 * Implements the canonical Ika flow proven in the SDK integration tests:
 *   prepareDKGAsync → registerEncryptionKey + requestDWalletDKG (tx #1)
 *   → wait AwaitingKeyHolderSignature → acceptEncryptedUserShare (tx #2) → wait Active
 *
 * CRITICAL: acceptEncryptedUserShare must reuse the EXACT `userPublicOutput` from prepareDKGAsync.
 * It is verified cryptographically against the on-chain output (`userAndNetworkDKGOutputMatch`), so a
 * regenerated output always fails with "User public output does not match the DWallet public output".
 * We keep it in memory and chain straight into accept — no localStorage round-trip, no regeneration.
 */

import { Transaction } from '@mysten/sui/transactions';
import { SuiClient } from '@mysten/sui/client';
import {
  IkaClient,
  IkaTransaction,
  Curve,
  prepareDKGAsync,
  UserShareEncryptionKeys,
  getNetworkConfig,
  createRandomSessionIdentifier,
  publicKeyFromDWalletOutput,
} from '@ika.xyz/sdk';
import { ethers } from 'ethers';

export type DWalletKind = 'ECDSA' | 'EdDSA';

const IKA_PACKAGE_ID =
  process.env.NEXT_PUBLIC_IKA_PACKAGE_ID ||
  '0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a';

const STATE_POLL = { timeout: 300000, interval: 2000 } as const;

export interface CreateDWalletParams {
  suiClient: SuiClient;
  account: { address: string };
  /** Signs + executes a Sui transaction. In this app, backed by zkLogin (lib/zklogin/execute.ts). */
  signAndExecuteAsync: (input: { transaction: Transaction }) => Promise<{ digest: string }>;
  kind: DWalletKind;
  onStatus?: (step: CreateStep, message: string) => void;
}

export type CreateStep =
  | 'init'
  | 'prepare'
  | 'request'
  | 'awaiting-network'
  | 'accept'
  | 'activating'
  | 'done';

export interface CreatedDWallet {
  dwalletId: string;
  dwalletCapId: string;
  curve: DWalletKind;
  publicKey: string;
  /** Primary derived address (ETH for ECDSA, Solana for EdDSA). */
  address: string;
}

/** Minimal base58 (Bitcoin alphabet) encoder — a Solana address is its 32-byte pubkey in base58. */
function base58Encode(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = '';
  for (let k = 0; bytes[k] === 0 && k < bytes.length - 1; k++) result += '1';
  for (let q = digits.length - 1; q >= 0; q--) result += ALPHABET[digits[q]];
  return result;
}

/** Deterministic encryption seed — same formula across the app so the user share is recoverable. */
function deterministicSeed(suiAddress: string, curve: Curve): Uint8Array {
  const curveString = curve === Curve.SECP256K1 ? 'secp256k1' : 'ed25519';
  return ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes(`ika-dwallet-${suiAddress}-${curveString}`)));
}

export async function createDWallet(params: CreateDWalletParams): Promise<CreatedDWallet> {
  const { suiClient, account, signAndExecuteAsync, kind, onStatus } = params;
  const status = (step: CreateStep, message: string) => {
    console.log(`[${step}] ${message}`);
    onStatus?.(step, message);
  };

  const curve = kind === 'ECDSA' ? Curve.SECP256K1 : Curve.ED25519;

  status('init', 'Connecting to Ika network…');
  const ikaClient = new IkaClient({
    suiClient,
    config: getNetworkConfig('testnet'),
    cache: true,
  });
  await ikaClient.initialize();

  // Need an IKA coin to pay MPC fees.
  const ikaCoins = await suiClient.getCoins({
    owner: account.address,
    coinType: `${IKA_PACKAGE_ID}::ika::IKA`,
  });
  if (ikaCoins.data.length === 0) {
    throw new Error('No IKA tokens found. Get testnet IKA from https://faucet.ika.xyz/');
  }
  const largestIkaCoin = ikaCoins.data.reduce((prev, cur) =>
    BigInt(cur.balance) > BigInt(prev.balance) ? cur : prev
  );

  status('prepare', 'Preparing distributed key generation…');
  const encryptionSeed = deterministicSeed(account.address, curve);
  const sessionIdentifierBytes = createRandomSessionIdentifier();
  const userShareEncryptionKeys = await UserShareEncryptionKeys.fromRootSeedKey(encryptionSeed, curve);

  const latestNetworkKey = await ikaClient.getLatestNetworkEncryptionKey();
  const dkgRequestInput = await prepareDKGAsync(
    ikaClient,
    curve,
    userShareEncryptionKeys,
    sessionIdentifierBytes,
    account.address
  );

  // ---- Transaction #1: register encryption key (if needed) + request DKG ----
  status('request', 'Requesting dWallet creation — approve in your wallet…');
  const tx = new Transaction();
  const ikaTx = new IkaTransaction({ ikaClient, transaction: tx, userShareEncryptionKeys });

  const sessionIdentifier = ikaTx.registerSessionIdentifier(sessionIdentifierBytes);

  // Register the encryption key only if it isn't already on-chain.
  let needsRegistration = true;
  try {
    await ikaClient.getActiveEncryptionKey(userShareEncryptionKeys.getSuiAddress());
    needsRegistration = false;
  } catch {
    needsRegistration = true;
  }
  if (needsRegistration) {
    await ikaTx.registerEncryptionKey({ curve });
  }

  const [dWalletCap] = await ikaTx.requestDWalletDKG({
    dkgRequestInput,
    ikaCoin: tx.object(largestIkaCoin.coinObjectId),
    suiCoin: tx.gas,
    sessionIdentifier,
    dwalletNetworkEncryptionKeyId: latestNetworkKey.id,
    curve,
  });
  tx.transferObjects([dWalletCap], account.address);

  const requestResult = await signAndExecuteAsync({ transaction: tx });

  // Wait for indexing and read the created objects + DKG event.
  const requestDetails = await suiClient.waitForTransaction({
    digest: requestResult.digest,
    options: { showObjectChanges: true, showEvents: true, showEffects: true },
  });

  if ((requestDetails.effects as any)?.status?.status !== 'success') {
    throw new Error(
      (requestDetails.effects as any)?.status?.error || 'dWallet creation transaction failed'
    );
  }

  // DWalletCap id from object changes → its dwallet_id field.
  let dwalletCapId: string | undefined;
  for (const change of requestDetails.objectChanges ?? []) {
    if (change.type === 'created' && (change as any).objectType?.includes('DWalletCap')) {
      dwalletCapId = (change as any).objectId;
      break;
    }
  }
  if (!dwalletCapId) throw new Error('Could not find created DWalletCap');

  const capObject = await suiClient.getObject({ id: dwalletCapId, options: { showContent: true } });
  const dwalletId = (capObject.data?.content as any)?.fields?.dwallet_id;
  if (!dwalletId) throw new Error('Could not extract dWallet id from DWalletCap');

  // Encrypted-share id from the DKG event (canonical source).
  let encryptedShareId: string | undefined;
  try {
    const dkgEvent = requestDetails.events?.find((e: any) => e.type?.includes('DWalletDKGRequestEvent'));
    const ed = (dkgEvent?.parsedJson as any)?.event_data ?? (dkgEvent?.parsedJson as any);
    encryptedShareId =
      ed?.user_secret_key_share?.Encrypted?.encrypted_user_secret_key_share_id ||
      ed?.encrypted_user_secret_key_share_id;
  } catch {
    // resolved from chain below if missing
  }

  // ---- Wait for the network DKG round to finish ----
  status('awaiting-network', 'Network is generating your key shares (2PC-MPC)…');
  const awaitingDWallet = await ikaClient.getDWalletInParticularState(
    dwalletId,
    'AwaitingKeyHolderSignature',
    STATE_POLL
  );

  // Resolve the encrypted share id if the event didn't give it.
  if (!encryptedShareId) {
    const tableId = (awaitingDWallet as any).encrypted_user_secret_key_shares?.id?.id;
    if (tableId) {
      const fields = await suiClient.getDynamicFields({ parentId: tableId });
      for (const f of fields.data ?? []) {
        try {
          const share: any = await ikaClient.getEncryptedUserSecretKeyShare(f.objectId);
          if (share) {
            encryptedShareId = share.id?.id ?? f.objectId;
            break;
          }
        } catch {
          /* try next */
        }
      }
    }
  }
  if (!encryptedShareId) throw new Error('Could not resolve the encrypted user share id');

  // ---- Transaction #2: accept the encrypted user share ----
  status('accept', 'Finalizing your dWallet — approve in your wallet…');
  const acceptTx = new Transaction();
  const acceptIkaTx = new IkaTransaction({
    ikaClient,
    transaction: acceptTx,
    userShareEncryptionKeys,
  });
  await acceptIkaTx.acceptEncryptedUserShare({
    dWallet: awaitingDWallet as any,
    userPublicOutput: dkgRequestInput.userPublicOutput,
    encryptedUserSecretKeyShareId: encryptedShareId,
  });
  acceptTx.setGasBudget(50000000);

  const acceptResult = await signAndExecuteAsync({ transaction: acceptTx });
  const acceptDetails = await suiClient.waitForTransaction({
    digest: acceptResult.digest,
    options: { showEffects: true },
  });
  if ((acceptDetails.effects as any)?.status?.status !== 'success') {
    throw new Error((acceptDetails.effects as any)?.status?.error || 'Activation transaction failed');
  }

  status('activating', 'Waiting for activation to confirm…');
  const activeDWallet = await ikaClient.getDWalletInParticularState(dwalletId, 'Active', STATE_POLL);

  // Derive a display address + public key from the active dWallet.
  let publicKey = '';
  let address = '';
  try {
    const pubOutput = (activeDWallet.state as any).Active?.public_output;
    if (pubOutput) {
      const pk = await publicKeyFromDWalletOutput(curve, Uint8Array.from(pubOutput));
      publicKey = '0x' + Buffer.from(pk).toString('hex');
      if (curve === Curve.SECP256K1) {
        const { SigningKey, computeAddress } = await import('ethers');
        const uncompressed =
          pk.length === 33 ? SigningKey.computePublicKey('0x' + Buffer.from(pk).toString('hex'), false) : publicKey;
        address = computeAddress(uncompressed);
      } else {
        // ED25519: the 32-byte public key base58-encoded IS the Solana address.
        address = base58Encode(pk);
      }
    }
  } catch (e) {
    console.warn('Could not derive display address:', e);
  }

  status('done', 'dWallet is active!');
  return { dwalletId, dwalletCapId, curve: kind, publicKey, address };
}
