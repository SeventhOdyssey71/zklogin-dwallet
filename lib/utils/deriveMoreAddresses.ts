/**
 * Substrate SS58 address encoding.
 *
 * SS58 encodes only the 32-byte public key, so it is curve-agnostic — the same function serves the
 * sr25519 (RISTRETTO) key Polkadot natively uses and an ed25519 key alike. Prefix 0 is Polkadot.
 *
 * Verified against `@polkadot/util-crypto`'s `encodeAddress` across several keys and both the
 * Polkadot (0) and generic Substrate (42) prefixes. An address wrong by one byte silently sends funds
 * somewhere unspendable, so this is checked against a reference implementation rather than trusted by
 * inspection.
 */

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  let num = BigInt('0x' + (hex || '0'));
  let out = '';
  while (num > 0n) {
    out = BASE58[Number(num % 58n)] + out;
    num /= 58n;
  }
  // Leading zero bytes encode as '1' and are lost by the bigint conversion above.
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

export function deriveSs58Address(publicKey: string, prefix = 0): string {
  const hex = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
  const key = new Uint8Array(hex.length / 2);
  for (let i = 0; i < key.length; i++) key[i] = parseInt(hex.substr(i * 2, 2), 16);
  if (key.length !== 32) {
    throw new Error(`Expected a 32-byte Substrate public key, got ${key.length}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { blake2b } = require('blakejs');

  const payload = new Uint8Array(1 + key.length);
  payload[0] = prefix;
  payload.set(key, 1);

  // Checksum = first 2 bytes of blake2b-512("SS58PRE" || prefix || pubkey)
  const tag = new TextEncoder().encode('SS58PRE');
  const hashInput = new Uint8Array(tag.length + payload.length);
  hashInput.set(tag, 0);
  hashInput.set(payload, tag.length);
  const checksum = new Uint8Array(blake2b(hashInput, null, 64)).slice(0, 2);

  const address = new Uint8Array(payload.length + 2);
  address.set(payload, 0);
  address.set(checksum, payload.length);
  return base58Encode(address);
}
