/**
 * Cardano chain signing implementation
 *
 * Cardano uses ED25519 signatures (EdDSA) on a UTXO model.
 * Key concepts:
 * - UTXOs: Unspent transaction outputs (like Bitcoin)
 * - Transaction inputs: References to UTXOs being spent
 * - Transaction outputs: New UTXOs being created
 * - Transaction fees: Calculated based on transaction size
 * - Shelley-era addresses: Bech32-encoded with payment and stake credentials
 */

import { ChainSigner, UnsignedTransaction, SignedTransactionResult } from '../core/types';
import { CARDANO_TESTNET } from '../../config/chains';

/**
 * Cardano chain signer for Preview testnet
 */
export class CardanoSigner implements ChainSigner {
  /**
   * Build unsigned Cardano transaction
   */
  async buildUnsignedTransaction(
    recipient: string,
    amount: string,
    fromAddress: string,
    publicKey?: string
  ): Promise<UnsignedTransaction> {
    console.log(`📝 Building unsigned Cardano transaction...`);

    if (!publicKey) {
      throw new Error('Public key is required for Cardano transactions');
    }

    try {
      // Dynamically import Cardano serialization library (browser-only)
      const CardanoWasm = await import('@emurgo/cardano-serialization-lib-browser');

      // Convert ADA to lovelace (1 ADA = 1,000,000 lovelace)
      const amountInLovelace = Math.floor(parseFloat(amount) * 1e6);

      console.log(`💰 Sending ${amount} tADA (${amountInLovelace} lovelace)`);
      console.log(`📤 From: ${fromAddress}`);
      console.log(`📥 To: ${recipient}`);

      // Fetch UTXOs for the sender address
      console.log('🔍 Fetching UTXOs from Koios API...');
      const utxosResponse = await fetch(`/api/cardano-utxos?address=${fromAddress}`);
      if (!utxosResponse.ok) {
        throw new Error(`Failed to fetch UTXOs: ${utxosResponse.status}`);
      }

      const utxosData = await utxosResponse.json();
      if (!utxosData || !Array.isArray(utxosData) || utxosData.length === 0) {
        throw new Error('No UTXOs found for this address. Address needs to be funded first.');
      }

      console.log(`✅ Found ${utxosData.length} UTXOs`);

      // Get protocol parameters
      console.log('🔍 Fetching protocol parameters...');
      const paramsResponse = await fetch('/api/cardano-params');
      if (!paramsResponse.ok) {
        throw new Error(`Failed to fetch protocol parameters: ${paramsResponse.status}`);
      }

      const protocolParams = await paramsResponse.json();
      console.log('✅ Protocol parameters fetched');

      // Get current chain tip to calculate accurate TTL
      console.log('🔍 Fetching current chain tip for TTL...');
      const tipResponse = await fetch('/api/cardano-tip');
      if (!tipResponse.ok) {
        throw new Error(`Failed to fetch chain tip: ${tipResponse.status}`);
      }

      const tipData = await tipResponse.json();
      const currentSlot = tipData.abs_slot;
      console.log(`✅ Current slot: ${currentSlot}`);

      // Build transaction using Cardano serialization library
      const txBuilder = CardanoWasm.TransactionBuilder.new(
        CardanoWasm.TransactionBuilderConfigBuilder.new()
          .fee_algo(
            CardanoWasm.LinearFee.new(
              CardanoWasm.BigNum.from_str(protocolParams.min_fee_a?.toString() || '44'),
              CardanoWasm.BigNum.from_str(protocolParams.min_fee_b?.toString() || '155381')
            )
          )
          .pool_deposit(CardanoWasm.BigNum.from_str(protocolParams.pool_deposit?.toString() || '500000000'))
          .key_deposit(CardanoWasm.BigNum.from_str(protocolParams.key_deposit?.toString() || '2000000'))
          .max_value_size(protocolParams.max_val_size || 5000)
          .max_tx_size(protocolParams.max_tx_size || 16384)
          .coins_per_utxo_byte(CardanoWasm.BigNum.from_str(protocolParams.coins_per_utxo_size?.toString() || '4310'))
          .build()
      );

      // Add inputs from UTXOs
      const txUnspentOutputs = CardanoWasm.TransactionUnspentOutputs.new();
      let totalInput = 0;

      // Koios returns UTXOs directly as an array
      for (const utxo of utxosData) {
        const txHash = CardanoWasm.TransactionHash.from_bytes(
          Buffer.from(utxo.tx_hash, 'hex')
        );
        const txInput = CardanoWasm.TransactionInput.new(
          txHash,
          utxo.tx_index
        );
        const value = CardanoWasm.Value.new(
          CardanoWasm.BigNum.from_str(utxo.value)
        );
        const output = CardanoWasm.TransactionOutput.new(
          CardanoWasm.Address.from_bech32(fromAddress),
          value
        );
        const unspentOutput = CardanoWasm.TransactionUnspentOutput.new(txInput, output);

        txUnspentOutputs.add(unspentOutput);
        totalInput += parseInt(utxo.value);
      }

      console.log(`💰 Total input: ${totalInput} lovelace`);

      // Add output (recipient)
      const recipientAddress = CardanoWasm.Address.from_bech32(recipient);
      const outputValue = CardanoWasm.Value.new(
        CardanoWasm.BigNum.from_str(amountInLovelace.toString())
      );
      const output = CardanoWasm.TransactionOutput.new(recipientAddress, outputValue);
      txBuilder.add_output(output);

      // Set TTL (time to live) - current slot + 2 hours (assuming 1 second per slot)
      const ttl = currentSlot + 7200; // 2 hours = 7200 slots
      console.log(`⏰ Setting TTL to slot ${ttl} (current: ${currentSlot}, +2 hours)`);
      txBuilder.set_ttl(ttl);

      // Add change output and calculate fee
      const changeAddress = CardanoWasm.Address.from_bech32(fromAddress);
      txBuilder.add_inputs_from(txUnspentOutputs, 1); // CoinSelectionStrategyCIP2
      txBuilder.add_change_if_needed(changeAddress);

      // Build the transaction body
      const txBody = txBuilder.build();

      // Get the transaction body bytes to hash for signing
      const txBodyBytes = txBody.to_bytes();

      // Compute Blake2b-256 hash of transaction body (this is what we sign)
      const { blake2b } = require('blakejs');
      const txBodyHash = blake2b(txBodyBytes, null, 32); // 32 bytes = 256 bits
      const messageBytes = new Uint8Array(txBodyHash);

      console.log(`✅ Cardano transaction built`);
      console.log(`📋 Transaction body hash: ${Buffer.from(messageBytes).toString('hex')}`);
      console.log(`📋 Message to sign (${messageBytes.length} bytes)`);

      return {
        messageBytes,
        unsignedTx: {
          txBody,
          fromAddress,
          publicKey, // Store public key for witness creation
          CardanoWasm, // Pass the library instance for later use
        },
      };
    } catch (error) {
      console.error('❌ Error building Cardano transaction:', error);
      throw error;
    }
  }

