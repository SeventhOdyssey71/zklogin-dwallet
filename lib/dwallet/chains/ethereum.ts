/**
 * EVM chain signing — every EVM chain in the registry.
 *
 * WHY THE CHAIN LIST IS DERIVED
 * -----------------------------
 * This module used to hardcode `['Ethereum','Polygon','Avalanche','BSC']`, while the registry offered
 * fourteen chains including five L2s. The result was that Base, Arbitrum, Optimism, Linea and Scroll
 * appeared in the UI, accepted a recipient and an amount, and then failed at signing time with
 * "Unsupported chain" — the send path simply had no implementation for them. Reading `family: 'evm'`
 * from the single registry makes that class of gap impossible.
 */

import { ethers } from 'ethers';
import { ChainSigner, UnsignedTransaction, SignedTransactionResult } from '../core/types';
import { MAINNET_CHAINS } from '../../config/chains';
import { CHAIN_BY_ID } from '../../config/chainRegistry';

/**
 * EVM chain configuration, from the shared registry.
 *
 * The chain ID matters beyond routing: EIP-155 folds it into the signed payload, so a stale testnet ID
 * here would produce a signature that mainnet rejects outright (and that a testnet would happily
 * replay). All nine IDs are verified against their live RPCs.
 */
function evmConfig(chain: string): { chainId: number; rpcUrl: string } {
  const def = CHAIN_BY_ID[chain];
  if (!def || def.family !== 'evm') {
    throw new Error(`Unsupported EVM chain: ${chain}`);
  }
  const config = MAINNET_CHAINS[chain];
  if (!config?.rpcUrl || !config?.chainId) {
    throw new Error(`Missing mainnet RPC config for EVM chain: ${chain}`);
  }
  return { chainId: config.chainId, rpcUrl: config.rpcUrl };
}

/**
 * Priority-fee floors, in gwei — only where the *network* enforces a minimum.
 *
 * The previous version applied a blanket 1 gwei default to any chain not listed, which is wrong on
 * every L2. Measured live: Scroll suggests 0.0000001 gwei and Arbitrum 0 (it ignores priority fees
 * entirely), so a 1 gwei floor overpaid by roughly four orders of magnitude. Where a chain has no rule
 * of its own, the node's own suggestion is the best available answer — so the map stays empty for those
 * and we trust `getFeeData()`.
 */
const NETWORK_MIN_PRIORITY_GWEI: Record<string, string> = {
  // Polygon's validators reject transactions under ~25 gwei priority regardless of what the base fee
  // suggests; this is a documented network rule, not a guess.
  Polygon: '25',
};

/**
 * Fallback gas limit for a native transfer when estimation is unavailable.
 *
 * 21000 is the EVM intrinsic cost of a plain value transfer, but it is NOT sufficient everywhere:
 * Arbitrum folds its L1 data cost into gas units and measured 21348 for the same transfer, so a
 * hardcoded 21000 runs out of gas. We estimate against the node and only fall back to these values.
 */
const FALLBACK_GAS_LIMIT: Record<string, bigint> = {
  Arbitrum: 50_000n, // generous: Arbitrum's L1 component varies with calldata and L1 congestion
};
const DEFAULT_GAS_LIMIT = 21_000n;

/**
 * Ethereum/EVM chain signer
 */
export class EthereumSigner implements ChainSigner {
  constructor(private chain: string) {
    evmConfig(chain); // throws early on an unsupported chain
  }

  /**
   * Build unsigned EVM transaction (EIP-1559)
   */
  async buildUnsignedTransaction(
    recipient: string,
    amount: string,
    fromAddress: string
  ): Promise<UnsignedTransaction> {
    const config = evmConfig(this.chain);

    // Connect to RPC
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);

    // Get nonce
    const nonce = await provider.getTransactionCount(fromAddress);

    // Convert amount to wei
    const value = ethers.parseEther(amount);

    /**
     * Live fee data, per chain.
     *
     * Hardcoded gas was survivable on testnets; on mainnet a fixed maxFeePerGas either strands the
     * transaction when the base fee rises above it or silently overpays by a wide margin. Ask the
     * node, honour any network-enforced floor, then add headroom on the base fee.
     */
    const feeData = await provider.getFeeData();

