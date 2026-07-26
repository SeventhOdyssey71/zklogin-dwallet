/**
 * Turn raw errors into something a user can act on.
 *
 * The UI previously rendered `e.message` directly, which meant a failed send showed things like
 * "Error checking transaction input objects: Balance of gas object 280957005 is lower than the needed
 * amount: 500000000" — accurate, unreadable, and offering no clue what to do. Worse, on a monochrome
 * theme it rendered in the same white text as everything else, so it did not even read as an error.
 *
 * Each rule matches a failure we have actually hit, and says what to do about it. Anything unmatched is
 * passed through trimmed rather than replaced by a generic apology: an unfamiliar error is still the most
 * useful thing we have, and hiding it would make real bugs unreportable.
 */

export interface FriendlyError {
  /** One-line summary, safe to show prominently. */
  message: string;
  /** Optional next step. */
  action?: string;
  /** The original text, for the details disclosure. */
  raw: string;
}

interface Rule {
  match: RegExp;
  message: string;
  action?: string;
}

const RULES: Rule[] = [
  {
    /**
     * The Ika network's on-chain parameters have moved past what the published SDK can read.
     *
     * `reconfiguration_public_output_to_protocol_pp` fails with "invalid value: integer 3, expected variant
     * index 0 <= i < 2" for EVERY curve, including secp256k1 — so it is not our dWallet or our call, it is a
     * variant inside the network's reconfiguration output that @ika.xyz/ika-wasm 0.2.1 does not know about.
     * Both it and @ika.xyz/sdk 0.4.1 are the latest published versions, so there is no upgrade to take and
     * nothing application code can do. Saying so plainly beats showing a wasm deserialisation error.
     */
    match: /expected variant index|reconfiguration_public_output|networkDkgPublicOutput/i,
    message: 'The Ika network has updated its parameters beyond what the current SDK can read.',
    action:
      'Signing is unavailable until @ika.xyz/sdk publishes an update. Your funds and dWallets are unaffected — this only blocks new signatures.',
  },
  {
    match: /Not enough SUI for gas/i,
    message: 'Not enough SUI to pay for gas.',
    action: 'Top up the SUI balance on your zkLogin address, then try again.',
  },
  {
    match: /Balance of gas object .* is lower than the needed amount/i,
    message: 'Not enough SUI to cover this transaction’s gas budget.',
    action: 'Top up SUI on your zkLogin address — a signing round costs roughly 0.02 SUI.',
  },
  {
    match: /No IKA|insufficient.*IKA|ikaCoin/i,
    message: 'Not enough IKA to pay the 2PC-MPC session fee.',
    action: 'Swap some SUI for IKA on Cetus, then try again.',
  },
  {
    match: /No zkLogin session|not signed in|session expired|Invalid signature.*epoch/i,
    message: 'Your zkLogin session has expired.',
    action: 'Sign in with Google again to continue.',
  },
  {
    match: /insufficient funds|InsufficientFunds|exceeds balance|Insufficient balance/i,
    message: 'The sending address does not hold enough to cover the amount plus network fees.',
    action: 'Reduce the amount — Max already leaves room for fees.',
  },
  {
    match: /nonce (too low|has already been used)|replacement transaction underpriced/i,
    message: 'This transaction’s nonce was already used.',
    action: 'Wait for the previous transaction to confirm, then send again.',
  },
  {
    match: /Blockhash not found|block height exceeded|TransactionExpired/i,
    message: 'The Solana blockhash expired before the signature was ready.',
    action: 'Try again — a banked presignature makes the second attempt much faster.',
  },
  {
    match: /is not in KeyHolderSigned state|Please recreate your dWallet/i,
    message: 'This dWallet’s key generation never finished, so it cannot sign.',
    action: 'Create a new dWallet — an interrupted DKG cannot be resumed.',
  },
  {
    match: /not Active|is not activated/i,
    message: 'This dWallet is not active yet.',
    action: 'Wait for activation to finish, or create a new one if it stalled.',
  },
  {
    match: /EOnlyGlobalPresignAllowed|error_code: 31/i,
    message: 'The Ika coordinator requires a pooled presignature for this curve.',
    action: 'Reopen the send dialog so a presignature can be banked first.',
  },
  {
    match: /Unsupported chain/i,
    message: 'This chain cannot be sent from yet.',
  },
  {
    match: /rate limit|429|Too Many Requests/i,
    message: 'A network provider is rate-limiting us.',
    action: 'Wait a few seconds and try again.',
  },
  {
    match: /Failed to fetch|NetworkError|ERR_NAME_NOT_RESOLVED|ECONNREFUSED|fetch failed/i,
    message: 'Could not reach the network.',
    action: 'Check your connection and try again.',
  },
  {
    match: /502|Bad Gateway|execute failed/i,
    message: 'The signing service could not submit the transaction.',
    action: 'Try again — if it persists, check the SUI balance on your zkLogin address.',
  },
];

/** The longest raw error worth showing inline before it becomes noise. */
const RAW_INLINE_LIMIT = 240;

export function friendlyError(error: unknown): FriendlyError {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          })();

  const text = (raw ?? '').trim() || 'Something went wrong.';

  for (const rule of RULES) {
    if (rule.match.test(text)) {
      return { message: rule.message, action: rule.action, raw: text };
    }
  }

  // Unmatched: show it, but keep it to a readable length. The full text stays available in `raw`.
  return {
    message: text.length > RAW_INLINE_LIMIT ? `${text.slice(0, RAW_INLINE_LIMIT)}…` : text,
    raw: text,
  };
}
