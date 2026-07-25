/**
 * Single source of truth for which networks this app talks to.
 *
 * Everything is MAINNET: Sui mainnet, the Ika mainnet 2PC-MPC coordinator, and mainnet
 * destination chains. There is no testnet fallback on purpose — a half-configured app that
 * silently derives testnet addresses for a mainnet key is worse than one that fails loudly.
 *
 * Sui RPC: the official Mysten mainnet fullnode serves `access-control-allow-origin: *`, so it
 * works directly from the browser. Override with NEXT_PUBLIC_SUI_RPC_URL if you have a private
 * endpoint (recommended for production — public RPCs rate-limit).
 */

import { getNetworkConfig } from '@ika.xyz/sdk';
import type { IkaConfig } from '@ika.xyz/sdk';

/** The only Sui network this app supports. */
export const SUI_NETWORK = 'mainnet' as const;

/** Sui mainnet chain identifier — used to fail fast if an RPC points somewhere else. */
export const SUI_MAINNET_CHAIN_ID = '35834a8a';

export const SUI_RPC_URL =
  process.env.NEXT_PUBLIC_SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';

/**
 * Ika mainnet package + object IDs, straight from the SDK rather than hand-copied.
 *
 * As of @ika.xyz/sdk 0.4.1 this resolves to the live mainnet deployment:
 *   ikaDwallet2pcMpcPackage  0x23b5bd96…f7e77
 *   ikaDWalletCoordinator    0x5ea59bce…c75f3
 */
export const IKA_CONFIG: IkaConfig = getNetworkConfig(SUI_NETWORK);

/** Fully-qualified mainnet IKA coin type — the token that pays 2PC-MPC session fees. */
export const IKA_COIN_TYPE = `${IKA_CONFIG.packages.ikaPackage}::ika::IKA`;

/** Native SUI coin type. */
export const SUI_COIN_TYPE = '0x2::sui::SUI';

/**
 * Where to get mainnet IKA — a Cetus swap prefilled SUI → IKA.
 *
 * There is no faucet on mainnet, so the useful destination is a place that actually sells IKA rather
 * than a marketing page. Built from `IKA_COIN_TYPE` instead of a pasted literal so the link can never
 * point at a stale coin type if the SDK's mainnet config changes.
 */
export const IKA_ACQUIRE_URL = `https://app.cetus.zone/swap/${SUI_COIN_TYPE}/${IKA_COIN_TYPE}`;

export const SUI_EXPLORER = 'https://suiscan.xyz/mainnet';

export function suiTxUrl(digest: string): string {
  return `${SUI_EXPLORER}/tx/${digest}`;
}

export function suiObjectUrl(id: string): string {
  return `${SUI_EXPLORER}/object/${id}`;
}
