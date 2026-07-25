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

/** Every curve, in the order they are created. */
export const ALL_KINDS: DWalletKind[] = ['ECDSA', 'EdDSA', 'Schnorrkel'];
