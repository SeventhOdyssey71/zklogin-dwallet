/**
 * The Sui half of the pipeline: redeem a CCTP attestation into native USDC, then swap to USDsui.
 *
 * Both steps are ordinary Sui transactions signed by the zkLogin user — no dWallet involved, because
 * the destination is the user's own Sui address. That is the neat part of the architecture: Ika signs
 * the *foreign* chain, zkLogin signs Sui.
 *
 * The two steps are kept separate rather than fused into one PTB on purpose. The mint is the
 * irreversible, time-sensitive half (an attestation redeemed once cannot be redeemed again); the
 * swap is a market operation that can be retried, repriced, or skipped entirely if the user would
 * rather hold USDC. Bundling them would mean a slippage failure rolls back a redeemed attestation.
 */

import { Transaction } from '@mysten/sui/transactions';
import type { AppSuiClient } from '@/lib/sui/client';
import {
  CCTP_SUI,
  SUI_DENY_LIST,
  SUI_USDC_TYPE,
  USDSUI_TYPE,
  USDC_DECIMALS,
  USDSUI_DECIMALS,
} from './cctp';

export interface MintResult {
  digest: string;
  /** USDC in display units that the mint produced, when it can be determined. */
  amount?: string;
}

/**
 * Redeem a CCTP message + attestation on Sui, minting native USDC.
 *
 * Sui's CCTP V1 is a **five-call hot-potato chain**, and every signature below was read from the
 * deployed packages via `sui_getNormalizedMoveFunction` rather than guessed — the module names in
 * particular are not what the docs' prose suggests (`receive_message`, not `message_transmitter`):
 *
 *   1. receive_message::receive_message(message, attestation, &mut MTState, &TxContext) -> Receipt
 *   2. handle_receive_message::handle_receive_message<USDC>(
 *        Receipt, &mut TMState, &DenyList, &mut Treasury<USDC>, &mut TxContext
 *      ) -> StampReceiptTicketWithBurnMessage          ← this is where the USDC is minted
 *   3. handle_receive_message::deconstruct_stamp_receipt_ticket_with_burn_message(ticket)
 *        -> (StampReceiptTicket<MessageTransmitterAuthenticator>, BurnMessage)
 *   4. receive_message::stamp_receipt(StampReceiptTicket<_>, &MTState) -> StampedReceipt
 *   5. receive_message::complete_receive_message(StampedReceipt, &MTState)
 *
 * Every intermediate value is a hot potato — it cannot be stored, dropped or split across
 * transactions — so all five calls must land in one programmable transaction block. Step 5 is not
 * optional bookkeeping: without it the potato is never consumed and the whole transaction aborts.
 *
 * Note there is **no Coin returned**. `handle_receive_message` mints straight to the `mintRecipient`
 * encoded in the CCTP message, which is why nothing is transferred here — and why getting
 * `suiAddressToBytes32` right on the burn side is what actually determines who receives the funds.
 */
export async function buildMintTransaction(params: {
  message: string; // 0x-prefixed bytes from the source-chain MessageSent event
  attestation: string; // 0x-prefixed signature from Circle
}): Promise<Transaction> {
  const tx = new Transaction();

  const toBytes = (hex: string): number[] => {
    const h = hex.startsWith('0x') ? hex.slice(2) : hex;
    const out: number[] = [];
    for (let i = 0; i < h.length; i += 2) out.push(parseInt(h.substr(i, 2), 16));
    return out;
  };

  // 1. Verify Circle's attestation → Receipt.
  const [receipt] = tx.moveCall({
    target: `${CCTP_SUI.messageTransmitterPackage}::receive_message::receive_message`,
    arguments: [
      tx.pure.vector('u8', toBytes(params.message)),
      tx.pure.vector('u8', toBytes(params.attestation)),
      tx.object(CCTP_SUI.messageTransmitterState),
    ],
  });

  // 2. Mint. The USDC goes directly to the mintRecipient from the message.
  const [ticketWithBurnMessage] = tx.moveCall({
    target: `${CCTP_SUI.tokenMessengerMinterPackage}::handle_receive_message::handle_receive_message`,
    typeArguments: [SUI_USDC_TYPE],
    arguments: [
      receipt,
      tx.object(CCTP_SUI.tokenMessengerMinterState),
      tx.object(SUI_DENY_LIST),
      tx.object(CCTP_SUI.usdcTreasury),
    ],
  });

  // 3. Split the combined ticket into the stamp ticket and the burn message. `BurnMessage` has the
  // `drop` ability (verified on chain), so the second return value needs no explicit disposal.
  const [stampTicket] = tx.moveCall({
    target: `${CCTP_SUI.tokenMessengerMinterPackage}::handle_receive_message::deconstruct_stamp_receipt_ticket_with_burn_message`,
    arguments: [ticketWithBurnMessage],
  });

  // 4. Stamp the receipt with the token-messenger's authenticator.
  const [stampedReceipt] = tx.moveCall({
    target: `${CCTP_SUI.messageTransmitterPackage}::receive_message::stamp_receipt`,
    typeArguments: [
      `${CCTP_SUI.tokenMessengerMinterPackage}::message_transmitter_authenticator::MessageTransmitterAuthenticator`,
    ],
    arguments: [stampTicket, tx.object(CCTP_SUI.messageTransmitterState)],
  });

  // 5. Consume the stamped receipt. Mandatory — the hot potato must be destroyed here.
  tx.moveCall({
    target: `${CCTP_SUI.messageTransmitterPackage}::receive_message::complete_receive_message`,
    arguments: [stampedReceipt, tx.object(CCTP_SUI.messageTransmitterState)],
  });

  return tx;
}

