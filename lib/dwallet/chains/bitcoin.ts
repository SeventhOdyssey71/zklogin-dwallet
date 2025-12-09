/**
 * Bitcoin chain signing implementation
 */

import { ChainSigner, UnsignedTransaction, SignedTransactionResult } from '../core/types';

/**
 * Bitcoin UTXO structure
 */
interface UTXO {
  txid: string;
  vout: number;
  value: number;
  status: {
    confirmed: boolean;
    block_height?: number;
  };
}

/**
 * Bitcoin chain signer
 */
export class BitcoinSigner implements ChainSigner {
  private rpcUrl = 'https://blockstream.info/testnet/api';

  /**
   * Build unsigned Bitcoin transaction
   */
  async buildUnsignedTransaction(
    recipient: string,
    amount: string,
    fromAddress: string
  ): Promise<UnsignedTransaction> {
    console.log(`📝 Building unsigned Bitcoin transaction...`);
    console.log(`💰 Sending ${amount} BTC`);
    console.log(`📤 From: ${fromAddress}`);
    console.log(`📥 To: ${recipient}`);

    // Fetch UTXOs for the address
    const utxosResponse = await fetch(`${this.rpcUrl}/address/${fromAddress}/utxo`);
    if (!utxosResponse.ok) {
      throw new Error(`Failed to fetch UTXOs: ${utxosResponse.status}`);
    }

    const utxos: UTXO[] = await utxosResponse.json();
    console.log(`📦 Found ${utxos.length} UTXOs`);

    if (utxos.length === 0) {
      throw new Error('No UTXOs available. Address has no funds.');
    }

    // Convert BTC to satoshis
    const amountSatoshis = Math.floor(parseFloat(amount) * 1e8);
    const feeRate = 1; // 1 sat/vbyte for testnet

    // Select UTXOs (simple algorithm: use first UTXO that's large enough)
    let selectedUtxos: UTXO[] = [];
    let totalInput = 0;

    for (const utxo of utxos) {
      if (!utxo.status.confirmed) continue; // Skip unconfirmed

      selectedUtxos.push(utxo);
      totalInput += utxo.value;

      // Estimate transaction size:
      // - Input: ~148 bytes per input
      // - Output: ~34 bytes per output (2 outputs: recipient + change)
      // - Overhead: ~10 bytes
      const estimatedSize = selectedUtxos.length * 148 + 2 * 34 + 10;
      const estimatedFee = estimatedSize * feeRate;

      if (totalInput >= amountSatoshis + estimatedFee) {
        break;
      }
    }

    if (totalInput < amountSatoshis) {
      throw new Error(`Insufficient funds. Have ${totalInput} sats, need ${amountSatoshis} sats`);
    }

    // Calculate fee and change
    const estimatedSize = selectedUtxos.length * 148 + 2 * 34 + 10;
    const fee = estimatedSize * feeRate;
    const change = totalInput - amountSatoshis - fee;

    console.log(`📊 Transaction details:`);
    console.log(`   Inputs: ${selectedUtxos.length} UTXOs, Total: ${totalInput} sats`);
    console.log(`   Amount: ${amountSatoshis} sats`);
    console.log(`   Fee: ${fee} sats (${feeRate} sat/vbyte)`);
    console.log(`   Change: ${change} sats`);

    // Build raw Bitcoin transaction
    // Version (4 bytes) - little endian
    const version = Buffer.alloc(4);
    version.writeUInt32LE(2, 0); // Version 2

    // Input count (1 byte varint)
    const inputCount = Buffer.from([selectedUtxos.length]);

    // Inputs
    const inputs = Buffer.concat(
      selectedUtxos.map((utxo) => {
        // Previous tx hash (32 bytes, reversed)
        const txHash = Buffer.from(utxo.txid, 'hex').reverse();

        // Previous output index (4 bytes, little endian)
        const outputIndex = Buffer.alloc(4);
        outputIndex.writeUInt32LE(utxo.vout, 0);

        // Script length (1 byte) - 0 for unsigned
        const scriptLength = Buffer.from([0]);

        // Sequence (4 bytes) - 0xfffffffe for RBF
        const sequence = Buffer.from([0xfe, 0xff, 0xff, 0xff]);

        return Buffer.concat([txHash, outputIndex, scriptLength, sequence]);
      })
    );

    // Output count (1 byte varint)
    const outputCount = Buffer.from([change > 546 ? 2 : 1]); // Only create change output if > dust (546 sats)

    // Outputs
    const recipientOutput = this.createP2PKHOutput(recipient, amountSatoshis);

    let outputs = recipientOutput;
    if (change > 546) {
      const changeOutput = this.createP2PKHOutput(fromAddress, change);
      outputs = Buffer.concat([recipientOutput, changeOutput]);
    }

    // Locktime (4 bytes)
    const locktime = Buffer.alloc(4);

    // Combine all parts
    const unsignedTx = Buffer.concat([
      version,
      inputCount,
      inputs,
      outputCount,
      outputs,
      locktime,
    ]);

    console.log(`✅ Bitcoin transaction built: ${unsignedTx.length} bytes`);
    console.log(`📋 Raw transaction (hex): ${unsignedTx.toString('hex').substring(0, 40)}...`);

    return {
      messageBytes: new Uint8Array(unsignedTx),
      unsignedTx: {
        rawTx: unsignedTx,
        selectedUtxos,
        recipient,
        amount: amountSatoshis,
        change,
        fee,
        fromAddress,
      },
    };
  }

