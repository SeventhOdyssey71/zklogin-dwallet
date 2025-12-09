# Troubleshooting History: Ethereum Signing with Ika dWallet

## Critical Bug Discovery and Resolution

**Date:** December 9, 2025
**Status:** ✅ Resolved
**Impact:** Complete signing failure for Ethereum transactions

---

## Timeline of Investigation

### Initial Problem

**Symptom:** Ethereum transactions failing with "insufficient funds" error despite funded wallet.

```
Error: insufficient funds for intrinsic transaction cost
Expected "from" address: 0xcD4548f5307799e088D0629DB7189007a5970AEa (has 0.014936 ETH)
Actual recovered addresses:
  v=0: 0xF43dC8B0a914f27AB9cEa84294ab6A5a63fF6678 (balance: 0)
  v=1: 0xa9c813ed6Bf89d8916430c697F7372F9b3d91599 (balance: 0)
```

### Investigation Phase 1: Understanding Address Recovery

**Initial Hypothesis:** Recovery ID (v value) calculation was incorrect.

**Steps Taken:**
1. Analyzed console3.md and console4.md (discovery tests)
2. Found that discovery consistently returned correct address with v=1
3. Compared discovery logic vs transaction signing logic

**Discovery Test Results:**
```
Console3: v=1 → 0xcD4548f5307799e088D0629DB7189007a5970AEa ✅
Console4: v=1 → 0xcD4548f5307799e088D0629DB7189007a5970AEa ✅
```

**Transaction Test Results:**
```
Console2: v=1 → 0xa9c813ed6Bf89d8916430c697F7372F9b3d91599 ❌
```

**Observation:** Discovery worked, but transaction signing didn't. Both used the same dWallet!

### Investigation Phase 2: Deep Dive into Ika Codebase

**User Feedback:** "you are very much totally wrong, highly wrong, continue studying this until you find the solution and don't stop"

**Intensive Code Analysis:**
1. Examined `/ika/sdk/typescript/test/v2/all-combinations.test.ts`
2. Found ECDSA + SECP256K1 + KECCAK256 test cases
3. Discovered `testPresign` helper function logic
4. Analyzed signature verification patterns

**Key Finding:**
```typescript
// From imported-key.test.ts (lines 660-679)
if (
  dWallet.is_imported_key_dwallet &&
  (signatureAlgorithm === SignatureAlgorithm.ECDSASecp256k1 ||
   signatureAlgorithm === SignatureAlgorithm.ECDSASecp256r1)
) {
  unverifiedPresignCap = ikaTransaction.requestPresign({...});
} else {
  // ECDSA with DKG dWallets DOES use requestGlobalPresign!
  unverifiedPresignCap = ikaTransaction.requestGlobalPresign({...});
}
```

**Realization:** Our use of `requestGlobalPresign` was correct. The issue had to be elsewhere.

### Investigation Phase 3: Comparing Discovery vs Transaction

**User Hint:** "check console 3 and console 4"

**Detailed Comparison:**

| Aspect | Discovery (console3/4) | Transaction (console2) |
|--------|----------------------|----------------------|
| dWallet ID | Same | Same |
| Curve | SECP256K1 | SECP256K1 |
| Algorithm | ECDSASecp256k1 | ECDSASecp256k1 |
| Message Type | UTF-8 text | RLP-encoded tx |
| **Hash Scheme** | **KECCAK256** | **SHA256** ⚠️ |
| v=1 Result | ✅ Correct address | ❌ Wrong address |

### The Breakthrough

**File:** `/lib/dwallet/clientSideSigning.ts`
**Line:** 412

```typescript
// ❌ WRONG CODE (before fix)
const hashScheme = curve === Curve.SECP256K1 ? Hash.SHA256 : Hash.SHA512;
```

**Compared to:** `/lib/dwallet/discoverDWalletAddress.ts`
**Line:** 51

```typescript
// ✅ CORRECT CODE (discovery function)
const hashScheme = Hash.KECCAK256;
```

**Root Cause Identified:**
- Discovery function used `Hash.KECCAK256`
- Transaction signing used `Hash.SHA256`
- Different hash schemes → completely different signatures
- Different signatures → different recovered addresses!

---

## The Fix

### Code Change

**File:** `/Users/emmanuelosadebe/ika-dapp/dwallet-frontend/lib/dwallet/clientSideSigning.ts`

**Before:**
```typescript
// Line 412
const hashScheme = curve === Curve.SECP256K1 ? Hash.SHA256 : Hash.SHA512;
```

**After:**
```typescript
// Lines 410-414
// Hash scheme depends on the curve and blockchain
// Ethereum (SECP256K1 ECDSA) requires KECCAK256
// Solana (ED25519 EdDSA) uses SHA512
// This must match the hash scheme used in discovery function
const hashScheme = curve === Curve.SECP256K1 ? Hash.KECCAK256 : Hash.SHA512;
```

