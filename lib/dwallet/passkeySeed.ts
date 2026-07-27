'use client';

/**
 * The seed that encrypts the user's dWallet key share, taken from a passkey.
 *
 * WHY THIS REPLACES THE ADDRESS-DERIVED SEED
 * -----------------------------------------
 * The seed used to be `keccak256("ika-dwallet-<zkLoginAddress>-<curve>")`. Every input to that is
 * public: the address is on chain and the curve label is a constant in this file's neighbour. So
 * anyone could derive anyone's share-encryption keypair and decrypt the encrypted user share the
 * coordinator stores. It was never a secret, which means encrypting the share bought nothing.
 *
 * zkLogin cannot fix this on its own, and this is the part worth being precise about: zkLogin exposes
 * no stable *secret*. Its ephemeral key is regenerated every session, and everything durable about it
 * — the address, the issuer, the audience — is public by construction. Ika's devrel put it as "zkLogin
 * with Ika is not compatible"; the narrower and more useful statement is that zkLogin is a fine
 * *authenticator* and an unusable *key-derivation source*.
 *
 * So zkLogin keeps the jobs it is good at — proving who the user is, owning the dWallet cap that
 * authorises signing — and the passkey supplies the one thing it cannot: a stable secret only the user
 * can produce.
 *
 * WHY PRF AND NOT A PASSKEY SIGNATURE
 * -----------------------------------
 * The obvious idea is to sign something with the passkey and hash the signature. It does not work.
 * WebAuthn assertions are not deterministic: the authenticator signs over a client-data hash that
 * includes a fresh challenge and a signature counter that increments every use, and ECDSA itself uses
 * a random nonce. The same passkey signing "the same thing" twice gives two different signatures, so
 * the derived seed would change on every ceremony and the share would decrypt exactly once.
 *
 * The PRF extension (WebAuthn Level 2, backed by the authenticator's CTAP2 `hmac-secret`) is the
 * deterministic primitive. The authenticator holds a secret bound to the credential and returns
 * HMAC(credentialSecret, salt) — same credential and same salt, same 32 bytes, forever, on every
 * device the passkey syncs to. That is a key-derivation function, which is what this needs.
 *
 * WHAT THIS COSTS, HONESTLY
 * -------------------------
 * Recovery changes shape. The old scheme could rebuild the keys from a Google login alone, on any
 * device, with nothing stored — which was the product's headline and also precisely why it was
 * insecure. Now the passkey is load-bearing: lose every copy of it and the share cannot be decrypted.
 *
 * Two things bound that. Passkeys sync through iCloud Keychain and Google Password Manager, so the
 * normal case is that the credential already exists on the user's other devices. And `seedBackup.ts`
 * wraps this seed under a user-chosen password so there is a recovery path that does not depend on
 * the authenticator surviving.
 */

/** Salt for the PRF evaluation. Fixed and versioned: changing it derives a different seed. */
const PRF_SALT = new TextEncoder().encode('ika-dwallet-share-encryption-v1');

/** Relying-party name shown in the passkey prompt. */
const RP_NAME = 'ycos';

/** Where the credential id is remembered, per zkLogin address. */
const CREDENTIAL_KEY = 'ycos.passkey.credential.v1';

export interface PasskeyCapability {
  /** WebAuthn exists and this context can use it (secure context, platform authenticator available). */
  supported: boolean;
  /** Why not, when `supported` is false — shown to the user, so it must be in plain words. */
  reason?: string;
}

/**
 * Can this browser do what we need?
 *
 * Checked before offering wallet creation rather than discovered at the moment of failure. PRF support
 * specifically cannot be feature-detected in advance — `PublicKeyCredential` exposes no capability flag
 * for it, and the only honest test is to create a credential and read back
 * `getClientExtensionResults().prf.enabled`. So this checks what CAN be checked, and creation verifies
 * the rest and refuses if the extension came back unsupported.
 */
export async function passkeyCapability(): Promise<PasskeyCapability> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return { supported: false, reason: 'This browser does not support passkeys.' };
  }
  if (!window.isSecureContext) {
    return { supported: false, reason: 'Passkeys need a secure (HTTPS) connection.' };
  }
  try {
    const available =
      await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      return {
        supported: false,
        reason: 'No passkey authenticator on this device. Try a device with Touch ID, Face ID, Windows Hello or a security key.',
      };
    }
  } catch {
    // The query itself failing is not proof of absence; let creation be the judge.
  }
  return { supported: true };
}

