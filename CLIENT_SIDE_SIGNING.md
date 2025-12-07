# Client-Side dWallet Transaction Signing

## Overview

Your dWallet frontend now supports **100% client-side transaction signing** using the Ika SDK's 2PC-MPC protocol. No backend server required!

## What You Just Built

### Architecture

```
User Browser
    ├─ Next.js Frontend
    ├─ Sui Wallet (connected via @mysten/dapp-kit)
    ├─ Ika SDK (@ika.xyz/sdk)
    └─ dWallet 2PC-MPC Protocol
        ├─ User's Encrypted Share (on Sui blockchain)
        ├─ Network Validators' Shares (distributed)
        └─ MPC Signature Computation (no full private key exposed)
```

### Flow

1. **User clicks "Send"** button in wallet UI
2. **Sui wallet prompts appear** (2 transactions):
   - Transaction 1: Create presign capability
   - Transaction 2: Request signature
3. **MPC computation happens** across Ika network validators
4. **Signature returned** to browser
5. **Transaction broadcasted** to target blockchain (Ethereum, Polygon, etc.)

## How It Works

### dWallet Types

There are two main types of dWallets, which require different signing methods:

1. **Regular (DKG) dWallets** - Created through Distributed Key Generation
   - Kind: `"zero-trust"` or `"shared"`
   - Uses `requestGlobalPresign()` for presigning
   - Uses `approveMessage()` and `requestSign()` for signing
   - Most common type for new dWallets

2. **Imported-Key dWallets** - Created by importing an existing private key
   - Kind: `"imported-key"` or `"imported-shared"`
   - Uses `requestPresign()` for ECDSA presigning
   - Uses `approveImportedKeyMessage()` and `requestSignWithImportedKey()` for signing
   - For users migrating existing keys

The client-side signing implementation automatically detects the dWallet type and uses the correct methods.

### File Structure

```
lib/
  dwallet/
    clientSideSigning.ts          # Core signing logic

components/
  SendTransaction.tsx              # UI component with signing integration

app/wallets/[id]/
  page.tsx                         # Wallet detail page passing dWallet data
```

### Key Functions

#### `signWithDWallet()`
**Location:** `/lib/dwallet/clientSideSigning.ts`

Main signing orchestrator that:
1. Initializes IkaClient and UserShareEncryptionKeys
2. Builds unsigned transaction for target chain
3. **Detects dWallet type** (imported-key vs regular DKG)
4. Creates presign capability using appropriate method:
   - `requestPresign()` for imported-key dWallets with ECDSA
   - `requestGlobalPresign()` for regular DKG dWallets
5. Requests signature using appropriate method:
   - `requestSignWithImportedKey()` for imported-key dWallets
   - `requestSign()` for regular DKG dWallets
6. Polls for signature completion
7. Returns signed transaction

#### `broadcastTransaction()`
Broadcasts the signed transaction to the target blockchain using ethers.js.

### User Experience

**What the user sees:**
1. Fill out form (recipient, amount, memo)
2. Click "Send Transaction"
3. **Sui wallet popup**: "Approve presign transaction" → User approves
4. Status: "Waiting for presign to complete..."
5. **Sui wallet popup**: "Approve sign transaction" → User approves
6. Status: "Waiting for signature to complete..."
7. Status: "Broadcasting transaction..."
8. Success: "Transaction sent successfully! Hash: 0x..."

## Security Model

### What's Stored Where

| Data | Location | Security |
|------|----------|----------|
| **dWallet ID** | Public (Sui blockchain) | ✅ Public info |
| **dWallet Cap ID** | Public (Sui blockchain) | ✅ Public capability object |
| **User's Encrypted Share** | Sui blockchain | 🔐 Encrypted with user's keys |
| **Encryption Keys** | Generated client-side from seed | 🔐 Never leaves browser |
| **Network Shares** | Distributed across validators | 🔐 No single validator has full key |
| **Full Private Key** | **NOWHERE** | ✅ Never exists as single entity |

### Critical Security Points

1. **Encryption Seed**: Currently hardcoded (`'ika-ultimate-encryption-2024'`)
   - ⚠️ **PRODUCTION TODO**: Replace with wallet-derived seed
   - Best practice: Sign a message with Sui wallet and use signature as seed

2. **User Share Encryption Keys**: Generated from seed
   - Used to decrypt user's share from blockchain
   - Never sent to server
   - Ephemeral (regenerated each session)

3. **MPC Protocol**: 2PC-MPC ensures:
   - User holds 1 encrypted share
   - Network holds distributed shares
   - Signing requires cooperation
   - No single party can sign alone

## Supported Chains

### Currently Implemented
- ✅ Ethereum (Sepolia testnet)
- ✅ Polygon (Amoy testnet)
- ✅ Avalanche (Fuji testnet)
- ✅ BSC (Testnet)

### TODO
- ⏳ Bitcoin
- ⏳ Solana
- ⏳ Polkadot
- ⏳ Cardano
- ⏳ NEAR

## Requirements

### For Users

