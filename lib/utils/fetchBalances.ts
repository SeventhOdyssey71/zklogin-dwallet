/**
 * Fetch real balances from blockchain testnets
 */

import { TESTNET_CHAINS, SOLANA_TESTNET } from '../config/chains';

/**
 * Convert hex string to decimal number (for wei to ETH conversion)
 */
function hexToDecimal(hex: string): bigint {
  return BigInt(hex);
}

/**
 * Convert wei to ETH
 */
function weiToEth(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  return eth.toFixed(6);
}

/**
 * Fetch balance for EVM chains (Ethereum, Polygon, Avalanche, BSC)
 * Using direct JSON-RPC fetch to avoid CORS issues with ethers.js
 */
export async function fetchEVMBalance(chain: string, address: string): Promise<{ balance: string; usdValue: number }> {
  // Fallback RPC endpoints for each chain
  const fallbackRPCs: { [key: string]: string[] } = {
    'Ethereum': [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://rpc2.sepolia.org',
      'https://sepolia.drpc.org',
    ],
    'Polygon': [
      'https://rpc-amoy.polygon.technology',
      'https://polygon-amoy-bor-rpc.publicnode.com',
    ],
    'Avalanche': [
      'https://api.avax-test.network/ext/bc/C/rpc',
      'https://avalanche-fuji-c-chain-rpc.publicnode.com',
    ],
    'BSC': [
      'https://bsc-testnet-rpc.publicnode.com',
      'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    ],
  };

  const config = TESTNET_CHAINS[chain];
  if (!config) {
    throw new Error(`Chain config not found for ${chain}`);
  }

  const rpcEndpoints = fallbackRPCs[chain] || [config.rpcUrl];

  // Try each RPC endpoint until one works
  for (let i = 0; i < rpcEndpoints.length; i++) {
    try {
      const rpcUrl = rpcEndpoints[i];

      // Use direct fetch with JSON-RPC to avoid ethers.js CORS issues
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getBalance',
          params: [address, 'latest'],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`RPC returned ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message);
      }

      const balanceWei = hexToDecimal(data.result);
      const balance = weiToEth(balanceWei);

      console.log(`✅ ${chain} balance: ${balance} ${config.nativeCurrency.symbol}`);

      return {
        balance,
        usdValue: 0,
      };
    } catch (error) {
      // Only log error details on last attempt
      if (i === rpcEndpoints.length - 1) {
        console.error(`❌ All ${chain} RPC endpoints failed`);
        return {
          balance: '0',
          usdValue: 0,
        };
      }
      // Silently try next endpoint
    }
  }

  return {
    balance: '0',
    usdValue: 0,
  };
}

/**
 * Fetch balance for Solana
 */
export async function fetchSolanaBalance(address: string): Promise<{ balance: string; usdValue: number }> {
  // Skip if address is invalid
  if (!address || address === 'Invalid public key') {
    console.log(`⏭️ Skipping Solana balance fetch for invalid address: ${address}`);
    return {
      balance: '0',
      usdValue: 0,
    };
  }

  try {
    // Add timeout to fetch request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(SOLANA_TESTNET.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [address],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Solana RPC returned ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`Solana RPC error: ${data.error.message}`);
    }

    const lamports = data.result?.value || 0;
    const balance = (lamports / 1e9).toFixed(6); // Convert lamports to SOL

    console.log(`✅ Solana balance: ${balance} SOL`);

    return {
      balance,
      usdValue: 0,
    };
  } catch (error) {
    console.error('❌ Solana balance fetch failed:', error instanceof Error ? error.message : 'Unknown error');
    return {
      balance: '0',
      usdValue: 0,
    };
  }
}

/**
 * Fetch balance for Bitcoin testnet
 */
export async function fetchBitcoinBalance(address: string): Promise<{ balance: string; usdValue: number }> {
  // Skip if address is invalid
  if (!address || address === 'Invalid public key' || address.includes('not implemented')) {
    console.log(`⏭️ Skipping Bitcoin balance fetch for invalid address: ${address}`);
    return {
      balance: '0',
      usdValue: 0,
    };
  }

  try {
    // Add timeout to fetch request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    // Using Blockstream API for Bitcoin testnet
    const response = await fetch(`https://blockstream.info/testnet/api/address/${address}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Bitcoin API returned ${response.status}`);
    }

    const data = await response.json();

    const satoshis = data.chain_stats?.funded_txo_sum || 0;
    const balance = (satoshis / 1e8).toFixed(8); // Convert satoshis to BTC

    console.log(`✅ Bitcoin balance: ${balance} BTC`);

    return {
      balance,
      usdValue: 0,
    };
  } catch (error) {
    console.error('❌ Bitcoin balance fetch failed:', error instanceof Error ? error.message : 'Unknown error');
    return {
      balance: '0',
      usdValue: 0,
    };
  }
}

/**
 * Fetch balances for all compatible chains
 */
export async function fetchAllBalances(
  chainAddresses: { [chain: string]: string },
  curve: number
): Promise<{ [chain: string]: { balance: string; usdValue: number } }> {
  const balances: { [chain: string]: { balance: string; usdValue: number } } = {};

  const promises = Object.entries(chainAddresses).map(async ([chain, address]) => {
    try {
      if (curve === 0) {
        // SECP256K1 - EVM chains and Bitcoin
        if (chain === 'Bitcoin') {
          balances[chain] = await fetchBitcoinBalance(address);
        } else {
          balances[chain] = await fetchEVMBalance(chain, address);
        }
      } else {
        // ED25519 - Solana and others
        if (chain === 'Solana') {
          balances[chain] = await fetchSolanaBalance(address);
        } else {
          // For Polkadot, Cardano, NEAR - return 0 for now
          balances[chain] = { balance: '0', usdValue: 0 };
        }
      }
    } catch (error) {
      console.error(`❌ Error fetching ${chain} balance:`, error instanceof Error ? error.message : error);
      balances[chain] = { balance: '0', usdValue: 0 };
    }
  });

  await Promise.all(promises);

  console.log('✅ All balances fetched');
  return balances;
}
