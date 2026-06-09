'use client';

import { createNetworkConfig, SuiClientProvider } from '@mysten/dapp-kit';
import { getFullnodeUrl } from '@mysten/sui/client';
import { ReactNode } from 'react';

// Auth is zkLogin (Google), not a browser wallet — so there's no dapp-kit WalletProvider.
// We keep SuiClientProvider only for read access (useSuiClient) and for building/executing
// transactions. CORS-friendly Sui testnet RPC first (official Mysten RPC blocks browser CORS).
const TESTNET_RPC = 'https://sui-testnet.publicnode.com:443';

const { networkConfig } = createNetworkConfig({
  testnet: { url: TESTNET_RPC },
  mainnet: { url: getFullnodeUrl('mainnet') },
});

export function SuiWalletProvider({ children }: { children: ReactNode }) {
  return (
    <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
      {children}
    </SuiClientProvider>
  );
}