    // BSC's public RPC reports no EIP-1559 fields at all (maxFeePerGas: null, measured), so the
    // legacy gasPrice is the only signal available there. Treat a missing suggestion as zero rather
    // than substituting an invented floor.
    const nodePriority = feeData.maxPriorityFeePerGas ?? 0n;
    const floor = NETWORK_MIN_PRIORITY_GWEI[this.chain];
    const minPriority = floor ? ethers.parseUnits(floor, 'gwei') : 0n;
    const maxPriorityFeePerGas = nodePriority > minPriority ? nodePriority : minPriority;

    // EIP-1559 base fee can grow ~12.5% per block; 2x gives roughly 6 blocks of headroom. Unspent
    // headroom is refunded, so overshooting the cap costs nothing.
    const suggestedMaxFee = feeData.maxFeePerGas ?? feeData.gasPrice ?? maxPriorityFeePerGas;
    const baseFee =
      suggestedMaxFee > maxPriorityFeePerGas ? suggestedMaxFee - maxPriorityFeePerGas : suggestedMaxFee;
    const maxFeePerGas = baseFee * BigInt(2) + maxPriorityFeePerGas;

    /**
     * Estimate the gas limit rather than assuming 21000.
     *
     * Measured against live RPCs: Arbitrum returns 21348 and several chains 21227 for the very same
     * native transfer, so the old hardcoded 21000 was under the requirement — an out-of-gas failure
     * after the whole MPC signing round had already been paid for. A contract recipient needs more
     * still. Estimation with the real value first, then value-free (a contract may revert on a zero
     * value), then the chain fallback.
     */
    let gasLimit = FALLBACK_GAS_LIMIT[this.chain] ?? DEFAULT_GAS_LIMIT;
    try {
      const estimated = await provider.estimateGas({ from: fromAddress, to: recipient, value });
      // A 25% buffer absorbs block-to-block variation in Arbitrum's L1 component and any state change
      // between estimation and inclusion. Unused gas is refunded.
      gasLimit = (estimated * BigInt(125)) / BigInt(100);
    } catch {
      try {
        const estimated = await provider.estimateGas({ from: fromAddress, to: recipient, value: 0n });
        gasLimit = (estimated * BigInt(125)) / BigInt(100);
      } catch {
        console.warn(`⚠️ Gas estimation unavailable on ${this.chain}; using ${gasLimit} as the limit.`);
      }
    }

    console.log(
      `⛽ ${this.chain} (chainId ${config.chainId}): maxFee ${ethers.formatUnits(maxFeePerGas, 'gwei')} gwei, ` +
        `priority ${ethers.formatUnits(maxPriorityFeePerGas, 'gwei')} gwei, gasLimit ${gasLimit} ` +
        `(max ~${ethers.formatEther(maxFeePerGas * gasLimit)} native)`
    );

    // Build transaction
    const unsignedTx = {
      to: recipient,
      value: value,
      nonce: nonce,
      chainId: config.chainId,
      type: 2, // EIP-1559
      maxFeePerGas,
      maxPriorityFeePerGas,
      gasLimit,
    };

    // Serialize for signing
    const tx = ethers.Transaction.from(unsignedTx);

    // CRITICAL: Pass RAW serialized transaction to dWallet, NOT the hash!
    // dWallet will hash it internally with KECCAK256 based on hashScheme parameter
    const serializedTx = tx.unsignedSerialized;  // Raw RLP-encoded bytes
    const messageBytes = ethers.getBytes(serializedTx);  // Pass raw bytes directly

    if (process.env.NEXT_PUBLIC_DEBUG_SIGNING === '1') {
      console.log(`✅ ${this.chain} tx built: ${messageBytes.length} bytes (raw serialized)`);
      console.log(`📋 Serialized: ${serializedTx.substring(0, 40)}…`);
      console.log(`📋 Expected hash after KECCAK256: ${ethers.keccak256(serializedTx)}`);
    }

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
    const config = evmConfig(this.chain);

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
