'use client';

/**
 * Turn durable nonces on for a dWallet's Solana account.
 *
 * ONE ON-CHAIN TRANSACTION, ONCE
 * -----------------------------
 * A nonce account has to exist before it can be used, and creating it is itself a Solana transaction — so
 * this is the one transaction in the wallet that cannot be durable. It costs ~0.00145 SOL of rent (fully
 * recoverable via `buildWithdrawNonceTransaction`) plus a normal fee and one MPC signature.
 *
 * It runs through the ordinary signing pipeline via `prebuilt`, rather than a second bespoke path, so it
 * inherits the presignature pool, the pre-decrypted key share and the phase timings — and cannot drift away
 * from how every other signature is produced.
 *
 * Idempotent: if the account already exists and is usable, this does nothing and spends nothing.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import type { AppSuiClient } from '@/lib/sui/client';
import { SOLANA_MAINNET } from '@/lib/config/chains';
import {
  buildCreateNonceAccountTransaction,
  readDurableNonce,
  NONCE_ACCOUNT_LAMPORTS,
} from '@/lib/dwallet/chains/solanaNonce';

export interface EnableResult {
  /** 'already' when nothing needed doing. */
  status: 'created' | 'already';
  nonceAccount: string;
  /** Solana signature of the creation transaction, when one was sent. */
  txHash?: string;
}

/** Whether this account can already sign transactions that do not expire. */
export async function durableNonceReady(solanaAddress: string): Promise<boolean> {
  try {
    const connection = new Connection(SOLANA_MAINNET.rpcUrl, 'confirmed');
    return (await readDurableNonce(connection, new PublicKey(solanaAddress))) !== null;
  } catch {
    return false;
  }
}

/** The one-time rent deposit, in SOL, for UI copy. */
export const NONCE_RENT_SOL = NONCE_ACCOUNT_LAMPORTS / 1e9;

export async function enableDurableNonce(params: {
  suiClient: AppSuiClient;
  dwalletId: string;
  dwalletCapId: string;
  zkAddress: string;
  solanaAddress: string;
  signAndExecuteTransaction: (p: unknown) => Promise<unknown>;
  onProgress?: (message: string) => void;
}): Promise<EnableResult> {
  const connection = new Connection(SOLANA_MAINNET.rpcUrl, 'confirmed');
  const owner = new PublicKey(params.solanaAddress);

  const existing = await readDurableNonce(connection, owner);
  if (existing) {
    return { status: 'already', nonceAccount: existing.account.toBase58() };
  }

  /**
   * Refuse rather than half-succeed on a thin balance.
   *
   * Rent plus a fee, with headroom. Letting this through on an underfunded account would spend an MPC
   * signature to produce a transaction the network rejects.
   */
  const balance = await connection.getBalance(owner);
  const needed = NONCE_ACCOUNT_LAMPORTS + 20_000;
  if (balance < needed) {
    throw new Error(
      `Not enough SOL to set this up: need about ${(needed / 1e9).toFixed(5)} SOL, have ` +
        `${(balance / 1e9).toFixed(5)}. The rent is refundable once set up.`
    );
  }

  params.onProgress?.('Creating your nonce account…');

  const { transaction, account } = await buildCreateNonceAccountTransaction(connection, owner);

  // Signed through the normal pipeline; only the payload is ours.
  const { signWithDWallet, broadcastTransaction } = await import('@/lib/dwallet/clientSideSigning');
  const signed = await signWithDWallet({
    dwalletId: params.dwalletId,
    dwalletCapId: params.dwalletCapId,
    encryptedShareId: '',
    chain: 'Solana',
    recipient: params.solanaAddress,
    amount: '0',
    suiClient: params.suiClient,
    userAccount: { address: params.zkAddress },
    signAndExecuteTransaction: params.signAndExecuteTransaction as never,
    onProgress: params.onProgress,
    prebuilt: { messageBytes: transaction.serializeMessage(), unsignedTx: { transaction } },
  });

  if (!signed.serialized) throw new Error('Nonce setup produced no signed transaction.');
  const { txHash } = await broadcastTransaction('Solana', signed.serialized);

  /**
   * Wait for it to land before reporting success.
   *
   * The next send reads this account, and reporting "enabled" before it exists would make that read miss and
   * silently fall back to a blockhash — the feature would look broken rather than pending.
   */
  params.onProgress?.('Confirming…');
  await connection.confirmTransaction(txHash, 'confirmed').catch(() => {
    // Confirmation timeouts are not failures; the account either exists on the next read or it does not.
  });

  return { status: 'created', nonceAccount: account.toBase58(), txHash };
}
