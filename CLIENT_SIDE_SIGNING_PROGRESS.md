# Client-Side dWallet Signing - Implementation Progress

**Date:** 2025-12-06
**Status:** In Progress - Debugging Encrypted Share Discovery

---

## 🎯 Goal

Implement **100% client-side transaction signing** using the Ika SDK's 2PC-MPC protocol, eliminating the need for a backend server.

---

## ✅ What We've Achieved

### 1. Core Infrastructure (COMPLETE)

**Files Created:**
- `/lib/dwallet/clientSideSigning.ts` - Main signing implementation (500+ lines)
- `/CLIENT_SIDE_SIGNING.md` - Complete documentation

**Key Components Implemented:**
- `initializeClientSideSigning()` - IkaClient + UserShareEncryptionKeys setup
- `signWithDWallet()` - Main signing orchestrator
- `broadcastTransaction()` - EVM transaction broadcasting
- `buildUnsignedTransaction()` - Multi-chain transaction building

### 2. Presign Flow (WORKING ✅)

**Breakthrough:** Successfully implemented presign capability extraction!

**How it works:**
```typescript
// 1. Request presign and get capability object
const unverifiedPresignCap = presignIkaTx.requestGlobalPresign({...});

// 2. CRITICAL: Transfer capability to ourselves
presignTx.transferObjects([unverifiedPresignCap], userAddress);

// 3. Execute transaction
const result = await signAndExecuteTransaction({transaction: presignTx});

// 4. Find created presign capability in objectChanges
const presignCapObj = result.objectChanges.find(c =>
  c.type === 'created' && c.objectType.includes('PresignCap')
);

// 5. Query capability object to get presign session ID
const presignCapDetails = await suiClient.getObject({id: presignCapObj.objectId});
const presignId = presignCapDetails.data.content.fields.presign_id;

// 6. Poll for completion
const completedPresign = await ikaClient.getPresignInParticularState(
  presignId,
  'Completed',
  {timeout: 60000, interval: 2000}
);
```

**Test Results:**
```
✅ Presign transaction submitted: [digest]
✅ Presign capability ID: 0x...
✅ Presign session ID extracted: 0x...
✅ Presign completed
```

### 3. dWallet Type Detection (COMPLETE)

**Implemented Logic:**
```typescript
const dWalletKind = dWallet.kind; // "zero-trust" | "shared" | "imported-key"

if (isImportedKey && isECDSA) {
  // Use requestPresign()
} else {
  // Use requestGlobalPresign()
}
```

**References:**
- `lib/dwallet/clientSideSigning.ts:270-305` - Presign method selection
- `lib/dwallet/clientSideSigning.ts:447-512` - Sign method selection

### 4. Address Derivation (COMPLETE)

**Implementation:**
```typescript
// Extract public key from dWallet
const actualPublicKey = await publicKeyFromDWalletOutput(
  curve,
  dWallet.state.Active.public_output
);

// Derive blockchain address
const publicKeyHex = '0x' + Buffer.from(actualPublicKey).toString('hex');
const fromAddress = computeAddress(publicKeyHex); // For Ethereum
```

### 5. Multi-Chain Support (PARTIAL)

**Implemented:**
- ✅ Ethereum (Sepolia)
- ✅ Polygon (Amoy)
- ✅ Avalanche (Fuji)
- ✅ BSC (Testnet)

**Pending:**
- ⏳ Bitcoin (UTXO model)
- ⏳ Solana (different transaction format)

---

## 🔧 Current Issue: Encrypted Share Discovery

### The Problem

**Error:**
```
Error: DWallet signing requires either encryptedUserSecretKeyShare,
(secretShare + publicOutput), or public_user_secret_key_share on the DWallet
```

**Root Cause:**
- For zero-trust dWallets, we need the user's encrypted secret key share
- The encrypted share ID is not being found in the dWallet object
- The encrypted share is created as a **separate object** during DKG

### Current Solution (In Testing)

**Strategy:** Query for encrypted shares owned by the user

```typescript
// Search all EncryptedUserSecretKeyShare objects owned by user
const ownedObjects = await suiClient.getOwnedObjects({
  owner: userAccount.address,
  filter: {
    StructType: `${ikaConfig.packages.ikaDwallet2pcMpcPackage}::coordinator_inner::EncryptedUserSecretKeyShare`
  }
});

// Find the one matching this dWallet
for (const obj of ownedObjects.data) {
  if (obj.data.content.fields.dwallet_id === dwalletId) {
    // Found it! Fetch and decrypt
    const encryptedShare = await ikaClient.getEncryptedUserSecretKeyShare(obj.objectId);
    const {secretShare, publicOutput} = await userShareKeys.decryptUserShare(
      dWallet,
      encryptedShare,
      protocolParams
    );
  }
}
```

