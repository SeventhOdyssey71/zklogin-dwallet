import {
  DWallet,
  CreateDWalletRequest,
  SignTransactionRequest,
  SignTransactionResponse,
  SignMessageRequest
} from '../types/dwallet';
import { mockDWallets, mockTransactions, mockBlockchains } from './mockData';
import { realDwalletAPI, isUsingRealAPI } from './realDwallet';

// Mock API delay helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Hybrid API Client for dWallet Operations
 * Uses real backend when available, falls back to mock data
 */
export const dwalletAPI = {
  /**
   * Create a new dWallet
   * Currently uses mock data (real creation requires complex DKG process)
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
   * Hybrid: Fetches real wallet info from backend, merges with mock data for display
   */
  getDWallets: async (): Promise<DWallet[]> => {
    if (isUsingRealAPI()) {
      try {
        // Get real dWallet info from backend
        const realWallet = await realDwalletAPI.getDWalletInfo();

        // Get balances for supported chains
        const supportedChains = await realDwalletAPI.getSupportedChains();
        const balances = [];

        // Fetch balances for ALL compatible chains
        // dWallet derives addresses from one master key, so all chains are available
        for (const chain of supportedChains.chains) {
          try {
            const balanceData = await realDwalletAPI.getBalance(chain.id);
            balances.push({
              chain: chain.name,
              address: balanceData.address,
              balance: balanceData.amount,        // Backend uses 'amount' field
              usdValue: 0,                        // TODO: Add price oracle integration
              symbol: balanceData.symbol
            });
          } catch (error) {
            console.warn(`Failed to get balance for ${chain.id}, showing with 0 balance:`, error);
            // Still show the chain even if balance fetch fails
            balances.push({
              chain: chain.name,
              address: 'Loading...',
              balance: '0',
              usdValue: 0,
              symbol: chain.symbol
            });
          }
        }

        // Create DWallet object from real data
        const realDWallet: DWallet = {
          id: realWallet.id,
          name: 'My Active dWallet',
          type: realWallet.curve === 'SECP256K1' ? 'ECDSA' : 'EdDSA',
          curve: realWallet.curve as any,
          publicKey: realWallet.publicKey || realWallet.address,
          createdAt: realWallet.created,
          status: 'ACTIVE',
          compatibleChains: realWallet.curve === 'SECP256K1'
            ? ['Ethereum', 'Bitcoin', 'Polygon', 'Avalanche']
            : ['Solana', 'Polkadot'],
          balances
        };

        // Return only real wallet, no demo wallets
        return [realDWallet];
      } catch (error) {
        console.error('Failed to fetch real wallet, falling back to mock:', error);
        return mockDWallets;
      }
    }

    // Fall back to mock data
    await delay(500);
    return mockDWallets;
  },

  /**
   * Get a specific dWallet by ID
   */
  getDWallet: async (id: string): Promise<DWallet | null> => {
    if (isUsingRealAPI()) {
      try {
        const realWallet = await realDwalletAPI.getDWalletInfo();
        if (realWallet.id === id) {
          // Fetch balances
          const supportedChains = await realDwalletAPI.getSupportedChains();
          const balances = [];

          // Fetch balances for ALL compatible chains
          // Since dWallet derives addresses from one master key, all chains should show
          for (const chain of supportedChains.chains) {
            try {
              const balanceData = await realDwalletAPI.getBalance(chain.id);
              balances.push({
                chain: chain.name,
                address: balanceData.address,
                balance: balanceData.amount,        // Backend uses 'amount' field
                usdValue: 0,                        // TODO: Add price oracle integration
                symbol: balanceData.symbol
              });
            } catch (error) {
              console.warn(`Failed to get balance for ${chain.id}, showing with 0 balance`, error);
              // Still show the chain even if balance fetch fails
              balances.push({
                chain: chain.name,
                address: 'Loading...',
                balance: '0',
                usdValue: 0,
                symbol: chain.symbol
              });
            }
          }

          return {
            id: realWallet.id,
            name: 'My Active dWallet',
            type: realWallet.curve === 'SECP256K1' ? 'ECDSA' : 'EdDSA',
            curve: realWallet.curve as any,
            publicKey: realWallet.publicKey || realWallet.address,
            createdAt: realWallet.created,
            status: 'ACTIVE',
            compatibleChains: realWallet.curve === 'SECP256K1'
              ? ['Ethereum', 'Bitcoin', 'Polygon', 'Avalanche']
              : ['Solana', 'Polkadot'],
            balances
          };
        }
      } catch (error) {
        console.error('Failed to fetch real wallet:', error);
        return null;
      }

      // Wallet ID doesn't match the real wallet
      return null;
    }

    // Fallback to mock only when not using real API
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
   * Uses real backend when available
   */
  signTransaction: async (request: SignTransactionRequest): Promise<SignTransactionResponse> => {
    if (isUsingRealAPI()) {
      try {
        const result = await realDwalletAPI.signTransaction(request.chain, request.transaction);
        return {
          signature: result.hash,
          txHash: result.txHash,
          status: 'SUCCESS',
          message: 'Transaction signed and broadcast successfully'
        };
      } catch (error: any) {
        return {
          signature: '',
          status: 'FAILED',
          message: error.message || 'Failed to sign transaction'
        };
      }
    }

    // Mock fallback
    await delay(3000);
    const success = Math.random() > 0.1;

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
   * Uses real backend when available
   */
  getTransactions: async (dwalletId: string, chain?: string) => {
    if (isUsingRealAPI() && chain) {
      try {
        const history = await realDwalletAPI.getTransactionHistory(chain, { limit: 20 });
        return history.transactions.map(tx => ({
          id: tx.hash,
          chain: chain,
          from: tx.from,
          to: tx.to,
          amount: tx.amount,
          symbol: mockBlockchains.find(b => b.id === chain.toLowerCase())?.nativeCurrency.symbol || '',
          timestamp: tx.timestamp,
          status: tx.status as any,
          txHash: tx.hash
        }));
      } catch (error) {
        console.error('Failed to fetch transaction history:', error);
      }
    }

    // Mock fallback
    await delay(800);
    let transactions = mockTransactions;
    if (chain) {
      transactions = transactions.filter(tx => tx.chain === chain);
    }
    return transactions;
  },

  /**
   * Get balance for a specific chain
   * Uses real backend when available
   */
  getBalance: async (dwalletId: string, chain: string) => {
    if (isUsingRealAPI()) {
      try {
        const balanceData = await realDwalletAPI.getBalance(chain);
        return {
          chain: chain,
          address: balanceData.address,
          balance: balanceData.amount,        // Backend uses 'amount' field
          usdValue: 0,                        // TODO: Add price oracle integration
          symbol: balanceData.symbol,
          lastUpdated: new Date().toISOString()
        };
      } catch (error) {
        console.error(`Failed to fetch balance for ${chain}:`, error);
      }
    }

    // Mock fallback
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
  },

  /**
   * Get supported blockchains
   */
  getSupportedChains: async () => {
    if (isUsingRealAPI()) {
      try {
        return await realDwalletAPI.getSupportedChains();
      } catch (error) {
        console.error('Failed to fetch supported chains:', error);
      }
    }

    await delay(300);
    return { chains: mockBlockchains };
  },

  /**
   * Health check
   */
  healthCheck: async () => {
    if (isUsingRealAPI()) {
      try {
        return await realDwalletAPI.healthCheck();
      } catch (error) {
        return { status: 'error', message: 'Backend not available' };
      }
    }
    return { status: 'mock', message: 'Using mock data' };
  }
};

// Export utility function
export { isUsingRealAPI };
