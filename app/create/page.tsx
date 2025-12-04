'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Check, ArrowRight, ArrowLeft, Wallet, Shield, Zap, Loader2, Sparkles } from 'lucide-react';
import { dwalletAPI } from '@/lib/api/dwallet';
import { useWalletStore } from '@/lib/store/walletStore';
import { DWalletType } from '@/lib/types/dwallet';

type Step = 1 | 2 | 3 | 4;

export default function CreatePage() {
  const router = useRouter();
  const addWallet = useWalletStore((state) => state.addWallet);

  const [step, setStep] = useState<Step>(1);
  const [walletType, setWalletType] = useState<DWalletType>('ECDSA');
  const [walletName, setWalletName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createdWallet, setCreatedWallet] = useState<any>(null);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const wallet = await dwalletAPI.createDWallet({
        type: walletType,
        name: walletName,
      });
      setCreatedWallet(wallet);
      addWallet(wallet);
      setStep(4);
    } catch (error) {
      console.error('Failed to create wallet:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const compatibleChains = walletType === 'ECDSA'
    ? ['Bitcoin', 'Ethereum', 'Polygon', 'Avalanche', 'BSC']
    : ['Solana', 'Polkadot', 'Cardano', 'Near', 'Stellar'];

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-32">
      <div className="max-w-4xl w-full">
        {/* Progress Bar */}
        <div className="mb-12">
          <div className="flex items-center justify-between max-w-md mx-auto">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center">
                <motion.div
                  initial={false}
                  animate={{
                    scale: step >= s ? 1 : 0.8,
                    backgroundColor: step >= s ? '#a855f7' : '#e4e4e7',
                  }}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                >
                  {step > s ? <Check className="w-5 h-5" /> : s}
                </motion.div>
                {s < 3 && (
                  <motion.div
                    initial={false}
                    animate={{
                      width: step > s ? '100%' : '0%',
                    }}
                    className="h-1 bg-purple-500 mx-4"
                    style={{ width: 80 }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {/* Step 1: Choose Wallet Type */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="text-center mb-12">
                <h1 className="text-5xl md:text-6xl font-black mb-4">
                  Choose Wallet Type
                </h1>
                <p className="text-xl text-zinc-600 dark:text-zinc-400">
                  Select the signature algorithm for your dWallet
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                {/* ECDSA Card */}
                <motion.button
                  onClick={() => setWalletType('ECDSA')}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={`
                    p-8 rounded-3xl text-left cursor-hover transition-all
                    ${walletType === 'ECDSA'
                      ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white border-4 border-purple-600'
                      : 'bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800'
                    }
                  `}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                      walletType === 'ECDSA' ? 'bg-white/20' : 'bg-gradient-to-br from-purple-500 to-pink-500'
                    }`}>
                      <Shield className={`w-8 h-8 ${walletType === 'ECDSA' ? 'text-white' : 'text-white'}`} />
                    </div>
                    {walletType === 'ECDSA' && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="w-8 h-8 rounded-full bg-white flex items-center justify-center"
                      >
                        <Check className="w-5 h-5 text-purple-600" />
                      </motion.div>
                    )}
                  </div>

                  <h3 className="text-2xl font-bold mb-2">ECDSA</h3>
                  <p className={`text-sm mb-4 ${walletType === 'ECDSA' ? 'text-white/90' : 'text-zinc-600 dark:text-zinc-400'}`}>
                    SECP256K1 Curve
                  </p>

                  <div className="space-y-2 mb-4">
                    <div className={`text-sm font-medium ${walletType === 'ECDSA' ? 'text-white' : 'text-zinc-900 dark:text-white'}`}>
                      Compatible with:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {['₿ Bitcoin', '⟠ Ethereum', '🟣 Polygon', '🔺 Avalanche', '🟡 BSC'].map((chain) => (
                        <span
                          key={chain}
                          className={`px-2 py-1 rounded-full text-xs ${
                            walletType === 'ECDSA'
                              ? 'bg-white/20 text-white'
                              : 'bg-zinc-100 dark:bg-zinc-800'
                          }`}
                        >
                          {chain}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className={`text-sm ${walletType === 'ECDSA' ? 'text-white/80' : 'text-zinc-500 dark:text-zinc-500'}`}>
                    Best for EVM chains and Bitcoin
                  </div>
                </motion.button>

                {/* EdDSA Card */}
                <motion.button
                  onClick={() => setWalletType('EdDSA')}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={`
                    p-8 rounded-3xl text-left cursor-hover transition-all
                    ${walletType === 'EdDSA'
                      ? 'bg-gradient-to-br from-blue-500 to-purple-500 text-white border-4 border-blue-600'
                      : 'bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800'
                    }
                  `}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                      walletType === 'EdDSA' ? 'bg-white/20' : 'bg-gradient-to-br from-blue-500 to-purple-500'
                    }`}>
                      <Zap className={`w-8 h-8 ${walletType === 'EdDSA' ? 'text-white' : 'text-white'}`} />
                    </div>
                    {walletType === 'EdDSA' && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="w-8 h-8 rounded-full bg-white flex items-center justify-center"
                      >
                        <Check className="w-5 h-5 text-blue-600" />
                      </motion.div>
                    )}
                  </div>

                  <h3 className="text-2xl font-bold mb-2">EdDSA</h3>
                  <p className={`text-sm mb-4 ${walletType === 'EdDSA' ? 'text-white/90' : 'text-zinc-600 dark:text-zinc-400'}`}>
                    ED25519 Curve
                  </p>

                  <div className="space-y-2 mb-4">
                    <div className={`text-sm font-medium ${walletType === 'EdDSA' ? 'text-white' : 'text-zinc-900 dark:text-white'}`}>
                      Compatible with:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {['◎ Solana', '● Polkadot', '₳ Cardano', 'Ⓝ Near', '✦ Stellar'].map((chain) => (
                        <span
                          key={chain}
                          className={`px-2 py-1 rounded-full text-xs ${
                            walletType === 'EdDSA'
                              ? 'bg-white/20 text-white'
                              : 'bg-zinc-100 dark:bg-zinc-800'
                          }`}
                        >
                          {chain}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className={`text-sm ${walletType === 'EdDSA' ? 'text-white/80' : 'text-zinc-500 dark:text-zinc-500'}`}>
                    Best for modern chains with EdDSA
                  </div>
                </motion.button>
              </div>

              <div className="flex justify-end">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setStep(2)}
                  className="px-8 py-4 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold cursor-hover flex items-center gap-2"
                >
                  Continue
                  <ArrowRight className="w-5 h-5" />
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* Step 2: Name Your Wallet */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="text-center mb-12">
                <h1 className="text-5xl md:text-6xl font-black mb-4">
                  Name Your Wallet
                </h1>
                <p className="text-xl text-zinc-600 dark:text-zinc-400">
                  Choose a memorable name for your dWallet
                </p>
              </div>

              <div className="max-w-2xl mx-auto">
                <div className="p-8 rounded-3xl bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800">
                  <label className="block mb-4">
                    <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2 block">
                      Wallet Name
                    </span>
                    <input
                      type="text"
                      value={walletName}
                      onChange={(e) => setWalletName(e.target.value)}
                      placeholder="e.g., My Main Wallet"
                      className="w-full px-6 py-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 focus:border-purple-500 dark:focus:border-purple-500 outline-none text-lg transition-colors"
                      autoFocus
                    />
                  </label>

                  <div className="mt-6 p-4 rounded-2xl bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20">
                    <div className="flex items-start gap-3">
                      <Wallet className="w-5 h-5 text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-medium mb-1">Wallet Type: {walletType}</div>
                        <div className="text-sm text-zinc-600 dark:text-zinc-400">
                          {walletType === 'ECDSA' ? 'SECP256K1 Curve' : 'ED25519 Curve'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between max-w-2xl mx-auto">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setStep(1)}
                  className="px-8 py-4 rounded-full bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 font-bold cursor-hover flex items-center gap-2"
                >
                  <ArrowLeft className="w-5 h-5" />
                  Back
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setStep(3)}
                  disabled={!walletName.trim()}
                  className={`px-8 py-4 rounded-full font-bold cursor-hover flex items-center gap-2 ${
                    walletName.trim()
                      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                      : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed'
                  }`}
                >
                  Continue
                  <ArrowRight className="w-5 h-5" />
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* Step 3: Review & Create */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="text-center mb-12">
                <h1 className="text-5xl md:text-6xl font-black mb-4">
                  Review & Create
                </h1>
                <p className="text-xl text-zinc-600 dark:text-zinc-400">
                  Confirm your dWallet details
                </p>
              </div>

              <div className="max-w-2xl mx-auto space-y-6">
                <div className="p-8 rounded-3xl bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-2 border-purple-500/20">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                      <Wallet className="w-8 h-8 text-white" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold">{walletName}</h3>
                      <p className="text-zinc-600 dark:text-zinc-400">{walletType} Wallet</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between py-3 border-b border-zinc-200 dark:border-zinc-800">
                      <span className="text-zinc-600 dark:text-zinc-400">Algorithm</span>
                      <span className="font-medium">{walletType}</span>
                    </div>
                    <div className="flex justify-between py-3 border-b border-zinc-200 dark:border-zinc-800">
                      <span className="text-zinc-600 dark:text-zinc-400">Curve</span>
                      <span className="font-medium">
                        {walletType === 'ECDSA' ? 'SECP256K1' : 'ED25519'}
                      </span>
                    </div>
                    <div className="py-3">
                      <span className="text-zinc-600 dark:text-zinc-400 block mb-2">Compatible Chains</span>
                      <div className="flex flex-wrap gap-2">
                        {compatibleChains.map((chain) => (
                          <span
                            key={chain}
                            className="px-3 py-1 rounded-full text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                          >
                            {chain}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-6 rounded-2xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50">
                  <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-blue-900 dark:text-blue-100">
                      <strong>Security Note:</strong> Your private key will be generated using 2PC-MPC protocol
                      and distributed across the Ika validator network. No single party will have access to your complete private key.
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between max-w-2xl mx-auto">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setStep(2)}
                  disabled={isCreating}
                  className="px-8 py-4 rounded-full bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 font-bold cursor-hover flex items-center gap-2"
                >
                  <ArrowLeft className="w-5 h-5" />
                  Back
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleCreate}
                  disabled={isCreating}
                  className="px-8 py-4 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold cursor-hover flex items-center gap-2"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      Create dWallet
                      <Sparkles className="w-5 h-5" />
                    </>
                  )}
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* Step 4: Success */}
          {step === 4 && createdWallet && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-8"
            >
              <div className="text-center mb-12">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                  className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center"
                >
                  <Check className="w-12 h-12 text-white" />
                </motion.div>

                <h1 className="text-5xl md:text-6xl font-black mb-4">
                  <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600">
                    Success!
                  </span>
                </h1>
                <p className="text-xl text-zinc-600 dark:text-zinc-400">
                  Your dWallet has been created
                </p>
              </div>

              <div className="max-w-2xl mx-auto space-y-6">
                <div className="p-8 rounded-3xl bg-gradient-to-br from-purple-500 to-pink-500 text-white">
                  <h3 className="text-2xl font-bold mb-4">{createdWallet.name}</h3>

                  <div className="space-y-3">
                    <div>
                      <div className="text-sm text-white/70 mb-1">Wallet ID</div>
                      <div className="font-mono text-sm bg-white/10 p-3 rounded-lg break-all">
                        {createdWallet.id}
                      </div>
                    </div>

                    <div>
                      <div className="text-sm text-white/70 mb-1">Public Key</div>
                      <div className="font-mono text-sm bg-white/10 p-3 rounded-lg break-all">
                        {createdWallet.publicKey}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4">
                      <div>
                        <div className="text-sm text-white/70 mb-1">Type</div>
                        <div className="font-medium">{createdWallet.type}</div>
                      </div>
                      <div>
                        <div className="text-sm text-white/70 mb-1">Curve</div>
                        <div className="font-medium">{createdWallet.curve}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => router.push('/dashboard')}
                    className="px-8 py-4 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold cursor-hover"
                  >
                    Go to Dashboard
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      setStep(1);
                      setWalletName('');
                      setCreatedWallet(null);
                    }}
                    className="px-8 py-4 rounded-full bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 font-bold cursor-hover"
                  >
                    Create Another
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
