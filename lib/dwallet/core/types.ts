/**
 * Shared types for dWallet client-side signing
 */

import { IkaClient, UserShareEncryptionKeys } from '@ika.xyz/sdk';
import type { AppSuiClient } from '@/lib/sui/client';

/**
 * Parameters for signing a transaction with dWallet
 */
export interface UnsignedTransaction {
  messageBytes: Uint8Array;
  unsignedTx: any;
}

export interface SignTransactionParams {
  dwalletId: string;
  dwalletCapId: string;
  encryptedShareId: string;
  chain: string;
  recipient: string;
  amount: string;
  memo?: string;
  suiClient: AppSuiClient;
  userAccount: any; // Sui wallet account from @mysten/dapp-kit
  signAndExecuteTransaction: (params: any) => Promise<any>;
  /** Called as each phase begins, so the UI can show what is actually happening. */
  onProgress?: (message: string) => void;
  /**
   * A transaction the caller has already built, signed instead of deriving one from
   * (chain, recipient, amount).
   *
   * Exists for operations that are not "send X to Y" — setting up a durable nonce account, for instance,
   * which is a System Program call with no recipient or amount at all. Everything else about the pipeline
   * (presignature, key share, MPC round, signature attachment) is identical, so this reuses it rather than
   * duplicating a second signing path that would then drift.
   */
  prebuilt?: UnsignedTransaction;
}

/**
 * Result of a signed transaction
 */
export interface SignedTransactionResult {
  signature: string;
  hash: string;
  txHash: string;
  serialized?: string;
}

/**
 * Initialized client-side signing context
 */
export interface SigningContext {
  ikaClient: IkaClient;
  userShareEncryptionKeys: UserShareEncryptionKeys;
}

/**
 * Unsigned transaction data ready for signing
 */

/**
 * Chain-specific signer interface
 */
export interface ChainSigner {
  /**
   * Build an unsigned transaction
   */
  buildUnsignedTransaction(
    recipient: string,
    amount: string,
    fromAddress: string,
    publicKey?: string
  ): Promise<UnsignedTransaction>;

  /**
   * Serialize and broadcast a signed transaction
   */
  broadcastTransaction(
    unsignedTx: any,
    signature: Uint8Array,
    recoveryId?: number
  ): Promise<SignedTransactionResult>;
}
