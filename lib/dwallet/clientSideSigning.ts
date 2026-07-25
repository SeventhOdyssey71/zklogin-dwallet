/**
 * Client-Side dWallet Transaction Signing
 *
 * This module orchestrates the dWallet 2PC-MPC signing process against Ika MAINNET.
 * Chain-specific logic is delegated to modular chain signers.
 *
 * Architecture:
 * - core/: Shared utilities (encryption, client initialization, types)
 * - chains/: Chain-specific signing implementations (Ethereum, Solana, etc.)
 * - clientSideSigning.ts: MPC orchestration and coordination
 *
 * 2PC-MPC v4: presignatures come from the network's continuously-replenished pool via
 * `requestGlobalPresign` rather than being computed per-dWallet on demand. See
 * `lib/ika/globalPresign.ts` for why, and for the on-chain policy that decides it.
 */

import { Transaction } from '@mysten/sui/transactions';
import { IkaTransaction } from '@ika.xyz/sdk';
import { ethers } from 'ethers';
import { PublicKey, Transaction as SolanaTransaction, Connection } from '@solana/web3.js';

// Import refactored modules
import { SignTransactionParams, SignedTransactionResult, UnsignedTransaction } from './core/types';
import { generateDeterministicEncryptionSeed } from './core/encryption';
import { getChainSigner } from './chains';
import { getIkaClient, chainCrypto } from '@/lib/ika/ikaClient';
import { takeReady, pendingPresign, primePresignPool, refillInBackground } from '@/lib/ika/presignPool';
import { peekUserShare, prepareUserShare } from '@/lib/ika/userShare';
import { generateEncryptionKeys } from './core/encryption';
import { getDWalletMeta } from './dwalletMeta';
import { Timings } from './core/timings';
import { prepareIkaFeeCoin } from '@/lib/ika/ikaFee';
import { MAINNET_CHAINS, SOLANA_MAINNET, txExplorerUrl } from '@/lib/config/chains';

// Re-export types for backwards compatibility
export type { SignTransactionParams, SignedTransactionResult } from './core/types';
export { initializeClientSideSigning } from './core/client';

/**
 * Polling cadence for MPC session state (presign, sign).
 *
 * 2PC-MPC v4 completes a pooled presign essentially immediately and the online signing round in
 * ~400ms. The previous 2000ms interval meant a send spent seconds sitting in `setTimeout` after the
 * network had already finished — the dominant source of the old perceived slowness. 250ms tracks the
 * protocol closely while staying polite to the RPC; the timeout stays generous for a congested epoch.
 */
const MPC_POLL = { timeout: 60_000, interval: 250 } as const;

/**
 * Verbose signing logs, off by default.
 *
 * This flow logged ~200 lines per send, including full JSON dumps of transaction effects, the entire
 * events array and the whole dWallet object. That made the console unusable and hid real failures.
 * The numbered step markers below stay as ordinary logs so progress is still visible; everything else
 * is gated. Set NEXT_PUBLIC_DEBUG_SIGNING=1 for the full trace.
 */
const SIGN_VERBOSE = process.env.NEXT_PUBLIC_DEBUG_SIGNING === '1';
const debug = (...args: unknown[]) => {
  if (SIGN_VERBOSE) console.log(...args);
};


/**
 * Step 2: Build unsigned transaction for the target blockchain
 *
 * Delegates to chain-specific signers for transaction building
 */
export async function buildUnsignedTransaction(
  chain: string,
  recipient: string,
  amount: string,
  fromAddress: string,
  publicKey?: string
): Promise<UnsignedTransaction> {
  debug(`📝 Building unsigned ${chain} transaction...`);

  // Get chain-specific signer
  const signer = getChainSigner(chain);

  // Delegate to chain signer (pass public key for chains that need it)
  return await signer.buildUnsignedTransaction(recipient, amount, fromAddress, publicKey);
}

/**
 * Step 3: Sign transaction using dWallet 2PC-MPC protocol
 *
 * This is the core signing function that:
 * 1. Creates a presign capability
 * 2. Approves the message
 * 3. Requests signature from dWallet network
 * 4. Polls for completion
 * 5. Returns the signature
 */
