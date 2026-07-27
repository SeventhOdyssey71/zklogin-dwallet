/**
 * Solana chain signing implementation
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction as SolanaTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { ChainSigner, UnsignedTransaction, SignedTransactionResult } from '../core/types';
import { SOLANA_MAINNET } from '../../config/chains';
import { readDurableNonce } from './solanaNonce';
import { debug, warn } from '@/lib/utils/log';

/**
 * Solana chain signer
 */
export class SolanaSigner implements ChainSigner {
  private connection: Connection;

  constructor() {
    // Connect to Solana mainnet-beta (via the shared config so reads/sends can't diverge).
    this.connection = new Connection(SOLANA_MAINNET.rpcUrl, 'confirmed');
  }

  /**
   * Build unsigned Solana transaction
   */
  async buildUnsignedTransaction(
    recipient: string,
    amount: string,
    fromAddress: string
  ): Promise<UnsignedTransaction> {
    debug(`📝 Building unsigned Solana transaction...`);

    // Create public keys
    const fromPubkey = new PublicKey(fromAddress);
    const toPubkey = new PublicKey(recipient);

    // Check balance before building transaction
    const balance = await this.connection.getBalance(fromPubkey);
    const balanceSOL = balance / LAMPORTS_PER_SOL;
    debug(`💰 Current balance: ${balanceSOL} SOL (${balance} lamports)`);

    // Convert SOL to lamports
    const lamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);

    debug(`💰 Sending ${amount} SOL (${lamports} lamports)`);
    debug(`📤 From: ${fromAddress}`);
    debug(`📥 To: ${recipient}`);

    // Warn if insufficient balance
    if (balance < lamports) {
      warn(`⚠️ WARNING: Insufficient balance! Have ${balanceSOL} SOL, need ${amount} SOL`);
      warn(`📋 This is Solana mainnet — fund ${fromAddress} with real SOL.`);
    }

    /**
     * Prefer a durable nonce.
     *
     * With one, the transaction commits to a value that does not expire, so the ~13s signing round stops
     * racing a ~60-90s blockhash window. Without one, fall back to a recent blockhash fetched as late as
     * possible — the previous behaviour — so a wallet that has not set up a nonce account still works.
     *
     * `nonceInfo` on the constructor rather than adding `nonceAdvance` by hand: the runtime requires that
     * instruction at index 0, and letting web3.js place it removes the chance of an ordering mistake that
     * would make the transaction look like an ordinary one with an unknown blockhash.
     */
    const durable = await readDurableNonce(this.connection, fromPubkey);

    let transaction: SolanaTransaction;
    let blockhash: string;
    let lastValidBlockHeight: number | undefined;

    if (durable) {
      debug(`⏳ Using durable nonce ${durable.account.toBase58()} — this signature cannot expire`);
      blockhash = durable.nonce;
      transaction = new SolanaTransaction({
        feePayer: fromPubkey,
        nonceInfo: { nonce: durable.nonce, nonceInstruction: durable.advanceInstruction },
      });
    } else {
      debug('⏰ No durable nonce — fetching a fresh blockhash (expires in ~150s)…');
      const started = Date.now();
      const latest = await this.connection.getLatestBlockhash('finalized');
      debug(`✅ Blockhash fetched in ${Date.now() - started}ms`);
      blockhash = latest.blockhash;
      lastValidBlockHeight = latest.lastValidBlockHeight;
      transaction = new SolanaTransaction({
        feePayer: fromPubkey,
        blockhash,
        lastValidBlockHeight,
      });
    }

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

    debug(`✅ Solana transaction built: ${messageBytes.length} bytes`);

    return {
      messageBytes,
      unsignedTx: {
        transaction,
        blockhash,
        lastValidBlockHeight,
        // Lets the broadcaster skip the expiry-retry dance when the signature cannot expire.
        durableNonce: durable?.account.toBase58(),
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
    debug('📡 Broadcasting transaction to Solana...');

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

    debug('✅ Transaction broadcast!');
    debug('🔗 TX Signature:', txSignature);

    // Wait for confirmation
    debug('⏳ Waiting for confirmation...');
    const confirmation = await this.connection.confirmTransaction({
      signature: txSignature,
      blockhash: unsignedTx.blockhash,
      lastValidBlockHeight: unsignedTx.lastValidBlockHeight,
    });

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    debug('✅ Transaction confirmed!');

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