1. **Sui Wallet** with testnet SUI (for gas fees on Sui transactions)
2. **IKA Tokens** (for dWallet signing operation fees)
3. **Native tokens** on target chain (for gas fees: ETH, MATIC, AVAX, BNB)

### For Developers

**Dependencies** (already installed):
```json
{
  "@ika.xyz/sdk": "^0.2.3",
  "@ika.xyz/ika-wasm": "^0.2.1",
  "@mysten/dapp-kit": "^0.19.11",
  "ethers": "^6.16.0"
}
```

## Testing

### Prerequisites
1. Connect Sui wallet (testnet)
2. Acquire testnet IKA tokens (from faucet or testnet)
3. Activate your dWallet (if pending)
4. Get some testnet tokens on target chain (e.g., Sepolia ETH from faucet)

### Test Flow
1. Navigate to wallet detail page
2. Select a chain with balance
3. Click "Send" button
4. Enter recipient address (must be valid for selected chain)
5. Enter amount
6. Click "Send Transaction"
7. Approve presign transaction in Sui wallet
8. Wait for presign completion
9. Approve sign transaction in Sui wallet
10. Wait for signature
11. Transaction broadcasts automatically
12. Check block explorer for confirmation

## Known Limitations

### 1. Hardcoded Encryption Seed
**Issue**: Using deterministic seed instead of wallet-derived
**Impact**: Anyone with the seed can decrypt your share
**Fix**: Implement wallet signature-based seed derivation

**Example Implementation:**
```typescript
// In production, do this:
const messageToSign = `Unlock dWallet\nTimestamp: ${Date.now()}`;
const signatureResponse = await signMessage({ message: messageToSign });
const encryptionSeed = new TextEncoder().encode(signatureResponse.signature);
```

### 2. Event Parsing
**Issue**: Manual parsing of Sui event data
**Impact**: May break if SDK changes event structure
**Fix**: Use official SDK event parsers (when available)

### 3. Gas Estimation
**Issue**: Using fixed gas limit (21000) for EVM transactions
**Impact**: Complex contract calls will fail
**Fix**: Implement proper gas estimation per transaction type

### 4. Limited Chain Support
**Issue**: Only EVM chains implemented
**Impact**: Can't send Bitcoin, Solana, etc.
**Fix**: Implement chain-specific transaction builders

## Production Checklist

Before deploying to mainnet:

- [ ] Replace hardcoded encryption seed with wallet signature
- [ ] Implement proper error handling for all edge cases
- [ ] Add transaction confirmation UI
- [ ] Implement gas price estimation
- [ ] Add support for ERC-20 tokens
- [ ] Implement Bitcoin UTXO transaction building
- [ ] Implement Solana transaction building
- [ ] Add transaction history persistence
- [ ] Implement proper event parsing with SDK
- [ ] Add comprehensive logging
- [ ] Implement retry logic for failed transactions
- [ ] Add transaction status tracking
- [ ] Test on mainnet with small amounts first!

## Troubleshooting

### "No IKA tokens available for signing"
**Solution**: Acquire IKA tokens from faucet or purchase from exchange

### "Please connect your Sui wallet first"
**Solution**: Click "Connect Wallet" button and approve connection

### "Invalid [chain] address format"
**Solution**: Ensure recipient address matches the selected chain format

### "Presign event not found"
**Solution**: Check Sui transaction succeeded. May need to update event parsing logic.

### "Insufficient balance"
**Solution**: Need testnet tokens on target chain (ETH, MATIC, AVAX, etc.)

## Advanced: How 2PC-MPC Works

### The Math (Simplified)

1. **Key Generation (DKG)**:
   ```
   Private Key = Share_User + Share_Network₁ + Share_Network₂ + ...
   (Never computed as a whole)
   ```

2. **Signing**:
   ```
   Signature = MPC_Sign(Message, Share_User, Share_Network*)
   (Computed without revealing any individual share)
   ```

3. **Verification**:
   ```
   Verify(Signature, Message, PublicKey) = Valid ✅
   (Standard ECDSA/EdDSA verification)
   ```

### The Process

1. **Presign Phase**:
   - Generate random nonce shares
   - Compute presign = f(nonce_shares)
   - Store for later use

2. **Sign Phase**:
   - Load presign
   - Approve message
   - Each party computes: partial_sig = f(message, presign, their_share)
   - Combine partial signatures
   - Final signature = combine(partial_sig_user, partial_sig_network)

3. **Broadcast**:
   - Signature is standard ECDSA/EdDSA
   - Works on any blockchain
   - Verifiable by anyone

## Next Steps

1. **Test the implementation** with testnet tokens
2. **Replace encryption seed** with wallet signature
3. **Add more chains** (Bitcoin, Solana, etc.)
4. **Enhance UX** with better status messages
5. **Add error recovery** for failed transactions

## Resources

- [Ika SDK Documentation](https://docs.ika.xyz)
- [dWallet Network](https://dwallet.io)
- [2PC-MPC Overview](https://eprint.iacr.org/2023/765.pdf)
- [Ethers.js Documentation](https://docs.ethers.org)
