'use client';

/**
 * Per-chain balance reads, all going through the rate-limited pool in `./rpc`.
 *
 * Each fetcher does one thing: turn an address into a native-token amount. Endpoint choice, retries,
 * timeouts, health tracking and log suppression all live in the pool, so a chain added here inherits them
 * rather than reimplementing them — which is how the previous version ended up with four different
 * timeout values and three different ways of reporting the same failure.
 *
 * A failure throws. The store above decides what to show, and deliberately keeps the last known value
 * rather than replacing a real balance with zero.
 */

import { CHAIN_BY_ID } from '@/lib/config/chainRegistry';
import { fetchTokenPrices } from '@/lib/utils/prices';
import { callRpc, quiet, RpcError } from './rpc';
import { EVM_ENDPOINTS, NEAR_ENDPOINTS, SOLANA_ENDPOINTS } from './endpoints';

export interface Balance {
  balance: string;
  usdValue: number;
}

/** Decimal places for display. Six is enough to see dust without becoming unreadable. */
const DISPLAY_DP = 6;

const fromBaseUnits = (raw: bigint, decimals: number): string => {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = (abs % divisor).toString().padStart(decimals, '0').slice(0, DISPLAY_DP);
  return `${negative ? '-' : ''}${whole}.${frac}`;
};

/* ------------------------------- EVM ------------------------------- */

async function evmBalance(chain: string, address: string): Promise<Balance> {
  const urls = EVM_ENDPOINTS[chain];
  if (!urls) throw new RpcError(`No RPC endpoints configured for ${chain}`);

  const result = await callRpc(chain, urls, {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getBalance',
    params: [address, 'latest'],
  });

  const decimals = CHAIN_BY_ID[chain]?.decimals ?? 18;
  return { balance: fromBaseUnits(BigInt(result as string), decimals), usdValue: 0 };
}

/* ------------------------------ Solana ----------------------------- */

async function solanaBalance(address: string): Promise<Balance> {
  const result = (await callRpc('Solana', SOLANA_ENDPOINTS, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getBalance',
    params: [address],
  })) as { value?: number };

  return { balance: fromBaseUnits(BigInt(result?.value ?? 0), 9), usdValue: 0 };
}

/* ------------------------------- NEAR ------------------------------ */

async function nearBalance(address: string): Promise<Balance> {
  try {
    const result = (await callRpc('NEAR', NEAR_ENDPOINTS, {
      jsonrpc: '2.0',
      id: 1,
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: address },
    })) as { amount?: string };
    return { balance: fromBaseUnits(BigInt(result?.amount ?? '0'), 24), usdValue: 0 };
  } catch (e) {
    /**
     * An unfunded implicit account does not exist on NEAR, and the RPC reports that as an error rather
     * than a zero balance. That is the normal state of a freshly derived dWallet address, so it must not
     * be treated as a failure — the old code logged it on every single refresh.
     */
    const message = (e as Error).message;
    if (/does not exist|UNKNOWN_ACCOUNT|is not found/i.test(message)) {
      return { balance: '0.000000', usdValue: 0 };
    }
    throw e;
  }
}

/* ----------------------- proxied through our API ----------------------- */

/**
 * Chains read through a server route, because their APIs send no CORS headers.
 *
 * These keep their own `fetch` since they are not JSON-RPC, but they use the same generous deadline. The
 * old 6s budget was the direct cause of "Cardano balance fetch failed: signal is aborted without reason" —
 * Koios itself measured 1.9s, but under the request storm the proxy could not answer in time, and the
 * abort message told the user nothing about what had actually happened.
 */
const PROXY_TIMEOUT_MS = 12_000;

async function viaProxy(chain: string, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new RpcError(`${chain} proxy returned HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    const err = e as Error;
    throw new RpcError(
      err.name === 'AbortError' ? `${chain} balance request timed out` : `${chain}: ${err.message}`
    );
  } finally {
    clearTimeout(timer);
  }
}

async function bitcoinBalance(address: string): Promise<Balance> {
  const data = (await viaProxy('Bitcoin', `/api/bitcoin-balance?address=${encodeURIComponent(address)}`)) as {
    balance?: string;
  };
  return { balance: data?.balance ?? '0', usdValue: 0 };
}

async function cardanoBalance(address: string): Promise<Balance> {
  const data = (await viaProxy(
    'Cardano',
    `/api/cardano-balance?address=${encodeURIComponent(address)}`
  )) as { balance?: string }[] | { balance?: string } | null;

  // Koios answers with an array; an address it has never seen yields an empty one, which is a real zero
  // rather than an error.
  const first = Array.isArray(data) ? data[0] : data;
  if (!first) return { balance: '0.000000', usdValue: 0 };
  return { balance: fromBaseUnits(BigInt(first.balance ?? '0'), 6), usdValue: 0 };
}

/*
 * Polkadot's reader is gone along with the chain (see chainRegistry.ts). That removes the last import of
 * `@polkadot/api` from the client, which was 875 KB — the single largest dependency in the bundle — and
 * with it the websocket connection this module had to keep alive and reconnect.
 */

/* ------------------------------ router ----------------------------- */

/** Addresses that derivation could not produce; reading them would only waste a request. */
function isUnusable(address: string): boolean {
  return !address || address === 'Invalid public key' || address.includes('not implemented');
}

/**
 * Read one chain's native balance, then price it.
 *
 * `curve` selects the family the address belongs to, matching how addresses were derived: 0 is secp256k1
 * (Bitcoin plus every EVM chain, which share one address), anything else is an ed25519-family chain.
 */
export async function fetchChainBalance(chain: string, address: string): Promise<Balance> {
  if (isUnusable(address)) return { balance: '0.000000', usdValue: 0 };

  const def = CHAIN_BY_ID[chain];
  const raw = await (async (): Promise<Balance> => {
    if (chain === 'Bitcoin') return bitcoinBalance(address);
    if (def?.family === 'evm') return evmBalance(chain, address);
    if (chain === 'Solana') return solanaBalance(address);
    if (chain === 'Cardano') return cardanoBalance(address);
    if (chain === 'NEAR') return nearBalance(address);
    quiet(`unsupported:${chain}`, `[balances] no reader for ${chain}`);
    return { balance: '0.000000', usdValue: 0 };
  })();

  // Prices are cached inside `fetchTokenPrices`, so this does not add a request per chain. A price
  // failure must not fail the balance — the amount is the important part.
  let price = 0;
  try {
    price = (await fetchTokenPrices())[chain] ?? 0;
  } catch {
    price = 0;
  }

  return { balance: raw.balance, usdValue: (parseFloat(raw.balance) || 0) * price };
}
