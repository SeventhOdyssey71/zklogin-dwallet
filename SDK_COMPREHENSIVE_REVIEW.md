# Comprehensive SDK Review: Client-Side dWallet Creation

## Executive Summary

**Key Finding**: The Ika SDK tests use **zero-value coins** because they run on **localnet** with **zero pricing configuration**, NOT because it's the correct production pattern.

**For Production (Testnet/Mainnet)**: You MUST use real coins with actual balances to pay for dWallet creation fees.

---

## Table of Contents

1. [Why Tests Use Zero-Value Coins](#why-tests-use-zero-value-coins)
2. [Production Requirements](#production-requirements)
3. [Move Contract Fee Structure](#move-contract-fee-structure)
4. [TypeScript SDK Patterns](#typescript-sdk-patterns)
5. [Correct Client-Side Implementation](#correct-client-side-implementation)
6. [Common Mistakes to Avoid](#common-mistakes-to-avoid)

---

## Why Tests Use Zero-Value Coins

### Test Environment Configuration

**File**: `/ika/sdk/typescript/test/helpers/test-utils.ts:103-106`

```typescript
export function createTestSuiClient(): SuiClient {
    return new SuiClient({
        url: process.env.SUI_TESTNET_URL || getFullnodeUrl('localnet'),
        //                                    ^^^^^^^^^ Tests default to LOCALNET
    });
}
```

### Localnet Pricing Configuration

**File**: `/ika/contracts/ika_system/tests/test_utils.move:474-486`

```move
public fun create_pricing_for_default_protocols(value: u64): DWalletPricing {
    let mut pricing = dwallet_pricing::empty();
    pricing.insert_or_update_dwallet_pricing(0, option::none(), 0, value, value, value, value);
    // ...
    pricing
}
```

**File**: `/ika/contracts/ika_system/tests/e2e_tests.move:300`

```move
let pricing = test_utils::create_pricing_for_default_protocols(5000);
//                                                               ^^^^ Can be set to 0 for tests!
```

### Zero-Value Coin Pattern (TEST ONLY!)

**File**: `/ika/sdk/typescript/test/helpers/test-utils.ts:290-296`

```typescript
/**
 * Creates an empty IKA token for transactions
 */
export function createEmptyTestIkaToken(tx: Transaction, ikaConfig: IkaConfig) {
    return tx.moveCall({
        target: `0x2::coin::zero`,  // ← Creates coin with 0 balance!
        arguments: [],
        typeArguments: [`${ikaConfig.packages.ikaPackage}::ika::IKA`],
    });
}
```

### Why This Works in Tests

1. **Localnet Environment**: Tests run on localnet, not testnet/mainnet
2. **Zero Pricing**: Test configuration sets all fees to 0 or minimal values
3. **No Validation**: Test environment may skip balance validation
4. **Controlled Environment**: Tests have full control over network configuration

---

## Production Requirements

### Move Contract Fee Validation and Coin Handling

**File**: `/ika/deployed_contracts/testnet/ika_dwallet_2pc_mpc/sources/sessions_manager.move:332-344`

**CRITICAL**: The Move function takes coins by **mutable reference** (`&mut Coin`), NOT by value!

```move
public(package) fun initiate_user_session<E: copy + drop + store>(
    self: &mut SessionsManager,
    epoch: u64,
    session_identifier: SessionIdentifier,
    dwallet_network_encryption_key_id: ID,
    pricing_value: PricingInfoValue,
    payment_ika: &mut Coin<IKA>,
    payment_sui: &mut Coin<SUI>,
    event_data: E,
    ctx: &mut TxContext,
): Balance<SUI> {
    // ✅ CONTRACT VALIDATES COIN BALANCE!
    assert!(payment_ika.value() >= pricing_value.fee_ika(), EInsufficientIKAPayment);
    assert!(
        payment_sui.value() >= pricing_value.gas_fee_reimbursement_sui() +
                              pricing_value.gas_fee_reimbursement_sui_for_system_calls(),
        EInsufficientSUIPayment,
    );

    // ✅ CONTRACT DEDUCTS FEES FROM COINS!
    let fee_charged_ika = payment_ika.split(pricing_value.fee_ika(), ctx).into_balance();
    let gas_fee_reimbursement_sui = payment_sui
        .split(pricing_value.gas_fee_reimbursement_sui(), ctx)
        .into_balance();
    let gas_fee_reimbursement_sui_for_system_calls = payment_sui
        .split(pricing_value.gas_fee_reimbursement_sui_for_system_calls(), ctx)
        .into_balance();

    // Fees are taken from the coins and stored by the protocol
    // The REMAINING balance stays in the coin (it's &mut, not consumed!)
    // ...
}
```

### What This Means

1. **Zero-value coins will FAIL**: The `assert!` on line 332 will reject transactions with insufficient balance
2. **Coins must have actual balance**: The `split()` method requires real tokens to split out
3. **Only fees are consumed**: The split tokens are taken by the protocol
4. **Remaining balance stays in the coin**: Because coins are passed as `&mut`, the remaining balance after `.split()` stays in the original coin object
5. **Sui handles coin lifecycle**: The Sui runtime automatically manages the modified coin object and returns it to your wallet

---

## How Coin Fees Work in Detail

### Move Function Signature

```move
// From coordinator.move:336-337
payment_ika: &mut Coin<IKA>,  // ← Mutable reference (NOT consumed!)
payment_sui: &mut Coin<SUI>,  // ← Mutable reference (NOT consumed!)
```

### The `.split()` Method

```move
// From sessions_manager.move:338
let fee_charged_ika = payment_ika.split(pricing_value.fee_ika(), ctx).into_balance();
```

**What `.split()` does:**
1. Takes a **specific amount** from the coin (the fee)
2. Returns that amount as a new balance
3. **Leaves the remainder** in the original coin object
4. Modifies the coin in-place (that's why it's `&mut`)

### Example

If you have:
- **Your IKA coin**: 1000 IKA
- **DKG fee**: 100 IKA

After transaction:
- **Fee taken**: 100 IKA (consumed by protocol)
- **Your coin**: 900 IKA (automatically returned to your wallet)

### Why You Might See "All Coins Disappear"

If you're seeing ALL your coins disappear, it could be:

1. **Multiple operations**: Each operation (session registration, encryption key registration, DKG) may charge fees
2. **Gas fees**: SUI is also used for transaction gas
3. **UI update delay**: Wallet balance might not update immediately after transaction
4. **Actual bug**: Check the transaction effects to see what happened to the coins

### How to Verify

After the transaction executes, check `result.objectChanges`:

```typescript
console.log('Object changes:', result.objectChanges);
// Look for:
// - { type: 'mutated', objectType: '0x2::coin::Coin<IKA>' } ← Your IKA coin (modified)
// - { type: 'created', objectType: 'DWalletCap' } ← Your new dWallet
```

The IKA coin should be **mutated** (not deleted), with the remaining balance.

---

## Move Contract Fee Structure

### Pricing Information

**File**: `/ika/deployed_contracts/testnet/ika_dwallet_2pc_mpc/sources/pricing.move:5-14`

```move
/// This module provides structures and functions for managing pricing information for a dWallet.
/// Each operation (e.g., DKG, re-encrypt user share, ECDSA presign, etc.) has its own pricing data,
/// represented by a `PricingPerOperation`. Each `PricingPerOperation` holds three values:
///   - **fee_ika**: The IKA fee for the operation.
///   - **gas_fee_reimbursement_sui**: The SUI reimbursement.
///   - **gas_fee_reimbursement_sui_for_system_calls**: The SUI reimbursement for system calls.
```

### Fee Components

```move
public struct PricingInfoValue has copy, drop, store {
    fee_ika: u64,                                      // IKA tokens charged to user
    gas_fee_reimbursement_sui: u64,                    // SUI for gas reimbursement
    gas_fee_reimbursement_sui_for_system_calls: u64,   // SUI for system calls
}
```

### DKG Operation Pricing

**File**: `/ika/deployed_contracts/testnet/ika_dwallet_2pc_mpc/sources/coordinator_inner.move:2809-2817`

```move
let pricing_value = if (sign_during_dkg_request.is_some()) {
    self
        .pricing_and_fee_manager
        .get_pricing_value_for_protocol(curve, option::some(...), DWALLET_DKG_WITH_SIGN_PROTOCOL_FLAG)
} else {
    self
        .pricing_and_fee_manager
        .get_pricing_value_for_protocol(curve, option::none(), DWALLET_DKG_PROTOCOL_FLAG)
};
```

---

## TypeScript SDK Patterns

### Official SDK Pattern (From Tests)

**File**: `/ika/sdk/typescript/test/v2/helpers.ts:190-220`

```typescript
// ✅ STEP 1: Create empty IKA coin (TEST ONLY - uses zero-value coin!)
const emptyIKACoin = createEmptyTestIkaToken(suiTransaction, ikaClient.ikaConfig);

// ✅ STEP 2: Create IkaTransaction wrapper
const ikaTransaction = createTestIkaTransaction(ikaClient, suiTransaction, userShareEncryptionKeys);

// ✅ STEP 3: Register session identifier ON IkaTransaction
const sessionIdentifier = ikaTransaction.registerSessionIdentifier(randomSessionIdentifier);

// ✅ STEP 4: Request DKG
const [dWalletCap] = await ikaTransaction.requestDWalletDKG({
    dkgRequestInput: {
        userDKGMessage,
        encryptedUserShareAndProof,
        userPublicOutput,
        userSecretKeyShare,
    },
    curve,
    dwalletNetworkEncryptionKeyId: latestNetworkEncryptionKey.id,
    ikaCoin: emptyIKACoin,      // ← Zero-value coin (TEST ONLY!)
    suiCoin: suiTransaction.gas,
    sessionIdentifier,
});

// ✅ STEP 5: Transfer DWalletCap to user (CRITICAL!)
suiTransaction.transferObjects([dWalletCap], signerAddress);

// ✅ STEP 6: Execute transaction
const result = await executeTestTransaction(suiClient, suiTransaction, testName);
```

### Key Methods from IkaTransaction

**File**: `/ika/sdk/typescript/src/client/ika-transaction.d.ts:693-115`

```typescript
// Register session identifier
registerSessionIdentifier(sessionIdentifier: Uint8Array): TransactionObjectArgument;

// Request DKG to create dWallet
requestDWalletDKG<S extends SignatureAlgorithm = never>({
    dkgRequestInput: DKGRequestInput;
    ikaCoin: TransactionObjectArgument;          // ← MUST have balance in production!
    suiCoin: TransactionObjectArgument;          // ← MUST have balance in production!
    sessionIdentifier: TransactionObjectArgument;
    dwalletNetworkEncryptionKeyId: string;
    signDuringDKGRequest?: { ... };
    curve: Curve;
}): Promise<TransactionResult>;  // ← Returns DWalletCap reference

// Register encryption key (one-time per curve)
registerEncryptionKey({ curve }: { curve: Curve }): Promise<void>;
```

---

## Correct Client-Side Implementation

### Production Pattern (Browser/Testnet/Mainnet)

```typescript
// ✅ STEP 1: Get user's wallet account
const account = useCurrentAccount();
if (!account) {
    throw new Error("Please connect your Sui wallet");
}

// ✅ STEP 2: Fetch user's IKA and SUI coins with REAL balances
const coins = await suiClient.getCoins({
    owner: account.address,
    coinType: `${IKA_PACKAGE_ID}::ika::IKA`,
});

const ikaCoins = coins.data;
if (ikaCoins.length === 0) {
    throw new Error("No IKA tokens found. Get IKA from https://faucet.ika.xyz/");
}

// Find coin with largest balance
const largestIkaCoin = ikaCoins.reduce((prev, current) =>
    BigInt(current.balance) > BigInt(prev.balance) ? current : prev
);

// ✅ STEP 3: Create transaction
const tx = new Transaction();
tx.setSender(account.address);  // CRITICAL: Set transaction sender!
tx.setGasBudget(100000000);     // 0.1 SUI for gas

// ✅ STEP 4: Use REAL coins (not zero-value coins!)
const ikaCoin = tx.object(largestIkaCoin.coinObjectId);  // Real IKA tokens
const suiCoin = tx.gas;                                   // Real SUI for gas

// ✅ STEP 5: Create IkaTransaction wrapper FIRST
const ikaTx = new IkaTransaction({
    ikaClient,
    transaction: tx,
    userShareEncryptionKeys,
});

// ✅ STEP 6: Register session identifier using IkaTransaction method
const sessionIdentifierBytes = new TextEncoder().encode(`dwallet-creation-${Date.now()}`);
const sessionIdentifier = ikaTx.registerSessionIdentifier(sessionIdentifierBytes);

// ✅ STEP 7: Check/register encryption key
let activeEncryptionKeyId;
try {
    activeEncryptionKeyId = await ikaClient.getActiveEncryptionKeyId(account.address, curve);
} catch (error) {
    // First time creating dWallet with this curve - register encryption key
    await ikaTx.registerEncryptionKey({ curve });
    const latestNetworkKey = await ikaClient.getLatestNetworkEncryptionKey();
    activeEncryptionKeyId = latestNetworkKey.id;
}

// ✅ STEP 8: Prepare DKG parameters (heavy cryptography - 10-30s)
const dkgRequestInput = await prepareDKGAsync(
    ikaClient,
    curve,
    userShareEncryptionKeys,
    sessionIdentifierBytes,
    account.address
);

// ✅ STEP 9: Request dWallet DKG
const dWalletCap = await ikaTx.requestDWalletDKG({
    dkgRequestInput,
    ikaCoin,              // ← Real coin with balance!
    suiCoin,              // ← Real coin with balance!
    sessionIdentifier,
    dwalletNetworkEncryptionKeyId: activeEncryptionKeyId,
    curve,
});

// ✅ STEP 10: Transfer DWalletCap to user (CRITICAL!)
tx.transferObjects([dWalletCap], account.address);

// ✅ STEP 11: Sign and execute transaction
const result = await signAndExecuteTransaction({
    transaction: tx,
    options: {
        showEffects: true,
        showObjectChanges: true,
        showEvents: true,
    },
});
```

---

## Common Mistakes to Avoid

### ❌ MISTAKE 1: Using Zero-Value Coins in Production

```typescript
// ❌ WRONG - This pattern is for TESTS ONLY!
const ikaCoin = tx.moveCall({
    target: '0x2::coin::zero',
    arguments: [],
    typeArguments: [`${ikaPackage}::ika::IKA`],
});
```

**Why it fails**:
- Move contract checks `payment_ika.value() >= pricing_value.fee_ika()`
- Zero-value coin has 0 balance
- `assert!` on line 332 of `sessions_manager.move` will fail

### ❌ MISTAKE 2: Using coordinatorTransactions Instead of IkaTransaction

```typescript
// ❌ WRONG - Don't use low-level coordinatorTransactions directly
import { coordinatorTransactions } from '@ika.xyz/sdk';

const coordinatorObjectRef = tx.sharedObjectRef({...});
const sessionIdentifier = coordinatorTransactions.registerSessionIdentifier(
    networkConfig,
    coordinatorObjectRef,
    sessionIdentifierBytes,
    tx
);
```

```typescript
// ✅ CORRECT - Use IkaTransaction methods
const ikaTx = new IkaTransaction({ ikaClient, transaction: tx, userShareEncryptionKeys });
const sessionIdentifier = ikaTx.registerSessionIdentifier(sessionIdentifierBytes);
```

**Why the first approach is wrong**:
- SDK tests (line 203 in `helpers.ts`) show calling `registerSessionIdentifier` on `IkaTransaction`
- Low-level `coordinatorTransactions` requires manual shared object management
- `IkaTransaction` handles all the complexity internally

### ❌ MISTAKE 3: Forgetting to Transfer DWalletCap

```typescript
// ❌ WRONG - DWalletCap created but not transferred to user
const dWalletCap = await ikaTx.requestDWalletDKG({...});

// Execute transaction without transfer
await signAndExecuteTransaction({ transaction: tx });
// User won't receive the DWalletCap!
```

```typescript
// ✅ CORRECT - Always transfer DWalletCap to user
const dWalletCap = await ikaTx.requestDWalletDKG({...});
tx.transferObjects([dWalletCap], account.address);  // ← CRITICAL!
await signAndExecuteTransaction({ transaction: tx });
```

**Evidence**: SDK tests (line 220 in `helpers.ts`) always call `suiTransaction.transferObjects([dWalletCap], signerAddress)`

### ❌ MISTAKE 4: Not Setting Transaction Sender

```typescript
// ❌ WRONG - Missing sender
const tx = new Transaction();
const ikaTx = new IkaTransaction({ ikaClient, transaction: tx, ... });
// Later: TypeError: Cannot read properties of undefined...
```

```typescript
// ✅ CORRECT - Always set sender
const tx = new Transaction();
tx.setSender(account.address);  // ← CRITICAL!
```

### ❌ MISTAKE 5: Calling tx.build() Before Execution

```typescript
// ❌ WRONG - build() consumes the transaction!
await ikaTx.requestDWalletDKG({...});
const built = await tx.build();  // ← Transaction consumed here
await signAndExecuteTransaction({ transaction: tx });  // ← Fails! Transaction already built
```

```typescript
// ✅ CORRECT - Never call build() manually
await ikaTx.requestDWalletDKG({...});
tx.transferObjects([dWalletCap], account.address);
await signAndExecuteTransaction({ transaction: tx });  // ← SDK handles building
```

---

## Rust SDK Files Reference

### Key Rust Files for dWallet Operations

1. **`/ika/crates/ika-sui-client/src/ika_protocol_transactions.rs`** (21KB)
   - Protocol-level transaction builders
   - DKG request formatting
   - Session management

2. **`/ika/crates/ika-sui-client/src/ika_validator_transactions.rs`** (53KB)
   - Validator-side transaction handling
   - Consensus integration
   - Network key management

3. **`/ika/crates/dwallet-mpc-centralized-party/src/lib.rs`**
   - MPC cryptography implementation
   - DKG computation
   - Secret share encryption

4. **`/ika/crates/ika-core/src/consensus_handler.rs`**
   - Consensus validation logic
   - Session state management
   - Event processing

### Note on Rust SDK

The Rust code is primarily for:
- **Validator nodes** (backend infrastructure)
- **Network protocol** (consensus and MPC)
- **Testing infrastructure** (local network setup)

For **client-side browser applications**, use the **TypeScript SDK** (`@ika.xyz/sdk` + `@ika.xyz/ika-wasm`).

---

## Summary: Test vs Production

| Aspect | Test Environment (Localnet) | Production (Testnet/Mainnet) |
|--------|------------------------------|------------------------------|
| **Network** | Localnet | Testnet or Mainnet |
| **Pricing** | 0 or minimal (configurable) | Real fees (IKA + SUI) |
| **Coins** | Zero-value coins work | MUST use real coins with balance |
| **Validation** | May skip balance checks | Full validation enforced |
| **Purpose** | SDK development & testing | Real-world dApp usage |
| **Configuration** | `ika_config.json` (local) | `getNetworkConfig('testnet')` |

---

## Conclusion

**For Production dApps:**

1. ✅ Use real coins with actual balances (`tx.object(coinId)`, `tx.gas`)
2. ✅ Create `IkaTransaction` wrapper first
3. ✅ Call `ikaTx.registerSessionIdentifier()` on the wrapper
4. ✅ Transfer DWalletCap to user with `tx.transferObjects()`
5. ✅ Set transaction sender with `tx.setSender()`
6. ✅ Never call `tx.build()` manually

**Why Tests Mislead:**

- Tests run on localnet with zero pricing
- Zero-value coins only work because fees are disabled
- This is NOT the production pattern
- Always refer to Move contracts for ground truth

**Ground Truth:**

The Move contract source code in `/ika/deployed_contracts/testnet/` shows the real requirements:
- `assert!(payment_ika.value() >= pricing_value.fee_ika())`
- Coins must have sufficient balance
- Fees are deducted via `split()` method

---

## Files Referenced

### TypeScript SDK
- `/ika/sdk/typescript/test/helpers/test-utils.ts` - Test utilities with zero-value coin pattern
- `/ika/sdk/typescript/test/v2/helpers.ts` - DKG test helpers showing correct transaction flow
- `/ika/sdk/typescript/src/client/ika-transaction.ts` - IkaTransaction implementation
- `/ika/sdk/typescript/README.md` - SDK documentation

### Move Contracts
- `/ika/deployed_contracts/testnet/ika_dwallet_2pc_mpc/sources/sessions_manager.move` - Fee validation
- `/ika/deployed_contracts/testnet/ika_dwallet_2pc_mpc/sources/pricing.move` - Pricing structure
- `/ika/deployed_contracts/testnet/ika_dwallet_2pc_mpc/sources/coordinator.move` - DKG entry points
- `/ika/contracts/ika_system/tests/test_utils.move` - Test pricing configuration

### Rust SDK
- `/ika/crates/ika-sui-client/src/ika_protocol_transactions.rs` - Protocol transactions
- `/ika/crates/dwallet-mpc-centralized-party/src/lib.rs` - MPC cryptography
- `/ika/crates/ika-core/src/consensus_handler.rs` - Consensus handling

---

Generated: 2025-12-05
Purpose: Comprehensive understanding of client-side dWallet creation requirements
