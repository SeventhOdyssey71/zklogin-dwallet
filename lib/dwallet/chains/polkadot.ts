/**
 * Polkadot chain signing implementation
 *
 * Polkadot uses ED25519 signatures (EdDSA) on the Substrate framework.
 * Key concepts:
 * - Extrinsics: Polkadot's term for transactions
 * - Era: Transaction validity period (mortal vs immortal)
 * - Nonce: Account transaction counter
 * - Tip: Optional fee tip for validators
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { ChainSigner, UnsignedTransaction, SignedTransactionResult } from '../core/types';
import { POLKADOT_TESTNET } from '../../config/chains';

/**
 * Polkadot chain signer for Paseo AssetHub
 */
export class PolkadotSigner implements ChainSigner {
  private api: ApiPromise | null = null;
  private provider: WsProvider | null = null;

  /**
   * Connect to Polkadot node
   */
  private async connect(): Promise<ApiPromise> {
    if (this.api && this.api.isConnected) {
      return this.api;
    }

    console.log('🔗 Connecting to Polkadot AssetHub...');
    this.provider = new WsProvider(POLKADOT_TESTNET.rpcUrl);

    // Set connection timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });

    try {
      this.api = await Promise.race([
        ApiPromise.create({ provider: this.provider }),
        timeoutPromise,
      ]);
      console.log('✅ Connected to Polkadot AssetHub');
      return this.api;
    } catch (error) {
      if (this.provider) {
        await this.provider.disconnect();
      }
      throw error;
    }
  }

  /**
   * Disconnect from Polkadot node
   */
  private async disconnect(): Promise<void> {
    if (this.api) {
      await this.api.disconnect();
      this.api = null;
    }
    if (this.provider) {
      await this.provider.disconnect();
      this.provider = null;
    }
  }

