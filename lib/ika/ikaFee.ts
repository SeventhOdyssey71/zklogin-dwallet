/**
 * Supplying the IKA coin that pays 2PC-MPC session fees.
 *
 * WHY THIS EXISTS
 * ---------------
 * The obvious implementation — `getCoins({ coinType: IKA })` then `tx.object(coin.coinObjectId)` —
 * fails on any account whose funds live in Sui's **address balance** rather than in classic owned
 * `Coin<T>` objects.
 *
 * With address balances (the accumulator, root object `0xacc`), `suix_getCoins` still returns an
 * entry, but it is a *synthetic* coin-reservation reference: its digest carries a 20-byte `0xac`
 * marker in bytes 12–32. `@mysten/sui` deliberately filters those out of `getCoins`/`getAllCoins`,
 * so the array comes back empty and the caller concludes "no IKA" — even though `getBalance` happily
 * reports the full amount. That mismatch is exactly the bug this replaces: the navbar (getBalance)
 * showed 100 IKA while dWallet creation (getCoins) insisted there was none.
 *
 * `coinWithBalance` is the correct primitive. It resolves at build time and knows how to withdraw
 * from the address balance *or* split from real coin objects, so it works whichever form the funds
 * take — which also means this code needs no branch for the two cases.
 *
 * IMPORTANT: the Move entrypoints take the fee coin as `&mut Coin<IKA>`, so they only deduct from it
 * and never consume it. A coin created inside the PTB and left unconsumed makes the whole transaction
 * abort with an unused-value error, so callers MUST hand the remainder back — `settle()` does that.
 */

import { coinWithBalance, type Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions';
import type { AppSuiClient } from '@/lib/sui/client';
import { IKA_COIN_TYPE, IKA_ACQUIRE_URL } from '@/lib/config/network';

export interface IkaFeeCoin {
  /** Pass as the `ikaCoin` argument. Safe to reuse across several calls in the same PTB. */
  coin: TransactionObjectArgument;
  /** Call once, after the last call that borrows the coin, to return the unspent remainder. */
  settle: () => void;
}

/**
 * Withdraw the account's IKA into a coin for this transaction.
 *
 * The full balance is withdrawn rather than a guessed fee amount: session pricing isn't known
 * client-side, and since `settle()` returns whatever is left it costs the user nothing.
 */
export async function prepareIkaFeeCoin(params: {
  tx: Transaction;
  suiClient: AppSuiClient;
  owner: string;
}): Promise<IkaFeeCoin> {
  const { tx, suiClient, owner } = params;

  // getBalance (not getCoins) — it reports address-balance funds correctly.
  const balance = await suiClient.getBalance({ owner, coinType: IKA_COIN_TYPE });
  const total = BigInt(balance.totalBalance);

  if (total === 0n) {
    throw new Error(
      `No IKA in ${owner}. Mainnet 2PC-MPC sessions are paid in IKA — get some at ${IKA_ACQUIRE_URL} ` +
        `and send it to this address.`
    );
  }

  // `tx.add` materialises the intent once so the same coin can be borrowed by several calls and
  // then transferred; passing the raw `coinWithBalance(...)` thunk repeatedly would create a new
  // coin per use.
  const coin = tx.add(
    coinWithBalance({ type: IKA_COIN_TYPE, balance: total, useGasCoin: false })
  );

  return {
    coin,
    settle: () => {
      tx.transferObjects([coin], owner);
    },
  };
}
