/**
 * Real API Client for dWallet Operations
 * Connects to the Express backend server
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const USE_REAL_API = process.env.NEXT_PUBLIC_USE_REAL_API === 'true';

// Helper function for API calls
async function apiCall<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Network error' }));
      throw new Error(error.error || error.details || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`API call failed: ${endpoint}`, error);
    throw error;
  }
}

export const realDwalletAPI = {
  /**
   * Health check
   */
  async healthCheck() {
    return apiCall<{ status: string; timestamp: string }>('/api/health');
  },

  /**
   * Get dWallet info from backend
   */
  async getDWalletInfo() {
    return apiCall<{
      id: string;
      status: string;
      curve: string;
      network: string;
      address: string;
      publicKey: string;
      created: string;
    }>('/api/dwallet/info');
  },

  /**
   * Get balance for a specific chain
   */
  async getBalance(chain: string) {
    return apiCall<{
      amount: string;          // Backend returns 'amount', not 'balance'
      available: string;
      pending: string;
      address: string;
      symbol: string;
      decimals: number;
      utxos?: number;          // For Bitcoin
    }>(`/api/balance/${chain.toLowerCase()}`);
  },

  /**
   * Sign and broadcast transaction
   */
  async signTransaction(chain: string, transactionData: {
    to: string;
    amount: string;
    memo?: string;
  }) {
    return apiCall<{
      hash: string;
      txHash: string;
      status: string;
      chain: string;
      timestamp: string;
    }>(`/api/sign/${chain.toLowerCase()}`, {
      method: 'POST',
      body: JSON.stringify(transactionData),
    });
  },

  /**
   * Get transaction history for a chain
   */
  async getTransactionHistory(chain: string, options?: {
    limit?: number;
    offset?: number;
  }) {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.offset) params.append('offset', options.offset.toString());

    const query = params.toString() ? `?${params.toString()}` : '';
    return apiCall<{
      transactions: Array<{
        hash: string;
        from: string;
        to: string;
        amount: string;
        timestamp: string;
        status: string;
      }>;
    }>(`/api/history/${chain.toLowerCase()}${query}`);
  },

  /**
   * Estimate transaction fees
   */
  async estimateFees(chain: string, transactionData: {
    to: string;
    amount: string;
  }) {
    return apiCall<{
      estimatedFee: string;
      gasPrice?: string;
      gasLimit?: string;
    }>(`/api/estimate/${chain.toLowerCase()}`, {
      method: 'POST',
      body: JSON.stringify(transactionData),
    });
  },

  /**
   * Get supported chains
   */
  async getSupportedChains() {
    return apiCall<{
      chains: Array<{
        id: string;
        name: string;
        symbol: string;
        network: string;
        rpc: string;
      }>;
    }>('/api/chains');
  },
};

// Export conditional API based on environment variable
export const isUsingRealAPI = () => USE_REAL_API;
