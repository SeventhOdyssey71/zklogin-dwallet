import {
  DWallet,
  CreateDWalletRequest,
  SignTransactionRequest,
  SignTransactionResponse,
  SignMessageRequest
} from '../types/dwallet';
import { mockDWallets, mockTransactions } from './mockData';

// Mock API delay helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Mock API Client for dWallet Operations
 * TODO: Replace with real API calls to backend
 */
export const dwalletAPI = {
  /**
   * Create a new dWallet
   */
  createDWallet: async (request: CreateDWalletRequest): Promise<DWallet> => {
    await delay(2000); // Simulate network delay and DKG process

    const curve = request.curve || (request.type === 'ECDSA' ? 'SECP256K1' : 'ED25519');
    const compatibleChains = request.type === 'ECDSA'
      ? ['Ethereum', 'Bitcoin', 'Polygon', 'Avalanche', 'BSC']
      : ['Solana', 'Polkadot', 'Cardano', 'Near', 'Stellar'];

    const newWallet: DWallet = {
      id: '0x' + Math.random().toString(16).substr(2, 64),
      name: request.name,
      type: request.type,
      curve,
      publicKey: '0x04' + Math.random().toString(16).substr(2, 128),
      createdAt: new Date().toISOString(),
      status: 'ACTIVE',
      compatibleChains,
      balances: []
    };

    return newWallet;
  },

  /**
   * Get all dWallets for the user
   */
  getDWallets: async (): Promise<DWallet[]> => {
    await delay(500);
    return mockDWallets;
  },

  /**
   * Get a specific dWallet by ID
   */
  getDWallet: async (id: string): Promise<DWallet | null> => {
    await delay(300);
    return mockDWallets.find(w => w.id === id) || null;
  },

  /**
   * Delete/deactivate a dWallet
   */
  deleteDWallet: async (id: string): Promise<{ success: boolean; message: string }> => {
    await delay(1000);
    return {
      success: true,
      message: 'dWallet deactivated successfully'
    };
  },

  /**
   * Sign a transaction
   */
  signTransaction: async (request: SignTransactionRequest): Promise<SignTransactionResponse> => {
    await delay(3000); // Simulate MPC signing process

    // Simulate occasional failures for testing
    const success = Math.random() > 0.1; // 90% success rate

    if (success) {
      return {
        signature: '0x' + Math.random().toString(16).substr(2, 128),
        txHash: '0x' + Math.random().toString(16).substr(2, 64),
        status: 'SUCCESS',
        message: 'Transaction signed successfully'
      };
    } else {
      return {
        signature: '',
        status: 'FAILED',
        message: 'Failed to sign transaction - insufficient presigns'
      };
    }
  },

  /**
   * Sign a message
   */
  signMessage: async (request: SignMessageRequest): Promise<SignTransactionResponse> => {
    await delay(2000);

    return {
      signature: '0x' + Math.random().toString(16).substr(2, 128),
      status: 'SUCCESS',
      message: 'Message signed successfully'
    };
  },

  /**
   * Get transaction history for a dWallet
   */
  getTransactions: async (dwalletId: string, chain?: string) => {
    await delay(800);

    let transactions = mockTransactions;
    if (chain) {
      transactions = transactions.filter(tx => tx.chain === chain);
    }

    return transactions;
  },

  /**
   * Get balance for a specific chain
   */
  getBalance: async (dwalletId: string, chain: string) => {
    await delay(1000);

    const wallet = mockDWallets.find(w => w.id === dwalletId);
    if (!wallet) {
      throw new Error('dWallet not found');
    }

    const balance = wallet.balances.find(b => b.chain === chain);
    if (!balance) {
      return {
        chain,
        address: '',
        balance: '0',
        usdValue: 0,
        symbol: '',
        lastUpdated: new Date().toISOString()
      };
    }

    return {
      ...balance,
      lastUpdated: new Date().toISOString()
    };
  }
};
