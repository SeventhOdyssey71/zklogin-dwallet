/**
 * Solana chain signing implementation
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction as SolanaTransaction,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js';
import { ChainSigner, UnsignedTransaction, SignedTransactionResult } from '../core/types';

/**
 * Solana chain signer
 */
export class SolanaSigner implements ChainSigner {
  private connection: Connection;

  constructor() {
    // Connect to Solana devnet
    this.connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  }

  /**
   * Build unsigned Solana transaction
   */
  async buildUnsignedTransaction(
    recipient: string,
    amount: string,
    fromAddress: string
  ): Promise<UnsignedTransaction> {
    console.log(`📝 Building unsigned Solana transaction...`);

    // Create public keys
    const fromPubkey = new PublicKey(fromAddress);
    const toPubkey = new PublicKey(recipient);

    // Check balance before building transaction
    const balance = await this.connection.getBalance(fromPubkey);
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
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('finalized');
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
   * Broadcast signed Solana transaction
   */
  async broadcastTransaction(
    unsignedTx: any,
    signature: Uint8Array
  ): Promise<SignedTransactionResult> {
    console.log('📡 Broadcasting transaction to Solana...');

    const { transaction } = unsignedTx;

    // Add signature to transaction
    transaction.addSignature(
      transaction.feePayer!,
      Buffer.from(signature)
    );

    // Serialize and send
    const rawTransaction = transaction.serialize();
    const txSignature = await this.connection.sendRawTransaction(rawTransaction, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log('✅ Transaction broadcast!');
    console.log('🔗 TX Signature:', txSignature);

    // Wait for confirmation
    console.log('⏳ Waiting for confirmation...');
    const confirmation = await this.connection.confirmTransaction({
      signature: txSignature,
      blockhash: unsignedTx.blockhash,
      lastValidBlockHeight: unsignedTx.lastValidBlockHeight,
    });

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    console.log('✅ Transaction confirmed!');

    return {
      signature: '0x' + Buffer.from(signature).toString('hex'),
      hash: txSignature,
      txHash: txSignature,
    };
  }
}

/**
 * Get Solana chain signer
 */
export function getSolanaSigner(): ChainSigner {
  return new SolanaSigner();
}
