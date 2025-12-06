'use client';

import { createNetworkConfig, SuiClientProvider, WalletProvider } from '@mysten/dapp-kit';
import { getFullnodeUrl } from '@mysten/sui/client';
import { ReactNode } from 'react';

// Multiple RPC endpoints for Sui testnet (for fallback reliability)
// NOTE: Official Mysten RPC blocks CORS from browsers, so we use CORS-friendly alternatives first
const TESTNET_RPC_ENDPOINTS = [
  'https://sui-testnet.publicnode.com:443', // Public Node RPC (CORS-friendly)
  'https://sui-testnet-endpoint.blockvision.org', // BlockVision RPC (CORS-friendly)
  'https://sui-testnet-rpc.allthatnode.com', // AllThatNode RPC
  getFullnodeUrl('testnet'), // Official Mysten testnet RPC (last resort - CORS issues)
];

// Multiple RPC endpoints for Sui mainnet
const MAINNET_RPC_ENDPOINTS = [
  'https://sui-mainnet.publicnode.com:443', // Public Node RPC (CORS-friendly)
  'https://sui-mainnet-endpoint.blockvision.org', // BlockVision RPC (CORS-friendly)
  'https://sui-mainnet-rpc.allthatnode.com', // AllThatNode RPC
  getFullnodeUrl('mainnet'), // Official Mysten mainnet RPC (last resort)
];

// Try alternative RPC endpoints if primary fails
let currentTestnetRpcIndex = 0;
let currentMainnetRpcIndex = 0;

// Function to get next available RPC endpoint
export function getNextTestnetRpc() {
  const rpc = TESTNET_RPC_ENDPOINTS[currentTestnetRpcIndex];
  console.log(`🔄 Trying testnet RPC ${currentTestnetRpcIndex + 1}/${TESTNET_RPC_ENDPOINTS.length}:`, rpc);
  currentTestnetRpcIndex = (currentTestnetRpcIndex + 1) % TESTNET_RPC_ENDPOINTS.length;
  return rpc;
}

export function getNextMainnetRpc() {
  const rpc = MAINNET_RPC_ENDPOINTS[currentMainnetRpcIndex];
  console.log(`🔄 Trying mainnet RPC ${currentMainnetRpcIndex + 1}/${MAINNET_RPC_ENDPOINTS.length}:`, rpc);
  currentMainnetRpcIndex = (currentMainnetRpcIndex + 1) % MAINNET_RPC_ENDPOINTS.length;
  return rpc;
}

// Configure Sui network with primary RPC endpoints
const { networkConfig } = createNetworkConfig({
  testnet: { url: TESTNET_RPC_ENDPOINTS[0] },
  mainnet: { url: MAINNET_RPC_ENDPOINTS[0] },
});

interface SuiWalletProviderProps {
  children: ReactNode;
}

/**
 * Sui Wallet Provider
 *
 * Provides Sui wallet connection functionality to the app.
 * Wraps the app with:
 * - SuiClientProvider (for Sui blockchain connection)
 * - WalletProvider (for wallet connection/signing)
 *
 * Users connect their Sui wallet (browser extension) to:
 * - Create dWallets
 * - Sign transactions
 * - Pay gas fees
 *
 * NO PRIVATE KEYS are sent to the server!
 */
export function SuiWalletProvider({ children }: SuiWalletProviderProps) {
  return (
    <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
      <WalletProvider
        autoConnect={true}
        storageKey="ika-dwallet-sui-wallet"
      >
        {children}
      </WalletProvider>
    </SuiClientProvider>
  );
}
