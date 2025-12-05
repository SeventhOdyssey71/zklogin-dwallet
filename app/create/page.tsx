'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Check, ArrowRight, ArrowLeft, Wallet, Shield, Zap, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { dwalletAPI } from '@/lib/api/dwallet';
import { useWalletStore } from '@/lib/store/walletStore';
import { DWalletType } from '@/lib/types/dwallet';
import { IkaClient, IkaTransaction, Curve, prepareDKGAsync, UserShareEncryptionKeys, coordinatorTransactions, getNetworkConfig } from '@ika.xyz/sdk';

type Step = 0 | 1 | 2 | 3 | 4;

export default function CreatePage() {
  const router = useRouter();
  const addWallet = useWalletStore((state) => state.addWallet);

  // Sui Wallet Integration
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();
  const [mounted, setMounted] = useState(false);

  const [step, setStep] = useState<Step>(0);
  const [walletType, setWalletType] = useState<DWalletType>('ECDSA');
  const [walletName, setWalletName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createdWallet, setCreatedWallet] = useState<any>(null);
  const [creationError, setCreationError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-advance to step 1 if wallet is connected
  useEffect(() => {
    if (account && step === 0) {
      setStep(1);
    }
  }, [account, step]);

  const handleCreate = async () => {
    if (!account) {
      setCreationError('Please connect your Sui wallet first');
      return;
    }

    setIsCreating(true);
    setCreationError(null);

    try {
      console.log('🚀 Starting browser-based dWallet creation with Ika SDK...');
      console.log('👛 Wallet address:', account.address);

      // Step 1: Get network config and initialize Ika Client
      const networkConfig = getNetworkConfig('testnet');
      console.log('📋 Network config:', networkConfig);

      const ikaClient = new IkaClient({
        suiClient: suiClient,
        config: networkConfig,
      });

      console.log('✅ IkaClient initialized for testnet');

      // Step 2: Get IKA and SUI coins
      const packageId = process.env.NEXT_PUBLIC_IKA_PACKAGE_ID || '0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a';
      const ikaCoins = await suiClient.getCoins({
        owner: account.address,
        coinType: `${packageId}::ika::IKA`,
      });

      if (ikaCoins.data.length === 0) {
        throw new Error('No IKA tokens found. Get IKA from https://faucet.ika.xyz/');
      }

      const largestIkaCoin = ikaCoins.data.reduce((prev, current) =>
        (BigInt(current.balance) > BigInt(prev.balance)) ? current : prev
      );

      console.log('💰 IKA coin found:', largestIkaCoin.coinObjectId, 'balance:', largestIkaCoin.balance);

      // Step 3: Determine curve from wallet type
      const curve = walletType === 'ECDSA' ? Curve.SECP256K1 : Curve.ED25519;
      console.log('📐 Using curve:', curve);

      // Step 4: Generate encryption keypair for user share
      // In a real app, this should be derived from user's wallet or stored securely
      // For now, we'll generate a random seed
      const randomSeed = new Uint8Array(32);
      crypto.getRandomValues(randomSeed);

      const userShareEncryptionKeys = await UserShareEncryptionKeys.fromRootSeedKey(
        randomSeed,
        curve
      );

      console.log('🔐 Generated encryption keys for user share');
      console.log('🔑 Encryption key address:', userShareEncryptionKeys.getSuiAddress());

      // Step 5: Create transaction with session identifier
      const tx = new Transaction();
      tx.setGasBudget(100000000); // 0.1 SUI

      const ikaCoin = tx.object(largestIkaCoin.coinObjectId);
      const suiCoin = tx.gas;

      // Register session identifier
      const sessionIdentifierBytes = new TextEncoder().encode(`dwallet-creation-${Date.now()}`);
      const coordinatorObjectRef = tx.sharedObjectRef({
        objectId: networkConfig.objects.ikaDWalletCoordinator.objectID,
        initialSharedVersion: networkConfig.objects.ikaDWalletCoordinator.initialSharedVersion,
        mutable: true,
      });
      const sessionIdentifier = coordinatorTransactions.registerSessionIdentifier(
        networkConfig,
        coordinatorObjectRef,
        sessionIdentifierBytes,
        tx
      );

      console.log('📝 Session identifier registered');

      // Step 6: Create IkaTransaction wrapper
      const ikaTx = new IkaTransaction({
        ikaClient,
        transaction: tx,
        userShareEncryptionKeys,
      });

      // Step 7: Check if user has encryption key registered, if not register it
      console.log('🔍 Checking for existing encryption key...');
      let activeEncryptionKeyId;
      try {
        activeEncryptionKeyId = await ikaClient.getActiveEncryptionKeyId(account.address, curve);
        console.log('✅ Found existing encryption key:', activeEncryptionKeyId);
      } catch (error) {
        console.log('📝 No encryption key found, registering new one...');
        await ikaTx.registerEncryptionKey({ curve });
        // After registering, we need to execute this transaction first before creating dWallet
        console.log('⚠️ Need to register encryption key in a separate transaction first');

        // Sign and execute the encryption key registration transaction
        signAndExecuteTransaction(
          { transaction: tx },
          {
            onSuccess: async (result) => {
              console.log('✅ Encryption key registered successfully!');
              console.log('🔄 Please try creating the dWallet again');
              setCreationError('Encryption key registered. Please click "Create dWallet" again to continue.');
              setIsCreating(false);
            },
            onError: (error) => {
              console.error('❌ Failed to register encryption key:', error);
              setCreationError('Failed to register encryption key: ' + error.message);
              setIsCreating(false);
            },
          }
        );
        return; // Exit early, user needs to try again after key registration
      }

      // Step 8: Prepare DKG (Distributed Key Generation) parameters
      console.log('🔢 Preparing DKG cryptographic parameters...');

      const dkgRequestInput = await prepareDKGAsync(
        ikaClient,
        curve,
        userShareEncryptionKeys,
        sessionIdentifierBytes,
        account.address
      );

      console.log('✅ DKG parameters prepared');

      // Step 9: Request dWallet DKG
      const dwalletResult = await ikaTx.requestDWalletDKG({
        dkgRequestInput,
        ikaCoin,
        suiCoin,
        sessionIdentifier,
        dwalletNetworkEncryptionKeyId: activeEncryptionKeyId,
        curve,
      });

      console.log('🏗️ dWallet DKG transaction built');

      // Step 10: Sign and execute transaction
      console.log('✍️ Requesting signature from user...');

      signAndExecuteTransaction(
        {
          transaction: tx,
        },
        {
          onSuccess: async (result) => {
            console.log('✅ Transaction executed successfully!');
            console.log('📦 Result:', result);

            // Extract dWallet ID from object changes
            let dwalletId = null;
            if (result.objectChanges) {
              for (const change of result.objectChanges) {
                if (change.type === 'created' && change.objectType?.includes('DWalletCap')) {
                  dwalletId = change.objectId;
                  break;
                }
              }
            }

            if (!dwalletId) {
              throw new Error('Could not find created dWallet ID in transaction result');
            }

            console.log('🆔 New dWallet ID:', dwalletId);

            // Create wallet object for UI
            const newWallet = {
              id: dwalletId,
              name: walletName,
              type: walletType,
              curve: curve as any,
              publicKey: 'Loading...',
              createdAt: new Date().toISOString(),
              status: 'ACTIVE' as const,
              compatibleChains: walletType === 'ECDSA'
                ? ['Ethereum', 'Bitcoin', 'Polygon', 'Avalanche']
                : ['Solana', 'Polkadot'],
              balances: [],
            };

            setCreatedWallet(newWallet);
            addWallet(newWallet);
            setStep(4);
            setIsCreating(false);

            console.log('🎉 dWallet created successfully in browser!');
          },
          onError: (error) => {
            console.error('❌ Transaction failed:', error);
            setCreationError(error.message || 'Failed to create dWallet');
            setIsCreating(false);
          },
        }
      );
    } catch (error: any) {
      console.error('❌ dWallet creation error:', error);
      setCreationError(error.message || 'Failed to create dWallet');
      setIsCreating(false);
    }
  };

  const compatibleChains = walletType === 'ECDSA'
    ? ['Bitcoin', 'Ethereum', 'Polygon', 'Avalanche', 'BSC']
    : ['Solana', 'Polkadot', 'Cardano', 'Near', 'Stellar'];

  if (!mounted) {
    return null; // Don't render on server
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-32">
      <div className="max-w-4xl w-full">
        {/* Progress Bar */}
        {step > 0 && (
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
        )}

        <AnimatePresence mode="wait">
          {/* Step 0: Wallet Connection Required */}
          {step === 0 && (
            <motion.div
              key="step0"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="text-center mb-12">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                  className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center"
                >
                  <Wallet className="w-12 h-12 text-white" />
                </motion.div>

                <h1 className="text-5xl md:text-6xl font-black mb-4">
                  Connect Your Wallet
                </h1>
                <p className="text-xl text-zinc-600 dark:text-zinc-400 mb-8">
                  You need to connect your Sui wallet to create a dWallet
                </p>
              </div>

              <div className="max-w-2xl mx-auto">
                <div className="p-8 rounded-3xl bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800">
                  <div className="space-y-6">
                    <div className="flex items-start gap-4 p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50">
                      <Shield className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <h3 className="font-bold text-blue-900 dark:text-blue-100 mb-2">
                          Why connect a wallet?
                        </h3>
                        <ul className="text-sm text-blue-900 dark:text-blue-100 space-y-2">
                          <li>• You control your private keys (not stored on our servers)</li>
                          <li>• Sign dWallet creation transactions yourself</li>
                          <li>• Full security and transparency</li>
                          <li>• Pay for gas fees directly from your wallet</li>
                        </ul>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-2xl bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/50">
                      <AlertCircle className="w-6 h-6 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <h3 className="font-bold text-purple-900 dark:text-purple-100 mb-2">
                          Requirements
                        </h3>
                        <ul className="text-sm text-purple-900 dark:text-purple-100 space-y-2">
                          <li>• Sui Wallet browser extension installed</li>
                          <li>• Some SUI tokens for gas fees</li>
                          <li>• IKA tokens (get from <a href="https://faucet.ika.xyz/" target="_blank" rel="noopener noreferrer" className="underline font-medium">faucet.ika.xyz</a>)</li>
                        </ul>
                      </div>
                    </div>

                    <div className="pt-4 text-center">
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                        Click the &quot;Connect Wallet&quot; button in the top-right corner to continue
                      </p>
                      <motion.div
                        animate={{
                          y: [0, -10, 0],
                        }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }}
                        className="inline-block"
                      >
                        <ArrowRight className="w-8 h-8 text-purple-600 dark:text-purple-400 rotate-[-45deg]" />
                      </motion.div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

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

              {creationError && (
                <div className="max-w-2xl mx-auto mb-6">
                  <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-red-900 dark:text-red-100">
                        <div className="mb-2">
                          <strong>Error:</strong> {creationError}
                        </div>
                        {creationError.includes('IKA tokens') && (
                          <div className="mt-2 p-3 bg-white dark:bg-zinc-800 rounded-lg border border-red-200 dark:border-red-800">
                            <div className="font-medium mb-1">Get IKA tokens:</div>
                            <a
                              href="https://faucet.ika.xyz/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-purple-600 dark:text-purple-400 hover:underline font-medium"
                            >
                              https://faucet.ika.xyz/ →
                            </a>
                            <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                              Connect your wallet and request IKA tokens
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

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
                  disabled={isCreating || !account}
                  className={`px-8 py-4 rounded-full font-bold cursor-hover flex items-center gap-2 ${
                    isCreating || !account
                      ? 'bg-zinc-300 dark:bg-zinc-700 text-zinc-500 cursor-not-allowed'
                      : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                  }`}
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Creating dWallet...
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
