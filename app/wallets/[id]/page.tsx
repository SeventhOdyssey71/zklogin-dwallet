'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  ArrowLeft,
  Wallet,
  Copy,
  ExternalLink,
  Send,
  Download,
  Loader2,
  Check,
  TrendingUp,
  Activity,
  Clock
} from 'lucide-react';
import { dwalletAPI } from '@/lib/api/dwallet';
import { DWallet } from '@/lib/types/dwallet';
import { BentoCard } from '@/components/ui/BentoCard';

export default function WalletDetailPage() {
  const params = useParams();
  const router = useRouter();
  const walletId = params.id as string;

  const [wallet, setWallet] = useState<DWallet | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [selectedChain, setSelectedChain] = useState<string | null>(null);

  useEffect(() => {
    loadWallet();
  }, [walletId]);

  const loadWallet = async () => {
    setIsLoading(true);
    try {
      const data = await dwalletAPI.getDWallet(walletId);
      setWallet(data);
      if (data?.balances.length) {
        setSelectedChain(data.balances[0].chain);
      }
    } catch (error) {
      console.error('Failed to load wallet:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const totalBalance = wallet?.balances.reduce((sum, b) => sum + b.usdValue, 0) || 0;
  const selectedBalance = wallet?.balances.find(b => b.chain === selectedChain);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-purple-600" />
          <p className="text-xl text-zinc-600 dark:text-zinc-400">Loading wallet...</p>
        </div>
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <BentoCard className="max-w-md text-center">
          <h2 className="text-2xl font-bold mb-4">Wallet Not Found</h2>
          <p className="text-zinc-600 dark:text-zinc-400 mb-6">
            The wallet you're looking for doesn't exist or has been removed.
          </p>
          <Link href="/wallets">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-6 py-3 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold cursor-hover"
            >
              Back to Wallets
            </motion.button>
          </Link>
        </BentoCard>
      </div>
    );
  }

  return (
    <main className="min-h-screen px-4 md:px-8 py-32">
      <div className="max-w-7xl mx-auto">
        {/* Back Button */}
        <Link href="/wallets">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="flex items-center gap-2 mb-8 text-zinc-600 dark:text-zinc-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors cursor-hover"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Wallets
          </motion.button>
        </Link>

        {/* Header */}
        <div className="mb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start justify-between gap-4 mb-6"
          >
            <div className="flex items-center gap-4">
              <div className={`w-20 h-20 rounded-full flex items-center justify-center ${
                wallet.type === 'ECDSA'
                  ? 'bg-gradient-to-br from-purple-500 to-pink-500'
                  : 'bg-gradient-to-br from-blue-500 to-purple-500'
              }`}>
                <Wallet className="w-10 h-10 text-white" />
              </div>
              <div>
                <h1 className="text-5xl md:text-6xl font-black mb-2">{wallet.name}</h1>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    wallet.type === 'ECDSA'
                      ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                      : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  }`}>
                    {wallet.type} • {wallet.curve}
                  </span>
                  <span className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
                    wallet.status === 'ACTIVE'
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600'
                  }`}>
                    <div className={`w-2 h-2 rounded-full ${
                      wallet.status === 'ACTIVE' ? 'bg-green-500' : 'bg-zinc-400'
                    }`} />
                    {wallet.status}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Wallet ID */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex items-center gap-3 text-zinc-600 dark:text-zinc-400"
          >
            <span className="text-sm font-medium">Wallet ID:</span>
            <code className="font-mono text-sm">{wallet.id.slice(0, 40)}...</code>
            <button
              onClick={() => copyToClipboard(wallet.id)}
              className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-hover"
            >
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            </button>
          </motion.div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <BentoCard delay={0}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">Total Balance</p>
                <h3 className="text-4xl font-black mb-1">${totalBalance.toLocaleString()}</h3>
                <div className="flex items-center gap-1 text-green-600">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-sm font-medium">+8.2%</span>
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
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">Active Chains</p>
                <h3 className="text-4xl font-black mb-1">{wallet.balances.length}</h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  of {wallet.compatibleChains.length} supported
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-600 flex items-center justify-center">
                <Activity className="w-6 h-6 text-white" />
              </div>
            </div>
          </BentoCard>

          <BentoCard delay={0.2}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">Created</p>
                <h3 className="text-2xl font-black mb-1">
                  {new Date(wallet.createdAt).toLocaleDateString()}
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {Math.floor((Date.now() - new Date(wallet.createdAt).getTime()) / (1000 * 60 * 60 * 24))} days ago
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-400 to-pink-600 flex items-center justify-center">
                <Clock className="w-6 h-6 text-white" />
              </div>
            </div>
          </BentoCard>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chain Balances */}
          <div className="lg:col-span-2 space-y-6">
            <h2 className="text-3xl font-bold">Balances</h2>

            {wallet.balances.length === 0 ? (
              <BentoCard>
                <div className="text-center py-12">
                  <p className="text-zinc-600 dark:text-zinc-400">
                    No balances found. Fund your wallet to get started.
                  </p>
                </div>
              </BentoCard>
            ) : (
              <div className="grid gap-4">
                {wallet.balances.map((balance, index) => (
                  <motion.div
                    key={balance.chain}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <BentoCard
                      className={`cursor-hover ${
                        selectedChain === balance.chain ? 'ring-2 ring-purple-500' : ''
                      }`}
                      onClick={() => setSelectedChain(balance.chain)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-xl font-bold">{balance.chain}</h3>
                            <span className="text-sm text-zinc-600 dark:text-zinc-400">
                              {balance.symbol}
                            </span>
                          </div>
                          <div className="text-2xl font-black mb-1">
                            {balance.balance} {balance.symbol}
                          </div>
                          <div className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                            ${balance.usdValue.toLocaleString()} USD
                          </div>
                          {/* Blockchain Address */}
                          <div className="flex items-center gap-2 mt-3">
                            <code className="text-xs font-mono text-zinc-500 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">
                              {balance.address.slice(0, 12)}...{balance.address.slice(-8)}
                            </code>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(balance.address);
                              }}
                              className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors cursor-hover"
                            >
                              {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="px-4 py-2 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium cursor-hover flex items-center gap-2"
                          >
                            <Send className="w-4 h-4" />
                            Send
                          </motion.button>
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="px-4 py-2 rounded-full bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 font-medium cursor-hover flex items-center gap-2"
                          >
                            <Download className="w-4 h-4" />
                            Receive
                          </motion.button>
                        </div>
                      </div>
                    </BentoCard>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <h2 className="text-3xl font-bold">Details</h2>

            {/* Public Key */}
            <BentoCard>
              <h3 className="font-bold mb-2">Public Key</h3>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono break-all text-zinc-600 dark:text-zinc-400">
                  {wallet.publicKey.slice(0, 20)}...
                </code>
                <button
                  onClick={() => copyToClipboard(wallet.publicKey)}
                  className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded transition-colors"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </BentoCard>

            {/* Compatible Chains */}
            <BentoCard>
              <h3 className="font-bold mb-4">Compatible Chains</h3>
              <div className="flex flex-wrap gap-2">
                {wallet.compatibleChains.map((chain) => (
                  <span
                    key={chain}
                    className="px-3 py-1 rounded-full text-sm bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                  >
                    {chain}
                  </span>
                ))}
              </div>
            </BentoCard>

            {/* Actions */}
            <BentoCard>
              <h3 className="font-bold mb-4">Quick Actions</h3>
              <div className="space-y-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full px-4 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium cursor-hover flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Send Transaction
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full px-4 py-3 rounded-2xl bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 font-medium cursor-hover flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  View on Explorer
                </motion.button>
              </div>
            </BentoCard>
          </div>
        </div>
      </div>
    </main>
  );
}