### Verification

**Test Transaction:**
```
Transaction Hash: 0x5afdbae8f6a04ab4923d13b88b4882c691498b7e3ba19f50d669c88cfde549d0
Block: 9802308
Status: Success ✅
```

**Signature Recovery:**
```
Testing v=0: 0xE7092426492c7E121394C122D505e7eaB300C0dE
Testing v=1: 0xcD4548f5307799e088D0629DB7189007a5970AEa ✅
Found correct v=1 matching expected address!
```

**Balance Update:**
```
Before: 0.024936 ETH
After:  0.014894 ETH (0.01 sent + gas fees)
```

---

## Why This Bug Existed

### Historical Context

1. **ECDSA with SHA256** is common for Bitcoin and other blockchains
2. **Initial implementation** likely copied from Bitcoin example
3. **Ethereum's unique requirement** for KECCAK256 was overlooked
4. **Discovery function** was written later and used correct hash scheme
5. **Inconsistency** between discovery and signing went unnoticed

### Why It Was Hard to Find

1. **Both signatures were valid** - just for different messages
2. **MPC computation succeeded** - no error thrown
3. **Recovery IDs seemed correct** - v=0 and v=1 both produced addresses
4. **Error message was misleading** - "insufficient funds" suggested balance issue
5. **Multiple layers of abstraction** - hash scheme buried in configuration

---

## Lessons Learned

### 1. Blockchain-Specific Requirements

Different blockchains have different hash requirements:

| Blockchain | Hash Scheme | Notes |
|------------|-------------|-------|
| Ethereum | KECCAK256 | Required for ECDSA |
| Bitcoin | SHA256 or DoubleSHA256 | Depends on operation |
| Solana | SHA512 | For EdDSA signatures |

**Lesson:** Always verify hash scheme matches blockchain requirements.

### 2. Consistency Across Codebase

Discovery and transaction signing must use:
- ✅ Same hash scheme
- ✅ Same signature algorithm
- ✅ Same curve parameters
- ✅ Same message formatting

**Lesson:** Create shared configuration to ensure consistency.

### 3. Test-Driven Debugging

**What Worked:**
1. Comparing working (discovery) vs broken (transaction) implementations
2. Reading official test suites in Ika codebase
3. Systematic elimination of variables

**Lesson:** When debugging, find what works and compare against what doesn't.

### 4. User Feedback is Crucial

User's comments guided the investigation:
- "but v1 was the correct one" → focused on why v=1 worked in discovery
- "check console 3 and console 4" → compared discovery outputs
- "continue studying until you find the solution" → deep dive into codebase

**Lesson:** Listen carefully to user observations and hints.

---

## Detailed Technical Explanation

### How ECDSA Signature Recovery Works

```
1. Sign message with private key → produces (r, s)
2. To verify signature, need to recover public key
3. There are 2-4 possible public keys for any (r, s)
4. Recovery ID (v) indicates which one is correct
5. Recovered public key → hashed → Ethereum address
```

### Why Hash Scheme Matters

```
Given:
- Same dWallet (same private key)
- Same message (same transaction)
- Different hash schemes

Process:
1. SHA256(message) = hash_A
2. KECCAK256(message) = hash_B
3. Sign(hash_A, private_key) = signature_A
4. Sign(hash_B, private_key) = signature_B
5. signature_A ≠ signature_B

Result:
- signature_A recovers to address_A
- signature_B recovers to address_B
- address_A ≠ address_B
```

### Why Discovery Worked

```typescript
// Discovery function (discoverDWalletAddress.ts:51)
const hashScheme = Hash.KECCAK256; // ✅ Correct for Ethereum

// Signs test message with KECCAK256
const signature = await sign(testMessage, KECCAK256);

// Recovers address using KECCAK256
const recoveredAddress = recoverAddress(signature, testMessage, KECCAK256);

// Result: recoveredAddress = address from public_output[0] ✅
```

### Why Transaction Signing Failed

```typescript
// Transaction signing (clientSideSigning.ts:412 - BEFORE FIX)
const hashScheme = Hash.SHA256; // ❌ Wrong for Ethereum

// Signs transaction with SHA256
const signature = await sign(transaction, SHA256);

// But recovery tries to use the ACTUAL transaction hash (KECCAK256)
const recoveredAddress = recoverAddress(signature, transaction, KECCAK256);

// Result: recoveredAddress ≠ address from public_output[0] ❌
// Because signature was created with SHA256 but recovery uses KECCAK256
```

---

## Prevention Strategies

### 1. Configuration Validation

