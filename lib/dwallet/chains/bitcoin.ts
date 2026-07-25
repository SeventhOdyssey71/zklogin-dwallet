/**
 * Bitcoin chain signing — Taproot (P2TR / BIP341), the SDK's intended Bitcoin path.
 *
 * WHY TAPROOT
 * -----------
 * The Ika SDK names its signature algorithms after their use: `Taproot` is documented as
 * "Taproot (Bitcoin)". It is BIP340 Schnorr on secp256k1 — which is precisely what 2PC-MPC v4
 * ("fast Schnorr") accelerates, and per the SDK, Schnorr/Taproot **always** uses
 * `requestGlobalPresign`, i.e. the v4 presignature pool with its single ~400ms online round. The
 * old legacy-ECDSA path was the slow one.
 *
 * HOW IKA'S TAPROOT SIGNING BEHAVES (from the SDK's own integration tests)
 * -----------------------------------------------------------------------
 * `all-combinations.test.ts` verifies a Taproot signature as:
 *
 *     schnorr.verify(signature, computeHash(message), publicKey.slice(1))
 *
 * Three facts fall out of that, and the whole implementation follows from them:
 *
 *   1. The signature is a bare 64-byte BIP340 Schnorr signature. No recovery id, no DER, and for
 *      SIGHASH_DEFAULT no trailing sighash byte.
 *   2. It verifies against the **x-only** public key — the 33-byte compressed key minus its parity
 *      prefix (`.slice(1)`).
 *   3. Ika signs `SHA256(message)`, where `message` is what we hand it. It applies **no BIP341 key
 *      tweak**, and there is no tweak function anywhere in the SDK or ika-wasm.
 *
 * CONSEQUENCE 1 — the output key is the UNTWEAKED key.
 * BIP341 normally sets the output key to Q = P + H_TapTweak(P)·G. Spending that key-path requires
 * signing with (p + t), which Ika cannot do since it can't tweak its secret share. So we use the
 * dWallet's x-only key directly as the taproot output key. Consensus only checks
 * `schnorr_verify(Q, sighash, sig)` against whatever 32 bytes sit in the scriptPubKey — it does not
 * care how Q was derived — so this is valid and, crucially, spendable. There is no script tree, so
 * there is no key-path/script-path ambiguity to worry about.
 *
 * CONSEQUENCE 2 — how we get BIP341's sighash out of a plain SHA256.
 * The real sighash is `taggedHash("TapSighash", 0x00 || SigMsg)`, and a BIP340 tagged hash is just
 *     taggedHash(tag, m) = SHA256( SHA256(tag) || SHA256(tag) || m )
 * Since Ika gives us exactly one SHA256, we hand it
 *     message = SHA256("TapSighash") || SHA256("TapSighash") || 0x00 || SigMsg
 * and its single SHA256 emits the exact BIP341 sighash. No protocol changes, no second hash.
 *
 * SAFETY NET
 * ----------
 * The SigMsg preimage is assembled here by hand (it has to be — we need the pre-tag bytes, and
 * libraries only expose the finished hash). So on every signing operation we also compute the
 * authoritative sighash with the audited `@scure/btc-signer` and assert the two agree before
 * anything is signed or broadcast. A mismatch throws instead of burning a real UTXO.
 */

import { Transaction } from '@scure/btc-signer';
import { sha256 } from '@noble/hashes/sha2.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bech32, bech32m } from 'bech32';
import { ChainSigner, UnsignedTransaction, SignedTransactionResult } from '../core/types';
import { MAINNET_CHAINS } from '../../config/chains';

/** Blockstream UTXO shape. */
interface UTXO {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number };
}

/** Taproot outputs below this are unspendable dust and rejected by relays. */
const P2TR_DUST_SATS = 330;

/**
 * Exact virtual size of a 1-input P2TR key-path spend with the given output scripts.
 *
 * Computed rather than estimated: a fixed guess either underpays (slow or stuck) or overpays, and
 * the real number is fully determined here because we control the input count and know every output
 * script length up front.
 *
 *   base   = nVersion(4) + txinCount(1) + txin(41) + txoutCount(1) + Σ(value 8 + len 1 + script) + locktime(4)
 *   total  = base + segwit marker&flag(2) + witness(1 item + 1 len + 64 sig = 66)
 *   weight = base*3 + total,   vsize = ceil(weight / 4)
 */