/** The credential id we created for this account, if this browser has seen it. */
function rememberedCredential(zkAddress: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const all = JSON.parse(window.localStorage.getItem(CREDENTIAL_KEY) ?? '{}') as Record<string, string>;
    return all[zkAddress] ?? null;
  } catch {
    return null;
  }
}

function rememberCredential(zkAddress: string, credentialIdB64: string): void {
  if (typeof window === 'undefined') return;
  try {
    const all = JSON.parse(window.localStorage.getItem(CREDENTIAL_KEY) ?? '{}') as Record<string, string>;
    all[zkAddress] = credentialIdB64;
    window.localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(all));
  } catch {
    /* the credential is still discoverable without this; it just costs an extra prompt */
  }
}

const toB64 = (b: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(b)));

/**
 * Decode into a view over a plain `ArrayBuffer`.
 *
 * `Uint8Array.from` yields `Uint8Array<ArrayBufferLike>`, which TypeScript 5.9's DOM types no longer
 * accept as a `BufferSource` — the WebAuthn signatures want a view whose buffer is specifically an
 * `ArrayBuffer`. Allocating one explicitly satisfies that without a cast.
 */
function fromB64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Same reason as `fromB64`: the PRF salt has to be a view over a real `ArrayBuffer`. */
function bytes(source: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(source.length));
  out.set(source);
  return out;
}

/**
 * Create the passkey that will hold this account's seed.
 *
 * Run once, at wallet setup. `residentKey: 'required'` makes it discoverable, so a user arriving on a
 * new device can be prompted without us having to know the credential id first — which matters,
 * because the id lives in localStorage and localStorage is not the thing we want recovery to depend on.
 *
 * Throws if the authenticator created a credential without PRF. That is deliberate: silently
 * continuing would fall back to a seed the user cannot produce, and the failure would surface later as
 * an undecryptable share rather than here as a clear refusal.
 */
export async function createPasskey(zkAddress: string, label: string): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = new TextEncoder().encode(zkAddress);

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: RP_NAME, id: window.location.hostname },
      user: { id: userId, name: label, displayName: label },
      // ES256 first, RS256 as the fallback some authenticators still prefer.
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      timeout: 120_000,
      extensions: { prf: {} },
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error('Passkey creation was cancelled.');

  const results = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean };
  };
  if (!results.prf?.enabled) {
    throw new Error(
      'This authenticator cannot derive a wallet key (no PRF support). Try a different device, ' +
        'a platform passkey (Touch ID / Face ID / Windows Hello), or a recent security key.'
    );
  }

  rememberCredential(zkAddress, toB64(credential.rawId));
}

/**
 * Derive the 32-byte seed by evaluating the PRF against the account's passkey.
 *
 * Prompts the user — a Face ID / Touch ID confirmation — so callers should do this ONCE per session
 * and hold the derived keys in memory, not call it per signature. `lib/ika/shareKeys.ts` already
 * caches the derived `UserShareEncryptionKeys`, which is the right place for that to live.
 *
 * `allowCredentials` is passed when we know the id (fast path, no credential picker) and omitted when
 * we do not, letting the platform offer whatever discoverable credential it holds for this site. The
 * second path is what makes a fresh device work.
 */
export async function derivePasskeySeed(zkAddress: string): Promise<Uint8Array> {
  const known = rememberedCredential(zkAddress);
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: window.location.hostname,
      userVerification: 'required',
      timeout: 120_000,
      ...(known
        ? { allowCredentials: [{ type: 'public-key' as const, id: fromB64(known) }] }
        : {}),
      extensions: { prf: { eval: { first: bytes(PRF_SALT) } } },
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error('Passkey confirmation was cancelled.');

  const results = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const first = results.prf?.results?.first;
  if (!first) {
    throw new Error(
      'This passkey did not return a wallet key. It was probably created on a device without PRF ' +
        'support — use the password recovery option, or set up a new passkey.'
    );
  }

  // Remember the id now that we know it works, so the next prompt can skip the picker.
  rememberCredential(zkAddress, toB64(assertion.rawId));

  return new Uint8Array(first);
}

/** Has this browser got a credential recorded for the account? Only a UX hint — absence is not proof. */
export function hasRememberedPasskey(zkAddress: string): boolean {
  return rememberedCredential(zkAddress) !== null;
}

/** Forget the recorded credential ids on sign-out. The passkeys themselves are untouched. */
export function clearRememberedPasskeys(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CREDENTIAL_KEY);
  } catch {
    /* nothing to do */
  }
}