  /**
   * Broadcast signed Cardano transaction
   */
  async broadcastTransaction(
    unsignedTx: any,
    signature: Uint8Array
  ): Promise<SignedTransactionResult> {
    console.log('📡 Broadcasting transaction to Cardano Preview testnet...');

    try {
      const { txBody, fromAddress, publicKey, CardanoWasm } = unsignedTx;

      // ED25519 signature is 64 bytes
      const signatureBytes = signature.slice(0, 64);
      const signatureHex = Buffer.from(signatureBytes).toString('hex');
      console.log(`🔐 Signature (${signature.length} bytes):`, signatureHex);

      // Parse public key (remove 0x prefix if present)
      const pubKeyHex = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
      const pubKeyBytes = Buffer.from(pubKeyHex, 'hex');

      console.log(`🔑 Public key (${pubKeyBytes.length} bytes):`, pubKeyHex);

      // Create witness set with the signature
      const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();

      // Create PublicKey from raw bytes, then create Vkey from it
      const publicKeyObj = CardanoWasm.PublicKey.from_bytes(pubKeyBytes);
      const vkey = CardanoWasm.Vkey.new(publicKeyObj);

      // Create Ed25519Signature from signature bytes
      const ed25519Signature = CardanoWasm.Ed25519Signature.from_bytes(signatureBytes);

      // Create Vkeywitness (combines public key and signature)
      const vkeyWitness = CardanoWasm.Vkeywitness.new(vkey, ed25519Signature);
      vkeyWitnesses.add(vkeyWitness);

      // Create witness set
      const witnessSet = CardanoWasm.TransactionWitnessSet.new();
      witnessSet.set_vkeys(vkeyWitnesses);

      // Create signed transaction (only body and witness set, no auxiliary data)
      const signedTx = CardanoWasm.Transaction.new(txBody, witnessSet);

      const txBytes = signedTx.to_bytes();
      const txHex = Buffer.from(txBytes).toString('hex');

      console.log(`📦 Signed transaction (${txBytes.length} bytes)`);
      console.log(`📋 TX hex: ${txHex.substring(0, 100)}...`);
      console.log(`📋 TX CBOR structure (first byte): 0x${txHex.substring(0, 2)}`);

      // Submit to Koios API via our proxy
      console.log('📡 Submitting transaction to Cardano network...');
      const submitResponse = await fetch('/api/cardano-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx: txHex
        })
      });

      if (!submitResponse.ok) {
        const errorText = await submitResponse.text();
        throw new Error(`Transaction submission failed: ${submitResponse.status} - ${errorText}`);
      }

      const result = await submitResponse.json();
      console.log('✅ Transaction submitted successfully');
      console.log('📋 Result:', result);

      // Compute transaction ID from signed transaction (already have txBytes from above)
      const { blake2b } = require('blakejs');
      const txId = blake2b(txBytes, null, 32);
      const finalTxHash = Buffer.from(txId).toString('hex');

      return {
        signature: signatureHex,
        hash: finalTxHash,
        txHash: finalTxHash,
      };
    } catch (error) {
      console.error('❌ Cardano broadcast failed:', error);
      throw error;
    }
  }
}

/**
 * Get Cardano chain signer
 */
export function getCardanoSigner(): ChainSigner {
  return new CardanoSigner();
}
