/**
 * The dWallet curve kinds, split out from `createDWallet`.
 *
 * `ALL_KINDS` is the only runtime value the Create screen needs before anyone clicks anything, but
 * importing it from `createDWallet` dragged that whole module — and with it `ethers` and the Ika SDK —
 * into the initial page bundle. Keeping the constant in a module with no dependencies lets the heavy
 * creation code load on demand instead.
 */

/** The three curves a zkLogin account can hold a dWallet on. */
export type DWalletKind = 'ECDSA' | 'EdDSA' | 'Schnorrkel';

/**
 * The curves a new account actually needs.
 *
 * Schnorrkel is deliberately absent: its only chain was Polkadot, which cannot sign (see the note in
 * chainRegistry.ts), so creating one spent ~0.07 SUI and IKA on a key with nowhere to send. The KIND
 * itself stays in `DWalletKind` so accounts that already hold one still list it rather than crashing.
 */
export const ALL_KINDS: DWalletKind[] = ['ECDSA', 'EdDSA'];
