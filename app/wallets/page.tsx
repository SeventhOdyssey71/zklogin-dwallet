'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  Wallet,
  Plus,
  ArrowUpRight,
  Loader2,
  Grid3x3,
  List,
  Search,
  Filter,
  TrendingUp,
  TrendingDown,
  Copy,
  ExternalLink
} from 'lucide-react';
import { dwalletAPI } from '@/lib/api/dwallet';
import { getDWalletsFromBlockchain } from '@/lib/api/blockchainDwallet';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useWalletStore } from '@/lib/store/walletStore';
import { DWallet } from '@/lib/types/dwallet';
import { BentoCard } from '@/components/ui/BentoCard';

type ViewMode = 'grid' | 'list';
type SortBy = 'name' | 'balance' | 'created';

export default function WalletsPage() {
  const { wallets, setWallets, isLoading, setLoading } = useWalletStore();
  const account = useCurrentAccount();
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'ECDSA' | 'EdDSA'>('all');
  const [sortBy, setSortBy] = useState<SortBy>('created');

  useEffect(() => {
    if (account) {
      loadWallets();
    }
  }, [account]);

  const loadWallets = async () => {
    if (!account) {
      console.log('No wallet connected');
      return;
    }

    setLoading(true);
    try {
      console.log('📡 Fetching dWallets for address:', account.address);

      // Fetch dWallets directly from blockchain
      const blockchainWallets = await getDWalletsFromBlockchain(account.address);

      console.log('✅ Found', blockchainWallets.length, 'dWallets');

      // Convert to DWallet format for display
      const formattedWallets: DWallet[] = blockchainWallets.map((wallet) => ({
        id: wallet.id,
        name: `dWallet ${wallet.id.substring(0, 8)}...`,
        type: wallet.curve === 0 ? 'ECDSA' : 'EdDSA',
        curve: wallet.curve === 0 ? 'SECP256K1' : 'ED25519',
        publicKey: 'pending', // TODO: Extract from dWallet public key commitment
        status: wallet.state === 'Active' ? 'ACTIVE' : wallet.state === 'AwaitingNetworkDKGVerification' ? 'PENDING' : 'INACTIVE',
        compatibleChains: wallet.curve === 0
          ? ['Bitcoin', 'Ethereum', 'Polygon', 'Avalanche', 'BSC']
          : ['Solana', 'Polkadot', 'Cardano', 'NEAR'],
        balances: [], // TODO: Fetch real balances from chains
        createdAt: new Date().toISOString(),
      }));

      setWallets(formattedWallets);
    } catch (error) {
      console.error('Failed to load wallets from blockchain:', error);

      // Fall back to mock data if blockchain fetch fails
      try {
        const data = await dwalletAPI.getDWallets();
        setWallets(data);
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
      }
    } finally {
      setLoading(false);
    }
  };

  const filteredWallets = wallets
    .filter(wallet => {
      const matchesSearch = searchQuery === '' ||
        wallet.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        wallet.id.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter = filterType === 'all' || wallet.type === filterType;
      return matchesSearch && matchesFilter;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'balance':
          const aBalance = a.balances.reduce((sum, b) => sum + b.usdValue, 0);
          const bBalance = b.balances.reduce((sum, b) => sum + b.usdValue, 0);
          return bBalance - aBalance;
        case 'created':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default:
          return 0;
      }
    });

  const totalValue = wallets.reduce((sum, wallet) => {
    return sum + wallet.balances.reduce((wSum, balance) => wSum + balance.usdValue, 0);
  }, 0);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-purple-600" />
          <p className="text-xl text-zinc-600 dark:text-zinc-400">Loading wallets...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen px-4 md:px-8 py-32">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-12 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-5xl md:text-7xl font-black mb-4"
            >
              My Wallets
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-xl text-zinc-600 dark:text-zinc-400"
            >
              {wallets.length} wallet{wallets.length !== 1 ? 's' : ''} • ${totalValue.toLocaleString()} total
            </motion.p>
          </div>

          <Link href="/create">
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-6 py-3 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold cursor-hover flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Create New Wallet
            </motion.button>
          </Link>
        </div>

        {/* Controls */}
        <div className="mb-8 space-y-4">
          {/* Search & View Toggle */}
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search wallets by name or ID..."
                  className="w-full pl-12 pr-4 py-3 rounded-2xl bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 focus:border-purple-500 dark:focus:border-purple-500 outline-none transition-colors"
                />
              </div>
            </div>

            {/* View Mode Toggle */}
            <div className="flex gap-2">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setViewMode('grid')}
                className={`p-3 rounded-xl cursor-hover transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                    : 'bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800'
                }`}
              >
                <Grid3x3 className="w-5 h-5" />
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setViewMode('list')}
                className={`p-3 rounded-xl cursor-hover transition-colors ${
                  viewMode === 'list'
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                    : 'bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800'
                }`}
              >
                <List className="w-5 h-5" />
              </motion.button>
            </div>
          </div>

          {/* Filters & Sort */}
          <div className="flex flex-wrap gap-2">
            {/* Type Filters */}
            {['all', 'ECDSA', 'EdDSA'].map((type) => (
              <motion.button
                key={type}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setFilterType(type as any)}
                className={`px-4 py-2 rounded-full font-medium cursor-hover transition-colors ${
                  filterType === type
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                    : 'bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800'
                }`}
              >
                {type === 'all' ? 'All Wallets' : type}
              </motion.button>
            ))}

            <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-800" />

            {/* Sort Options */}
            {[
              { value: 'created', label: 'Recent' },
              { value: 'name', label: 'Name' },
              { value: 'balance', label: 'Balance' }
            ].map(({ value, label }) => (
              <motion.button
                key={value}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setSortBy(value as SortBy)}
                className={`px-4 py-2 rounded-full font-medium cursor-hover transition-colors ${
                  sortBy === value
                    ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                    : 'bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800'
                }`}
              >
                {label}
              </motion.button>
            ))}
          </div>
        </div>

        {/* Wallets Grid/List */}
        {filteredWallets.length === 0 ? (
          <BentoCard>
            <div className="text-center py-12">
              <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                <Wallet className="w-12 h-12 text-purple-600" />
              </div>
              <h3 className="text-2xl font-bold mb-2">
                {searchQuery || filterType !== 'all' ? 'No Wallets Found' : 'No Wallets Yet'}
              </h3>
              <p className="text-zinc-600 dark:text-zinc-400 mb-6">
                {searchQuery || filterType !== 'all'
                  ? 'Try adjusting your search or filters'
                  : 'Create your first dWallet to get started'}
              </p>
              {!searchQuery && filterType === 'all' && (
                <Link href="/create">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="px-8 py-4 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold cursor-hover inline-flex items-center gap-2"
                  >
                    <Plus className="w-5 h-5" />
                    Create Your First dWallet
                  </motion.button>
                </Link>
              )}
            </div>
          </BentoCard>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredWallets.map((wallet, index) => (
              <WalletCardGrid key={wallet.id} wallet={wallet} delay={index * 0.05} />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredWallets.map((wallet, index) => (
              <WalletCardList key={wallet.id} wallet={wallet} delay={index * 0.05} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function WalletCardGrid({ wallet, delay }: { wallet: DWallet; delay: number }) {
  const totalBalance = wallet.balances.reduce((sum, b) => sum + b.usdValue, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <Link href={`/wallets/${wallet.id}`}>
        <BentoCard className="cursor-hover h-full">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                wallet.type === 'ECDSA'
                  ? 'bg-gradient-to-br from-purple-500 to-pink-500'
                  : 'bg-gradient-to-br from-blue-500 to-purple-500'
              }`}>
                <Wallet className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-lg">{wallet.name}</h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {wallet.type} • {wallet.curve}
                </p>
              </div>
            </div>
            <ArrowUpRight className="w-5 h-5 text-zinc-400" />
          </div>

          <div className="mb-4">
            <div className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">Total Balance</div>
            <div className="text-2xl font-black">${totalBalance.toLocaleString()}</div>
          </div>

          <div className="space-y-2">
            {wallet.balances.slice(0, 3).map((balance) => (
              <div key={balance.chain} className="flex items-center justify-between text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">{balance.chain}</span>
                <span className="font-medium">
                  {balance.balance} {balance.symbol}
                </span>
              </div>
            ))}
            {wallet.balances.length > 3 && (
              <div className="text-sm text-zinc-500 text-center pt-2">
                +{wallet.balances.length - 3} more
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Status</span>
              <span className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  wallet.status === 'ACTIVE' ? 'bg-green-500' : 'bg-zinc-400'
                }`} />
                {wallet.status}
              </span>
            </div>
          </div>
        </BentoCard>
      </Link>
    </motion.div>
  );
}

function WalletCardList({ wallet, delay }: { wallet: DWallet; delay: number }) {
  const totalBalance = wallet.balances.reduce((sum, b) => sum + b.usdValue, 0);
  const [copied, setCopied] = useState(false);

  const copyAddress = (e: React.MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.writeText(wallet.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <Link href={`/wallets/${wallet.id}`}>
        <BentoCard className="cursor-hover">
          <div className="flex items-center gap-6">
            {/* Icon */}
            <div className={`w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0 ${
              wallet.type === 'ECDSA'
                ? 'bg-gradient-to-br from-purple-500 to-pink-500'
                : 'bg-gradient-to-br from-blue-500 to-purple-500'
            }`}>
              <Wallet className="w-8 h-8 text-white" />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="font-bold text-xl">{wallet.name}</h3>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  wallet.type === 'ECDSA'
                    ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                    : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                }`}>
                  {wallet.type}
                </span>
                <span className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
                  wallet.status === 'ACTIVE'
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    wallet.status === 'ACTIVE' ? 'bg-green-500' : 'bg-zinc-400'
                  }`} />
                  {wallet.status}
                </span>
              </div>

              <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 mb-3">
                <span className="font-mono truncate max-w-xs">{wallet.id.slice(0, 20)}...</span>
                <button
                  onClick={copyAddress}
                  className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded transition-colors"
                >
                  <Copy className="w-3 h-3" />
                </button>
                {copied && <span className="text-green-600 text-xs">Copied!</span>}
              </div>

              <div className="flex items-center gap-6">
                <div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">Balance</div>
                  <div className="text-xl font-bold">${totalBalance.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">Chains</div>
                  <div className="text-xl font-bold">{wallet.balances.length}</div>
                </div>
                <div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">Curve</div>
                  <div className="text-xl font-bold">{wallet.curve}</div>
                </div>
              </div>
            </div>

            {/* Arrow */}
            <ArrowUpRight className="w-6 h-6 text-zinc-400 flex-shrink-0" />
          </div>
        </BentoCard>
      </Link>
    </motion.div>
  );
}
