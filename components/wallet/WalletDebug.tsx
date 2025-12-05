'use client';

import { useWallets, useCurrentAccount, useConnectWallet } from '@mysten/dapp-kit';
import { useState, useEffect } from 'react';

export function WalletDebug() {
  const wallets = useWallets();
  const account = useCurrentAccount();
  const { mutate: connect } = useConnectWallet();
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null; // Don't render on server
  }

  const handleConnect = (walletName: string) => {
    setError(null);
    try {
      connect(
        { wallet: wallets.find(w => w.name === walletName)! },
        {
          onError: (err) => {
            setError(err.message);
            console.error('Connection error:', err);
          },
          onSuccess: () => {
            console.log('Successfully connected!');
          }
        }
      );
    } catch (err: any) {
      setError(err.message);
      console.error('Connect error:', err);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 bg-zinc-900 text-white p-4 rounded-lg border border-zinc-700 max-w-md z-50">
      <h3 className="font-bold mb-2">Wallet Debug Info</h3>

      <div className="space-y-2 text-sm">
        <div>
          <strong>Detected Wallets:</strong> {wallets.length}
        </div>

        {wallets.length === 0 && (
          <div className="text-yellow-400">
            ⚠️ No wallets detected! Install Sui Wallet extension.
          </div>
        )}

        {wallets.map((wallet) => (
          <div key={wallet.name} className="border border-zinc-700 p-2 rounded">
            <div className="font-medium">{wallet.name}</div>
            <button
              onClick={() => handleConnect(wallet.name)}
              className="mt-1 px-2 py-1 bg-purple-600 rounded text-xs hover:bg-purple-700"
            >
              Connect to {wallet.name}
            </button>
          </div>
        ))}

        {account && (
          <div className="border border-green-700 p-2 rounded bg-green-900/20">
            <div className="text-green-400">✅ Connected!</div>
            <div className="text-xs font-mono break-all mt-1">
              {account.address}
            </div>
          </div>
        )}

        {error && (
          <div className="border border-red-700 p-2 rounded bg-red-900/20">
            <div className="text-red-400">❌ Error:</div>
            <div className="text-xs mt-1">{error}</div>
          </div>
        )}
      </div>
    </div>
  );
}
