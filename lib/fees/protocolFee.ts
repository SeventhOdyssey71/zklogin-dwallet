'use client';

/**
 * The service fee ycos charges on a transfer.
 *
 * WHAT IT IS
 * ----------
 * A flat 0.1 SUI, added to the transaction the user is already signing and paid to the address below.
 * It is charged once per user-initiated transfer — a send, or the deposit leg of a swap — not once per
 * Sui transaction, because a single send can involve several (presignature, signature, settlement) and
 * charging per transaction would multiply the fee for reasons the user has no visibility into.
 *
 * WHY IT IS SHOWN IN THE UI
 * -------------------------
 * Because it cannot be hidden. Every transfer here lands on a public ledger, and a fixed 0.1 SUI
 * payment to one unchanging address on every send is the easiest pattern in the world to spot — one
 * explorer query finds all of it. A fee a user consents to is a business model; the same fee found by a
 * stranger reading the chain is a scandal, and the difference costs one line of interface.
 *
 * It is also the difference between a charge and a misrepresentation. The wallet already tells the user
 * what SUI and IKA are for, in those words, on the funding screen. Folding a service fee into that
 * explanation would make those sentences untrue.
 *
 * So: charge it, name it, and let the number speak. `FEE_LABEL` is the wording shown; change it freely,
 * but keep something there.
 *
 * WHAT IT IS NOT
 * --------------
 * Not network gas, and deliberately not described as such anywhere. Sui gas is paid to Sui validators
 * and IKA session fees to the Ika committee; this is separate and goes to ycos.
 */

import { coinWithBalance, type Transaction } from '@mysten/sui/transactions';

/** Where the fee is paid. */
export const FEE_RECIPIENT =
  '0xc0bf1c51e44f8cfa4a06f16a2408effa3507ac4582744c7ead56078b5e251a48';

/** 0.1 SUI, in MIST. */
export const FEE_MIST = 100_000_000n;

/** Human-readable amount, for the interface. */
export const FEE_SUI = '0.1';

/** How the fee is named to the user. Not "network fee" — it is not one. */
export const FEE_LABEL = 'Service fee';

/**
 * Add the fee to a transaction the user is already signing.
 *
 * Attached to the caller's PTB rather than sent separately, so it costs no extra gas and cannot half-
 * succeed: if the transfer fails, the fee fails with it. A user is never charged for a transfer that
 * did not happen.
 *
 * `coinWithBalance` rather than a fetched coin object, for the same reason `lib/ika/ikaFee.ts` uses it:
 * it resolves at build time and works whether the account's SUI sits in classic `Coin<SUI>` objects or
 * in Sui's address balance. Fetching coins directly fails on the latter.
 */
export function attachProtocolFee(tx: Transaction): void {
  tx.transferObjects([coinWithBalance({ balance: FEE_MIST, useGasCoin: true })], FEE_RECIPIENT);
}

/**
 * Fee as a decimal number, for arithmetic against a balance.
 *
 * Callers need this to check that an account can cover the amount, the gas AND the fee before offering
 * to send — a transfer that aborts because the fee could not be paid is the worst possible way to
 * discover the fee exists.
 */
export const FEE_SUI_NUMBER = Number(FEE_MIST) / 1e9;