export async function signWithDWallet(
  params: SignTransactionParams
): Promise<SignedTransactionResult> {
  const T = new Timings(`Send ${params.amount} on ${params.chain}`);

  // Curve / algorithm / hash come from one shared resolver so the presignature pool and this path
  // cannot disagree — a presignature bought for the wrong algorithm is unusable, and the mismatch
  // would only surface at signing time.
  const { curve, signatureAlgorithm, hashScheme } = chainCrypto(params.chain);

  const suiAddress = params.userAccount?.address;
  if (!suiAddress) {
    throw new Error('User account address is required for deterministic seed generation');
  }

  const encryptionSeed = generateDeterministicEncryptionSeed(suiAddress, curve);

  /**
   * === Prologue: everything the sign transaction needs, resolved concurrently ===
   *
   * These were previously seven strictly sequential awaits, each waiting on the one before for no
   * reason — measured at ~3.5s of round-trips before the signing round could even begin. Only the
   * genuine dependencies are kept: the dWallet needs the client, its metadata needs the dWallet, and
   * the unsigned transaction needs the derived address. Everything else overlaps, so the prologue now
   * costs roughly its slowest single member instead of their sum.
   */
  // Each member is timed individually: a single "prologue" row would hide which of them dominates,
  // which is the only thing that makes the next latency regression diagnosable.
  const timed = <V,>(name: string, p: Promise<V>): Promise<V> => {
    const t0 = performance.now();
    return p.finally(() => T.note(name, performance.now() - t0));
  };

  const ikaClientP = timed('· ika client', getIkaClient(params.suiClient));
  const keysP = timed('· share keys', generateEncryptionKeys(encryptionSeed, curve, suiAddress));
  const gasP = timed('· sui balance', params.suiClient.getBalance({ owner: suiAddress }));
  const dWalletP = timed(
    '· dwallet fetch',
    ikaClientP.then((c) => c.getDWallet(params.dwalletId))
  );
  const metaP = timed('· dwallet meta', dWalletP.then((dw) =>
    getDWalletMeta({
      suiClient: params.suiClient,
      dwalletId: params.dwalletId,
      chain: params.chain,
      curve,
      dWallet: dw,
    })
  ));
  const unsignedP = timed(
    '· build chain tx',
    metaP.then((m) =>
      buildUnsignedTransaction(params.chain, params.recipient, params.amount, m.address, m.publicKeyHex)
    )
  );
  const shareP = timed(
    '· user share',
    Promise.all([ikaClientP, metaP]).then(([c, m]) =>
      params.encryptedShareId
        ? c.getEncryptedUserSecretKeyShare(params.encryptedShareId)
        : m.encryptedShareId
          ? c.getEncryptedUserSecretKeyShare(m.encryptedShareId)
          : undefined
    )
  );

  const [ikaClient, userShareEncryptionKeys, gasBalance, dWallet, meta, built, encShare] =
    await T.step('prologue (all of the above, concurrent)', () =>
      Promise.all([ikaClientP, keysP, gasP, dWalletP, metaP, unsignedP, shareP])
    );

  /**
   * Fail on an empty gas tank — but only after the (cheap, parallel) prologue, and always before a
   * presignature is consumed.
   *
   * Without this, running out of SUI surfaced as an opaque 502 from /api/zklogin/execute carrying a raw
   * Sui error ("Balance of gas object … is lower than the needed amount"). A signing round is ~0.02 SUI;
   * the floor leaves room for the sign transaction and a retry.
   */
  const SUI_FLOOR_MIST = 30_000_000n;
  if (BigInt(gasBalance.totalBalance) < SUI_FLOOR_MIST) {
    throw new Error(
      `Not enough SUI for gas: ${(Number(gasBalance.totalBalance) / 1e9).toFixed(4)} SUI. ` +
        `Signing needs roughly 0.02 SUI per transaction — top up this address and try again.`
    );
  }

  const fromAddress = meta.address;
  const publicKeyHex = meta.publicKeyHex;
  const isImportedKey = meta.isImportedKey;
  let { messageBytes, unsignedTx } = built;

  if (encShare) {
    // A share that never reached KeyHolderSigned cannot authorise a signature; catching it here gives a
    // clear message instead of an opaque MPC failure minutes later.
    const state = encShare.state as { KeyHolderSigned?: { user_output_signature?: unknown } };
    if (!state.KeyHolderSigned) {
      throw new Error(
        `Encrypted user share is not in KeyHolderSigned state (got ${Object.keys(encShare.state)[0]}). ` +
          `Please recreate your dWallet.`
      );
    }
    if (!state.KeyHolderSigned.user_output_signature) {
      throw new Error('User output signature is missing from the encrypted share. Please recreate your dWallet.');
    }
  } else if (!meta.isShared && !meta.isImportedKey) {
    console.warn('⚠️ No encrypted user share found — signing may fail.');
  }
  const encryptedUserSecretKeyShare = encShare;

  /**
   * === 2PC-MPC v4: take a presignature from the standing pool ===
   *
   * `takeReady` is synchronous and returns only *settled* presignatures, so the common path costs
   * nothing at all. The previous code awaited a warm-up that was usually still in flight, which meant
   * paying the full ~15s presign leg while logging "using pre-warmed presignature" — the bulk of the
   * near-minute sends. See lib/ika/presignPool.ts.
   */
  const poolParams = {
    suiClient: params.suiClient,
    owner: suiAddress,
    curve,
    signatureAlgorithm,
    dwalletNetworkEncryptionKeyId: meta.networkEncryptionKeyId,
    dWallet,
    signAndExecuteAsync: (input: { transaction: Transaction }) =>
      params.signAndExecuteTransaction({
        transaction: input.transaction,
        options: { showEffects: true, showEvents: true, showObjectChanges: true },
      }),
  };

  let completedPresign: Awaited<ReturnType<typeof ikaClient.getPresignInParticularState>>;
  const presignWait = performance.now();
  const banked = takeReady(suiAddress, curve, signatureAlgorithm);

  if (banked) {
    console.log('1️⃣ Presignature ready from the pool (v4, zero wait)');
    completedPresign = banked.presign as typeof completedPresign;
    T.note('presign (from pool)', performance.now() - presignWait);
  } else {
    // Nothing banked. Joining a purchase already in flight beats starting another — same cost, head
    // start — and otherwise we buy one now.
    const inflight = pendingPresign(suiAddress, curve, signatureAlgorithm);
    console.log(
      inflight
        ? '1️⃣ Joining a presignature purchase already in flight…'
        : '1️⃣ No banked presignature — buying one now (this is the slow path)…'
    );
    const acquired = await T.step('presign (bought inline)', async () => {
      if (inflight) return inflight;
      await primePresignPool(poolParams);
      const now = takeReady(suiAddress, curve, signatureAlgorithm);
      if (!now) throw new Error('Presignature purchase reported success but nothing was banked.');
      return now;
    });
    completedPresign = acquired.presign as typeof completedPresign;
  }

  /**
   * Rebuild the transaction if acquiring the presignature took long enough to age the blockhash.
   *
   * Solana blockhashes expire after ~150s and EVM nonces can be taken by another transaction, so a
   * payload built before a slow presignature purchase may be stale by the time it is signed. In the
   * pooled path this never fires; in the slow path it costs one extra build rather than a failed send.
   */
  const STALE_BUILD_MS = 5_000;
  const presignElapsed = performance.now() - presignWait;
  if (presignElapsed > STALE_BUILD_MS) {
    const rebuilt = await T.step('rebuild tx (stale blockhash)', () =>
      buildUnsignedTransaction(params.chain, params.recipient, params.amount, fromAddress, publicKeyHex)
    );
    messageBytes = rebuilt.messageBytes;
    unsignedTx = rebuilt.unsignedTx;
  }

  const blockhashFetchTime = Date.now();

  console.log('2️⃣ Requesting signature…');

  const signTx = new Transaction();
  const signIkaTx = new IkaTransaction({
    ikaClient,
    transaction: signTx,
    userShareEncryptionKeys,
  });

  // Fresh fee coin for the sign transaction (same address-balance-safe path as the presign).
  signTx.setSender(params.userAccount.address);
  const signFee = await T.step('IKA fee coin', () =>
    prepareIkaFeeCoin({
      tx: signTx,
      suiClient: params.suiClient,
      owner: params.userAccount.address,
    })
  );
  const ikaCoin2 = signFee.coin;

  /**
   * Everything below until the submit is client-side wasm, and it was completely untimed.
   *
   * A real send reported 33.6s wall clock against 14.6s of measured phases — a 19s hole, all of it here.
   * `requestSign` decrypts the user's key share with class-groups crypto and computes the client's share
   * of the signature, and the decryption half of that is by far the more expensive.
   */
  const wasmStart = performance.now();

  // Verify presign capability
  const verifiedPresignCap = signIkaTx.verifyPresignCap({
    presign: completedPresign,
  });

  // Use different approve/sign methods based on dWallet type
  if (isImportedKey) {
    // For imported-key dWallets
    const importedKeyMessageApproval = signIkaTx.approveImportedKeyMessage({
      dWalletCap: params.dwalletCapId,
      curve,
      signatureAlgorithm,
      hashScheme,
      message: messageBytes,
    });

    await signIkaTx.requestSignWithImportedKey({
      dWallet: dWallet as any, // Cast to ImportedKeyDWallet
      importedKeyMessageApproval,
      verifiedPresignCap,
      hashScheme,
      presign: completedPresign,
      message: messageBytes,
      signatureScheme: signatureAlgorithm,
      ikaCoin: ikaCoin2,
      suiCoin: signTx.gas,
    });
  } else {
    // For regular (ZeroTrust/Shared) dWallets
    const messageApproval = signIkaTx.approveMessage({
      dWalletCap: params.dwalletCapId,
      curve,
      signatureAlgorithm,
      hashScheme,
      message: messageBytes,
    });

    const requestSignParams: any = {
      dWallet: dWallet as any, // Cast to ZeroTrustDWallet | SharedDWallet
      messageApproval,
      verifiedPresignCap,
      hashScheme,
      presign: completedPresign,
      message: messageBytes,
      signatureScheme: signatureAlgorithm,
      ikaCoin: ikaCoin2,
      suiCoin: signTx.gas,
    };

    /**
     * Prefer an already-decrypted share.
     *
     * Decrypting the user's key share is the single most expensive step in a send (~19s measured, and it
     * was invisible until the phase table exposed the gap). It depends only on the dWallet and the
     * encrypted share, never on the message, so the send dialog decrypts it while the user types. See
     * lib/ika/userShare.ts, including why passing `secretShare` here loses none of the SDK's verification.
     *
     * If it isn't ready, fall back to handing over the encrypted share and letting `requestSign` decrypt
     * internally — the previous behaviour, just slower.
     */
    const predecrypted = params.encryptedShareId
      ? peekUserShare(params.dwalletId, params.encryptedShareId)
      : meta.encryptedShareId
        ? peekUserShare(params.dwalletId, meta.encryptedShareId)
        : undefined;

    if (predecrypted) {
      requestSignParams.secretShare = predecrypted.secretShare;
      requestSignParams.publicOutput = predecrypted.publicOutput;
      console.log('🔓 Using pre-decrypted key share (off the critical path)');
    } else if (encryptedUserSecretKeyShare) {
      requestSignParams.encryptedUserSecretKeyShare = encryptedUserSecretKeyShare;
      debug('📝 Decrypting the user share inline (not pre-decrypted)');
    }

    await signIkaTx.requestSign(requestSignParams);
  }

  T.note('sign request (client wasm)', performance.now() - wasmStart);

  // Set higher gas budget for sign transaction (MPC computation is expensive)
  signFee.settle();
  /**
   * No explicit gas budget.
   *
   * This used to hardcode 0.5 SUI. A gas budget is *reserved*, not just spent, so Sui rejects the
   * transaction outright when the budget exceeds the balance — "Balance of gas object … is lower than
   * the needed amount: 500000000" — even though the transaction actually costs ~0.02 SUI. Any fixed
   * number is wrong in both directions: too high and it fails on a modest balance, too low and it
   * fails on a busy epoch. Omitting it makes the SDK dry-run and use the real estimate.
   */

  // Execute sign transaction
  debug('⏳ Executing sign transaction with Sui wallet...');
  const signTxResult = await T.step('sign tx (zkLogin submit)', () =>
    params.signAndExecuteTransaction({
      transaction: signTx,
      options: { showEffects: true, showEvents: true, showObjectChanges: true },
    })
  );

  debug('✅ Sign transaction executed');
  debug('📝 Transaction digest:', signTxResult.digest);

  /**
   * Read the outcome from execution itself rather than fetching it again.
   *
   * This used to call `waitForTransaction`, which not only costs a round-trip but has to wait for the
   * fullnode to *index* the transaction — around a second of dead time, paid on every send, for data
   * execution had already computed. The executing endpoint now returns effects, events and object
   * changes directly; the fetch remains only as a fallback for a signer that doesn't supply them.
   */
  const signTxDetails = signTxResult.effects
    ? signTxResult
    : await T.step('fetch sign effects (fallback)', () =>
        params.suiClient.waitForTransaction({
          digest: signTxResult.digest,
          options: { showEffects: true, showEvents: true, showObjectChanges: true },
        })
      );

  // Check if transaction succeeded
  if (signTxDetails.effects?.status?.status !== 'success') {
    const error = signTxDetails.effects?.status?.error || 'Unknown error';
    console.error('❌ Sign transaction failed with status:', signTxDetails.effects?.status);

    if (error === 'InsufficientGas') {
      throw new Error(
        'Sign transaction failed due to insufficient gas. ' +
        'Please ensure your wallet has enough SUI tokens. ' +
        'MPC signing operations require significant gas (0.5 SUI recommended).'
      );
    }

    throw new Error(`Sign transaction failed: ${error}`);
  }

  debug('✅ Sign transaction succeeded');

  // Extract sign session ID from events or object changes
  debug('🔍 Extracting sign session ID...');
  debug('Events:', signTxDetails.events);
  debug('Object changes:', signTxDetails.objectChanges);

  let signId: string | undefined;

  // Try to find sign ID in events
  const signEvent = signTxDetails.events?.find((e: any) =>
    e.type && (e.type.includes('SignRequestEvent') || e.type.includes('Sign'))
  );

  if (signEvent) {
    debug('📋 Found sign event:', signEvent);
    const parsedJson = signEvent.parsedJson as any;
    signId = parsedJson?.sign_id ||
             parsedJson?.event_data?.sign_id ||
             parsedJson?.id;
  }

  // If not found in events, try object changes (similar to presign)
  if (!signId) {
    debug('⚠️ Sign event not found, checking object changes...');
    const signSessionObject = signTxDetails.objectChanges?.find((change: any) => {
      if (change.type === 'created') {
        const objType = change.objectType || '';
        return objType.includes('SignSession') || objType.includes('Sign');
      }
      return false;
    });

    if (signSessionObject) {
      debug('📋 Found sign session object:', signSessionObject);
      signId = (signSessionObject as any).objectId;
    }
  }

  if (!signId) {
    console.error('❌ Could not find sign session ID');
    console.error('Full transaction details:', JSON.stringify(signTxDetails, null, 2));
    throw new Error('Sign session ID not found in transaction result');
  }

  debug('✅ Sign request submitted:', signId);

  // === STEP 4: Poll for Signature Completion ===
  // With a pooled presign this is the single online round the v4 upgrade reduced to ~400ms, so a
  // 2s poll interval could more than triple the observed signing latency on its own.
  console.log('3️⃣ Waiting for the MPC signature…');

  const completedSign = await T.step('MPC sign round', () =>
    ikaClient.getSignInParticularState(signId, curve, signatureAlgorithm, 'Completed', MPC_POLL)
  );

  /**
   * Bank the next presignature now, in the background.
   *
   * The one we just consumed is gone, so without this the *next* send would fall back to the slow path.
   * Refilling immediately after use — rather than when the next send starts — is what makes the pooled
   * path the steady state rather than a one-off.
   */
  refillInBackground(poolParams);

  // Extract signature
  const signature = Uint8Array.from(completedSign.state.Completed?.signature ?? []);
  const signatureHex = '0x' + Buffer.from(signature).toString('hex');

  // Calculate time elapsed for Solana
  const signingTimeElapsed = Date.now() - blockhashFetchTime;
  console.log('✅ Signature received:', signatureHex.substring(0, 20) + '...');
  debug(`⏱️  Signing took ${(signingTimeElapsed / 1000).toFixed(1)} seconds`);
  debug(`⏰ Time remaining until blockhash expiration: ~${Math.max(0, 150 - signingTimeElapsed / 1000).toFixed(0)} seconds`);

  // === STEP 5: Construct Signed Transaction ===
  console.log('4️⃣ Constructing signed transaction…');

  let serialized: string;
  let hash: string;

  if (params.chain === 'Bitcoin') {
    // Taproot: the witness is the bare 64-byte Schnorr signature. No recovery id (that's an ECDSA
    // concept), no public key in the witness (it IS the output key), no scriptSig. The signer
    // already carries everything else it needs in `unsignedTx`.
    const signer = getChainSigner(params.chain);
    const result = await T.step('broadcast', () => signer.broadcastTransaction(unsignedTx, signature));
    T.report();
    return result;
  } else if (params.chain === 'Solana') {
    // For Solana, attach EdDSA signature to transaction
    const transaction = unsignedTx.transaction as SolanaTransaction;

    // EdDSA signature is 64 bytes, no recovery ID needed
    const signatureBytes = signature.slice(0, 64);

    // Add signature to transaction
    transaction.addSignature(
      new PublicKey(fromAddress),
      Buffer.from(signatureBytes)
    );

    // Serialize the signed transaction
    const serializedBuffer = transaction.serialize();
    serialized = Buffer.from(serializedBuffer).toString('base64');
    hash = 'Solana-' + Buffer.from(signatureBytes).toString('hex').substring(0, 16);

    // Store the original blockhash and lastValidBlockHeight for confirmation
    (params as any).originalBlockhash = unsignedTx.blockhash;
    (params as any).originalLastValidBlockHeight = unsignedTx.lastValidBlockHeight;

    debug('');
    debug('═══════════════════════════════════════════════════════');
    debug('🎉 SOLANA TRANSACTION SIGNED SUCCESSFULLY!');
    debug('═══════════════════════════════════════════════════════');
    debug('Transaction ID:', hash);
    debug('');
    debug('📝 SIGNED TRANSACTION (base64, ready to broadcast):');
    debug(serialized);
    debug('');
    debug('You can broadcast this via Solana RPC sendTransaction');
    debug('═══════════════════════════════════════════════════════');
    debug('');
  } else if (params.chain === 'Polkadot') {
    // For Polkadot, use the chain signer's broadcast method
    debug('🔐 Processing ED25519 signature for Polkadot transaction...');

    const signer = getChainSigner(params.chain);
    const result = await T.step('broadcast', () => signer.broadcastTransaction(unsignedTx, signature));
    T.report();
    return result;
  } else if (params.chain === 'Cardano') {
    // For Cardano, use the chain signer's broadcast method
    debug('🔐 Processing ED25519 signature for Cardano transaction...');

    const signer = getChainSigner(params.chain);
    const result = await T.step('broadcast', () => signer.broadcastTransaction(unsignedTx, signature));
    T.report();
    return result;
  } else if (params.chain === 'NEAR') {
    // For NEAR, use the chain signer's broadcast method
    debug('🔐 Processing ED25519 signature for NEAR transaction...');

    const signer = getChainSigner(params.chain);
    const result = await T.step('broadcast', () => signer.broadcastTransaction(unsignedTx, signature));
    T.report();
    return result;
  } else {
    // For EVM chains, attach ECDSA signature to transaction
    // ECDSA signatures need the correct recovery value (yParity) to derive the correct address

    debug('🔐 Processing ECDSA signature for EVM transaction...');
    debug('📋 Expected sender address:', fromAddress);
    debug('📋 Signature hex:', signatureHex);
    debug('📋 Signature length:', signatureHex.length - 2, 'bytes');

    // Extract r and s from signature (64 bytes total: 32 for r, 32 for s)
    let r = '0x' + signatureHex.slice(2, 66);
    let s = '0x' + signatureHex.slice(66, 130);
    debug('📋 Raw r:', r);
    debug('📋 Raw s:', s);

    // CRITICAL: Normalize s to lower half (EIP-2: s must be in lower half of curve order)
    // This is required for signature malleability protection
    const secp256k1N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    const secp256k1HalfN = secp256k1N / BigInt(2);

    let sBigInt = BigInt(s);
    let recoveryOffset = 0;

    if (sBigInt > secp256k1HalfN) {
      debug('⚠️  s value is in upper half, normalizing...');
      sBigInt = secp256k1N - sBigInt;
      s = '0x' + sBigInt.toString(16).padStart(64, '0');
      recoveryOffset = 1; // If we flipped s, we also need to flip v
      debug('✅ Normalized s:', s);
    } else {
      debug('✅ s value is already in lower half (normalized)');
    }

    debug('');
    debug('🔍 Testing recovery values to find correct signature...');
    debug('📋 Expected address from public_output:', fromAddress);
    debug('📋 Recovery offset:', recoveryOffset);
    debug('');

    // Try both v values with proper recovery offset handling
    let signedTx: any = null;
    let actualSenderAddress: string | null = null;
    let matchedV: number | null = null;

    // For EIP-1559 (type 2) transactions, v should be 0 or 1 (not 27/28)
    // We'll use the recovery offset from s-value normalization
    for (let baseV = 0; baseV <= 1; baseV++) {
      const v = (baseV + recoveryOffset) % 2;
      const eip155V = v + 27; // Convert to legacy format for ethers.js

      const testTx = ethers.Transaction.from(unsignedTx);
      testTx.signature = ethers.Signature.from({ r, s, v: eip155V });

      const recoveredFrom = testTx.from;
      debug(`🔍 Testing baseV=${baseV}, v=${v}, eip155V=${eip155V}, recovered: ${recoveredFrom}`);

      // Check if this v value recovers to the expected address
      if (recoveredFrom?.toLowerCase() === fromAddress.toLowerCase()) {
        debug(`✅ Found correct recovery id (v): ${v} (EIP-155 v: ${eip155V})`);
        signedTx = testTx;
        actualSenderAddress = recoveredFrom;
        matchedV = eip155V;
        break;
      }
    }

    // If no match found, try all 4 combinations as last resort
    if (!signedTx) {
      debug('⚠️  Standard recovery failed, trying all v combinations...');
      let foundV: number | null = null;
      let foundAddress: string | null = null;

      for (let v = 0; v <= 3; v++) {
        try {
          // For EIP-1559 transactions, use v directly (0-3)
          // ethers.js will handle the conversion internally
          const testTx = ethers.Transaction.from(unsignedTx);
          testTx.signature = ethers.Signature.from({ r, s, v });

          const recoveredFrom = testTx.from;
          debug(`🔍 Trying v=${v}, recovered: ${recoveredFrom}`);

          if (recoveredFrom?.toLowerCase() === fromAddress.toLowerCase()) {
            signedTx = testTx;
            foundV = v;
            foundAddress = recoveredFrom;
            actualSenderAddress = recoveredFrom;
            matchedV = v;
            debug(`✅ Found working v: ${v}`);
            break;
          } else if (foundV === null) {
            // Keep track of the first valid signature for fallback
            foundV = v;
            foundAddress = recoveredFrom;
          }
        } catch (e) {
          // Invalid signature, continue
          continue;
        }
      }

      // If still no match, use the first valid signature we found
      if (!signedTx && foundV !== null && foundAddress) {
        console.warn('⚠️  Stored address does not match ANY signature recovery.');
        console.warn('⚠️  Using recovered address from v=' + foundV + ':', foundAddress);

        const fallbackTx = ethers.Transaction.from(unsignedTx);
        fallbackTx.signature = ethers.Signature.from({ r, s, v: foundV });
        signedTx = fallbackTx;
        actualSenderAddress = foundAddress;
        matchedV = foundV;

        debug('');
        debug('❌ CRITICAL: Address mismatch detected!');
        debug(`   Transaction built for: ${fromAddress}`);
        debug(`   Signature recovers to: ${foundAddress}`);
        debug('');
        debug('⚠️  The transaction nonce may be incorrect for this address!');
        debug('💡 You should fund the recovered address and use it instead.');
      }
    }

    debug('');
    debug('═══════════════════════════════════════════════════════');
    debug('✅ SIGNATURE VERIFICATION');
    debug('═══════════════════════════════════════════════════════');
    debug('📋 Transaction will be sent from:', actualSenderAddress);
    debug('📋 Expected address from public_output:', fromAddress);
    debug('📋 Used recovery value (v):', matchedV);
    if (actualSenderAddress?.toLowerCase() === fromAddress.toLowerCase()) {
      debug('');
      debug('✅ SUCCESS: Signature recovers to expected address!');
      debug('💚 The transaction will be sent from the correct dWallet address.');
    } else {
      debug('');
      debug('⚠️  WARNING: These addresses DO NOT MATCH!');
      debug('❌ Signature recovery failed - transaction may be rejected.');
      debug('💰 Make sure to fund the ACTUAL sender address above!');
    }
    debug('═══════════════════════════════════════════════════════');
    debug('');

    const finalTx = signedTx;

    serialized = finalTx.serialized;
    hash = finalTx.hash || '0x';

    debug('');
    debug('═══════════════════════════════════════════════════════');
    debug('🎉 TRANSACTION SIGNED SUCCESSFULLY!');
    debug('═══════════════════════════════════════════════════════');
    debug('Transaction Hash:', hash);
    debug('Sender Address:', finalTx.from);
    debug('');
    debug('📝 FULL SIGNED TRANSACTION (ready to broadcast):');
    debug(serialized);
    debug('');
    debug('You can broadcast this manually at:');
    debug('https://etherscan.io/pushTx');
    debug('═══════════════════════════════════════════════════════');
    debug('');
  }

  T.report();
  return {
    signature: signatureHex,
    hash,
    txHash: hash,
    serialized,
  };
}

