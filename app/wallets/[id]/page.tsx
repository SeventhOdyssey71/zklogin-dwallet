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
  Clock,
  Zap,
  Edit2,
  X
} from 'lucide-react';
import { useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { IkaClient, IkaTransaction, UserShareEncryptionKeys, getNetworkConfig, Curve, prepareDKGAsync } from '@ika.xyz/sdk';
import { dwalletAPI } from '@/lib/api/dwallet';
import { getDWalletById } from '@/lib/api/blockchainDwallet';
import { DWallet } from '@/lib/types/dwallet';
import { BentoCard } from '@/components/ui/BentoCard';
import { deriveChainAddresses } from '@/lib/utils/deriveAddresses';

export default function WalletDetailPage() {
  const params = useParams();
  const router = useRouter();
  const walletId = params.id as string;
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();

  const [wallet, setWallet] = useState<DWallet | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActivating, setIsActivating] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');

  useEffect(() => {
    loadWallet();
  }, [walletId]);

  const loadWallet = async () => {
    setIsLoading(true);
    try {
      console.log('📡 Fetching dWallet from blockchain:', walletId);

      // Fetch from blockchain first
      const blockchainData = await getDWalletById(walletId);

      console.log('🔍 Blockchain state:', blockchainData.state);

      // Determine wallet status based on blockchain state
      // AwaitingKeyHolderSignature needs activation via acceptEncryptedUserShare
      let status: 'ACTIVE' | 'PENDING' | 'INACTIVE' = 'INACTIVE';
      if (blockchainData.state === 'Active') {
        status = 'ACTIVE';
      } else if (
        blockchainData.state === 'AwaitingNetworkDKGVerification' ||
        blockchainData.state === 'AwaitingKeyHolderSignature'
      ) {
        status = 'PENDING';
      }

      // Try to get saved wallet name from localStorage
      const savedName = localStorage.getItem(`dwallet_name_${walletId}`);
      const walletName = savedName || `dWallet ${walletId.substring(0, 8)}...`;

      const compatibleChains = blockchainData.curve === 0
        ? ['Bitcoin', 'Ethereum', 'Polygon', 'Avalanche', 'BSC']
        : ['Solana', 'Polkadot', 'Cardano', 'NEAR'];

      // Generate balances for all compatible chains with wallet addresses
      const publicKey = blockchainData.publicKey || 'pending';
      console.log('🔑 Public key from blockchain:', publicKey);

      // Derive chain-specific addresses from public key
      let chainAddresses: { [chain: string]: string } = {};
      if (publicKey !== 'pending') {
        chainAddresses = deriveChainAddresses(publicKey, blockchainData.curve);
        console.log('📍 Derived addresses:', chainAddresses);
      }

      const balances = compatibleChains.map(chain => {
        const symbols: { [key: string]: string } = {
          'Bitcoin': 'BTC',
          'Ethereum': 'ETH',
          'Polygon': 'MATIC',
          'Avalanche': 'AVAX',
          'BSC': 'BNB',
          'Solana': 'SOL',
          'Polkadot': 'DOT',
          'Cardano': 'ADA',
          'NEAR': 'NEAR'
        };

        const address = chainAddresses[chain] || 'Activate wallet to view address';

        return {
          chain,
          symbol: symbols[chain] || chain,
          balance: '0',
          usdValue: 0,
          address
        };
      });

      const walletData: DWallet = {
        id: walletId,
        name: walletName,
        type: blockchainData.curve === 0 ? 'ECDSA' : 'EdDSA',
        curve: blockchainData.curve === 0 ? 'SECP256K1' : 'ED25519',
        publicKey: publicKey,
        status,
        compatibleChains,
        balances,
        createdAt: blockchainData.createdAt || new Date().toISOString(),
      };

      setWallet(walletData);
      setEditedName(walletName);

      if (walletData.compatibleChains.length > 0) {
        setSelectedChain(walletData.compatibleChains[0]);
      }
    } catch (error) {
      console.error('Failed to load wallet from blockchain:', error);

      // Fallback to API
      try {
        const data = await dwalletAPI.getDWallet(walletId);
        if (data) {
          setWallet(data);
          setEditedName(data.name);
          if (data?.balances.length) {
            setSelectedChain(data.balances[0].chain);
          }
        }
      } catch (apiError) {
        console.error('Fallback API also failed:', apiError);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveName = () => {
    if (!editedName.trim()) return;

    localStorage.setItem(`dwallet_name_${walletId}`, editedName);
    setWallet(prev => prev ? { ...prev, name: editedName } : null);
    setIsEditingName(false);
    console.log('💾 Wallet name updated:', editedName);
  };

  const handleActivate = async () => {
    if (!account || !wallet) return;

    setIsActivating(true);
    setActivationError(null);

    try {
      console.log('🔄 Activating dWallet:', walletId);

      // Initialize IkaClient
      const networkConfig = getNetworkConfig('testnet');
      const ikaClient = new IkaClient({
        suiClient,
        config: networkConfig,
      });
      await ikaClient.initialize();

      // Get full dWallet details from blockchain and wait for correct state
      let dWallet = await ikaClient.getDWallet(walletId);
      console.log('📦 Initial dWallet state:', dWallet.state.$kind);

      // If wallet is still in AwaitingNetworkDKGVerification, poll until it reaches AwaitingKeyHolderSignature
      if (dWallet.state.$kind === 'AwaitingNetworkDKGVerification') {
        console.log('⏳ dWallet is still being processed by the network, polling for completion...');
        let attempts = 0;
        const maxAttempts = 30; // 30 attempts * 2 seconds = 1 minute max wait

        while (dWallet.state.$kind === 'AwaitingNetworkDKGVerification' && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
          dWallet = await ikaClient.getDWallet(walletId);
          attempts++;
          console.log(`⏳ Attempt ${attempts}/${maxAttempts}: State is ${dWallet.state.$kind}`);
        }

        if (dWallet.state.$kind === 'AwaitingNetworkDKGVerification') {
          throw new Error('Network DKG verification is taking longer than expected. Please try activating again in a few moments.');
        }

        console.log('✅ Network DKG verification complete!');
      }

      // Check if dWallet is in the correct state for activation
      const stateKind = dWallet.state.$kind;
      console.log('📋 Final dWallet state:', stateKind);
      console.log('📋 Full dWallet state:', JSON.stringify(dWallet.state, null, 2));

      if (stateKind !== 'AwaitingKeyHolderSignature') {
        throw new Error(`This dWallet is in "${stateKind}" state. Activation is only for wallets in "AwaitingKeyHolderSignature" state.`);
      }

      // Get encrypted user secret key share ID from the dWallet's encrypted_user_secret_key_shares table
      const encryptedSharesTable = (dWallet as any).encrypted_user_secret_key_shares;
      if (!encryptedSharesTable || encryptedSharesTable.size === '0') {
        throw new Error('No encrypted user secret key shares found in dWallet');
      }

      // The share ID is in the table, we need to query it
      const encryptedShareTableId = encryptedSharesTable.id.id;
      console.log('📦 Encrypted shares table ID:', encryptedShareTableId);

      // Get the first encrypted share from the table
      // We need to query the Sui dynamic field to get the actual share ID
      const dynamicFields = await suiClient.getDynamicFields({
        parentId: encryptedShareTableId,
      });

      console.log('🔍 Dynamic fields:', dynamicFields);

      if (!dynamicFields.data || dynamicFields.data.length === 0) {
        throw new Error('No encrypted user secret key shares found in table');
      }

      // Get the first share's object ID
      const firstShareObjectId = dynamicFields.data[0].objectId;
      console.log('🔑 First encrypted share object ID:', firstShareObjectId);

      // Get the encrypted share object
      const encryptedShareObject = await suiClient.getObject({
        id: firstShareObjectId,
        options: { showContent: true },
      });

      console.log('📋 Encrypted share object:', JSON.stringify(encryptedShareObject, null, 2));

      // Extract the share ID from the object content
      const shareContent = encryptedShareObject.data?.content as any;
      console.log('🔍 Share content type:', shareContent?.dataType);
      console.log('🔍 Share content fields:', shareContent?.fields);

      // Try multiple paths to find the ID
      let encryptedUserSecretKeyShareId =
        shareContent?.fields?.value?.fields?.id?.id ||
        shareContent?.fields?.value?.id?.id ||
        shareContent?.fields?.id?.id ||
        shareContent?.fields?.name; // Dynamic field key might be the ID

      // If the name field is the encryption key address, the value might contain the share ID
      if (!encryptedUserSecretKeyShareId && shareContent?.fields?.value) {
        const valueFields = shareContent.fields.value.fields || shareContent.fields.value;
        console.log('🔍 Value fields:', JSON.stringify(valueFields, null, 2));

        // The share ID might be the object ID itself
        encryptedUserSecretKeyShareId = firstShareObjectId;
      }

      if (!encryptedUserSecretKeyShareId) {
        console.error('❌ Could not find share ID. Content structure:', shareContent);
        throw new Error('Could not extract encrypted user secret key share ID from object. Check console for structure.');
      }

      console.log('✅ Encrypted user secret key share ID:', encryptedUserSecretKeyShareId);

      // Retrieve session identifier from localStorage to regenerate USER's original DKG output
      const sessionIdentifierKey = `dwallet_session_${walletId}`;
      const sessionIdentifierJSON = localStorage.getItem(sessionIdentifierKey);

      if (!sessionIdentifierJSON) {
        throw new Error('Session identifier not found. This dWallet was created in a different browser session. Activation must be done immediately after creation.');
      }

      const sessionIdentifierArray = JSON.parse(sessionIdentifierJSON);
      const sessionIdentifierBytes = new Uint8Array(sessionIdentifierArray);
      console.log('📝 Retrieved session identifier from localStorage');

      // Recreate UserShareEncryptionKeys using the saved encryption seed from creation
      const curve = dWallet.curve === 0 ? Curve.SECP256K1 : Curve.ED25519;

      // Retrieve encryption seed from localStorage
      const encryptionSeedKey = `dwallet_encryption_seed_${walletId}`;
      const encryptionSeedJSON = localStorage.getItem(encryptionSeedKey);

      if (!encryptionSeedJSON) {
        throw new Error('Encryption seed not found. This dWallet was created in a different browser session. Activation must be done immediately after creation.');
      }

      const encryptionSeedArray = JSON.parse(encryptionSeedJSON);
      const encryptionSeed = new Uint8Array(encryptionSeedArray);
      console.log('🔐 Recreating encryption keys from saved seed');

      const userShareEncryptionKeys = await UserShareEncryptionKeys.fromRootSeedKey(encryptionSeed, curve);

      console.log('🔑 Recreated encryption key address:', userShareEncryptionKeys.getSuiAddress());

      // Regenerate USER's original DKG output (not the combined blockchain output)
      console.log('🔐 Regenerating USER public output with session identifier...');
      const dkgInput = await prepareDKGAsync(
        ikaClient,
        curve,
        userShareEncryptionKeys,
        sessionIdentifierBytes,
        account.address
      );

      const userPublicOutputBytes = dkgInput.userPublicOutput;
      console.log('✅ USER public output regenerated, length:', userPublicOutputBytes.length);
      console.log('🔑 USER output (first 20 bytes):', Array.from(userPublicOutputBytes.slice(0, 20)));

      // Also log the blockchain's combined output for comparison
      const blockchainOutput = (dWallet.state as any)[stateKind]?.public_output;
      if (blockchainOutput) {
        console.log('🌐 Blockchain combined output length:', blockchainOutput.length);
        console.log('🌐 Blockchain output (first 20 bytes):', Array.from(blockchainOutput.slice(0, 20)));
      }

      // Create transaction
      const tx = new Transaction();
      const ikaTx = new IkaTransaction({
        ikaClient,
        transaction: tx,
        userShareEncryptionKeys,
      });

      // Call acceptEncryptedUserShare
      console.log('📝 Accepting encrypted user share...');
      console.log('🔍 dWallet curve:', dWallet.curve);
      console.log('🔍 dWallet state kind:', dWallet.state.$kind);
      console.log('🔍 Encrypted share ID:', encryptedUserSecretKeyShareId);
      console.log('🔍 User public output length:', userPublicOutputBytes.length);

      await ikaTx.acceptEncryptedUserShare({
        dWallet: { ...dWallet, kind: 'zero-trust' } as any,
        userPublicOutput: userPublicOutputBytes,
        encryptedUserSecretKeyShareId,
      });

      tx.setGasBudget(50000000);

      // Sign and execute transaction
      console.log('✍️ Signing transaction...');
      signAndExecuteTransaction(
        {
          transaction: tx,
        },
        {
          onSuccess: async (result) => {
            console.log('📜 Transaction submitted:', result.digest);

            // Wait a moment for blockchain to index
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Fetch transaction details to check if it actually succeeded
            try {
              const txDetails = await suiClient.getTransactionBlock({
                digest: result.digest,
                options: {
                  showEffects: true,
                },
              });

              const status = txDetails.effects?.status?.status;

              if (status !== 'success') {
                console.error('❌ Transaction failed on-chain:', txDetails.effects?.status);
                const error = txDetails.effects?.status?.error || 'Transaction failed on-chain';
                setActivationError(error);
                setIsActivating(false);
                return;
              }

              console.log('✅ Activation transaction successful!');

              // Reload wallet to show updated state
              await loadWallet();

              setIsActivating(false);
            } catch (error: any) {
              console.error('❌ Error checking transaction status:', error);
              setActivationError(error.message || 'Failed to verify transaction');
              setIsActivating(false);
            }
          },
          onError: (error) => {
            console.error('❌ Activation failed:', error);
            setActivationError(error.message || 'Failed to activate dWallet');
            setIsActivating(false);
          },
        }
      );
    } catch (error: any) {
      console.error('❌ Activation error:', error);
      setActivationError(error.message || 'Failed to activate dWallet');
      setIsActivating(false);
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
                <div className="flex items-center gap-3 mb-2">
                  {isEditingName ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editedName}
                        onChange={(e) => setEditedName(e.target.value)}
                        className="text-5xl md:text-6xl font-black bg-transparent border-b-2 border-purple-500 focus:outline-none"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveName();
                          if (e.key === 'Escape') setIsEditingName(false);
                        }}
                      />
                      <button
                        onClick={handleSaveName}
                        className="p-2 rounded-lg bg-green-500 hover:bg-green-600 text-white"
                      >
                        <Check className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => {
                          setIsEditingName(false);
                          setEditedName(wallet.name);
                        }}
                        className="p-2 rounded-lg bg-zinc-500 hover:bg-zinc-600 text-white"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <h1 className="text-5xl md:text-6xl font-black">{wallet.name}</h1>
                      <button
                        onClick={() => setIsEditingName(true)}
                        className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        title="Edit wallet name"
                      >
                        <Edit2 className="w-5 h-5" />
                      </button>
                    </>
                  )}
                </div>
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

                  {/* Activate Button - Show only when wallet is PENDING (AwaitingNetworkDKGVerification) */}
                  {wallet.status === 'PENDING' && account && (
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={handleActivate}
                      disabled={isActivating}
                      className={`px-4 py-2 rounded-full font-bold cursor-hover flex items-center gap-2 ${
                        isActivating
                          ? 'bg-zinc-300 dark:bg-zinc-700 text-zinc-500 cursor-not-allowed'
                          : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                      }`}
                    >
                      {isActivating ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Activating...
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4" />
                          Activate dWallet
                        </>
                      )}
                    </motion.button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>

          {/* Activation Error Message */}
          {activationError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 p-4 rounded-2xl bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800"
            >
              <p className="text-red-600 dark:text-red-400 font-medium">
                ❌ Activation Failed: {activationError}
              </p>
            </motion.div>
          )}

          {/* Prominent Activation Section - Only for AwaitingNetworkDKGVerification */}
          {wallet.status === 'PENDING' && account && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="mt-6"
            >
              <BentoCard className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 border-2 border-purple-200 dark:border-purple-800">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-5 h-5 text-purple-600" />
                      <h3 className="text-lg font-bold">Activation Required</h3>
                    </div>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      Your dWallet has been created but needs to be activated. Click the button to complete the setup and start using your dWallet.
                    </p>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleActivate}
                    disabled={isActivating}
                    className={`ml-4 px-6 py-3 rounded-full font-bold cursor-hover flex items-center gap-2 ${
                      isActivating
                        ? 'bg-zinc-300 dark:bg-zinc-700 text-zinc-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg'
                    }`}
                  >
                    {isActivating ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Activating...
                      </>
                    ) : (
                      <>
                        <Zap className="w-5 h-5" />
                        Activate Now
                      </>
                    )}
                  </motion.button>
                </div>
              </BentoCard>
            </motion.div>
          )}

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
                    onClick={() => setSelectedChain(balance.chain)}
                    className="cursor-pointer"
                  >
                    <BentoCard
                      className={`${
                        selectedChain === balance.chain ? 'ring-2 ring-purple-500' : ''
                      }`}
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
