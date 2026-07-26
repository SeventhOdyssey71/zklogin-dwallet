# CCTP → Cetus → USDsui pipeline

Built and verified against mainnet, **not yet wired into the UI** — nothing imports
`suiMintAndSwap.ts`, so none of this ships in the client bundle today.

- `cctp.ts` — Circle CCTP **V1** addresses and domains, `suiAddressToBytes32`, and a `preflight()`
  check. V1 specifically: Sui is domain 8 on V1 only, and V2 is not interoperable with it.
- `suiMintAndSwap.ts` — the five-call hot-potato mint chain on Sui, then the Cetus swap into USDsui.

Verified when written: all five Sui Move functions resolve against the deployed package, and Cetus
quoted USDC→USDsui at 0.9991.

What it still needs to become a feature: a UI flow to drive it, and a live end-to-end burn (which
needs real USDC on a source chain).
