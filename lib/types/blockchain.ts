// Blockchain Types

export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

export interface BlockchainConfig {
  id: string;
  name: string;
  icon: string;
  type: 'ECDSA' | 'EdDSA';
  curve: string;
  nativeCurrency: NativeCurrency;
  rpcUrl?: string;
  explorerUrl?: string;
  color: string; // For UI theming
}

export interface Transaction {
  id: string;
  chain: string;
  from: string;
  to: string;
  amount: string;
  symbol: string;
  timestamp: string;
  status: 'pending' | 'confirmed' | 'failed';
  txHash?: string;
  fee?: string;
}

export interface BalanceResponse {
  chain: string;
  address: string;
  balance: string;
  usdValue: number;
  symbol: string;
  lastUpdated: string;
}