**File:** `/lib/dwallet/clientSideSigning.ts:460-507`

---

## 📁 Key Files Modified

### 1. `/lib/dwallet/clientSideSigning.ts`

**Main Functions:**

| Function | Lines | Status | Description |
|----------|-------|--------|-------------|
| `initializeClientSideSigning()` | 58-77 | ✅ Complete | Initializes IkaClient + UserShareEncryptionKeys |
| `signWithDWallet()` | 163-590 | 🔧 Testing | Main signing orchestrator |
| `buildUnsignedTransaction()` | 87-161 | ✅ Complete | EVM transaction builder |
| `broadcastTransaction()` | 592-640 | ✅ Complete | Broadcasts signed tx to blockchain |

**Critical Sections:**

- **Lines 248-309:** Presign capability creation (WORKING ✅)
- **Lines 346-406:** Presign ID extraction from objectChanges (WORKING ✅)
- **Lines 408-415:** Presign completion polling (WORKING ✅)
- **Lines 420-511:** Encrypted share discovery (IN TESTING 🔧)
- **Lines 514-540:** Sign transaction execution (PENDING TEST ⏳)

### 2. `/components/SendTransaction.tsx`

**Changes:**
- Added Sui wallet hooks: `useCurrentAccount`, `useSuiClient`, `useSignAndExecuteTransaction`
- Added props: `dwalletId`, `dwalletCapId`, `encryptedShareId`
- Integrated `signWithDWallet()` call (lines 100-130)

**File:** Lines 1-170

### 3. `/app/wallets/[id]/page.tsx`

**Changes:**
- Pass dWallet metadata to SendTransaction component
- Lines 145, 890: Added `dwalletCapId` and `encryptedShareId` props

### 4. `/lib/api/blockchainDwallet.ts`

**Changes:**
- Enhanced `getDWalletById()` to extract encrypted share ID
- Lines 139-197: Multiple strategies to find encrypted share
  - Check dWallet object fields
  - Query dynamic fields of Table
  - Log full object structure for debugging

**Status:** Partially working - logs object structure but doesn't find share ID yet

### 5. `/lib/types/dwallet.ts`

**Changes:**
- Added optional fields to `DWallet` interface:
  ```typescript
  dwalletCapId?: string;
  encryptedShareId?: string;
  ```

---

## 🔍 Debugging Information

### What Works

1. **Presign Creation:** ✅
   - Transaction executes successfully
   - Presign capability is created and transferred
   - Presign ID is extracted from object fields
   - Polling completes successfully

2. **User Encryption Keys:** ✅
   - Generated from deterministic seed
   - Compatible with dWallet curve (SECP256K1/ED25519)

3. **dWallet Fetching:** ✅
   - Successfully fetches dWallet from blockchain
   - Extracts public key correctly
   - Detects dWallet type ("zero-trust")

### What's Being Debugged

1. **Encrypted Share Discovery:** 🔧
   - Need to find the EncryptedUserSecretKeyShare object ID
   - Current approach: Query all owned objects of type EncryptedUserSecretKeyShare
   - Fallback: User must provide encrypted share ID manually

### Expected Console Logs (Testing)

When you test, look for these logs:

```
✅ Presign transaction submitted: [digest]
✅ Presign capability ID: 0x...
✅ Presign session ID extracted: 0x...
✅ Presign completed
3️⃣ Requesting signature...
🔑 dWallet kind from state: zero-trust
🔓 Decrypting user share locally for zero-trust dWallet...
🔍 Searching for encrypted share owned by user...
Found encrypted shares: X
✅ Found matching encrypted share: 0x...
✅ User share decrypted successfully
📝 Using decrypted secretShare and publicOutput
⏳ Executing sign transaction with Sui wallet...
```

---

## 🚧 Known Issues & Limitations

### 1. Hardcoded Encryption Seed (SECURITY ⚠️)

**Current Implementation:**
```typescript
const encryptionSeed = new TextEncoder().encode('ika-ultimate-encryption-2024');
```

**Problem:** Anyone with this seed can decrypt user shares!

**Solution Needed:**
```typescript
// Derive from wallet signature
const message = `Unlock dWallet\nTimestamp: ${Date.now()}`;
const {signature} = await signMessage({message});
const encryptionSeed = new TextEncoder().encode(signature);
```

**File:** `clientSideSigning.ts:191`

