'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Menu, X, Wallet, LayoutDashboard, Plus, History } from 'lucide-react';
import { ConnectWalletCompact } from '@/components/wallet/ConnectWallet';

const navItems = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Create Wallet', href: '/create', icon: Plus },
  { label: 'My Wallets', href: '/wallets', icon: Wallet },
  { label: 'Activity', href: '/activity', icon: History },
];

export function Navigation() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Menu Button */}
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-8 left-8 p-4 rounded-full bg-white dark:bg-zinc-900 shadow-lg cursor-hover z-50 border border-zinc-200 dark:border-zinc-800"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Toggle menu"
      >
        {isOpen ? (
          <X className="w-6 h-6 text-zinc-900 dark:text-white" />
        ) : (
          <Menu className="w-6 h-6 text-zinc-900 dark:text-white" />
        )}
      </motion.button>

      {/* Wallet Connect Button */}
      <div className="fixed top-8 right-8 z-50">
        <ConnectWalletCompact />
      </div>

      {/* Full-screen overlay menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.nav
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed inset-0 bg-black dark:bg-white text-white dark:text-black z-40"
          >
            <div className="h-full flex flex-col justify-center items-center space-y-8 p-8">
              {navItems.map((item, i) => {
                const Icon = item.icon;
                return (
                  <motion.div
                    key={item.label}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="w-full max-w-md"
                  >
                    <Link
                      href={item.href}
                      onClick={() => setIsOpen(false)}
                      className="flex items-center gap-6 text-5xl md:text-7xl font-bold hover:italic transition-all cursor-hover group"
                    >
                      <Icon className="w-12 h-12 md:w-16 md:h-16 group-hover:scale-110 transition-transform" />
                      {item.label}
                    </Link>
                  </motion.div>
                );
              })}

              {/* Decorative gradient */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.5 }}
                className="absolute bottom-0 right-0 w-96 h-96 bg-gradient-to-tl from-purple-500/20 via-pink-500/20 to-blue-500/20 blur-3xl rounded-full"
              />
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </>
  );
}
