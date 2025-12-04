'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Wallet, TrendingUp, Activity, Plus, ArrowUpRight, Loader2 } from 'lucide-react';
import { dwalletAPI } from '@/lib/api/dwallet';
import { useWalletStore } from '@/lib/store/walletStore';
import { DWallet } from '@/lib/types/dwallet';
import { BentoCard } from '@/components/ui/BentoCard';

export default function DashboardPage() {
  const { wallets, setWallets, isLoading, setLoading } = useWalletStore();
  const [totalValue, setTotalValue] = useState(0);

  useEffect(() => {
    loadWallets();
  }, []);

  const loadWallets = async () => {
    setLoading(true);
    try {
      const data = await dwalletAPI.getDWallets();
      setWallets(data);

      // Calculate total portfolio value
      const total = data.reduce((sum, wallet) => {
        return sum + wallet.balances.reduce((wSum, balance) => wSum + balance.usdValue, 0);
      }, 0);
      setTotalValue(total);
    } catch (error) {
      console.error('Failed to load wallets:', error);
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-purple-600" />
          <p className="text-xl text-zinc-600 dark:text-zinc-400">Loading your dWallets...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen px-4 md:px-8 py-32">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl md:text-7xl font-black mb-4"
          >
            Dashboard
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-xl text-zinc-600 dark:text-zinc-400"
          >
            Manage your dWallets and track your portfolio
          </motion.p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <BentoCard delay={0}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">Total Portfolio</p>
                <h3 className="text-3xl font-black mb-1">${totalValue.toLocaleString()}</h3>
                <div className="flex items-center gap-1 text-green-600">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-sm font-medium">+12.5%</span>
                </div>
              </div>
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-white" />
              </div>
            </div>
          </BentoCard>

          <BentoCard delay={0.1}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">Total Wallets</p>
                <h3 className="text-3xl font-black mb-1">{wallets.length}</h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {wallets.filter(w => w.type === 'ECDSA').length} ECDSA, {wallets.filter(w => w.type === 'EdDSA').length} EdDSA
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <Wallet className="w-6 h-6 text-white" />
              </div>
            </div>
          </BentoCard>

          <BentoCard delay={0.2}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">Supported Chains</p>
                <h3 className="text-3xl font-black mb-1">15+</h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Bitcoin, Ethereum, Solana & more
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                <Activity className="w-6 h-6 text-white" />
              </div>
            </div>
          </BentoCard>
        </div>

        {/* Wallets Section */}
        <div className="mb-8 flex items-center justify-between">
          <h2 className="text-3xl font-bold">Your Wallets</h2>
          <Link href="/create">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-6 py-3 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold cursor-hover flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Create New
            </motion.button>
          </Link>
        </div>

        {wallets.length === 0 ? (
          <BentoCard>
            <div className="text-center py-12">
              <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                <Wallet className="w-12 h-12 text-purple-600" />
              </div>
              <h3 className="text-2xl font-bold mb-2">No dWallets Yet</h3>
              <p className="text-zinc-600 dark:text-zinc-400 mb-6">
                Create your first dWallet to start controlling multiple blockchains
              </p>
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
            </div>
          </BentoCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {wallets.map((wallet, index) => (
              <WalletCard key={wallet.id} wallet={wallet} delay={index * 0.1} />
            ))}
          </div>
        )}

        {/* Recent Activity */}
        {wallets.length > 0 && (
          <div className="mt-12">
            <h2 className="text-3xl font-bold mb-6">Recent Activity</h2>
            <BentoCard>
              <div className="space-y-4">
                {[
                  {
                    action: 'Created dWallet',
                    wallet: wallets[0].name,
                    time: '2 hours ago',
                    icon: Plus,
                    color: 'from-green-500 to-emerald-500'
                  },
                  {
                    action: 'Transaction Signed',
                    wallet: 'Ethereum • 0.5 ETH',
                    time: '5 hours ago',
                    icon: Activity,
                    color: 'from-blue-500 to-purple-500'
                  },
                  {
                    action: 'Balance Updated',
                    wallet: wallets[0].name,
                    time: '1 day ago',
                    icon: TrendingUp,
                    color: 'from-purple-500 to-pink-500'
                  },
                ].map((activity, i) => {
                  const Icon = activity.icon;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="flex items-center gap-4 p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 cursor-hover hover:scale-[1.02] transition-transform"
                    >
                      <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${activity.color} flex items-center justify-center flex-shrink-0`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{activity.action}</div>
                        <div className="text-sm text-zinc-600 dark:text-zinc-400">{activity.wallet}</div>
                      </div>
                      <div className="text-sm text-zinc-500">{activity.time}</div>
                    </motion.div>
                  );
                })}
              </div>
            </BentoCard>
          </div>
        )}
      </div>
    </main>
  );
}

function WalletCard({ wallet, delay }: { wallet: DWallet; delay: number }) {
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
                  {balance.balance} {balance.symbol} (${balance.usdValue})
                </span>
              </div>
            ))}
            {wallet.balances.length > 3 && (
              <div className="text-sm text-zinc-500 text-center pt-2">
                +{wallet.balances.length - 3} more chains
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
