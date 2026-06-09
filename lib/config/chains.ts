/**
 * Blockchain configuration for testnet networks
 */

export interface ChainConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorer: string;
}

export const TESTNET_CHAINS: { [key: string]: ChainConfig } = {
  'Ethereum': {
    name: 'Ethereum Sepolia',
    chainId: 11155111,
    rpcUrl: 'https://eth-sepolia.public.blastapi.io',
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    blockExplorer: 'https://sepolia.etherscan.io',
  },
  'Polygon': {
    name: 'Polygon Amoy',
    chainId: 80002,
    rpcUrl: 'https://rpc-amoy.polygon.technology',
    nativeCurrency: {
      name: 'MATIC',
      symbol: 'MATIC',
      decimals: 18,
    },
    blockExplorer: 'https://amoy.polygonscan.com',
  },
  'Avalanche': {
    name: 'Avalanche Fuji',
    chainId: 43113,
    rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
    nativeCurrency: {
      name: 'Avalanche',
      symbol: 'AVAX',
      decimals: 18,
    },
    blockExplorer: 'https://testnet.snowtrace.io',
  },
  'BSC': {
    name: 'BSC Testnet',
    chainId: 97,
    rpcUrl: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    nativeCurrency: {
      name: 'Binance Coin',
      symbol: 'BNB',
      decimals: 18,
    },
    blockExplorer: 'https://testnet.bscscan.com',
  },
  'Bitcoin': {
    name: 'Bitcoin Testnet',
    chainId: 0, // Bitcoin doesn't use chain IDs
    rpcUrl: 'https://blockstream.info/testnet/api', // Using Blockstream API
    nativeCurrency: {
      name: 'Bitcoin',
      symbol: 'BTC',
      decimals: 8,
    },
    blockExplorer: 'https://blockstream.info/testnet',
  },
};

export const SOLANA_TESTNET = {
  name: 'Solana Testnet',
  rpcUrl: 'https://api.testnet.solana.com',
  blockExplorer: 'https://explorer.solana.com/?cluster=testnet',
};

export const POLKADOT_TESTNET = {
  name: 'Paseo AssetHub',
  rpcUrl: 'wss://sys.ibp.network/asset-hub-paseo',
  blockExplorer: 'https://assethub-paseo.subscan.io',
};

export const CARDANO_TESTNET = {
  name: 'Cardano Preview',
  rpcUrl: 'https://cardano-preview.blockfrost.io/api/v0',
  blockExplorer: 'https://preview.cardanoscan.io',
};

export const NEAR_TESTNET = {
  name: 'NEAR Testnet',
  rpcUrl: 'https://rpc.testnet.near.org',
  blockExplorer: 'https://explorer.testnet.near.org',
};
