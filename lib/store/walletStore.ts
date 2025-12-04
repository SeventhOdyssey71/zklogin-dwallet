import { create } from 'zustand';
import { DWallet } from '../types/dwallet';

interface WalletState {
  // State
  wallets: DWallet[];
  selectedWallet: DWallet | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setWallets: (wallets: DWallet[]) => void;
  addWallet: (wallet: DWallet) => void;
  removeWallet: (walletId: string) => void;
  selectWallet: (wallet: DWallet | null) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  // Initial state
  wallets: [],
  selectedWallet: null,
  isLoading: false,
  error: null,

  // Actions
  setWallets: (wallets) => set({ wallets }),

  addWallet: (wallet) => set((state) => ({
    wallets: [wallet, ...state.wallets]
  })),

  removeWallet: (walletId) => set((state) => ({
    wallets: state.wallets.filter(w => w.id !== walletId),
    selectedWallet: state.selectedWallet?.id === walletId ? null : state.selectedWallet
  })),

  selectWallet: (wallet) => set({ selectedWallet: wallet }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  clearError: () => set({ error: null }),
}));