export interface SwapQuote {
  /** Input amount in base units (6-decimal USDC). */
  amountIn: string;
  /** Expected output in base units. */
  amountOut: string;
  /** Human-readable output. */
  amountOutDisplay: string;
  /** Effective rate, USDsui out per USDC in. Should sit near 1.0. */
  price: number;
  /** Cetus's route object, passed straight back into the SDK to build the transaction. */
  route: RouterDataV3;
}

/**
 * Cetus's route object. `findRouters` returns `RouterDataV3 | null`, so strip the null here —
 * `quoteUsdcToUsdsui` already throws on a missing route, meaning a `SwapQuote` always carries a real one.
 */
type RouterDataV3 = NonNullable<
  Awaited<
    ReturnType<
      Awaited<typeof import('@cetusprotocol/aggregator-sdk')>['AggregatorClient']['prototype']['findRouters']
    >
  >
>;

/** Lazily construct the aggregator client — the SDK is heavy, so it stays out of the main bundle. */
async function aggregator(sender: string) {
  const { AggregatorClient, Env } = await import('@cetusprotocol/aggregator-sdk');
  return new AggregatorClient({ signer: sender, env: Env.Mainnet });
}

/**
 * Quote USDC → USDsui through the Cetus aggregator.
 *
 * Routed via the SDK's `findRouters` rather than a hand-built HTTP call: the aggregator spans
 * DeepBook, Kriya, FlowX, Aftermath, Turbos and Cetus's own pools, and the SDK owns the endpoint,
 * versioning and route encoding.
 *
 * Both tokens are 6-decimal, so a healthy quote sits close to 1:1. A large deviation means thin
 * liquidity, which is surfaced rather than silently accepted.
 */
export async function quoteUsdcToUsdsui(params: {
  amount: string; // display units
  sender: string;
}): Promise<SwapQuote> {
  const amountIn = BigInt(
    Math.round(parseFloat(params.amount) * 10 ** USDC_DECIMALS)
  ).toString();

  const client = await aggregator(params.sender);
  const route = await client.findRouters({
    from: SUI_USDC_TYPE,
    target: USDSUI_TYPE,
    amount: amountIn,
    byAmountIn: true,
  });

  if (!route || route.insufficientLiquidity || route.amountOut.isZero()) {
    throw new Error(
      'No USDC→USDsui route with sufficient liquidity on Cetus. USDsui is recent, so the pool may ' +
        'not be seeded on every venue yet — you can hold native USDC and swap later, or route ' +
        'through SUI as an intermediate hop.'
    );
  }

  const outDisplay = Number(route.amountOut.toString()) / 10 ** USDSUI_DECIMALS;
  const inDisplay = parseFloat(params.amount);

  return {
    amountIn,
    amountOut: route.amountOut.toString(),
    amountOutDisplay: outDisplay.toFixed(6),
    price: outDisplay / inDisplay,
    route,
  };
}

/**
 * Build the Cetus swap transaction from a quote.
 *
 * `fastRouterSwap` is used rather than `routerSwap` because it selects and merges the input coins
 * and transfers the output itself — with `routerSwap` the caller must supply an `inputCoin` argument
 * and hand-manage the returned coin, which is avoidable ceremony here.
 */
export async function buildSwapTransaction(params: {
  sender: string;
  quote: SwapQuote;
  /** Basis points; default 50 = 0.5%. */
  slippageBps?: number;
}): Promise<Transaction> {
  const client = await aggregator(params.sender);
  const tx = new Transaction();
  tx.setSender(params.sender);

  await client.fastRouterSwap({
    router: params.quote.route,
    slippage: (params.slippageBps ?? 50) / 10_000,
    txb: tx,
  });

  return tx;
}

/**
 * How much USDsui the address currently holds — used to confirm the pipeline actually landed
 * rather than trusting a transaction digest.
 */
export async function getUsdsuiBalance(
  suiClient: AppSuiClient,
  owner: string
): Promise<string> {
  const bal = await suiClient.getBalance({ owner, coinType: USDSUI_TYPE });
  return (Number(bal.totalBalance) / 10 ** USDSUI_DECIMALS).toFixed(6);
}