```typescript
// Create shared configuration
export const BLOCKCHAIN_CONFIGS = {
  Ethereum: {
    curve: Curve.SECP256K1,
    signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
    hashScheme: Hash.KECCAK256, // ✅ Enforced in one place
  },
  Bitcoin: {
    curve: Curve.SECP256K1,
    signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
    hashScheme: Hash.SHA256,
  },
  Solana: {
    curve: Curve.ED25519,
    signatureAlgorithm: SignatureAlgorithm.EdDSA,
    hashScheme: Hash.SHA512,
  }
};

// Use consistently
const config = BLOCKCHAIN_CONFIGS[chain];
const hashScheme = config.hashScheme; // ✅ Always correct
```

### 2. Integration Tests

```typescript
describe('Ethereum Transaction Signing', () => {
  it('should recover correct address from signature', async () => {
    const signature = await signTransaction(tx);
    const recoveredAddress = recoverAddress(signature, tx);

    expect(recoveredAddress).toBe(expectedAddress);
  });

  it('should match discovery address', async () => {
    const discoveredAddress = await discoverAddress(dWallet);
    const txSignature = await signTransaction(tx, dWallet);
    const txAddress = recoverAddress(txSignature, tx);

    expect(txAddress).toBe(discoveredAddress);
  });
});
```

### 3. Documentation

- ✅ Document hash scheme requirements for each blockchain
- ✅ Add inline comments explaining critical choices
- ✅ Create troubleshooting guides (like this one!)

### 4. Code Review Checklist

When implementing blockchain signing:
- [ ] Verify hash scheme matches blockchain requirements
- [ ] Ensure consistency between discovery and signing
- [ ] Test signature recovery against expected address
- [ ] Validate with official blockchain test vectors
- [ ] Compare implementation against official SDK examples

---

## Related Issues

### Similar Problems to Watch For

1. **Signature Malleability**
   - S-value must be normalized to lower half
   - Recovery offset must be adjusted when s is flipped

2. **Recovery ID Format**
   - EIP-1559 uses v ∈ {0, 1}
   - Legacy transactions use v ∈ {27, 28}
   - ethers.js v6 converts automatically

3. **Message Formatting**
   - Ethereum: raw transaction bytes
   - Some chains: prefixed with "\x19Ethereum Signed Message:\n"
   - Different prefixes → different hashes → different addresses

---

## Testing Evidence

### Before Fix

```
Console2.md:
🔍 Testing baseV=0, v=0, eip155V=27, recovered: 0xF43dC8B0a914f27AB9cEa84294ab6A5a63fF6678
🔍 Testing baseV=1, v=1, eip155V=28, recovered: 0xa9c813ed6Bf89d8916430c697F7372F9b3d91599
⚠️  Stored address does not match ANY signature recovery.
❌ Error: insufficient funds
```

### After Fix

```
Console2.md (latest):
🔍 Testing baseV=0, v=0, eip155V=27, recovered: 0xE7092426492c7E121394C122D505e7eaB300C0dE
🔍 Testing baseV=1, v=1, eip155V=28, recovered: 0xcD4548f5307799e088D0629DB7189007a5970AEa
✅ Found correct recovery id (v): 1 (EIP-155 v: 28)
✅ SUCCESS: Signature recovers to expected address!
✅ Transaction confirmed! Block: 9802308, Status: Success
```

---

## Conclusion

This bug was a single-character change (`SHA256` → `KECCAK256`) that caused complete signing failure. The fix required:

1. ✅ Deep understanding of ECDSA signature recovery
2. ✅ Careful comparison of working vs broken code
3. ✅ Reading Ika SDK source code and tests
4. ✅ Attention to user feedback and hints
5. ✅ Systematic debugging approach

**Total Investigation Time:** ~4 hours
**Lines Changed:** 1
**Impact:** System now fully functional ✅

---

## References

### Files Modified

- `/lib/dwallet/clientSideSigning.ts` (line 412)

### Files Analyzed

- `/ika/sdk/typescript/test/v2/all-combinations.test.ts`
- `/ika/sdk/typescript/test/v2/imported-key.test.ts`
- `/ika/sdk/typescript/test/helpers/dwallet-test-helpers.ts`
- `/ika/contracts/ika_dwallet_2pc_mpc/sources/coordinator_inner.move`
- `/lib/dwallet/discoverDWalletAddress.ts`

### Console Outputs

- `console2.md` - Transaction signing logs
- `console3.md` - Discovery test #1
- `console4.md` - Discovery test #2

---

**Document Status:** Complete
**Last Updated:** December 9, 2025
**Verified By:** Successful on-chain transaction 0x5afdbae8f6a04ab4923d13b88b4882c691498b7e3ba19f50d669c88cfde549d0
