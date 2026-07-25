'use client';

import { createNetworkConfig, SuiClientProvider } from '@mysten/dapp-kit';
import { ReactNode } from 'react';
import { SUI_RPC_URL } from '@/lib/config/network';

// Auth is zkLogin (Google), not a browser wallet — so there's no dapp-kit WalletProvider.
// We keep SuiClientProvider only for read access (useSuiClient) and for building/executing
// transactions.
//
// Mainnet only, deliberately: the Ika 2PC-MPC coordinator this app signs against is the mainnet
// deployment, and a testnet Sui client would derive a different zkLogin address while otherwise
// appearing to work. Registering just one network makes that mismatch impossible.
const { networkConfig } = createNetworkConfig({
  mainnet: { url: SUI_RPC_URL, network: 'mainnet' },
});

export function SuiWalletProvider({ children }: { children: ReactNode }) {
  return (
    <SuiClientProvider networks={networkConfig} defaultNetwork="mainnet">
      {children}
    </SuiClientProvider>
  );
}
