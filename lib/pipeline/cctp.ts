/**
 * CCTP → Sui → USDsui: moving a deposit on another chain into Sui's native dollar.
 *
 * WHY A BRIDGE IS INVOLVED AT ALL
 * -------------------------------
 * A dWallet lets Sui *control* an address on another chain — it does not teleport value. Signing a
 * Solana transaction from Sui does not move SOL to Sui. So this pipeline splits cleanly in two:
 * Ika signs the source-chain leg, and Circle's CCTP performs the actual cross-chain move by burning
 * USDC on the source and minting native USDC on Sui. No wrapped assets, no liquidity pool, no
 * third-party bridge risk beyond Circle itself.
 *
 * V1, NOT V2 — THIS MATTERS
 * -------------------------
 * Circle runs two generations of CCTP with **separate contracts and incompatible message formats**.
 * Most EVM chains are on V2, but **Sui is only supported on V1 (legacy)**. A V2 burn therefore
 * cannot be minted by Sui's V1 transmitter — the funds would be burned with no way to complete the
 * transfer. Every address below is deliberately the **V1** deployment, and the attestation endpoint
 * is the V1 one. This is the single most dangerous detail in the whole flow.
 *
 * FLOW
 * ----
 *   1. approve USDC → TokenMessenger        (source chain, dWallet-signed)
 *   2. depositForBurn(amount, domain 8, mintRecipient = Sui address, USDC)
 *                                           (source chain, dWallet-signed) → emits MessageSent
 *   3. poll Circle's attestation service for the signature over that message
 *   4. receive_message + handle_receive_message on Sui  (zkLogin-signed) → native USDC minted
 *   5. Cetus aggregator swap USDC → USDsui  (zkLogin-signed)
 *
 * Steps 1–2 need native gas on the source chain (ETH/POL/AVAX/SOL). A wallet holding only USDC
 * cannot pay for its own burn, which is why `preflight` checks the gas balance and says so plainly
 * rather than letting the signature fail late.
 */

import { CHAIN_BY_ID, type ChainDef } from '@/lib/config/chainRegistry';

/** Circle's CCTP domain for Sui. */
export const SUI_CCTP_DOMAIN = 8;

/**
 * CCTP **V1** contracts on the source chains, verified against Circle's V1 EVM reference.
 * Unlike V2 (where every chain shares one address), V1 addresses are per-chain.
 */
export const CCTP_V1_EVM: Record<string, { tokenMessenger: string; messageTransmitter: string }> = {
  Ethereum: {
    tokenMessenger: '0xBd3fa81B58Ba92a82136038B25aDec7066af3155',
    messageTransmitter: '0x0a992d191DEeC32aFe36203Ad87D7d289a738F81',
  },
  Base: {
    tokenMessenger: '0x1682Ae6375C4E4A97e4B583BC394c861A46D8962',
    messageTransmitter: '0xAD09780d193884d503182aD4588450C416D6F9D4',
  },
  Arbitrum: {
    tokenMessenger: '0x19330d10D9Cc8751218eaf51E8885D058642E08A',
    messageTransmitter: '0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca',
  },
  Optimism: {
    tokenMessenger: '0x2B4069517957735bE00ceE0fadAE88a26365528f',
    messageTransmitter: '0x4D41f22c5a0e5c74090899E5a8Fb597a8842b3e8',
  },
  Polygon: {
    tokenMessenger: '0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE',
    messageTransmitter: '0xF3be9355363857F3e001be68856A2f96b4C39Ba9',
  },
  Avalanche: {
    tokenMessenger: '0x6B25532e1060CE10cc3B0A99e5683b91BFDe6982',
    messageTransmitter: '0x8186359aF5F57FbB40c6b14A588d2A59C0C29880',
  },
};

/** CCTP V1 packages and shared objects on Sui mainnet (all verified live on chain). */
export const CCTP_SUI = {
  messageTransmitterPackage:
    '0x08d87d37ba49e785dde270a83f8e979605b03dc552b5548f26fdf2f49bf7ed1b',
  tokenMessengerMinterPackage:
    '0x2aa6c5d56376c371f88a6cc42e852824994993cb9bab8d3e6450cbe3cb32b94e',
  messageTransmitterState:
    '0xf68268c3d9b1df3215f2439400c1c4ea08ac4ef4bb7d6f3ca6a2a239e17510af',
  tokenMessengerMinterState:
    '0x45993eecc0382f37419864992c12faee2238f5cfe22b98ad3bf455baf65c8a2f',
  usdcTreasury: '0x57d6725e7a8b49a7b2a612f6bd66ab5f39fc95332ca48be421c3229d514a6de7',
} as const;

/**
 * Sui's shared DenyList (`0x2::deny_list::DenyList`) at the well-known 0x403 address.
 * `handle_receive_message` takes it by reference so a regulated coin can block a mint.
 */
