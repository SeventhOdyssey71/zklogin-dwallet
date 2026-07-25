/**
 * Resolve a dWallet's public key and real per-chain addresses.
 *
 * Address derivation lives in `lib/utils/deriveAddresses.ts` and is shared with balance fetching,
 * so the addresses shown for receiving are exactly the ones the dWallet's MPC signing can spend.
 */

import { publicKeyFromDWalletOutput, Curve } from '@ika.xyz/sdk';
import type { AppSuiClient } from '@/lib/sui/client';
import { getIkaClient } from '@/lib/ika/ikaClient';
import { deriveChainAddresses } from '@/lib/utils/deriveAddresses';

export interface DWalletAddresses {
  publicKey: string;
  /** 0 = SECP256K1 (ECDSA), otherwise ED25519 (EdDSA). */
  curveNumber: number;
  addresses: Record<string, string>;
  active: boolean;
}

export async function getDWalletAddresses(
  suiClient: AppSuiClient,
  dwalletId: string
): Promise<DWalletAddresses> {
  const ikaClient = await getIkaClient(suiClient);

  const dWallet = await ikaClient.getDWallet(dwalletId);
  const curveNumber = dWallet.curve as number;
  // secp256k1=0, secp256r1=1, ed25519=2, ristretto=3
  const curveEnum =
    curveNumber === 0 ? Curve.SECP256K1 : curveNumber === 3 ? Curve.RISTRETTO : Curve.ED25519;

  const activeOutput = (dWallet.state as any).Active?.public_output;
  if (!activeOutput) {
    return { publicKey: '', curveNumber, addresses: {}, active: false };
  }

  const pk = await publicKeyFromDWalletOutput(curveEnum, Uint8Array.from(activeOutput));
  const publicKey = '0x' + Buffer.from(pk).toString('hex');
  const addresses = deriveChainAddresses(publicKey, curveNumber);

  return { publicKey, curveNumber, addresses, active: true };
}
