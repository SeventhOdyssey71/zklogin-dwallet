# Ethereum Transaction Signing with Ika dWallet

## Complete Implementation Guide

This document explains how to sign Ethereum transactions using Ika's dWallet MPC protocol with DKG (Distributed Key Generation) wallets.

---

## Table of Contents

1. [Overview](#overview)
2. [Key Concepts](#key-concepts)
3. [Prerequisites](#prerequisites)
4. [Address Derivation](#address-derivation)
5. [Transaction Signing Flow](#transaction-signing-flow)
6. [Common Issues & Solutions](#common-issues--solutions)
7. [Code Examples](#code-examples)

---

## Overview

Ika dWallet enables secure multi-party computation (MPC) for signing blockchain transactions without exposing private keys. This guide focuses on signing Ethereum transactions using **DKG dWallets** with the **`requestGlobalPresign`** method.

### What Works

- ✅ DKG dWallets with SECP256K1 curve
- ✅ ECDSA signatures using `requestGlobalPresign`
- ✅ EIP-1559 (Type 2) transactions
- ✅ Deterministic address recovery with correct hash scheme

---

## Key Concepts

### 1. DKG dWallet vs Imported-Key dWallet

| Feature | DKG dWallet | Imported-Key dWallet |
|---------|-------------|---------------------|
| Key Generation | Distributed (MPC) | Import existing key |
| ECDSA Signing | `requestGlobalPresign` | `requestPresign` |
| Use Case | New wallets | Existing keys |
| Ethereum Support | ✅ Yes | ✅ Yes |

**For this guide, we use DKG dWallets.**

### 2. Signature Components

ECDSA signatures consist of three components:
- **r**: X-coordinate of ephemeral key point
- **s**: Signature proof (must be normalized to lower half)
- **v**: Recovery ID (0 or 1 for EIP-1559, 27 or 28 for legacy)

### 3. Hash Schemes

**CRITICAL:** Ethereum requires **KECCAK256** hashing for ECDSA signatures.

```typescript
// ✅ CORRECT - Ethereum
const hashScheme = Hash.KECCAK256;

// ❌ WRONG - Will cause signature recovery failure
const hashScheme = Hash.SHA256;
```

### 4. Global Presigns

`requestGlobalPresign` creates presignatures that can be used with any compatible dWallet:
- Uses random ephemeral keys for security
- Single-use only (consumed after signing)
- Required for DKG dWallets with ECDSA

---

## Prerequisites

### Required Dependencies

```json
{
  "@ika.xyz/sdk": "latest",
  "@mysten/sui": "latest",
  "ethers": "^6.x",
  "@noble/curves": "latest"
}
```

### Required Resources

1. **SUI Tokens** - For gas fees on Sui network
2. **IKA Tokens** - For dWallet operations (get from https://faucet.ika.xyz/)
3. **ETH on Sepolia** - For funding the derived Ethereum address
4. **Active dWallet** - SECP256K1 curve, DKG type

### Network Configuration

```typescript
// Ethereum Sepolia Testnet
const config = {
  chainId: 11155111,
  rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  explorerUrl: 'https://sepolia.etherscan.io'
};

// Sui Testnet
const suiConfig = {
  network: 'testnet',
  rpcUrl: 'https://fullnode.testnet.sui.io:443'
};
```

---

## Address Derivation

### Step 1: Extract Public Key from dWallet

```typescript
import { publicKeyFromDWalletOutput, Curve } from '@ika.xyz/sdk';

// Fetch dWallet from blockchain
const dWallet = await ikaClient.getDWallet(dWalletId);

// Extract public key bytes
const publicOutput = Uint8Array.from(dWallet.state.Active?.public_output ?? []);
const publicKeyBytes = await publicKeyFromDWalletOutput(
  Curve.SECP256K1,
  publicOutput
);

console.log('Public key:', ethers.hexlify(publicKeyBytes));
// Example: 0x020b2081f48284ad15391751f790c0c875c009fae97caeb06f65564e88585f1898
```

### Step 2: Convert to Ethereum Address

```typescript
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';

// Decompress public key
const point = secp256k1.ProjectivePoint.fromHex(publicKeyBytes);
const uncompressedPubKey = point.toRawBytes(false); // 65 bytes

// Remove 0x04 prefix and hash with Keccak256
const pubKeyHash = keccak_256(uncompressedPubKey.slice(1));

// Take last 20 bytes as Ethereum address
const ethereumAddress = '0x' + Buffer.from(pubKeyHash.slice(-20)).toString('hex');

console.log('Ethereum address:', ethereumAddress);
// Example: 0xcD4548f5307799e088D0629DB7189007a5970AEa
```

### Step 3: Fund the Address

Send ETH to the derived address on Ethereum Sepolia testnet.

**Important:** This is the address that will be used as the "from" address for all transactions signed by this dWallet.

---

## Transaction Signing Flow

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CREATE PRESIGN                                           │
│    - Request global presign from Ika network                │
│    - Wait for MPC computation (~30-50 seconds)              │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. BUILD TRANSACTION                                         │
│    - Get current nonce and gas prices                       │
│    - Serialize unsigned transaction (EIP-1559 format)       │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. REQUEST SIGNATURE                                         │
│    - Create message approval with KECCAK256 hash scheme     │
│    - Submit sign request with presign and encrypted share   │
│    - Wait for MPC signature computation (~30-50 seconds)    │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. PROCESS SIGNATURE                                         │
│    - Extract (r, s) from 64-byte signature                  │
│    - Normalize s to lower half of curve order               │
│    - Try v=0 and v=1 to find correct recovery ID            │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. VERIFY & BROADCAST                                        │
│    - Verify signature recovers to expected address          │
│    - Construct signed transaction with (r, s, v)            │
│    - Broadcast to Ethereum network                          │
└─────────────────────────────────────────────────────────────┘
```

### Detailed Implementation

#### Step 1: Create Presign

```typescript
import { Transaction } from '@mysten/sui/transactions';
import { IkaTransaction, Curve, SignatureAlgorithm } from '@ika.xyz/sdk';

// Create Sui transaction
const presignTx = new Transaction();
presignTx.setSender(userAccount.address);

// Initialize Ika transaction
const ikaTransaction = new IkaTransaction({
  ikaClient,
  transaction: presignTx,
  userShareEncryptionKeys
});

// Get IKA coins for payment
const ikaCoins = await suiClient.getCoins({
  owner: userAccount.address,
  coinType: `${ikaClient.ikaConfig.packages.ikaPackage}::ika::IKA`
});

const ikaCoin = presignTx.object(ikaCoins.data[0].coinObjectId);

// Request global presign
const unverifiedPresignCap = ikaTransaction.requestGlobalPresign({
  curve: Curve.SECP256K1,
  dwalletNetworkEncryptionKeyId: dWallet.dwallet_network_encryption_key_id,
  signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
  ikaCoin: ikaCoin,
  suiCoin: presignTx.gas
});

presignTx.transferObjects([unverifiedPresignCap], userAccount.address);
presignTx.setGasBudget(50000000);

// Execute presign transaction
const result = await signAndExecuteTransaction({
  transaction: presignTx
});

// Extract presign ID from events
const presignEvent = result.events?.find(e =>
  e.type.includes('PresignRequestEvent')
);
const presignId = presignEvent.parsedJson?.event_data?.presign_id;

// Wait for presign to complete
const completedPresign = await ikaClient.getPresignInParticularState(
  presignId,
  'Completed',
  { timeout: 120000, interval: 2000 }
);

console.log('✅ Presign completed:', presignId);
```

#### Step 2: Build Unsigned Transaction

```typescript
import { ethers } from 'ethers';

// Get current nonce
const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const nonce = await provider.getTransactionCount(fromAddress);

// Build EIP-1559 transaction
const unsignedTx = {
  to: recipientAddress,
  value: ethers.parseEther(amount), // e.g., "0.01"
  nonce: nonce,
  chainId: config.chainId,
  type: 2, // EIP-1559
  maxFeePerGas: ethers.parseUnits('10', 'gwei'),
  maxPriorityFeePerGas: ethers.parseUnits('2', 'gwei'),
  gasLimit: 21000n
};

// Serialize for signing
const tx = ethers.Transaction.from(unsignedTx);
const serializedTx = tx.unsignedSerialized;
const messageBytes = ethers.getBytes(serializedTx);

console.log('📋 Transaction built:', {
  bytes: messageBytes.length,
  hash: ethers.keccak256(serializedTx)
});
```

#### Step 3: Request Signature

```typescript
import { Hash } from '@ika.xyz/sdk';

// Create signing transaction
const signTx = new Transaction();
signTx.setSender(userAccount.address);

const signIkaTransaction = new IkaTransaction({
  ikaClient,
  transaction: signTx,
  userShareEncryptionKeys
});

// Create message approval with KECCAK256 hash scheme
const messageApproval = signIkaTransaction.approveMessage({
  dWalletCap: dWallet.dwallet_cap_id,
  curve: Curve.SECP256K1,
  signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
  hashScheme: Hash.KECCAK256, // ⚠️ CRITICAL: Must be KECCAK256 for Ethereum!
  message: messageBytes
});

// Verify presign capability
const verifiedPresignCap = signIkaTransaction.verifyPresignCap({
  presign: completedPresign
});

// Get encrypted user share
const encryptedUserShare = await ikaClient.getEncryptedUserSecretKeyShare(
  encryptedUserSecretKeyShareId
);

// Get IKA coins for payment
const signIkaCoins = await suiClient.getCoins({
  owner: userAccount.address,
  coinType: `${ikaClient.ikaConfig.packages.ikaPackage}::ika::IKA`
});

const signIkaCoin = signTx.object(signIkaCoins.data[0].coinObjectId);

// Request signature
await signIkaTransaction.requestSign({
  dWallet: dWallet,
  messageApproval: messageApproval,
  verifiedPresignCap: verifiedPresignCap,
  hashScheme: Hash.KECCAK256, // ⚠️ CRITICAL: Must match message approval!
  presign: completedPresign,
  encryptedUserSecretKeyShare: encryptedUserShare,
  message: messageBytes,
  signatureScheme: SignatureAlgorithm.ECDSASecp256k1,
  ikaCoin: signIkaCoin,
  suiCoin: signTx.gas
});

// Execute sign transaction
const signResult = await signAndExecuteTransaction({
  transaction: signTx
});

// Extract sign ID from events
const signEvent = signResult.events?.find(e =>
  e.type.includes('SignRequestEvent')
);
const signId = signEvent.parsedJson?.event_data?.sign_id;

// Wait for signature to complete
const sign = await ikaClient.getSignInParticularState(
  signId,
  Curve.SECP256K1,
  SignatureAlgorithm.ECDSASecp256k1,
  'Completed',
  { timeout: 120000, interval: 2000 }
);

const signatureBytes = Uint8Array.from(sign.state.Completed?.signature ?? []);
console.log('✅ Signature received:', signatureBytes.length, 'bytes');
```

#### Step 4: Process Signature and Find Recovery ID

```typescript
// Extract r and s from 64-byte signature
let r = '0x' + Buffer.from(signatureBytes.slice(0, 32)).toString('hex');
let s = '0x' + Buffer.from(signatureBytes.slice(32, 64)).toString('hex');

// Normalize s to lower half (EIP-2 requirement)
const secp256k1N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
const secp256k1HalfN = secp256k1N / 2n;
let sBigInt = BigInt(s);
let recoveryOffset = 0;

if (sBigInt > secp256k1HalfN) {
  console.log('⚠️ Normalizing s to lower half...');
  sBigInt = secp256k1N - sBigInt;
  s = '0x' + sBigInt.toString(16).padStart(64, '0');
  recoveryOffset = 1; // Recovery ID flips when s is flipped
}

// Try both recovery values to find correct one
let signedTransaction = null;
let correctV = null;

for (let baseV = 0; baseV <= 1; baseV++) {
  const v = (baseV + recoveryOffset) % 2;
  const eip155V = v + 27; // Convert to EIP-155 format for ethers.js

  try {
    // Create test transaction with this v value
    const testTx = ethers.Transaction.from(unsignedTx);
    testTx.signature = ethers.Signature.from({ r, s, v: eip155V });

    const recoveredFrom = testTx.from;
    console.log(`🔍 Testing v=${v}, recovered: ${recoveredFrom}`);

    // Check if recovery matches expected address
    if (recoveredFrom?.toLowerCase() === fromAddress.toLowerCase()) {
      console.log(`✅ Found correct v: ${v} (EIP-155 v: ${eip155V})`);
      signedTransaction = testTx;
      correctV = eip155V;
      break;
    }
  } catch (error) {
    console.warn(`❌ v=${v} produced invalid signature`);
  }
}

if (!signedTransaction) {
  throw new Error('Signature recovery failed - no matching address found');
}

console.log('✅ Signature verified and transaction constructed');
```

#### Step 5: Broadcast Transaction

```typescript
// Get serialized signed transaction
const signedTxHex = signedTransaction.serialized;
console.log('📝 Signed transaction:', signedTxHex);

// Broadcast to Ethereum network
const txResponse = await provider.broadcastTransaction(signedTxHex);
console.log('✅ Transaction broadcasted:', txResponse.hash);

// Wait for confirmation
const receipt = await txResponse.wait();
console.log('✅ Transaction confirmed:', {
  hash: receipt.hash,
  block: receipt.blockNumber,
  status: receipt.status === 1 ? 'Success' : 'Failed'
});
```

---

## Common Issues & Solutions

### Issue 1: Signature Recovers to Wrong Address

**Symptoms:**
```
Expected: 0xcD4548f5307799e088D0629DB7189007a5970AEa
Recovered: 0xa9c813ed6Bf89d8916430c697F7372F9b3d91599
Error: insufficient funds
```

**Root Cause:** Using wrong hash scheme (SHA256 instead of KECCAK256)

**Solution:**
```typescript
// ✅ CORRECT - Use KECCAK256 for Ethereum
const hashScheme = Hash.KECCAK256;

// ❌ WRONG - Will cause recovery failure
const hashScheme = Hash.SHA256;
```

**Why This Matters:**
- Discovery function uses KECCAK256
- Transaction signing must also use KECCAK256
- Different hash schemes produce completely different signatures
- Signature recovery will fail if hash schemes don't match

### Issue 2: Error 31 - EOnlyGlobalPresignAllowed

**Symptoms:**
```
Error code: 31
Message: Only global presign allowed for this dWallet
```

**Root Cause:** Trying to use `requestPresign` with a DKG dWallet

**Solution:**
```typescript
// ✅ CORRECT - Use requestGlobalPresign for DKG dWallets
const presignCap = ikaTransaction.requestGlobalPresign({
  curve: Curve.SECP256K1,
  signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
  // ...
});

// ❌ WRONG - requestPresign is only for imported-key dWallets
const presignCap = ikaTransaction.requestPresign({
  dWallet: dWallet, // This will fail!
  // ...
});
```

### Issue 3: Different Addresses on Each Signing

**Symptoms:**
- Discovery returns: `0xcD4548...`
- Transaction 1 recovers to: `0xa9c813...`
- Transaction 2 recovers to: `0xf43dc8...`

**Root Cause:** This is expected behavior with `requestGlobalPresign` when using wrong hash scheme

**Solution:**
1. Use KECCAK256 hash scheme consistently
2. With correct hash scheme, v=1 will consistently recover to the address from `public_output[0]`

### Issue 4: Insufficient Funds Error

**Symptoms:**
```
Error: insufficient funds for intrinsic transaction cost
balance 0, tx cost 4210000000000000
```

**Root Cause:** Transaction is being sent from wrong address (signature recovery failed)

**Solution:**
1. Verify hash scheme is KECCAK256
2. Check that signature recovery matches funded address
3. Add detailed logging to see recovered addresses:
```typescript
console.log('Expected:', fromAddress);
console.log('Recovered v=0:', /* address from v=0 */);
console.log('Recovered v=1:', /* address from v=1 */);
```

### Issue 5: Transaction Expires Before Broadcasting

**Symptoms:**
```
Error: transaction blockhash not found
```

**Root Cause:** Ethereum transactions have time limits (Solana has blockhash expiration)

**Solution:**
1. Build transaction AFTER presign completes (not before)
2. Get fresh nonce/gas prices right before signing
3. Broadcast immediately after signature completes

**Recommended Flow:**
```
1. Create presign (30-50s)
2. Build transaction (< 1s)
3. Request signature (30-50s)
4. Broadcast immediately (< 5s)
```

### Issue 6: S-value Not Normalized

**Symptoms:**
```
Error: signature s-value is too high
```

**Root Cause:** S-value in upper half of curve order (not EIP-2 compliant)

**Solution:**
```typescript
const secp256k1N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
const secp256k1HalfN = secp256k1N / 2n;
let sBigInt = BigInt(s);
let recoveryOffset = 0;

if (sBigInt > secp256k1HalfN) {
  sBigInt = secp256k1N - sBigInt;
  s = '0x' + sBigInt.toString(16).padStart(64, '0');
  recoveryOffset = 1; // IMPORTANT: flip recovery ID when s is flipped
}
```

---

## Code Examples

### Complete Working Example

See the full implementation in:
- `/lib/dwallet/clientSideSigning.ts` - Main signing logic
- `/lib/dwallet/discoverDWalletAddress.ts` - Address discovery function
- `/components/SendTransaction.tsx` - UI component

### Key Files Reference

```
dwallet-frontend/
├── lib/
│   └── dwallet/
│       ├── clientSideSigning.ts      # Main signing implementation
│       ├── discoverDWalletAddress.ts # Address discovery
│       └── walletOperations.ts       # dWallet creation/management
├── components/
│   ├── SendTransaction.tsx           # Transaction UI
│   └── WalletDetail.tsx             # Wallet management UI
└── docs/
    ├── ETHEREUM-SIGNING-GUIDE.md     # This document
    └── TROUBLESHOOTING.md            # Detailed troubleshooting
```

### Quick Start Example

```typescript
import { signTransactionClientSide } from '@/lib/dwallet/clientSideSigning';

// Sign and broadcast an Ethereum transaction
const result = await signTransactionClientSide({
  chain: 'Ethereum',
  recipient: '0x2e81C241b5Fb0e80A8f861954aB574b4DC8F999c',
  amount: '0.01',
  dwalletId: '0x40f52b5...',
  suiAccount: userAccount,
  suiClient,
  signAndExecuteTransaction
});

console.log('Transaction hash:', result.txHash);
console.log('Etherscan:', `https://sepolia.etherscan.io/tx/${result.txHash}`);
```

---

## Testing Checklist

Before deploying to production:

- [ ] Verify KECCAK256 hash scheme is used consistently
- [ ] Test address derivation matches expected Ethereum address
- [ ] Confirm signature recovery works with v=0 and v=1
- [ ] Verify s-value normalization is implemented
- [ ] Test with EIP-1559 transactions (Type 2)
- [ ] Ensure proper error handling for all failure cases
- [ ] Test on Ethereum Sepolia testnet first
- [ ] Verify transaction confirmation and balance updates
- [ ] Test timeout handling for long-running MPC operations
- [ ] Validate gas price estimation and nonce management

---

## Security Considerations

### Private Key Security

- ✅ Private keys never leave the MPC network
- ✅ User share is encrypted with user's encryption key
- ✅ Network cannot sign without user participation
- ✅ Zero-trust security model by default

### Transaction Security

- ✅ Verify recipient address before signing
- ✅ Display transaction details to user for approval
- ✅ Validate recovered address matches expected address
- ✅ Use proper gas limits to prevent over-spending
- ✅ Implement transaction nonce management

### Best Practices

1. **Never skip signature verification:**
   ```typescript
   if (recoveredAddress !== expectedAddress) {
     throw new Error('Signature verification failed');
   }
   ```

2. **Always normalize s-value:**
   ```typescript
   if (sBigInt > secp256k1HalfN) {
     sBigInt = secp256k1N - sBigInt;
     recoveryOffset = 1;
   }
   ```

3. **Use correct hash scheme:**
   ```typescript
   // Ethereum = KECCAK256
   // Bitcoin = SHA256 or DoubleSHA256
   // Solana = SHA512
   const hashScheme = Hash.KECCAK256;
   ```

4. **Handle timeouts gracefully:**
   ```typescript
   const sign = await ikaClient.getSignInParticularState(
     signId,
     Curve.SECP256K1,
     SignatureAlgorithm.ECDSASecp256k1,
     'Completed',
     { timeout: 120000, interval: 2000 } // 2 minute timeout
   );
   ```

---

## Performance Considerations

### Timing Breakdown

| Operation | Time | Notes |
|-----------|------|-------|
| Create Presign | 30-50s | MPC computation on Ika network |
| Build Transaction | < 1s | Local operation |
| Request Signature | 30-50s | MPC computation on Ika network |
| Verify & Construct | < 1s | Local operation |
| Broadcast | 1-5s | Depends on network congestion |
| Confirmation | 12-30s | Ethereum block time (~12s) |
| **Total** | **~2-3 min** | End-to-end |

### Optimization Tips

1. **Parallel Operations:**
   - Fetch gas prices while presign is computing
   - Prepare transaction data while waiting for signature

2. **Caching:**
   - Cache encryption keys (regenerate from seed as needed)
   - Reuse SuiClient and IkaClient instances

3. **Error Recovery:**
   - Implement retry logic for network failures
   - Cache intermediate states for resumability

---

## Additional Resources

### Official Documentation
- Ika SDK: https://docs.ika.xyz/
- Ethereum: https://ethereum.org/developers
- EIP-1559: https://eips.ethereum.org/EIPS/eip-1559

### Tools
- Ika Faucet: https://faucet.ika.xyz/
- Sepolia Faucet: https://sepoliafaucet.com/
- Etherscan Sepolia: https://sepolia.etherscan.io/

### Support
- GitHub Issues: https://github.com/anthropics/ika-dapp/issues
- Ika Discord: [Link if available]

---

## Changelog

### 2025-12-09
- Initial documentation
- Fixed critical hash scheme bug (SHA256 → KECCAK256)
- Verified end-to-end transaction flow working
- Added comprehensive troubleshooting section

---

## License

[Your License Here]

---

**Last Updated:** December 9, 2025
**Tested On:** Ethereum Sepolia Testnet
**SDK Version:** @ika.xyz/sdk latest
**Status:** ✅ Production Ready