export const SUI_DENY_LIST =
  '0x0000000000000000000000000000000000000000000000000000000000000403';

/** Native USDC on Sui (6 decimals), and Sui's native dollar. */
export const SUI_USDC_TYPE =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export const USDSUI_TYPE =
  '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI';

/** Both are 6-decimal tokens — do not assume 9 like SUI itself. */
export const USDC_DECIMALS = 6;
export const USDSUI_DECIMALS = 6;

/** Circle's V1 attestation service. */
const IRIS_V1 = 'https://iris-api.circle.com/v1/attestations';

/** Minimal ABI fragments — only what the pipeline calls. */
export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
] as const;

export const TOKEN_MESSENGER_V1_ABI = [
  // V1 signature: no maxFee / minFinalityThreshold (those are V2 additions).
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64 nonce)',
] as const;

export const MESSAGE_TRANSMITTER_V1_ABI = [
  'event MessageSent(bytes message)',
] as const;

export interface PreflightResult {
  ok: boolean;
  chain: string;
  /** Human-readable reasons the transfer cannot proceed. */
  blockers: string[];
  usdcBalance: string;
  nativeBalance: string;
  needsApproval: boolean;
}

/**
 * A Sui address as the `bytes32` mintRecipient CCTP expects.
 *
 * Sui addresses are already 32 bytes, so this is a straight zero-padded copy — unlike an EVM
 * destination, where a 20-byte address is left-padded. Getting this wrong mints to an address
 * nobody controls, and the burn is irreversible.
 */
export function suiAddressToBytes32(suiAddress: string): string {
  const hex = suiAddress.startsWith('0x') ? suiAddress.slice(2) : suiAddress;
  if (!/^[0-9a-fA-F]{1,64}$/.test(hex)) {
    throw new Error(`Not a valid Sui address: ${suiAddress}`);
  }
  return '0x' + hex.padStart(64, '0').toLowerCase();
}

/** Is this chain a usable CCTP V1 source for a Sui destination? */
export function cctpSourceFor(chainId: string): (ChainDef & { cctp: { tokenMessenger: string; messageTransmitter: string } }) | null {
  const def = CHAIN_BY_ID[chainId];
  const cctp = CCTP_V1_EVM[chainId];
  if (!def || !cctp || def.cctpDomain === undefined || !def.usdc) return null;
  return { ...def, cctp };
}

/**
 * Check everything that could make the transfer fail, before anything is signed.
 *
 * The gas check is the important one: a dWallet funded only with USDC cannot pay for its own burn
 * transaction, and that is the single most common way this flow dies in practice.
 */
export async function preflight(params: {
  chain: string;
  fromAddress: string;
  amount: string; // display units, e.g. "25.5"
}): Promise<PreflightResult> {
  const { ethers } = await import('ethers');
  const source = cctpSourceFor(params.chain);

  const result: PreflightResult = {
    ok: false,
    chain: params.chain,
    blockers: [],
    usdcBalance: '0',
    nativeBalance: '0',
    needsApproval: true,
  };

  if (!source) {
    result.blockers.push(
      `${params.chain} is not a CCTP V1 source chain. CCTP cannot bridge from here to Sui — ` +
        `supported sources: ${Object.keys(CCTP_V1_EVM).join(', ')}.`
    );
    return result;
  }

  const provider = new ethers.JsonRpcProvider(source.rpcUrl);
  const usdc = new ethers.Contract(source.usdc!, ERC20_ABI, provider);

  const wanted = ethers.parseUnits(params.amount, USDC_DECIMALS);
  const [rawUsdc, rawNative, rawAllowance] = await Promise.all([
    usdc.balanceOf(params.fromAddress) as Promise<bigint>,
    provider.getBalance(params.fromAddress),
    usdc.allowance(params.fromAddress, source.cctp.tokenMessenger) as Promise<bigint>,
  ]);

  result.usdcBalance = ethers.formatUnits(rawUsdc, USDC_DECIMALS);
  result.nativeBalance = ethers.formatEther(rawNative);
  result.needsApproval = rawAllowance < wanted;

  if (rawUsdc < wanted) {
    result.blockers.push(
      `Insufficient USDC: have ${result.usdcBalance}, need ${params.amount}.`
    );
  }

  // Estimate what the two transactions will cost and compare against the native balance.
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  // approve ~60k, depositForBurn ~150k; double for headroom.
  const estGas = BigInt(210_000) * BigInt(2);
  const estCost = gasPrice * estGas;
  if (rawNative < estCost) {
    result.blockers.push(
      `Not enough ${source.symbol} for gas: have ${result.nativeBalance}, need roughly ` +
        `${ethers.formatEther(estCost)}. CCTP burns are signed on ${params.chain}, so this dWallet ` +
        `must hold native ${source.symbol} — USDC alone is not enough.`
    );
  }

  result.ok = result.blockers.length === 0;
  return result;
}

