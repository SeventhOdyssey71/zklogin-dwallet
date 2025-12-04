import { DWallet, DWalletType } from '../types/dwallet';
import { BlockchainConfig, Transaction } from '../types/blockchain';

// Mock dWallets
export const mockDWallets: DWallet[] = [
  {
    id: '0x0ad200ab340a95043583972fdca52e9960c5b5a11a2b31fa4533dd69ba759dd2',
    name: 'My Main Wallet',
    type: 'ECDSA',
    curve: 'SECP256K1',
    publicKey: '0x04abc123def456789012345678901234567890123456789012345678901234567890',
    createdAt: '2025-12-01T10:00:00Z',
    status: 'ACTIVE',
    compatibleChains: ['Ethereum', 'Bitcoin', 'Polygon', 'Avalanche', 'BSC'],
    balances: [
      {
        chain: 'Ethereum',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        balance: '1.5',
        usdValue: 3000,
        symbol: 'ETH'
      },
      {
        chain: 'Bitcoin',
        address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        balance: '0.05',
        usdValue: 2000,
        symbol: 'BTC'
      },
      {
        chain: 'Polygon',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        balance: '250.75',
        usdValue: 180,
        symbol: 'MATIC'
      }
    ]
  },
  {
    id: '0x20eddadefdb73efb78f8754f3d221fb0529b60f45d10737b8d49bc630a9284ad',
    name: 'Solana Portfolio',
    type: 'EdDSA',
    curve: 'ED25519',
    publicKey: '0x05xyz789abc123456789012345678901234567890123456789012345678901234',
    createdAt: '2025-12-04T13:49:00Z',
    status: 'ACTIVE',
    compatibleChains: ['Solana', 'Polkadot', 'Cardano', 'Near', 'Stellar'],
    balances: [
      {
        chain: 'Solana',
        address: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
        balance: '100',
        usdValue: 1500,
        symbol: 'SOL'
      },
      {
        chain: 'Polkadot',
        address: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
        balance: '50',
        usdValue: 350,
        symbol: 'DOT'
      }
    ]
  },
  {
    id: '0x3cd300cd450b96054793982fdca52e9960c5b5a11a2b31fa4533dd69ba759ee3',
    name: 'Trading Wallet',
    type: 'ECDSA',
    curve: 'SECP256K1',
    publicKey: '0x04def456abc789012345678901234567890123456789012345678901234567891234',
    createdAt: '2025-11-15T08:30:00Z',
    status: 'ACTIVE',
    compatibleChains: ['Ethereum', 'Avalanche', 'BSC', 'Arbitrum'],
    balances: [
      {
        chain: 'Avalanche',
        address: '0x852d36Dd7645D1643714e5b844Cc0e8395e1cDef',
        balance: '25.5',
        usdValue: 850,
        symbol: 'AVAX'
      },
      {
        chain: 'BSC',
        address: '0x852d36Dd7645D1643714e5b844Cc0e8395e1cDef',
        balance: '0.85',
        usdValue: 520,
        symbol: 'BNB'
      }
    ]
  }
];

// Mock blockchain configurations
export const mockBlockchains: BlockchainConfig[] = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    icon: '⟠',
    type: 'ECDSA',
    curve: 'SECP256K1',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://etherscan.io',
    color: '#627EEA'
  },
  {
    id: 'bitcoin',
    name: 'Bitcoin',
    icon: '₿',
    type: 'ECDSA',
    curve: 'SECP256K1',
    nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 8 },
    explorerUrl: 'https://blockchair.com/bitcoin',
    color: '#F7931A'
  },
  {
    id: 'solana',
    name: 'Solana',
    icon: '◎',
    type: 'EdDSA',
    curve: 'ED25519',
    nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
    explorerUrl: 'https://explorer.solana.com',
    color: '#14F195'
  },
  {
    id: 'polygon',
    name: 'Polygon',
    icon: '🟣',
    type: 'ECDSA',
    curve: 'SECP256K1',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    explorerUrl: 'https://polygonscan.com',
    color: '#8247E5'
  },
  {
    id: 'avalanche',
    name: 'Avalanche',
    icon: '🔺',
    type: 'ECDSA',
    curve: 'SECP256K1',
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    explorerUrl: 'https://snowtrace.io',
    color: '#E84142'
  },
  {
    id: 'bsc',
    name: 'BNB Chain',
    icon: '🟡',
    type: 'ECDSA',
    curve: 'SECP256K1',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    explorerUrl: 'https://bscscan.com',
    color: '#F3BA2F'
  },
  {
    id: 'polkadot',
    name: 'Polkadot',
    icon: '●',
    type: 'EdDSA',
    curve: 'ED25519',
    nativeCurrency: { name: 'Polkadot', symbol: 'DOT', decimals: 10 },
    explorerUrl: 'https://polkadot.subscan.io',
    color: '#E6007A'
  },
  {
    id: 'cardano',
    name: 'Cardano',
    icon: '₳',
    type: 'EdDSA',
    curve: 'ED25519',
    nativeCurrency: { name: 'Cardano', symbol: 'ADA', decimals: 6 },
    explorerUrl: 'https://cardanoscan.io',
    color: '#0033AD'
  }
];

// Mock transactions
export const mockTransactions: Transaction[] = [
  {
    id: '1',
    chain: 'Ethereum',
    from: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    to: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    amount: '0.5',
    symbol: 'ETH',
    timestamp: '2025-12-04T10:30:00Z',
    status: 'confirmed',
    txHash: '0xabc123def456...',
    fee: '0.002'
  },
  {
    id: '2',
    chain: 'Solana',
    from: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
    to: '7v91N7iZ9mNicL8WfG6cgSCKyRXydQjLh6UYBWwm6y1Q',
    amount: '10',
    symbol: 'SOL',
    timestamp: '2025-12-04T09:15:00Z',
    status: 'confirmed',
    txHash: '2ZE7Rw...',
    fee: '0.00025'
  },
  {
    id: '3',
    chain: 'Bitcoin',
    from: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    to: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    amount: '0.01',
    symbol: 'BTC',
    timestamp: '2025-12-03T16:45:00Z',
    status: 'pending',
    fee: '0.0001'
  }
];