  /**
   * Create P2PKH output script
   */
  private createP2PKHOutput(address: string, value: number): Buffer {
    // Decode base58 address to get public key hash
    const decoded = this.base58Decode(address);

    // Remove version byte (1 byte) and checksum (4 bytes)
    const pubKeyHash = decoded.slice(1, -4);

    // Value (8 bytes, little endian)
    const valueBuffer = Buffer.alloc(8);
    valueBuffer.writeBigUInt64LE(BigInt(value), 0);

    // P2PKH script: OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
    const script = Buffer.concat([
      Buffer.from([0x76]), // OP_DUP
      Buffer.from([0xa9]), // OP_HASH160
      Buffer.from([0x14]), // Push 20 bytes
      pubKeyHash,
      Buffer.from([0x88]), // OP_EQUALVERIFY
      Buffer.from([0xac]), // OP_CHECKSIG
    ]);

    // Script length (1 byte varint)
    const scriptLength = Buffer.from([script.length]);

    return Buffer.concat([valueBuffer, scriptLength, script]);
  }

  /**
   * Base58 decode (simplified for P2PKH addresses)
   */
  private base58Decode(address: string): Buffer {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    let result = BigInt(0);
    for (let i = 0; i < address.length; i++) {
      const value = BigInt(ALPHABET.indexOf(address[i]));
      if (value === BigInt(-1)) {
        throw new Error('Invalid base58 character');
      }
      result = result * BigInt(58) + value;
    }

    // Convert to buffer
    const hex = result.toString(16).padStart(50, '0');
    return Buffer.from(hex, 'hex');
  }

  /**
   * Broadcast signed Bitcoin transaction
   */
  async broadcastTransaction(
    unsignedTx: any,
    signature: Uint8Array,
    recoveryId: number
  ): Promise<SignedTransactionResult> {
    console.log('📡 Broadcasting Bitcoin transaction...');

    // For Bitcoin, we need to insert the signature into each input's scriptSig
    // This is complex because we need to:
    // 1. Create DER-encoded signature
    // 2. Add SIGHASH_ALL flag (0x01)
    // 3. Add public key
    // 4. Create scriptSig for each input

    // Extract r and s from signature (64 bytes: 32 for r, 32 for s)
    const r = signature.slice(0, 32);
    const s = signature.slice(32, 64);

    // Create DER-encoded signature
    const derSig = this.createDERSignature(r, s);

    console.log('🔍 DER signature:', Buffer.from(derSig).toString('hex'));

    // For now, throw an error indicating this needs full implementation
    throw new Error(
      'Bitcoin transaction signing is partially implemented. ' +
      'Full implementation requires:\n' +
      '1. Public key extraction from dWallet\n' +
      '2. DER signature encoding with SIGHASH_ALL\n' +
      '3. ScriptSig construction for each input\n' +
      '4. Transaction serialization with signatures\n' +
      '5. Broadcast via Blockstream API\n\n' +
      'This will be completed in the next iteration.'
    );
  }

  /**
   * Create DER-encoded signature
   */
  private createDERSignature(r: Uint8Array, s: Uint8Array): Uint8Array {
    // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]

    // Remove leading zeros from r and s
    let rBytes = Buffer.from(r);
    while (rBytes[0] === 0 && rBytes.length > 1) {
      rBytes = rBytes.slice(1);
    }

    let sBytes = Buffer.from(s);
    while (sBytes[0] === 0 && sBytes.length > 1) {
      sBytes = sBytes.slice(1);
    }

    // Add 0x00 prefix if high bit is set (to indicate positive number)
    if (rBytes[0] >= 0x80) {
      rBytes = Buffer.concat([Buffer.from([0x00]), rBytes]);
    }
    if (sBytes[0] >= 0x80) {
      sBytes = Buffer.concat([Buffer.from([0x00]), sBytes]);
    }

    const totalLength = 2 + rBytes.length + 2 + sBytes.length;

    const derSig = Buffer.concat([
      Buffer.from([0x30, totalLength]),
      Buffer.from([0x02, rBytes.length]),
      rBytes,
      Buffer.from([0x02, sBytes.length]),
      sBytes,
      Buffer.from([0x01]), // SIGHASH_ALL
    ]);

    return new Uint8Array(derSig);
  }
}

/**
 * Get Bitcoin chain signer
 */
export function getBitcoinSigner(): ChainSigner {
  return new BitcoinSigner();
}
