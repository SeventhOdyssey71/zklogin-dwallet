# Client-Side Signing Architecture for dWallet Frontend

## Problem Statement

**Current Issue**: Backend holds deterministic Sui keypair (security risk)
**Goal**: User controls all signing operations with their own Sui wallet

## Two Types of Keys to Understand

### 1. Sui Wallet Private Key (USER MUST CONTROL)
- Used to create dWallets on Sui blockchain
- Used to pay gas fees (SUI + IKA tokens)
- Signs Sui transactions for dWallet operations
- **NEVER goes to server** ✅

### 2. dWallet Key Shares (2PC-MPC Protocol)
- Distributed between user and Ika coordinator
- No single party has full private key
- Used to sign blockchain transactions (ETH, BTC, etc.)
- **Secure by design** ✅

## Recommended Architecture

### Phase 1: User-Controlled dWallet Creation (PRIORITY)

```
┌─────────────────────────────────────────┐
│     Browser (dwallet-frontend)          │
│  ┌───────────────────────────────────┐  │
│  │  User's Sui Wallet (Extension)    │  │
│  │  - Owns private key               │  │
│  │  - Signs all Sui transactions     │  │
│  └───────────────────────────────────┘  │
│             ↓ Signs                     │
│  ┌───────────────────────────────────┐  │
│  │  dWallet Creation Flow            │  │
│  │  1. Connect Sui wallet            │  │
│  │  2. User signs DKG transaction    │  │
│  │  3. User signs activation tx      │  │
│  │  4. dWallet created!              │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**Implementation**:
- ✅ Install @mysten/dapp-kit (DONE)
- ⏳ Create `<SuiWalletProvider>` wrapper
- ⏳ Add "Connect Wallet" button
- ⏳ Implement dWallet creation UI with signing

**Result**: User creates dWallets with their own Sui wallet (no server key exposure)

### Phase 2: Client-Side Transaction Signing (ADVANCED)

```
┌─────────────────────────────────────────┐
│     Browser (dwallet-frontend)          │
│  ┌───────────────────────────────────┐  │
│  │  Ika SDK (Browser Build)          │  │
│  │  - IkaClient                       │  │
│  │  - IkaTransaction                  │  │
│  │  - Presign workflow               │  │
│  └───────────────────────────────────┘  │
│             ↓                           │
│  ┌───────────────────────────────────┐  │
│  │  Sign Blockchain Transactions      │  │
│  │  1. User initiates ETH/BTC tx     │  │
│  │  2. Create presign (Sui tx)       │  │
│  │  3. Execute signing (Sui tx)      │  │
│  │  4. Apply signature to ETH/BTC    │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**Challenges**:
- ❌ Ika SDK uses Node.js modules (crypto, fs, etc.)
- ❌ Need browser-compatible build
- ❌ Complex presign polling workflow
- ⚠️  Requires significant Ika SDK modifications

**Alternative** (Hybrid Approach):
```
Frontend: User signs Sui transactions (presign, signing)
Backend: Polls for completion, applies signatures
```

## Recommended Implementation Plan

### Step 1: Sui Wallet Integration (THIS WEEK)

1. **Install Dependencies** ✅
   ```bash
   npm install @mysten/dapp-kit @tanstack/react-query
   ```

2. **Create Wallet Provider**
   ```typescript
   // lib/providers/SuiWalletProvider.tsx
   import { SuiClientProvider, WalletProvider } from '@mysten/dapp-kit'
   import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
   import { getFullnodeUrl } from '@mysten/sui/client'

   const networks = {
     testnet: { url: getFullnodeUrl('testnet') }
   }

   export function SuiProvider({ children }) {
     return (
       <QueryClientProvider client={queryClient}>
         <SuiClientProvider networks={networks} defaultNetwork="testnet">
           <WalletProvider>
             {children}
           </WalletProvider>
         </SuiClientProvider>
       </QueryClientProvider>
     )
   }
   ```

3. **Add Connect Button**
   ```typescript
   // components/WalletConnect.tsx
   import { ConnectButton, useCurrentAccount } from '@mysten/dapp-kit'

   export function WalletConnect() {
     const account = useCurrentAccount()

     return (
       <div>
         <ConnectButton />
         {account && <p>Connected: {account.address}</p>}
       </div>
     )
   }
   ```

4. **Implement dWallet Creation**
   ```typescript
   // lib/dwallet/create.ts
   import { useSignAndExecuteTransaction } from '@mysten/dapp-kit'
   import { Transaction } from '@mysten/sui/transactions'

   export function useCreateDWallet() {
     const { mutate: signAndExecute } = useSignAndExecuteTransaction()

     async function createDWallet(curve: 'SECP256K1' | 'ED25519') {
       const tx = new Transaction()
       // Build DKG transaction
       // User signs it
       signAndExecute({ transaction: tx })
     }

     return { createDWallet }
   }
   ```

### Step 2: Backend Security Update (THIS WEEK)

1. **Remove Deterministic Keypair**
   - Delete hardcoded seed from backend
   - Backend should NEVER hold Sui private keys

2. **Add User dWallet Loading**
   ```typescript
   // Backend: Load user's dWallet by ID (no signing)
   GET /api/dwallet/:walletId/info
   GET /api/dwallet/:walletId/balance/:chain
   ```

3. **Keep Read-Only Operations**
   ```typescript
   // These are safe (no signing)
   GET /api/balance/:chain/:address
   GET /api/history/:chain/:address
   GET /api/chains
   POST /api/estimate/:chain
   ```

### Step 3: Hybrid Signing (NEXT PHASE)

**For now**: Keep blockchain transaction signing on backend
**Why**: Complex presign workflow, Ika SDK browser compatibility issues
**Security**: 2PC-MPC means no single private key exposure

**Future**: Full client-side signing when Ika SDK browser build is available

## Current Status

### ✅ Completed
- Installed @mysten/dapp-kit
- Installed @tanstack/react-query
- Documented architecture
- Analyzed cross-chain-wallet implementation

### ⏳ In Progress
- Setting up Sui wallet provider
- Creating wallet connection UI

### 📋 Todo
1. Add SuiWalletProvider to app layout
2. Create ConnectWallet component
3. Implement client-side dWallet creation
4. Update backend to remove hardcoded keypair
5. Test user-controlled dWallet creation
6. (Future) Full client-side signing with Ika SDK browser build

## Security Principles

✅ **User Controls Sui Wallet**: Never send private key to server
✅ **2PC-MPC for dWallet**: Distributed key shares (secure by design)
✅ **User Signs All Sui Transactions**: DKG, presign, signing operations
⚠️  **Hybrid for Blockchain Signing**: Initially server-assisted, migrate to full client-side later

## Files to Create

1. `lib/providers/SuiWalletProvider.tsx` - Sui wallet context
2. `components/wallet/ConnectWallet.tsx` - Connection UI
3. `lib/dwallet/create.ts` - dWallet creation hooks
4. `lib/dwallet/sign.ts` - Transaction signing hooks (future)
5. Update `app/layout.tsx` - Wrap with providers

## Next Steps

Ready to implement Phase 1 (Sui Wallet Integration). Shall I proceed?
