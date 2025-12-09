/**
 * NEAR chain signing implementation
 *
 * NEAR uses ED25519 signatures with a specific transaction structure:
 * - Nonce: Incremented counter for each transaction
 * - Block Hash: Recent block hash (within 24 hours)
 * - Actions: Array of operations (transfer, function call, etc.)
 * - SHA256 hash of serialized transaction
 */

import { ChainSigner, UnsignedTransaction, SignedTransactionResult } from '../core/types';
import { NEAR_TESTNET } from '../../config/chains';

/**
 * NEAR chain signer for testnet
 */
export class NearSigner implements ChainSigner {
  /**
   * Build unsigned NEAR transaction
   */
  async buildUnsignedTransaction(
    recipient: string,
    amount: string,
    fromAddress: string,
    publicKey?: string
  ): Promise<UnsignedTransaction> {
    console.log(`📝 Building unsigned NEAR transaction...`);

    if (!publicKey) {
      throw new Error('Public key is required for NEAR transactions');
    }

    try {
      // Dynamically import NEAR API
      const { utils, transactions } = await import('near-api-js');
      const sha256 = require('js-sha256');

      // Convert NEAR to yoctoNEAR (1 NEAR = 10^24 yoctoNEAR)
      const amountInYocto = utils.format.parseNearAmount(amount);
      if (!amountInYocto) {
        throw new Error('Invalid amount');
      }

      console.log(`💰 Sending ${amount} NEAR (${amountInYocto} yoctoNEAR)`);
      console.log(`📤 From: ${fromAddress}`);
      console.log(`📥 To: ${recipient}`);

      // Get access key info (includes nonce and block hash)
      console.log('🔍 Fetching access key info...');
      const provider = new (await import('near-api-js')).providers.JsonRpcProvider({
        url: NEAR_TESTNET.rpcUrl,
      });

      // Parse public key - convert hex to base58
      const pubKeyHex = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
      const pubKeyBytes = Buffer.from(pubKeyHex, 'hex');

      // Create PublicKey object from bytes
      // NEAR expects ed25519:<base58> format
      const bs58 = require('bs58');
      const encode = bs58.encode || bs58.default?.encode || bs58.default;
      const pubKeyBase58 = typeof encode === 'function' ? encode(pubKeyBytes) : bs58(pubKeyBytes);
      const nearPublicKey = utils.PublicKey.fromString(`ed25519:${pubKeyBase58}`);

      console.log(`🔑 Public key (base58): ${nearPublicKey.toString()}`);

      // Query access key
      let accessKey: any;
      try {
        const accessKeyResponse = await provider.query({
          request_type: 'view_access_key',
          account_id: fromAddress,
          public_key: nearPublicKey.toString(),
          finality: 'final',
        });
        accessKey = accessKeyResponse as any;
      } catch (error: any) {
        // Account doesn't exist yet - implicit accounts need to be created first
        if (error.message?.includes('does not exist') || error.type === 'AccountDoesNotExist') {
          throw new Error(
            `NEAR account ${fromAddress.slice(0, 16)}... does not exist yet. ` +
            `Implicit accounts must receive NEAR tokens before they can send transactions. ` +
            `Please fund this account first from the NEAR testnet faucet.`
          );
        }
        throw error;
      }

      const nonce = accessKey.nonce + 1; // Increment nonce
      const blockHash = utils.serialize.base_decode(accessKey.block_hash);

      console.log(`✅ Nonce: ${nonce}`);
      console.log(`✅ Block hash: ${accessKey.block_hash}`);

      // Create transfer action
      // parseNearAmount returns string, but transfer expects bigint
      const actions = [transactions.transfer(BigInt(amountInYocto))];

      // Create transaction
      const transaction = transactions.createTransaction(
        fromAddress,
        nearPublicKey,
        recipient,
        nonce,
        actions,
        blockHash
      );

      // Serialize transaction
      const serializedTx = utils.serialize.serialize(
        transactions.SCHEMA.Transaction,
        transaction
      );

      // Hash serialized transaction with SHA256
      const serializedTxHash = new Uint8Array(sha256.sha256.array(serializedTx));

      console.log(`✅ NEAR transaction built`);
      console.log(`📋 Transaction hash (SHA256): ${Buffer.from(serializedTxHash).toString('hex')}`);
      console.log(`📋 Message to sign (${serializedTxHash.length} bytes)`);

      return {
        messageBytes: serializedTxHash,
        unsignedTx: {
          transaction,
          publicKey: nearPublicKey,
          utils,
          transactions,
        },
      };
    } catch (error) {
      console.error('❌ Error building NEAR transaction:', error);
      throw error;
    }
  }

  /**
   * Broadcast signed NEAR transaction
   */
  async broadcastTransaction(
    unsignedTx: any,
    signature: Uint8Array
  ): Promise<SignedTransactionResult> {
    console.log('📡 Broadcasting transaction to NEAR testnet...');

    try {
      const { transaction, publicKey, utils, transactions } = unsignedTx;

      // ED25519 signature is 64 bytes
      const signatureBytes = signature.slice(0, 64);
      const signatureHex = Buffer.from(signatureBytes).toString('hex');
      console.log(`🔐 Signature (${signature.length} bytes):`, signatureHex);

      // Create Signature object
      const nearSignature = new transactions.Signature({
        keyType: 0, // ED25519
        data: signatureBytes,
      });

      // Create signed transaction
      const signedTransaction = new transactions.SignedTransaction({
        transaction,
        signature: nearSignature,
      });

      // Serialize signed transaction
      const signedSerializedTx = signedTransaction.encode();
      const signedTxBase64 = Buffer.from(signedSerializedTx).toString('base64');

      console.log(`📦 Signed transaction (${signedSerializedTx.length} bytes)`);

      // Submit to NEAR RPC
      console.log('📡 Submitting transaction to NEAR network...');
      const provider = new (await import('near-api-js')).providers.JsonRpcProvider({
        url: NEAR_TESTNET.rpcUrl,
      });

      const result = await provider.sendJsonRpc('broadcast_tx_commit', [signedTxBase64]) as any;

      console.log('✅ Transaction submitted successfully');
      console.log('📋 Result:', result);

      // Extract transaction hash
      const txHash = result.transaction?.hash || 'unknown';

      return {
        signature: signatureHex,
        hash: txHash,
        txHash: txHash,
      };
    } catch (error) {
      console.error('❌ NEAR broadcast failed:', error);
      throw error;
    }
  }
}

/**
 * Get NEAR chain signer
 */
export function getNearSigner(): ChainSigner {
  return new NearSigner();
}
