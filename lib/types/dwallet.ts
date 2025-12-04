// dWallet Types

export type DWalletType = 'ECDSA' | 'EdDSA';
export type DWalletStatus = 'ACTIVE' | 'PENDING' | 'INACTIVE';
export type CurveType = 'SECP256K1' | 'ED25519';

export interface DWalletBalance {
  chain: string;
  address: string;
  balance: string;
  usdValue: number;
  symbol: string;
}

export interface DWallet {
  id: string;
  name: string;
  type: DWalletType;
  curve: CurveType;
  publicKey: string;
  createdAt: string;
  status: DWalletStatus;
  compatibleChains: string[];
  balances: DWalletBalance[];
}

export interface CreateDWalletRequest {
  type: DWalletType;
  name: string;
  curve?: CurveType;
}

export interface SignTransactionRequest {
  dwalletId: string;
  chain: string;
  transaction: any;
  hashScheme?: string;
}

export interface SignTransactionResponse {
  signature: string;
  txHash?: string;
  status: 'SUCCESS' | 'PENDING' | 'FAILED';
  message?: string;
}

export interface SignMessageRequest {
  dwalletId: string;
  message: string;
  chain: string;
}
