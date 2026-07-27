/**
 * Withdrawals from the zkLogin Sui wallet.
 *
 * This is the one wallet in the app that is **not** a dWallet. It is a plain Sui account whose key
 * is the zkLogin identity itself, so a transfer needs no MPC, no presignature and no IKA — just an
 * ordinary Sui transaction signed with the ephemeral key. That makes it by far the cheapest and
 * fastest path in the app, and it is what holds the SUI (gas) and IKA (2PC-MPC session fees) that
 * every dWallet operation spends.
 *
 * Coin selection is delegated to the SDK's `coinWithBalance` intent, which resolves the owner's
 * coins, merges as many as needed and splits off the exact amount at build time. Hand-rolling that
 * is where naive implementations break: an account whose balance is spread across many small coin
 * objects fails a single-coin `splitCoins`, and SUI additionally has to come out of the gas coin
 * rather than a separately-owned object.
 */

import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { isValidSuiAddress } from '@mysten/sui/utils';
import type { AppSuiClient } from '@/lib/sui/client';
import { IKA_COIN_TYPE, SUI_COIN_TYPE } from '@/lib/config/network';
import { FEE_MIST, FEE_SUI, attachProtocolFee } from '@/lib/fees/protocolFee';

export { SUI_COIN_TYPE };

export interface SuiAsset {
  /** Fully-qualified coin type. */
  type: string;
  symbol: string;
  decimals: number;
  /** Raw base-unit balance. */
  raw: string;
  /** Display-unit balance. */
  formatted: string;
}

/**
 * Gas headroom held back when sending SUI.
 *
 * SUI is spent from the gas coin, so transferring the entire balance leaves nothing to pay for the
 * transfer itself and the transaction fails at execution. A "max" send therefore reserves this much.
 * 0.05 SUI comfortably covers a simple transfer (which costs well under 0.01) without stranding a
 * meaningful amount.
 */
export const SUI_GAS_RESERVE_MIST = 50_000_000n; // 0.05 SUI

const fmt = (raw: bigint, decimals: number): string => {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
};

/** Read the SUI + IKA balances of the zkLogin address. */
export async function fetchSuiWalletAssets(
  suiClient: AppSuiClient,
  owner: string
): Promise<SuiAsset[]> {
  const [sui, ika, ikaMeta] = await Promise.all([
    suiClient.getBalance({ owner }),
    suiClient.getBalance({ owner, coinType: IKA_COIN_TYPE }).catch(() => ({ totalBalance: '0' })),
    suiClient.getCoinMetadata({ coinType: IKA_COIN_TYPE }).catch(() => null),
  ]);

  const ikaDecimals = ikaMeta?.decimals ?? 9;

  return [
    {
      type: SUI_COIN_TYPE,
      symbol: 'SUI',
      decimals: 9,
      raw: sui.totalBalance,
      formatted: fmt(BigInt(sui.totalBalance), 9),
    },
    {
      type: IKA_COIN_TYPE,
      symbol: ikaMeta?.symbol ?? 'IKA',
      decimals: ikaDecimals,
      raw: ika.totalBalance,
      formatted: fmt(BigInt(ika.totalBalance), ikaDecimals),
    },
  ];
}

/** Convert a display amount to base units without floating-point drift. */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    throw new Error(`Invalid amount: ${amount}`);
  }
  const [whole = '0', frac = ''] = trimmed.split('.');
  if (frac.length > decimals) {
    throw new Error(`Too many decimal places — ${decimals} maximum`);
  }
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((frac || '0').padEnd(decimals, '0'));
}

/** The most that can be sent, leaving gas headroom for SUI. */
export function maxSendable(asset: SuiAsset): bigint {
  const raw = BigInt(asset.raw);
  /**
   * The service fee is deducted for every asset, not only SUI.
   *
   * It is paid in SUI whatever is being sent, so sending the whole of some other coin would still leave
   * the transaction unable to cover it. Holding it back here means "Max" always produces an amount that
   * actually goes through — discovering the fee exists because a transfer aborted is the worst possible
   * introduction to it.
   */
  const reserve = asset.type === SUI_COIN_TYPE ? SUI_GAS_RESERVE_MIST + FEE_MIST : 0n;
  const spendable = raw > reserve ? raw - reserve : 0n;
  return asset.type === SUI_COIN_TYPE ? spendable : raw;
}

export interface SuiSendCheck {
  ok: boolean
  blockers: string[];
}

/** Validate a withdrawal before anything is signed. */
export function checkSuiSend(params: {
  asset: SuiAsset;
  amount: string;
  recipient: string;
  suiBalanceRaw: string;
}): SuiSendCheck {
  const blockers: string[] = [];

  if (!isValidSuiAddress(params.recipient)) {
    blockers.push('Recipient is not a valid Sui address (expects 0x + 64 hex characters).');
  }

  let requested: bigint | null = null;
  try {
    requested = toBaseUnits(params.amount, params.asset.decimals);
    if (requested <= 0n) blockers.push('Amount must be greater than zero.');
  } catch (e) {
    blockers.push((e as Error).message);
  }

  if (requested !== null && requested > 0n) {
    const max = maxSendable(params.asset);
    if (requested > max) {
      if (params.asset.type === SUI_COIN_TYPE) {
        blockers.push(
          `Amount exceeds the spendable balance. SUI pays its own gas and the ${FEE_SUI} SUI ` +
            `service fee, so ${fmt(SUI_GAS_RESERVE_MIST + FEE_MIST, 9)} SUI is held back — the most ` +
            `you can send is ${fmt(max, 9)} SUI.`
        );
      } else {
        blockers.push(
          `Insufficient ${params.asset.symbol}: have ${params.asset.formatted}, tried to send ${params.amount}.`
        );
      }
    }
  }

  // Even a non-SUI transfer needs SUI for gas.
  if (params.asset.type !== SUI_COIN_TYPE && BigInt(params.suiBalanceRaw) === 0n) {
    blockers.push(
      `No SUI for gas. Sending ${params.asset.symbol} is still a Sui transaction, so this address ` +
        `needs a little SUI to pay for it.`
    );
  }

  return { ok: blockers.length === 0, blockers };
}

/**
 * Build the withdrawal transaction.
 *
 * `useGasCoin` is the important flag: SUI must be taken from the gas coin, whereas IKA (or any other
 * coin type) comes from separately-owned coin objects. Passing the wrong one either fails to find a
 * coin or tries to split the object paying for the transaction.
 */
export function buildSuiSendTransaction(params: {
  asset: SuiAsset;
  amountBaseUnits: bigint;
  recipient: string;
  sender: string;
}): Transaction {
  const tx = new Transaction();
  tx.setSender(params.sender);

  // The service fee rides in the same transaction, so it cannot succeed while the transfer fails.
  attachProtocolFee(tx);

  const isSui = params.asset.type === SUI_COIN_TYPE;
  const coin = coinWithBalance({
    balance: params.amountBaseUnits,
    ...(isSui ? { useGasCoin: true } : { type: params.asset.type, useGasCoin: false }),
  });

  tx.transferObjects([coin], params.recipient);
  return tx;
}

/** Format a raw balance for display. Exported so the UI shares one formatter. */
export function formatUnits(raw: string | bigint, decimals: number): string {
  return fmt(typeof raw === 'string' ? BigInt(raw) : raw, decimals);
}
