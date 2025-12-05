'use client';

import { createNetworkConfig, SuiClientProvider, WalletProvider } from '@mysten/dapp-kit';
import { getFullnodeUrl } from '@mysten/sui/client';
import { ReactNode } from 'react';

// Configure Sui network
const { networkConfig } = createNetworkConfig({
  testnet: { url: getFullnodeUrl('testnet') },
  mainnet: { url: getFullnodeUrl('mainnet') },
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