function p2trSpendVsize(outputScriptLengths: number[]): number {
  const base =
    4 + 1 + 41 + 1 + outputScriptLengths.reduce((n, len) => n + 9 + len, 0) + 4;
  const total = base + 2 + 66;
  return Math.ceil((base * 3 + total) / 4);
}

const TAP_SIGHASH_TAG = sha256(new TextEncoder().encode('TapSighash'));

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

const u32le = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};

const u64le = (n: bigint): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};

const hexToBytes = (hex: string): Uint8Array => {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
};

const bytesToHex = (b: Uint8Array): string =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');

/**
 * dWallet public key → 32-byte x-only key.
 *
 * Ika hands back a 33-byte compressed secp256k1 key; Taproot verification uses `publicKey.slice(1)`
 * (drop the 0x02/0x03 parity prefix). 64/65-byte uncompressed forms are also tolerated.
 */
export function xOnlyPublicKey(publicKey: string): Uint8Array {
  const bytes = hexToBytes(publicKey);
  if (bytes.length === 33) return bytes.slice(1);
  if (bytes.length === 32) return bytes;
  if (bytes.length === 65) return bytes.slice(1, 33);
  if (bytes.length === 64) return bytes.slice(0, 32);
  throw new Error(`Unexpected secp256k1 public key length: ${bytes.length} bytes`);
}

/** x-only key → P2TR scriptPubKey (`OP_1 PUSH32 <Q>`). */
export function p2trScript(xOnly: Uint8Array): Uint8Array {
  if (xOnly.length !== 32) throw new Error('P2TR output key must be 32 bytes');
  return concat(new Uint8Array([0x51, 0x20]), xOnly);
}

/** x-only key → mainnet bech32m address (`bc1p…`). */
export function p2trAddress(xOnly: Uint8Array): string {
  return bech32m.encode('bc', [1, ...bech32m.toWords(xOnly)], 200);
}

