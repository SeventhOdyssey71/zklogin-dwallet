'use client';

import { useCurrentAccount, useDisconnectWallet, useWallets, useConnectWallet } from '@mysten/dapp-kit';
import { motion, AnimatePresence } from 'framer-motion';
import { Wallet, LogOut, Copy, Check, X } from 'lucide-react';
import { useState, useEffect } from 'react';

export function ConnectWallet() {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const copyAddress = () => {
    if (account?.address) {
      navigator.clipboard.writeText(account.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!mounted) {
    return null; // Don't render on server
  }

  if (!account) {
    return (
      <ConnectButton
        className="!px-6 !py-3 !rounded-full !bg-gradient-to-r !from-purple-600 !to-pink-600 !text-white !font-bold hover:!scale-105 transition-transform cursor-hover"
        connectText="Connect Sui Wallet"
      />
    );
  }

  return (
    <div className="flex items-center gap-3">
      {/* Address Display */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
      >
        <Wallet className="w-4 h-4 text-purple-600" />
        <code className="text-sm font-mono">
          {account.address.slice(0, 6)}...{account.address.slice(-4)}
        </code>
        <button
          onClick={copyAddress}
          className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors cursor-hover"
          title="Copy address"
        >
          {copied ? (
            <Check className="w-3 h-3 text-green-600" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      </motion.div>

      {/* Disconnect Button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => disconnect()}
        className="p-2 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors cursor-hover"
        title="Disconnect wallet"
      >
        <LogOut className="w-4 h-4" />
      </motion.button>
    </div>
  );
}

/**
 * Compact version for navigation bar
 */
export function ConnectWalletCompact() {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    console.log('🔧 ConnectWalletCompact mounted');
  }, []);

  useEffect(() => {
    console.log('👛 Account state:', account ? {
      address: account.address,
      connected: true
    } : 'Not connected');
  }, [account]);

  const copyAddress = () => {
    console.log('📋 Copy address clicked');
    if (account?.address) {
      navigator.clipboard.writeText(account.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDisconnect = () => {
    console.log('🔌 Disconnect button clicked');
    disconnect();
  };

  if (!mounted) {
    console.log('⏳ Not mounted yet, returning null');
    return null; // Don't render on server
  }

  if (!account) {
    console.log('🔘 Rendering custom connect button (no account)');
    return <CustomConnectButton />;
  }

  console.log('✅ Rendering connected state with address:', account.address.slice(0, 10) + '...');

  return (
    <div className="flex items-center gap-2">
      {/* Connected Address */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-sm">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <code className="font-mono text-xs">
          {account.address.slice(0, 4)}...{account.address.slice(-3)}
        </code>
        <button
          onClick={copyAddress}
          className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors"
          title="Copy address"
        >
          {copied ? (
            <Check className="w-3 h-3 text-green-600" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      </div>

      {/* Disconnect Button */}
      <button
        onClick={handleDisconnect}
        className="p-1.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
        title="Disconnect wallet"
      >
        <LogOut className="w-3 h-3" />
      </button>
    </div>
  );
}

/**
 * Wallet connection status indicator
 */
export function WalletStatus() {
  const account = useCurrentAccount();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null; // Don't render on server
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {account ? (
        <>
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-zinc-600 dark:text-zinc-400">
            Wallet Connected
          </span>
        </>
      ) : (
        <>
          <div className="w-2 h-2 rounded-full bg-zinc-400" />
          <span className="text-zinc-600 dark:text-zinc-400">
            No Wallet Connected
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Custom connect button with modal
 */
function CustomConnectButton() {
  const [isOpen, setIsOpen] = useState(false);
  const wallets = useWallets();
  const { mutate: connect } = useConnectWallet();

  const handleConnect = (walletName: string) => {
    console.log('🔌 Connecting to wallet:', walletName);
    const wallet = wallets.find(w => w.name === walletName);
    if (wallet) {
      connect(
        { wallet },
        {
          onSuccess: () => {
            console.log('✅ Connected successfully!');
            setIsOpen(false);
          },
          onError: (error) => {
            console.error('❌ Connection failed:', error);
          },
        }
      );
    }
  };

  return (
    <>
      <button
        onClick={() => {
          console.log('🖱️ Connect button clicked, opening modal');
          setIsOpen(true);
        }}
        className="px-4 py-2 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white text-sm font-bold hover:scale-105 transition-transform"
      >
        Connect Wallet
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/50 z-[99998]"
            />

            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl p-6 z-[99999]"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold">Connect Wallet</h3>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Wallet List */}
              <div className="space-y-3">
                {wallets.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-zinc-600 dark:text-zinc-400 mb-4">
                      No Sui wallets detected
                    </p>
                    <a
                      href="https://chrome.google.com/webstore/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-purple-600 hover:text-purple-700 underline text-sm"
                    >
                      Install Sui Wallet Extension
                    </a>
                  </div>
                ) : (
                  wallets.map((wallet) => (
                    <button
                      key={wallet.name}
                      onClick={() => handleConnect(wallet.name)}
                      className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-zinc-200 dark:border-zinc-700 hover:border-purple-500 dark:hover:border-purple-500 transition-colors group"
                    >
                      {wallet.icon && (
                        <img
                          src={wallet.icon}
                          alt={wallet.name}
                          className="w-10 h-10 rounded-lg"
                        />
                      )}
                      <div className="flex-1 text-left">
                        <div className="font-bold text-zinc-900 dark:text-white">
                          {wallet.name}
                        </div>
                        <div className="text-sm text-zinc-500 dark:text-zinc-400">
                          Click to connect
                        </div>
                      </div>
                      <div className="text-zinc-400 group-hover:text-purple-600 transition-colors">
                        →
                      </div>
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