### 2. Fixed Gas Limits

**Current:** `gasLimit: BigInt(21000)` (only works for simple ETH transfers)

**Needed:** Proper gas estimation for:
- ERC-20 token transfers
- Contract interactions
- Complex transactions

**File:** `clientSideSigning.ts:151`

### 3. Encrypted Share ID Storage

**Current:** Not stored persistently

**Options:**
1. Store in localStorage (requires encryption)
2. Store in database (backend needed)
3. Query from blockchain each time (current approach)

### 4. Limited Chain Support

Only EVM chains implemented. Need:
- Bitcoin: UTXO transaction building
- Solana: Solana transaction format
- Different signature formats per chain

---

## 📋 Next Steps

### Immediate (To Complete Current Flow)

1. **Test Encrypted Share Discovery** 🔧
   - Run the transaction
   - Check console logs
   - Verify encrypted share is found and decrypted

2. **Complete Sign Transaction** ⏳
   - If share is found, test full signing flow
   - Extract signature from sign session
   - Broadcast to target blockchain

3. **Handle Edge Cases**
   - No encrypted share found → Clear error message
   - Shared dWallet → Use public share
   - Imported-key dWallet → Use correct methods

### Short-term Improvements

4. **Replace Hardcoded Seed**
   - Implement wallet signature-based seed derivation
   - Add user consent flow ("Sign to unlock dWallet")

5. **Add Transaction History**
   - Store signed transactions
   - Display in UI
   - Link to block explorers

6. **Improve Error Handling**
   - User-friendly error messages
   - Retry logic for failed transactions
   - Transaction status tracking

### Long-term Features

7. **Add More Chains**
   - Bitcoin support
   - Solana support
   - Polkadot/Substrate chains

8. **ERC-20 Token Support**
   - Token contract interactions
   - Proper gas estimation
   - Token balance checking

9. **Batch Transactions**
   - Multiple operations in one PTB
   - Presign + Sign in single transaction
   - Optimize for gas savings

10. **Production Security**
    - Security audit
    - Key management best practices
    - Secure seed storage

---

## 🔗 Key References

### Documentation Files
- `/CLIENT_SIDE_SIGNING.md` - Complete implementation guide
- `/send.md` - Ika SDK documentation (from docs.ika.xyz)

### Important Code Sections

**Presign Flow:**
```typescript
// lib/dwallet/clientSideSigning.ts:248-415
// Shows complete presign creation and polling
```

**Sign Flow:**
```typescript
// lib/dwallet/clientSideSigning.ts:417-590
// Shows signature request and extraction
```

**Ika SDK Examples (from send.md):**
- Lines 1567-1632: Complete zero-trust signing example
- Lines 1367-1395: Presign creation pattern
- Lines 1606-1621: requestSign parameters

### SDK References

**IkaTransaction Methods:**
- `requestGlobalPresign()` - For regular DKG dWallets
- `requestPresign()` - For imported-key dWallets with ECDSA
- `requestSign()` - For zero-trust/shared dWallets
- `requestSignWithImportedKey()` - For imported-key dWallets
- `verifyPresignCap()` - Verify presign capability
- `approveMessage()` - Create message approval for signing

**IkaClient Methods:**
- `getDWallet()` - Fetch dWallet from blockchain
- `getPresign()` - Fetch presign session
- `getPresignInParticularState()` - Poll for presign completion
- `getSign()` - Fetch sign session
- `getSignInParticularState()` - Poll for signature completion
- `getEncryptedUserSecretKeyShare()` - Fetch encrypted share

---

## 🧪 Testing Checklist

### Prerequisites
- [ ] Sui wallet connected (testnet)
- [ ] IKA tokens available for signing fees
- [ ] dWallet activated (state: "Active")
- [ ] Target chain testnet tokens (e.g., Sepolia ETH)

### Test Flow
1. [ ] Navigate to wallet detail page
2. [ ] Click "Send" button
3. [ ] Fill in recipient address (valid for chain)
4. [ ] Fill in amount
5. [ ] Click "Send Transaction"
6. [ ] **Presign Phase:**
   - [ ] Sui wallet popup appears
   - [ ] Approve presign transaction
   - [ ] Wait for presign completion (~5-10 seconds)
7. [ ] **Sign Phase:**
   - [ ] Encrypted share is found/decrypted
   - [ ] Sui wallet popup appears again
   - [ ] Approve sign transaction
   - [ ] Wait for signature (~5-10 seconds)
8. [ ] **Broadcast:**
   - [ ] Transaction broadcasts to target chain
   - [ ] Transaction hash displayed
   - [ ] Verify on block explorer

