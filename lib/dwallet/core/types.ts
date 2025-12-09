/**
 * Shared types for dWallet client-side signing
 */

import { SuiClient } from '@mysten/sui/client';
import { IkaClient, UserShareEncryptionKeys, Curve } from '@ika.xyz/sdk';

/**
 * Parameters for signing a transaction with dWallet
 */
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
export interface UnsignedTransaction {
  messageBytes: Uint8Array;
  unsignedTx: any;
}

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
