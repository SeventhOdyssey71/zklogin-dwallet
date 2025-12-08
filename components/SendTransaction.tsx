'use client';

import React, { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { signWithDWallet, broadcastTransaction } from '@/lib/dwallet/clientSideSigning';
import { toast } from 'sonner';

interface SendTransactionProps {
  chain: string;
  symbol: string;
  address: string;
  balance: string;
  dwalletId: string;
  dwalletCapId: string;
  encryptedShareId: string;
  onTransactionComplete?: () => void;
}

export function SendTransaction({
  chain,
  symbol,
  address: _address,
  balance,
  dwalletId,
  dwalletCapId,
  encryptedShareId,
  onTransactionComplete
}: SendTransactionProps) {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const isValidAddress = (addr: string, chainName: string): boolean => {
    if (!addr) return false;

    switch (chainName) {
      case 'Bitcoin':
        // Bitcoin testnet addresses start with m, n, or tb1
        return /^[mn2][a-km-zA-HJ-NP-Z1-9]{25,34}$|^tb1[a-z0-9]{39,59}$/.test(addr);
      case 'Ethereum':
      case 'Polygon':
      case 'Avalanche':
      case 'BSC':
        return /^0x[a-fA-F0-9]{40}$/.test(addr);
      case 'Solana':
        return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
      case 'Polkadot':
        return /^[1-9A-HJ-NP-Za-km-z]{47,48}$/.test(addr);
      case 'Cardano':
        return /^addr_test1[a-z0-9]{53,}$/.test(addr);
      case 'NEAR':
        return /^[a-z0-9]{64}\.near$/.test(addr);
      default:
        return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setError(null);
    setSuccess(null);

    // Validation
    if (!recipient.trim()) {
      setError('Please enter a recipient address');
      return;
    }

    if (!isValidAddress(recipient, chain)) {
      setError(`Invalid ${chain} address format`);
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (parseFloat(amount) > parseFloat(balance)) {
      setError('Insufficient balance');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);
    setStatusMessage('');

    try {
      // Check if user has Sui wallet connected
      if (!account) {
        throw new Error('Please connect your Sui wallet first');
      }

      console.log('🚀 Starting client-side transaction signing...');
      console.log('   Chain:', chain);
      console.log('   Recipient:', recipient);
      console.log('   Amount:', amount);

      setStatusMessage('Initializing dWallet signing...');

      // Sign transaction using dWallet 2PC-MPC protocol
      const signedTx = await signWithDWallet({
        dwalletId,
        dwalletCapId,
        encryptedShareId,
        chain,
        recipient,
        amount,
        memo,
        suiClient,
        userAccount: account,
        signAndExecuteTransaction: (params: any) => {
          return new Promise((resolve, reject) => {
            signAndExecuteTransaction(params, {
              onSuccess: (result: any) => resolve(result),
              onError: (error: any) => reject(error),
            });
          });
        },
      });

      console.log('✅ Transaction signed:', signedTx.hash);
      setStatusMessage('Broadcasting transaction...');

      // Broadcast to blockchain
      const broadcastResult = await broadcastTransaction(chain, signedTx.serialized!);

      console.log('✅ Transaction broadcasted:', broadcastResult.txHash);

      // Show success toast
      toast.success('Transaction sent successfully!', {
        description: `Hash: ${broadcastResult.txHash.substring(0, 20)}...`,
        duration: 5000,
      });

      setSuccess(`Transaction sent successfully! Hash: ${broadcastResult.txHash.substring(0, 20)}...`);
      setRecipient('');
      setAmount('');
      setMemo('');
      setStatusMessage('');

      if (onTransactionComplete) {
        onTransactionComplete();
      }

    } catch (err: any) {
      console.error('❌ Transaction failed:', err);

      // Show error toast
      toast.error('Transaction failed', {
        description: err.message || 'An error occurred',
        duration: 5000,
      });

      setError(err.message || 'Transaction failed');
      setStatusMessage('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center gap-2 mb-6">
        <Send className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold">Send {symbol}</h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Recipient Address */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Recipient Address
          </label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={`Enter ${chain} address...`}
            className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            disabled={isLoading}
          />
        </div>

        {/* Amount */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm font-medium">Amount</label>
            <span className="text-xs text-muted-foreground">
              Balance: {balance} {symbol}
            </span>
          </div>
          <div className="relative">
            <input
              type="number"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary pr-16"
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={() => setAmount(balance)}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors"
              disabled={isLoading}
            >
              MAX
            </button>
          </div>
        </div>

        {/* Memo (Optional) */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Memo <span className="text-xs text-muted-foreground">(Optional)</span>
          </label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Add a note..."
            className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            disabled={isLoading}
            maxLength={100}
          />
        </div>

        {/* Status Message */}
        {statusMessage && (
          <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <p className="text-sm text-blue-500 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {statusMessage}
            </p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <p className="text-sm text-green-500">{success}</p>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading || !recipient || !amount}
          className="w-full px-4 py-3 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Send Transaction
            </>
          )}
        </button>
      </form>
    </div>
  );
}