### Expected Console Output
```
🔧 Initializing client-side signing...
✅ IkaClient initialized
✅ User encryption keys initialized
1️⃣ Creating presign capability...
🔑 dWallet kind: zero-trust
📝 Using requestGlobalPresign
✅ Presign transaction submitted: [digest]
✅ Presign capability ID: 0x...
✅ Presign session ID extracted: 0x...
2️⃣ Waiting for presign to complete...
✅ Presign completed
3️⃣ Requesting signature...
🔓 Decrypting user share locally...
🔍 Searching for encrypted share...
✅ Found matching encrypted share: 0x...
✅ User share decrypted successfully
📝 Using decrypted secretShare and publicOutput
⏳ Executing sign transaction...
✅ Sign transaction submitted: [digest]
4️⃣ Waiting for signature to complete...
✅ Signature completed
5️⃣ Broadcasting transaction...
✅ Transaction broadcasted: 0x[txHash]
```

---

## 💡 Key Insights from This Session

### 1. Presign Capability Pattern
The breakthrough was understanding that `requestGlobalPresign()` returns a **TransactionObjectArgument** that must be **transferred** to get its ID:

```typescript
const cap = tx.requestGlobalPresign({...});
tx.transferObjects([cap], userAddress); // CRITICAL!
// After execution, find cap in objectChanges
```

### 2. dWallet Type Matters
Different dWallet types require different methods:
- **Zero-trust (DKG):** `requestGlobalPresign()` + `requestSign()`
- **Imported-key:** `requestPresign()` + `requestSignWithImportedKey()`
- **Shared:** `requestGlobalPresign()` + `requestSign()` (no encrypted share)

### 3. Encrypted Share Discovery
The encrypted share is a **separate object** created during DKG. Options:
1. Store the ID when creating dWallet (best)
2. Query from blockchain by filtering owned objects (current)
3. Extract from dWallet object's dynamic fields (attempted, didn't work)

### 4. SDK Documentation is Key
The `/send.md` file (from docs.ika.xyz) contains the complete patterns. Always reference it for:
- Method signatures
- Parameter requirements
- Example flows

---

## 📊 Implementation Statistics

- **Lines of Code:** ~650 (clientSideSigning.ts)
- **Files Modified:** 5
- **Functions Created:** 4 major functions
- **Debugging Iterations:** ~20+ attempts to find encrypted share
- **Breakthroughs:** 2 major (presign extraction, dWallet type detection)
- **Time Invested:** Multiple hours of debugging
- **Current Status:** ~85% complete (pending encrypted share discovery)

---

## 🎓 Lessons Learned

1. **PTB Objects Must Be Transferred:** Transaction objects created in a PTB don't automatically become queryable - they must be transferred to an address first.

2. **Events Aren't Always Emitted:** We expected presign/sign events, but the IDs are actually in object fields, not events.

3. **SDK Type System is Complex:** The SDK has multiple dWallet types (ZeroTrust, Shared, ImportedKey) that require different method calls.

4. **Documentation Gaps:** Some patterns (like presign cap extraction) aren't explicitly documented and required reverse-engineering.

5. **Blockchain State is Eventual:** Need proper polling and waiting for state transitions (presign → completed, sign → completed).

---

## 🔒 Security Considerations

### Current Security Issues

1. **Hardcoded Encryption Seed** ⚠️ CRITICAL
   - Anyone with code can decrypt shares
   - Must be replaced before production

2. **No Key Rotation** ⚠️
   - Encryption keys are static
   - No mechanism to change them

3. **Browser-Only Storage** ⚠️
   - If user clears browser data, keys are lost
   - No backup/recovery mechanism

### Production Requirements

Before mainnet deployment:
- [ ] Wallet signature-based seed derivation
- [ ] Secure key storage (encrypted localStorage or hardware wallet)
- [ ] Key backup/recovery flow
- [ ] Security audit of cryptographic operations
- [ ] Rate limiting on signing operations
- [ ] Transaction confirmation UI
- [ ] Multi-sig support for high-value transactions

---

## 📞 Support Resources

- **Ika SDK Docs:** https://docs.ika.xyz
- **dWallet Network:** https://dwallet.io
- **GitHub Issues:** (if public repo exists)
- **Discord/Telegram:** (if community exists)

---

**Last Updated:** 2025-12-06
**Next Session Goals:**
1. Test encrypted share discovery
2. Complete full signing flow
3. Broadcast transaction to testnet
4. Verify on block explorer

**Status:** Ready for testing! 🚀