/**
 * Step 4: Broadcast signed transaction to blockchain
 */
export async function broadcastTransaction(
  chain: string,
  serialized: string
): Promise<{ txHash: string }> {
  console.log(`📡 Broadcasting ${chain} transaction...`);

  if (chain === 'Bitcoin') {
    // Broadcast Bitcoin transaction
    console.log('📡 Broadcasting Bitcoin transaction to Blockstream API...');

    // The serialized transaction should be hex-encoded
    const txHex = serialized;

    try {
      const response = await fetch(`${MAINNET_CHAINS.Bitcoin.rpcUrl}/tx`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: txHex,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Bitcoin broadcast failed: ${response.status} - ${errorText}`);
      }

      const txHash = await response.text(); // Blockstream returns just the txid

      debug('✅ Bitcoin transaction broadcasted!');
      debug('🔗 TX Hash:', txHash);
      debug('📋 Explorer:', txExplorerUrl('Bitcoin', txHash));

      return { txHash };
    } catch (error) {
      console.error('❌ Bitcoin broadcast failed:', error);
      throw error;
    }
  } else if (chain === 'Solana') {
    // Broadcast Solana transaction (mainnet-beta)
    const connection = new Connection(SOLANA_MAINNET.rpcUrl, 'confirmed');

    console.log('📡 Broadcasting Solana transaction...');

    // Deserialize the transaction
    let txBuffer = Buffer.from(serialized, 'base64');
    let txSignature: string;

    try {
      // Try to send with the original blockhash first
      debug('📤 Attempting to send with original blockhash...');
      txSignature = await connection.sendRawTransaction(txBuffer, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    } catch (error: any) {
      // If blockhash is not found, skip preflight and send anyway
      // The signature is still valid, but preflight simulation fails due to expired blockhash
      if (error.message && error.message.includes('Blockhash not found')) {
        debug('⚠️ Blockhash expired during signing process');
        debug('📤 Retrying with skipPreflight=true (signature is still valid)...');

        // Retry sending but skip the preflight check
        // The transaction is still valid, just the blockhash expired during the signing delay
        txSignature = await connection.sendRawTransaction(txBuffer, {
          skipPreflight: true, // Skip simulation since blockhash expired
          preflightCommitment: 'confirmed',
        });

        debug('✅ Transaction submitted successfully (preflight skipped)');
      } else {
        // Re-throw if it's a different error
        throw error;
      }
    }

    const signature = txSignature;

    console.log('✅ Transaction submitted:', signature);
    debug('📋 Solana Explorer:', txExplorerUrl('Solana', signature));

    /**
     * Don't block the send on confirmation.
     *
     * The transaction is irrevocably submitted the moment the cluster accepts it, and the signature is
     * final — waiting for `confirmTransaction` adds seconds (occasionally a 30s+ timeout) during which
     * the user is shown a spinner for work that is already done and cannot be undone. Confirmation is
     * still tracked, just in the background, so a genuine on-chain failure is reported rather than lost.
     */
    void connection
      .confirmTransaction(signature, 'confirmed')
      .then((c) =>
        c.value.err
          ? console.error('❌ Solana transaction failed on chain:', c.value.err)
          : console.log('✅ Solana transaction confirmed:', signature)
      )
      .catch((e) =>
        console.warn(
          `⚠️ Could not confirm ${signature} (it may still succeed): ${(e as Error).message}`
        )
      );

    return { txHash: signature };
  } else {
    // Broadcast EVM transaction. Read the RPC from the shared mainnet config rather than a second
    // hardcoded list — the two drifting apart is how you sign for one network and broadcast to
    // another.
    const rpcUrl = MAINNET_CHAINS[chain]?.rpcUrl;
    if (!rpcUrl) {
      throw new Error(`RPC URL not found for ${chain}`);
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const txResponse = await provider.broadcastTransaction(serialized);

    console.log('✅ Transaction submitted:', txResponse.hash);

    /**
     * Don't block the send on inclusion.
     *
     * `wait()` sits until the transaction is mined — ~12s on Ethereum mainnet — even though the hash is
     * already final and the user can follow it on an explorer. Since a mined receipt can also report a
     * reverted transaction, the wait still happens, just off the critical path.
     */
    void txResponse
      .wait()
      .then((receipt) =>
        receipt?.status === 1
          ? console.log(`✅ ${chain} transaction confirmed in block ${receipt.blockNumber}`)
          : console.error(`❌ ${chain} transaction reverted:`, txResponse.hash)
      )
      .catch((e) =>
        console.warn(
          `⚠️ Could not confirm ${txResponse.hash} (it may still be mined): ${(e as Error).message}`
        )
      );

    return { txHash: txResponse.hash };
  }
}
