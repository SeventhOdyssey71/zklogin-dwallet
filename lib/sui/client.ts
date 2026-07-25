/**
 * The app's Sui client type + factory, in one place.
 *
 * @mysten/sui v2 renamed the JSON-RPC client: `SuiClient` (from `@mysten/sui/client`) became
 * `SuiJsonRpcClient` (from `@mysten/sui/jsonRpc`), and `@mysten/sui/client` now only holds the
 * transport-agnostic core/base client types. Every module in this app imports `AppSuiClient` from
 * here instead of naming the concrete class, so the next transport swap (gRPC, GraphQL) is a
 * one-line change rather than a codebase-wide rename.
 */

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { SUI_NETWORK, SUI_RPC_URL } from '@/lib/config/network';

/** The Sui client type passed around this app. */
export type AppSuiClient = SuiJsonRpcClient;

/**
 * Build a Sui mainnet client.
 *
 * Pass an explicit `url` for server-side routes that should use a private endpoint; otherwise
 * this uses NEXT_PUBLIC_SUI_RPC_URL / the official Mysten mainnet fullnode.
 */
export function createSuiClient(url: string = SUI_RPC_URL): AppSuiClient {
  return new SuiJsonRpcClient({ url, network: SUI_NETWORK });
}