/**
 * Build the two unsigned source-chain transactions.
 *
 * Returned as plain transaction requests so they can be routed through the dWallet's MPC signer
 * exactly like a native transfer — the only difference is a populated `data` field.
 */
export async function buildBurnTransactions(params: {
  chain: string;
  fromAddress: string;
  suiRecipient: string;
  amount: string;
  skipApproval?: boolean;
}): Promise<
  { to: string; data: string; value: bigint; description: string }[]
> {
  const { ethers } = await import('ethers');
  const source = cctpSourceFor(params.chain);
  if (!source) throw new Error(`${params.chain} is not a CCTP V1 source chain`);

  const amount = ethers.parseUnits(params.amount, USDC_DECIMALS);
  const mintRecipient = suiAddressToBytes32(params.suiRecipient);

  const txs: { to: string; data: string; value: bigint; description: string }[] = [];

  if (!params.skipApproval) {
    const erc20 = new ethers.Interface(ERC20_ABI as unknown as string[]);
    txs.push({
      to: source.usdc!,
      data: erc20.encodeFunctionData('approve', [source.cctp.tokenMessenger, amount]),
      value: 0n,
      description: `Approve ${params.amount} USDC to the CCTP TokenMessenger`,
    });
  }

  const tm = new ethers.Interface(TOKEN_MESSENGER_V1_ABI as unknown as string[]);
  txs.push({
    to: source.cctp.tokenMessenger,
    data: tm.encodeFunctionData('depositForBurn', [
      amount,
      SUI_CCTP_DOMAIN,
      mintRecipient,
      source.usdc!,
    ]),
    value: 0n,
    description: `Burn ${params.amount} USDC for minting on Sui (domain ${SUI_CCTP_DOMAIN})`,
  });

  return txs;
}

/**
 * Pull the CCTP `message` bytes out of a burn transaction's receipt.
 *
 * The MessageSent event is emitted by the MessageTransmitter, not the TokenMessenger, so filter on
 * the transmitter's address to avoid picking up an unrelated log.
 */
export async function extractMessageFromReceipt(params: {
  chain: string;
  txHash: string;
}): Promise<{ message: string; messageHash: string }> {
  const { ethers } = await import('ethers');
  const source = cctpSourceFor(params.chain);
  if (!source) throw new Error(`${params.chain} is not a CCTP V1 source chain`);

  const provider = new ethers.JsonRpcProvider(source.rpcUrl);
  const receipt = await provider.getTransactionReceipt(params.txHash);
  if (!receipt) throw new Error(`No receipt for ${params.txHash}`);

  const iface = new ethers.Interface(MESSAGE_TRANSMITTER_V1_ABI as unknown as string[]);
  const topic = iface.getEvent('MessageSent')!.topicHash;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== source.cctp.messageTransmitter.toLowerCase()) continue;
    if (log.topics[0] !== topic) continue;
    const parsed = iface.decodeEventLog('MessageSent', log.data, log.topics);
    const message = parsed[0] as string;
    return { message, messageHash: ethers.keccak256(message) };
  }
  throw new Error('No MessageSent event found — was this actually a CCTP depositForBurn?');
}

export type AttestationStatus = 'pending' | 'complete';

/**
 * Poll Circle for the attestation over a burn message.
 *
 * Circle signs only after the source chain reaches its required finality, which on Ethereum means
 * ~13–19 minutes; L2s and Solana are considerably faster. The long default timeout reflects that
 * physical reality rather than any inefficiency here.
 */
export async function waitForAttestation(
  messageHash: string,
  options: { timeoutMs?: number; intervalMs?: number; onStatus?: (s: string) => void } = {}
): Promise<string> {
  const { timeoutMs = 30 * 60_000, intervalMs = 5_000, onStatus } = options;
  const deadline = Date.now() + timeoutMs;
  let polls = 0;

  while (Date.now() < deadline) {
    polls++;
    try {
      const res = await fetch(`${IRIS_V1}/${messageHash}`);
      if (res.ok) {
        const json = (await res.json()) as { status?: string; attestation?: string };
        if (json.status === 'complete' && json.attestation && json.attestation !== 'PENDING') {
          onStatus?.('Attestation received');
          return json.attestation;
        }
        onStatus?.(`Waiting for Circle attestation (source finality)… ${polls} checks`);
      } else if (res.status === 404) {
        // Circle has not indexed the burn yet — normal for the first few polls.
        onStatus?.(`Waiting for Circle to see the burn… ${polls} checks`);
      }
    } catch {
      onStatus?.('Attestation service unreachable, retrying…');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Attestation not available within ${Math.round(timeoutMs / 60_000)} minutes. The burn is ` +
      `already on chain and the funds are NOT lost — retry with the same message hash later: ${messageHash}`
  );
}
