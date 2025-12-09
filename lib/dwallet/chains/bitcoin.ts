/**
 * Bitcoin chain signing implementation
 */

import { ChainSigner, UnsignedTransaction, SignedTransactionResult } from '../core/types';
import { ethers } from 'ethers';

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

    // For each UTXO, we need to fetch its transaction to get the scriptPubKey
    // This is required for proper signature generation
    const utxosWithScriptPubKey = await Promise.all(
      utxos.map(async (utxo) => {
        const txResponse = await fetch(`${this.rpcUrl}/tx/${utxo.txid}`);
        if (!txResponse.ok) {
          throw new Error(`Failed to fetch transaction ${utxo.txid}`);
        }
        const txData = await txResponse.json();
        const output = txData.vout[utxo.vout];
        return {
          ...utxo,
          scriptPubKey: output.scriptpubkey,
        };
      })
    );

    if (utxosWithScriptPubKey.length === 0) {
      throw new Error('No UTXOs available. Address has no funds.');
    }

    // Convert BTC to satoshis
    const amountSatoshis = Math.floor(parseFloat(amount) * 1e8);
    const feeRate = 1; // 1 sat/vbyte for testnet

    // Select UTXOs (simple algorithm: use first UTXO that's large enough)
    let selectedUtxos: any[] = [];
    let totalInput = 0;

    for (const utxo of utxosWithScriptPubKey) {
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

    // === CRITICAL: Build signing transaction with scriptPubKey ===
    // For Bitcoin P2PKH signing, we must replace the empty scriptSig with the scriptPubKey
    // of the UTXO being spent, then append SIGHASH_ALL and double SHA256

    console.log('🔐 Building signing transaction for Bitcoin sighash...');

    // For simplicity, assume single input (can be extended for multiple inputs)
    const utxo = selectedUtxos[0];
    const scriptPubKeyHex = utxo.scriptPubKey;
    const scriptPubKey = Buffer.from(scriptPubKeyHex, 'hex');

    console.log(`📋 ScriptPubKey from UTXO: ${scriptPubKeyHex}`);
    console.log(`📋 ScriptPubKey length: ${scriptPubKey.length} bytes`);

    // Build signing transaction: replace empty scriptSig with scriptPubKey
    const voutBuffer = Buffer.alloc(4);
    voutBuffer.writeUInt32LE(utxo.vout, 0);

    const signingInput = Buffer.concat([
      Buffer.from(utxo.txid, 'hex').reverse(),  // Previous tx hash (reversed)
      voutBuffer,                                 // Previous output index (little endian)
      Buffer.from([scriptPubKey.length]),        // Script length
      scriptPubKey,                               // ScriptPubKey (NOT empty!)
      Buffer.from([0xfe, 0xff, 0xff, 0xff]),    // Sequence
    ]);

    const signingTx = Buffer.concat([
      version,
      inputCount,
      signingInput,
      outputCount,
      outputs,
      locktime,
      Buffer.from([0x01, 0x00, 0x00, 0x00]),  // SIGHASH_ALL (4 bytes, little endian)
    ]);

    console.log(`📋 Signing transaction: ${signingTx.length} bytes`);
    console.log(`📋 Signing tx hex (first 100 chars): ${signingTx.toString('hex').substring(0, 100)}...`);

    // CRITICAL: Pass RAW signing transaction to dWallet, NOT the hash!
    // dWallet will hash it internally with DoubleSHA256 based on hashScheme parameter
    const messageBytes = new Uint8Array(signingTx);

    // For logging: Calculate what the sighash SHOULD be after dWallet hashes it
    const crypto = require('crypto');
    const hash1 = crypto.createHash('sha256').update(signingTx).digest();
    const expectedSighash = crypto.createHash('sha256').update(hash1).digest();

    console.log(`✅ Passing RAW signing transaction to dWallet: ${signingTx.length} bytes`);
    console.log(`📋 Expected sighash after DoubleSHA256: ${expectedSighash.toString('hex')}`);
    console.log(`📋 dWallet will apply DoubleSHA256 hashing internally`);

    return {
      messageBytes,  // Pass raw signing transaction, dWallet will hash it!
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
    // Browser-compatible way to write 64-bit integer
    const valueBuffer = Buffer.alloc(8);
    const valueBigInt = BigInt(value);
    for (let i = 0; i < 8; i++) {
      valueBuffer[i] = Number((valueBigInt >> BigInt(i * 8)) & BigInt(0xff));
    }

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
   * Constructs the final signed transaction with scriptSig
   */
  async broadcastTransaction(
    unsignedTx: any,
    signature: Uint8Array,
    recoveryId: number
  ): Promise<SignedTransactionResult> {
    console.log('📝 Finalizing Bitcoin transaction with signature...');

    const { rawTx, selectedUtxos, publicKey } = unsignedTx;

    if (!publicKey) {
      throw new Error('Public key is required for Bitcoin signing');
    }

    console.log('🔑 Using public key:', publicKey.substring(0, 40) + '...');

    // Extract r and s from signature (64 bytes: 32 for r, 32 for s)
    const r = signature.slice(0, 32);
    const s = signature.slice(32, 64);

    // Create DER-encoded signature with SIGHASH_ALL
    const derSig = this.createDERSignature(r, s);
    console.log('📋 DER signature:', Buffer.from(derSig).toString('hex'));

    // Create scriptSig for P2PKH: <signature> <pubkey>
    const pubKeyBytes = Buffer.from(publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey, 'hex');
    const scriptSig = Buffer.concat([
      Buffer.from([derSig.length]),  // Push DER signature length
      Buffer.from(derSig),
      Buffer.from([pubKeyBytes.length]),  // Push pubkey length
      pubKeyBytes,
    ]);

    console.log('📋 ScriptSig length:', scriptSig.length);
    console.log('📋 ScriptSig hex:', scriptSig.toString('hex'));

    // Now rebuild the transaction with scriptSig
    // Parse the unsigned transaction to insert scriptSig
    const unsignedBuffer = Buffer.from(rawTx);

    console.log('📋 Unsigned tx hex:', unsignedBuffer.toString('hex'));
    console.log('📋 Unsigned tx length:', unsignedBuffer.length);

    // Find where to insert scriptSig (after the outpoint in first input)
    // Version (4 bytes) + input count (1 byte) + txid (32 bytes) + vout (4 bytes) = 41 bytes
    const prefix = unsignedBuffer.slice(0, 41);

    console.log('📋 Prefix (41 bytes):', prefix.toString('hex'));
    console.log('📋 Empty scriptSig length byte at position 41:', unsignedBuffer[41]);

    // Skip only the empty scriptSig length (1 byte with value 0)
    // The suffix includes sequence + outputs + locktime
    const suffixStart = 41 + 1;
    const suffix = unsignedBuffer.slice(suffixStart);

    console.log('📋 Suffix starts at byte', suffixStart, ':', suffix.toString('hex').substring(0, 40) + '...');

    // Construct final signed transaction
    // Structure: [prefix][scriptSig_length][scriptSig][suffix (contains sequence+outputs+locktime)]
    const signedTx = Buffer.concat([
      prefix,
      Buffer.from([scriptSig.length]),  // New script length
      scriptSig,
      suffix,  // Contains sequence (0xfeffffff) + outputs + locktime
    ]);

    const txHex = signedTx.toString('hex');
    const txHash = Buffer.from(ethers.keccak256('0x' + txHex).slice(2), 'hex').reverse().toString('hex');

    console.log('✅ Bitcoin transaction finalized!');
    console.log('📋 Signed transaction length:', signedTx.length, 'bytes');
    console.log('📋 Complete TX hex:', txHex);

    return {
      signature: Buffer.from(signature).toString('hex'),
      hash: txHash,
      txHash: txHash,
      serialized: txHex,
    };
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
