/**
 * Ethereum (and EVM-compatible) chain signing implementation
 * Supports: Ethereum, Polygon, Avalanche, BSC
 */

import { ethers } from 'ethers';
import { ChainSigner, UnsignedTransaction, SignedTransactionResult } from '../core/types';

/**
 * EVM chain configurations
 */
const EVM_CHAIN_CONFIGS: { [key: string]: { chainId: number; rpcUrl: string } } = {
  'Ethereum': { chainId: 11155111, rpcUrl: 'https://rpc-sepolia.rockx.com' },
  'Polygon': { chainId: 80002, rpcUrl: 'https://rpc-amoy.polygon.technology' },
  'Avalanche': { chainId: 43113, rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc' },
  'BSC': { chainId: 97, rpcUrl: 'https://bsc-testnet-rpc.publicnode.com' },
};

/**
 * Ethereum/EVM chain signer
 */
export class EthereumSigner implements ChainSigner {
  constructor(private chain: string) {
    if (!EVM_CHAIN_CONFIGS[chain]) {
      throw new Error(`Unsupported EVM chain: ${chain}`);
    }
  }

  /**
   * Build unsigned EVM transaction (EIP-1559)
   */
  async buildUnsignedTransaction(
    recipient: string,
    amount: string,
    fromAddress: string
  ): Promise<UnsignedTransaction> {
    const config = EVM_CHAIN_CONFIGS[this.chain];

    // Connect to RPC
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);

    // Get nonce
    const nonce = await provider.getTransactionCount(fromAddress);

    // Convert amount to wei
    const value = ethers.parseEther(amount);

    // Use chain-specific gas prices for testnets
    // Different chains have different minimum gas requirements
    let maxFeePerGas: bigint;
    let maxPriorityFeePerGas: bigint;

    switch (this.chain) {
      case 'Polygon':
        // Polygon Amoy requires minimum 25 gwei priority fee
        maxFeePerGas = ethers.parseUnits('50', 'gwei');
        maxPriorityFeePerGas = ethers.parseUnits('30', 'gwei');
        break;
      case 'BSC':
        // BSC testnet usually needs higher gas
        maxFeePerGas = ethers.parseUnits('20', 'gwei');
        maxPriorityFeePerGas = ethers.parseUnits('10', 'gwei');
        break;
      case 'Avalanche':
        // Avalanche Fuji
        maxFeePerGas = ethers.parseUnits('30', 'gwei');
        maxPriorityFeePerGas = ethers.parseUnits('2', 'gwei');
        break;
      case 'Ethereum':
      default:
        // Ethereum Sepolia
        maxFeePerGas = ethers.parseUnits('10', 'gwei');
        maxPriorityFeePerGas = ethers.parseUnits('2', 'gwei');
        break;
    }

    console.log(`⛽ Using fixed gas prices for ${this.chain} testnet:`);
    console.log('   maxFeePerGas:', ethers.formatUnits(maxFeePerGas, 'gwei'), 'gwei');
    console.log('   maxPriorityFeePerGas:', ethers.formatUnits(maxPriorityFeePerGas, 'gwei'), 'gwei');
    console.log('   Estimated cost: ~', ethers.formatEther(maxFeePerGas * BigInt(21000)), 'native token');

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

    // CRITICAL: Pass RAW serialized transaction to dWallet, NOT the hash!
    // dWallet will hash it internally with KECCAK256 based on hashScheme parameter
    const serializedTx = tx.unsignedSerialized;  // Raw RLP-encoded bytes
    const messageBytes = ethers.getBytes(serializedTx);  // Pass raw bytes directly

    // For logging: show what the hash SHOULD be after dWallet hashes it
    const expectedTxHash = ethers.keccak256(serializedTx);
    console.log(`✅ ${this.chain} transaction built: ${messageBytes.length} bytes (raw serialized)`);
    console.log(`📋 Serialized tx: ${serializedTx.substring(0, 40)}...`);
    console.log(`📋 Expected tx hash after KECCAK256: ${expectedTxHash}`);

    return { messageBytes, unsignedTx };
  }

  /**
   * Broadcast signed EVM transaction
   */
  async broadcastTransaction(
    unsignedTx: any,
    signature: Uint8Array,
    recoveryId: number
  ): Promise<SignedTransactionResult> {
    const config = EVM_CHAIN_CONFIGS[this.chain];

    console.log('📡 Broadcasting transaction to', this.chain);
    console.log('🔍 Recovery ID (v):', recoveryId);
    console.log('🔍 Signature length:', signature.length);

    // Convert signature to hex
    const signatureHex = '0x' + Buffer.from(signature).toString('hex');

    // Reconstruct the transaction with signature
    const tx = ethers.Transaction.from(unsignedTx);

    // Set the signature
    tx.signature = ethers.Signature.from({
      r: signatureHex.slice(0, 66),  // First 32 bytes
      s: '0x' + signatureHex.slice(66, 130),  // Next 32 bytes
      v: recoveryId,  // Recovery ID
    });

    const serialized = tx.serialized;

    console.log('📋 Signed transaction (serialized):', serialized);

    // Broadcast to network
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const txResponse = await provider.broadcastTransaction(serialized);

    console.log('✅ Transaction broadcast!');
    console.log('🔗 TX Hash:', txResponse.hash);

    // Wait for confirmation
    console.log('⏳ Waiting for confirmation...');
    const receipt = await txResponse.wait();

    console.log('✅ Transaction confirmed!');
    console.log('📦 Block:', receipt?.blockNumber);
    console.log('✅ Status:', receipt?.status === 1 ? 'Success' : 'Failed');

    return {
      signature: signatureHex,
      hash: txResponse.hash,
      txHash: txResponse.hash,
      serialized,
    };
  }
}

/**
 * Get EVM chain signer
 */
export function getEthereumSigner(chain: string): ChainSigner {
  return new EthereumSigner(chain);
}