/** Decode any supported Bitcoin mainnet address to its scriptPubKey. */
function addressToScript(address: string): Uint8Array {
  // bech32 / bech32m (segwit v0 and v1+). BIP350: v0 uses bech32, v1+ uses bech32m — the two
  // checksums are deliberately incompatible, so the version dictates the decoder.
  if (address.startsWith('bc1')) {
    const decoded = address.startsWith('bc1p')
      ? bech32m.decode(address, 200)
      : bech32.decode(address, 200);
    const version = decoded.words[0];
    const program = new Uint8Array(bech32m.fromWords(decoded.words.slice(1)));
    if (version === 0) {
      if (program.length !== 20 && program.length !== 32) {
        throw new Error('Invalid segwit v0 program length');
      }
      return concat(new Uint8Array([0x00, program.length]), program);
    }
    if (version === 1 && program.length !== 32) {
      throw new Error('Invalid taproot program length');
    }
    return concat(new Uint8Array([0x50 + version, program.length]), program);
  }

  // base58check: P2PKH ('1…') and P2SH ('3…')
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = 0n;
  for (const ch of address) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid Bitcoin address: ${address}`);
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let bytes = hexToBytes(hex);
  // restore leading zero bytes eaten by base58
  for (const ch of address) {
    if (ch !== '1') break;
    bytes = concat(new Uint8Array([0]), bytes);
  }
  const payload = bytes.slice(0, bytes.length - 4);
  const checksum = bytes.slice(bytes.length - 4);
  const expected = sha256(sha256(payload)).slice(0, 4);
  if (bytesToHex(checksum) !== bytesToHex(expected)) {
    throw new Error(`Bad address checksum: ${address}`);
  }
  const hash160 = payload.slice(1);
  if (payload[0] === 0x00) {
    // OP_DUP OP_HASH160 PUSH20 <h> OP_EQUALVERIFY OP_CHECKSIG
    return concat(new Uint8Array([0x76, 0xa9, 0x14]), hash160, new Uint8Array([0x88, 0xac]));
  }
  if (payload[0] === 0x05) {
    // OP_HASH160 PUSH20 <h> OP_EQUAL
    return concat(new Uint8Array([0xa9, 0x14]), hash160, new Uint8Array([0x87]));
  }
  throw new Error(`Unsupported address version byte 0x${payload[0].toString(16)}`);
}

/**
 * Build the BIP341 SigMsg preimage for a key-path spend with SIGHASH_DEFAULT, prefixed with the
 * two TapSighash tag digests so that a single SHA256 over the result equals the real sighash.
 *
 * Single-input only (see the selection note in buildUnsignedTransaction) — with one input,
 * sha_prevouts/amounts/scriptpubkeys/sequences each cover exactly that input.
 */
function taprootSighashPreimage(params: {
  version: number;
  lockTime: number;
  prevTxid: Uint8Array; // internal byte order (little-endian, as serialized)
  prevVout: number;
  prevAmount: bigint;
  prevScript: Uint8Array;
  sequence: number;
  outputs: { script: Uint8Array; amount: bigint }[];
  inputIndex: number;
}): Uint8Array {
  const {
    version,
    lockTime,
    prevTxid,
    prevVout,
    prevAmount,
    prevScript,
    sequence,
    outputs,
    inputIndex,
  } = params;

  const shaPrevouts = sha256(concat(prevTxid, u32le(prevVout)));
  const shaAmounts = sha256(u64le(prevAmount));
  const shaScriptPubKeys = sha256(
    concat(new Uint8Array([prevScript.length]), prevScript) // varint length (always < 0xfd here)
  );
  const shaSequences = sha256(u32le(sequence));
  const shaOutputs = sha256(
    concat(
      ...outputs.map((o) => concat(u64le(o.amount), new Uint8Array([o.script.length]), o.script))
    )
  );

  const sigMsg = concat(
    new Uint8Array([0x00]), // epoch (BIP341 hashes 0x00 || SigMsg)
    new Uint8Array([0x00]), // hash_type = SIGHASH_DEFAULT
    u32le(version),
    u32le(lockTime),
    shaPrevouts,
    shaAmounts,
    shaScriptPubKeys,
    shaSequences,
    shaOutputs,
    new Uint8Array([0x00]), // spend_type: no annex, key path
    u32le(inputIndex)
  );

  // Ika computes SHA256(message); tag||tag||sigMsg turns that into taggedHash("TapSighash", …).
  return concat(TAP_SIGHASH_TAG, TAP_SIGHASH_TAG, sigMsg);
}

/** Bitcoin Taproot signer. */
export class BitcoinSigner implements ChainSigner {
  private rpcUrl = MAINNET_CHAINS.Bitcoin.rpcUrl;

  /**
   * Live fee rate in sat/vByte, targeting ~3-block confirmation.
   *
   * A flat rate always confirmed on testnet; on mainnet it either strands the transaction or
   * overpays, so read Blockstream's estimates and fall back to a conservative floor.
   */
  private async getFeeRate(): Promise<number> {
    const FALLBACK_SAT_PER_VBYTE = 5;
    try {
      const res = await fetch(`${this.rpcUrl}/fee-estimates`);
      if (!res.ok) return FALLBACK_SAT_PER_VBYTE;
      const estimates: Record<string, number> = await res.json();
      const target = estimates['3'] ?? estimates['2'] ?? estimates['1'];
      if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) {
        return FALLBACK_SAT_PER_VBYTE;
      }
      return Math.max(1, Math.ceil(target)); // never below the 1 sat/vB relay minimum
    } catch {
      return FALLBACK_SAT_PER_VBYTE;
    }
  }

  /**
   * Build an unsigned P2TR spend.
   *
   * Speed notes — the old implementation did two things that dominated its latency:
   *   • one extra `/tx/{txid}` request per UTXO purely to recover each prevout's scriptPubKey.
   *     Unnecessary here: we only ever spend our *own* P2TR outputs, so every prevout script is
   *     `p2trScript(ourKey)`, computable locally. Those N requests are gone.
   *   • it fetched UTXOs and the fee rate sequentially; they are independent, so they now run
   *     concurrently.
   */
  async buildUnsignedTransaction(
    recipient: string,
    amount: string,
    fromAddress: string,
    publicKey?: string
  ): Promise<UnsignedTransaction> {
    if (!publicKey) {
      throw new Error('Bitcoin Taproot signing needs the dWallet public key to derive the prevout script');
    }

    const xOnly = xOnlyPublicKey(publicKey);
    const ourScript = p2trScript(xOnly);
    const derived = p2trAddress(xOnly);

    if (derived !== fromAddress) {
      throw new Error(
        `Address mismatch: dWallet key derives ${derived} but the spend targets ${fromAddress}. ` +
          `Refusing to build a transaction whose inputs it cannot sign.`
      );
    }

    console.log('📝 Building unsigned Bitcoin Taproot (P2TR) transaction…');
    console.log(`📤 From: ${fromAddress}`);
    console.log(`📥 To:   ${recipient}`);

    // Independent network reads — run them together.
    const [utxosRes, feeRate] = await Promise.all([
      fetch(`${this.rpcUrl}/address/${fromAddress}/utxo`),
      this.getFeeRate(),
    ]);
    if (!utxosRes.ok) throw new Error(`Failed to fetch UTXOs: ${utxosRes.status}`);
    const utxos: UTXO[] = await utxosRes.json();

    const confirmed = utxos.filter((u) => u.status.confirmed);
    if (confirmed.length === 0) {
      throw new Error(
        utxos.length > 0
          ? 'All UTXOs are still unconfirmed — wait for a confirmation and retry.'
          : 'No UTXOs available. This address has no funds.'
      );
    }

    const amountSats = BigInt(Math.floor(parseFloat(amount) * 1e8));
    if (amountSats <= 0n) throw new Error('Amount must be greater than zero');
    console.log(`💰 Sending ${amount} BTC (${amountSats} sats) at ${feeRate} sat/vB`);

    // Exact fee for each shape, using the real recipient script length.
    const recipientScriptEarly = addressToScript(recipient);
    const vsizeWithChange = p2trSpendVsize([recipientScriptEarly.length, ourScript.length]);
    const vsizeNoChange = p2trSpendVsize([recipientScriptEarly.length]);

    // Single-input selection: pick the smallest confirmed UTXO that still covers amount + fee.
    //
    // Deliberately one input. Each additional input needs its own BIP341 sighash and therefore its
    // own MPC signature — a separate presign + sign round trip — and the ChainSigner contract here
    // carries a single message. Rather than silently produce a transaction with one signature and
    // several unsigned inputs (which is what the previous legacy path would have done), we require
    // one sufficient UTXO and fail with a clear message otherwise.
    const feeFor = (outputs: number) =>
      BigInt(Math.ceil((outputs === 2 ? vsizeWithChange : vsizeNoChange) * feeRate));

    const sorted = [...confirmed].sort((a, b) => a.value - b.value);
    let chosen: UTXO | undefined;
    let fee = 0n;
    let change = 0n;
    let withChange = true;

    for (const utxo of sorted) {
      const value = BigInt(utxo.value);

      const feeTwo = feeFor(2);
      if (value >= amountSats + feeTwo) {
        const rest = value - amountSats - feeTwo;
        if (rest >= BigInt(P2TR_DUST_SATS)) {
          chosen = utxo;
          fee = feeTwo;
          change = rest;
          withChange = true;
          break;
        }
      }
      // No viable change output — sweep the remainder into the fee instead of creating dust.
      const feeOne = feeFor(1);
      if (value >= amountSats + feeOne) {
        chosen = utxo;
        fee = value - amountSats;
        change = 0n;
        withChange = false;
        break;
      }
    }

    if (!chosen) {
      const total = confirmed.reduce((s, u) => s + BigInt(u.value), 0n);
      const largest = sorted[sorted.length - 1];
      throw new Error(
        `No single UTXO covers ${amountSats} sats + fee. Largest is ${largest.value} sats ` +
          `(${confirmed.length} UTXOs totalling ${total} sats). Each extra input needs its own MPC ` +
          `signature, so this wallet spends one UTXO per transaction — send an amount that fits ` +
          `the largest UTXO, or consolidate first.`
      );
    }

    const outputs: { script: Uint8Array; amount: bigint }[] = [
      { script: recipientScriptEarly, amount: amountSats },
    ];
    if (withChange) outputs.push({ script: ourScript, amount: change });

    const VERSION = 2;
    const LOCKTIME = 0;
    const SEQUENCE = 0xfffffffd; // RBF-enabled

    const vsize = withChange ? vsizeWithChange : vsizeNoChange;
    console.log(`📊 1 input (${chosen.value} sats) → ${outputs.length} output(s), ${vsize} vB`);
    console.log(
      `   fee ${fee} sats (${(Number(fee) / vsize).toFixed(2)} sat/vB)` +
        `${withChange ? `, change ${change} sats` : ' — no change; remainder swept to fee'}`
    );

    // Authoritative transaction + sighash from the audited library.
    const tx = new Transaction({
      version: VERSION,
      lockTime: LOCKTIME,
      allowUnknownOutputs: true,
      allowLegacyWitnessUtxo: true,
    });
    const txidBytes = hexToBytes(chosen.txid); // Blockstream returns display (big-endian) order
    tx.addInput({
      txid: txidBytes,
      index: chosen.vout,
      sequence: SEQUENCE,
      witnessUtxo: { script: ourScript, amount: BigInt(chosen.value) },
    });
    for (const o of outputs) tx.addOutput({ script: o.script, amount: o.amount });

    const authoritativeSighash = tx.preimageWitnessV1(
      0,
      [ourScript],
      0, // SIGHASH_DEFAULT
      [BigInt(chosen.value)]
    );

    // Our preimage, shaped so Ika's single SHA256 lands on the same value.
    // scure takes the txid in display order and reverses it internally; the raw serialization (and
    // therefore sha_prevouts) uses the reversed form.
    const messageBytes = taprootSighashPreimage({
      version: VERSION,
      lockTime: LOCKTIME,
      prevTxid: new Uint8Array([...txidBytes].reverse()),
      prevVout: chosen.vout,
      prevAmount: BigInt(chosen.value),
      prevScript: ourScript,
      sequence: SEQUENCE,
      outputs,
      inputIndex: 0,
    });

    // The guard: prove the hand-built preimage hashes to the audited sighash BEFORE we spend
    // anything. If these ever diverge, the signature would be unusable and the UTXO wasted.
    const derivedSighash = sha256(messageBytes);
    if (bytesToHex(derivedSighash) !== bytesToHex(authoritativeSighash)) {
      throw new Error(
        `BIP341 sighash mismatch — refusing to sign. ` +
          `built=${bytesToHex(derivedSighash)} expected=${bytesToHex(authoritativeSighash)}`
      );
    }
    console.log(`✅ BIP341 sighash verified against @scure/btc-signer: ${bytesToHex(derivedSighash).slice(0, 16)}…`);

    return {
      messageBytes,
      unsignedTx: {
        tx,
        sighash: authoritativeSighash,
        xOnly,
        selectedUtxo: chosen,
        fee: Number(fee),
      },
    };
  }

  /**
   * Attach the Schnorr signature as the input witness and serialize.
   *
   * SIGHASH_DEFAULT means the witness is exactly the bare 64-byte signature — no trailing sighash
   * byte (that is only for explicit non-default types), no pubkey (it is already the output key),
   * no scriptSig at all.
   */
  async broadcastTransaction(
    unsignedTx: {
      tx: Transaction;
      sighash: Uint8Array;
      xOnly: Uint8Array;
      selectedUtxo: UTXO;
    },
    signature: Uint8Array
  ): Promise<SignedTransactionResult> {
    const { tx, sighash, xOnly } = unsignedTx;

    const sig = signature.length === 65 ? signature.slice(0, 64) : signature;
    if (sig.length !== 64) {
      throw new Error(`Expected a 64-byte BIP340 Schnorr signature, got ${signature.length} bytes`);
    }

    // Verify locally exactly the way Ika's own test does — catches a bad signature before it costs
    // a fee, and confirms the untweaked output key assumption holds.
    if (!schnorr.verify(sig, sighash, xOnly)) {
      throw new Error(
        'Schnorr signature does not verify against the dWallet x-only key over the BIP341 sighash. ' +
          'Refusing to broadcast an invalid transaction.'
      );
    }
    console.log('✅ Schnorr signature verifies against the taproot output key');

    tx.updateInput(0, { finalScriptWitness: [sig] });

    const serialized = bytesToHex(tx.extract());
    const txid = tx.id;

    console.log('📡 Broadcasting Bitcoin Taproot transaction…');
    const res = await fetch(`${this.rpcUrl}/tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: serialized,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Bitcoin broadcast failed: ${res.status} — ${body}`);
    }
    const broadcastTxid = (await res.text()).trim();

    console.log('✅ Broadcast:', broadcastTxid);
    console.log('📋 Explorer:', `${MAINNET_CHAINS.Bitcoin.blockExplorer}/tx/${broadcastTxid}`);

    return {
      signature: '0x' + bytesToHex(sig),
      hash: broadcastTxid || txid,
      txHash: broadcastTxid || txid,
      serialized,
    };
  }
}

/** Factory used by the chain registry in `./index.ts`. */
export function getBitcoinSigner(): BitcoinSigner {
  return new BitcoinSigner();
}