  /**
   * Build unsigned Polkadot transaction
   */
  async buildUnsignedTransaction(
    recipient: string,
    amount: string,
    fromAddress: string
  ): Promise<UnsignedTransaction> {
    console.log(`📝 Building unsigned Polkadot transaction...`);

    try {
      const api = await this.connect();

      // Get account info for nonce and balance
      const accountInfo: any = await api.query.system.account(fromAddress);
      const nonce = accountInfo.nonce.toNumber();
      const balance = accountInfo.data;

      // Convert DOT/PAS to plancks (10^10 smallest units)
      const amountInPlancks = BigInt(Math.floor(parseFloat(amount) * 1e10));

      console.log(`💰 Current balance: ${Number(balance.free.toBigInt()) / 1e10} PAS`);
      console.log(`💰 Sending ${amount} PAS (${amountInPlancks} plancks)`);
      console.log(`📤 From: ${fromAddress}`);
      console.log(`📥 To: ${recipient}`);
      console.log(`🔢 Nonce: ${nonce}`);

      // Check balance
      if (balance.free.toBigInt() < amountInPlancks) {
        console.warn(`⚠️ WARNING: Insufficient balance!`);
        console.warn(`📋 Have: ${Number(balance.free.toBigInt()) / 1e10} PAS`);
        console.warn(`📋 Need: ${amount} PAS + fees`);
      }

      // Create transfer extrinsic
      // For AssetHub, we use balances.transferKeepAlive to prevent account reaping
      const transfer = api.tx.balances.transferKeepAlive(recipient, amountInPlancks);

      // Get latest block hash and era info
      const blockHash = await api.rpc.chain.getBlockHash();
      const signedBlock = await api.rpc.chain.getBlock(blockHash);
      const blockNumber = signedBlock.block.header.number.toNumber();

      console.log(`📋 Current block: ${blockNumber}`);
      console.log(`📋 Block hash: ${blockHash.toHex()}`);

      // Create signing payload
      // Era: Transaction valid for 64 blocks (~6.4 minutes on Polkadot)
      const era = api.createType('ExtrinsicEra', {
        current: blockNumber,
        period: 64,
      });

      // Get runtime version and genesis hash
      const runtimeVersion = api.runtimeVersion;
      const genesisHash = api.genesisHash;

      console.log(`📋 Runtime version: ${runtimeVersion.specVersion}`);
      console.log(`📋 Genesis hash: ${genesisHash.toHex()}`);

      // Build the signing payload
      const signingPayload = api.createType('ExtrinsicPayload', {
        method: transfer.method.toHex(),
        era: era.toHex(),
        nonce: nonce, // Pass as number, createType will handle conversion
        tip: 0, // No tip
        specVersion: runtimeVersion.specVersion.toNumber(),
        transactionVersion: runtimeVersion.transactionVersion.toNumber(),
        genesisHash: genesisHash.toHex(),
        blockHash: blockHash.toHex(),
      });

      // Serialize payload for signing
      let messageBytes = signingPayload.toU8a(true); // true = sign as mortal

      console.log(`✅ Polkadot extrinsic built: ${messageBytes.length} bytes`);
      console.log(`📋 Signing payload hex:`, '0x' + Buffer.from(messageBytes).toString('hex'));

      // CRITICAL: Polkadot requires Blake2-256 hash if payload > 256 bytes
      // This is standard for all Substrate chains
      if (messageBytes.length > 256) {
        const { blake2b } = require('blakejs');
        const hashedMessage = blake2b(messageBytes, null, 32); // 32 bytes = 256 bits
        console.log(`⚠️  Payload > 256 bytes, using Blake2-256 hash for signing`);
        console.log(`📋 Hashed message (32 bytes):`, '0x' + Buffer.from(hashedMessage).toString('hex'));
        messageBytes = hashedMessage;
      }

      return {
        messageBytes,
        unsignedTx: {
          transfer,
          signingPayload,
          era,
          nonce: nonce,
          blockHash: blockHash.toHex(),
          fromAddress,
        },
      };
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  /**
   * Broadcast signed Polkadot transaction
   */
  async broadcastTransaction(
    unsignedTx: any,
    signature: Uint8Array
  ): Promise<SignedTransactionResult> {
    console.log('📡 Broadcasting transaction to Polkadot AssetHub...');

    try {
      const api = await this.connect();

      const { transfer, fromAddress, era, nonce } = unsignedTx;

      // ED25519 signature is 64 bytes
      const signatureBytes = signature.slice(0, 64);
      const signatureHex = '0x' + Buffer.from(signatureBytes).toString('hex');
      console.log(`🔐 Signature (${signature.length} bytes):`, signatureHex);

      // Create signature in Polkadot format
      // For ED25519: 0x00 prefix + 64-byte signature
      const multiSignature = api.createType('ExtrinsicSignature', {
        Ed25519: signatureHex
      });

      console.log(`🔐 MultiSignature:`, multiSignature.toHex());

      // Create signed extrinsic manually
      // This ensures the signature format matches what we signed
      transfer.addSignature(
        fromAddress,
        multiSignature,
        {
          era: era,
          nonce: nonce,
          tip: 0
        }
      );

      console.log(`📦 Signed extrinsic: ${transfer.toHex()}`);

      // Submit transaction
      const txHash = await new Promise<string>((resolve, reject) => {
        transfer
          .send((result: any) => {
            console.log(`📊 Transaction status: ${result.status.type}`);

            if (result.status.isInBlock) {
              console.log(`✅ Transaction included in block: ${result.status.asInBlock.toHex()}`);
              resolve(result.status.asInBlock.toHex());
            } else if (result.status.isFinalized) {
              console.log(`✅ Transaction finalized: ${result.status.asFinalized.toHex()}`);
            } else if (result.status.isDropped || result.status.isInvalid) {
              reject(new Error(`Transaction ${result.status.type}`));
            }

            // Check for errors in events
            if (result.dispatchError) {
              let errorMessage = 'Transaction failed';

              if (result.dispatchError.isModule) {
                const decoded = api.registry.findMetaError(result.dispatchError.asModule);
                errorMessage = `${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`;
              } else {
                errorMessage = result.dispatchError.toString();
              }

              reject(new Error(errorMessage));
            }
          })
          .catch(reject);
      });

      console.log('✅ Transaction confirmed!');
      console.log('🔗 TX Hash:', txHash);

      await this.disconnect();

      return {
        signature: signatureHex,
        hash: txHash,
        txHash: txHash,
      };
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }
}

/**
 * Get Polkadot chain signer
 */
export function getPolkadotSigner(): ChainSigner {
  return new PolkadotSigner();
}
