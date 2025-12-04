'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { Wallet, Shield, Zap, Globe, ArrowRight, Sparkles } from 'lucide-react';
import { BentoCard } from '@/components/ui/BentoCard';

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Hero Section */}
      <section className="min-h-screen flex items-center justify-center relative overflow-hidden px-4">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-pink-500/10 to-blue-500/10 dark:from-purple-900/20 dark:via-pink-900/20 dark:to-blue-900/20" />

        {/* Animated gradient orbs */}
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            rotate: [0, 90, 0],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: 'linear',
          }}
          className="absolute top-20 right-20 w-96 h-96 bg-gradient-to-br from-purple-500/30 to-pink-500/30 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            scale: [1.2, 1, 1.2],
            rotate: [90, 0, 90],
          }}
          transition={{
            duration: 15,
            repeat: Infinity,
            ease: 'linear',
          }}
          className="absolute bottom-20 left-20 w-96 h-96 bg-gradient-to-tr from-blue-500/30 to-purple-500/30 rounded-full blur-3xl"
        />

        {/* Content */}
        <div className="relative z-10 max-w-7xl mx-auto text-center space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 dark:bg-black/10 backdrop-blur-sm border border-white/20 dark:border-zinc-800"
          >
            <Sparkles className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-medium">Powered by 2PC-MPC Technology</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-6xl md:text-8xl lg:text-9xl font-black tracking-tighter"
          >
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 dark:from-purple-400 dark:via-pink-400 dark:to-blue-400">
              Control
            </span>
            <br />
            Every Chain
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="text-xl md:text-2xl text-zinc-600 dark:text-zinc-400 max-w-3xl mx-auto"
          >
            Create and manage dWallets across 15+ blockchains with zero-trust MPC technology.
            One wallet, unlimited possibilities.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="flex flex-col sm:flex-row gap-4 justify-center items-center"
          >
            <Link href="/create">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-8 py-4 rounded-full bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 text-white font-bold text-lg cursor-hover flex items-center gap-2 shadow-2xl"
              >
                Create dWallet
                <ArrowRight className="w-5 h-5" />
              </motion.button>
            </Link>

            <Link href="/dashboard">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-8 py-4 rounded-full bg-white dark:bg-zinc-900 text-black dark:text-white font-bold text-lg cursor-hover border-2 border-zinc-200 dark:border-zinc-800"
              >
                View Dashboard
              </motion.button>
            </Link>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.8 }}
            className="grid grid-cols-3 gap-8 max-w-2xl mx-auto pt-16"
          >
            <div>
              <div className="text-4xl md:text-5xl font-black bg-clip-text text-transparent bg-gradient-to-r from-purple-600 to-pink-600">
                15+
              </div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
                Blockchains
              </div>
            </div>
            <div>
              <div className="text-4xl md:text-5xl font-black bg-clip-text text-transparent bg-gradient-to-r from-pink-600 to-blue-600">
                &lt;1s
              </div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
                Signing Speed
              </div>
            </div>
            <div>
              <div className="text-4xl md:text-5xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">
                100%
              </div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
                Zero-Trust
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-32 px-4 md:px-8 max-w-7xl mx-auto">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-5xl md:text-7xl font-black text-center mb-16"
        >
          Why dWallet?
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-auto">
          {/* Large card */}
          <BentoCard className="md:col-span-2 md:row-span-2 min-h-[400px]" delay={0}>
            <div className="h-full flex flex-col justify-between">
              <div>
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mb-6">
                  <Shield className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-3xl md:text-4xl font-bold mb-4">
                  Zero-Trust Security
                </h3>
                <p className="text-lg text-zinc-600 dark:text-zinc-400">
                  Your private keys never exist in one place. 2PC-MPC protocol ensures distributed
                  key generation and signing across the Ika validator network. No single point of failure.
                </p>
              </div>
              <div className="mt-8 grid grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-white/50 dark:bg-black/50 backdrop-blur">
                  <div className="text-2xl font-bold">2PC-MPC</div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">Protocol</div>
                </div>
                <div className="p-4 rounded-2xl bg-white/50 dark:bg-black/50 backdrop-blur">
                  <div className="text-2xl font-bold">100+</div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">Validators</div>
                </div>
              </div>
            </div>
          </BentoCard>

          {/* Medium card */}
          <BentoCard className="min-h-[192px]" delay={0.1}>
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-500 to-blue-500 flex items-center justify-center mb-4">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-2xl font-bold mb-2">Lightning Fast</h3>
            <p className="text-zinc-600 dark:text-zinc-400">
              Sub-second signature generation with 10,000 TPS capability
            </p>
          </BentoCard>

          {/* Wide card */}
          <BentoCard className="md:col-span-2 min-h-[250px]" delay={0.2}>
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center mb-4">
              <Globe className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-2xl font-bold mb-2">Universal Compatibility</h3>
            <p className="text-zinc-600 dark:text-zinc-400 mb-6">
              Control Bitcoin, Ethereum, Solana, Polkadot, and 10+ more blockchains with a single dWallet
            </p>
            <div className="flex flex-wrap gap-2">
              {['₿ Bitcoin', '⟠ Ethereum', '◎ Solana', '● Polkadot', '🟣 Polygon', '🔺 Avalanche'].map((chain) => (
                <span
                  key={chain}
                  className="px-3 py-1 rounded-full text-sm bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800"
                >
                  {chain}
                </span>
              ))}
            </div>
          </BentoCard>

          {/* Tall card */}
          <BentoCard className="md:row-span-2 min-h-[400px]" delay={0.3}>
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mb-4">
              <Wallet className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-2xl font-bold mb-2">Dual Algorithm Support</h3>
            <p className="text-zinc-600 dark:text-zinc-400 mb-6">
              ECDSA and EdDSA wallets for complete blockchain coverage
            </p>
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20">
                <div className="font-bold mb-1">ECDSA (SECP256K1)</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  Bitcoin, Ethereum, EVM chains
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/20">
                <div className="font-bold mb-1">EdDSA (ED25519)</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  Solana, Polkadot, Cardano
                </div>
              </div>
            </div>
          </BentoCard>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-32 px-4 md:px-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="max-w-4xl mx-auto text-center p-16 rounded-3xl bg-gradient-to-br from-purple-600 via-pink-600 to-blue-600 text-white relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />
          <div className="relative z-10">
            <h2 className="text-4xl md:text-6xl font-black mb-6">
              Ready to Get Started?
            </h2>
            <p className="text-xl mb-8 text-white/90">
              Create your first dWallet in seconds and start controlling multiple blockchains
            </p>
            <Link href="/create">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-8 py-4 rounded-full bg-white text-purple-600 font-bold text-lg cursor-hover shadow-2xl inline-flex items-center gap-2"
              >
                Create Your dWallet Now
                <ArrowRight className="w-5 h-5" />
              </motion.button>
            </Link>
          </div>
        </motion.div>
      </section>
    </main>
  );
}
