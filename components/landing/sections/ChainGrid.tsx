'use client';

/**
 * The fourteen chains, as the proof of the headline.
 *
 * This is the one section that has to be exhaustive rather than illustrative: "multi-chain" is a claim
 * anything can make, and the only rebuttal is the full list. Names come from the registry, so the page
 * cannot advertise a chain the app does not actually address, and cannot omit one it does.
 *
 * Labels are the registry `id` (Base, Arbitrum, Optimism) rather than `name` ("Arbitrum One", "OP
 * Mainnet"): at seven columns the longer forms wrap, and the deployment a chain calls itself is a
 * distinction that belongs in the tooltip rather than in a scan-once grid.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useChainAssets, type ChainAsset } from '@/components/ChainChips';
import { CHAINS, chainsForCurve, type ChainDef, type CurveKind } from '@/lib/config/chainRegistry';
import { Reveal, Section, SectionHeader, STAGGER_CHILD, STAGGER_PARENT } from './shared';

/**
 * How one key becomes many chains.
 *
 * Counts are derived, never written down — the point of the section is that the numbers add up, and a
 * hardcoded "10 chains" that disagreed with the grid above it would undo exactly that.
 */
const KEY_GROUPS: { curve: CurveKind; scheme: string; covers: string }[] = [
  { curve: 'ECDSA', scheme: 'secp256k1', covers: 'Bitcoin and every EVM chain' },
  { curve: 'EdDSA', scheme: 'ed25519', covers: 'Solana, NEAR and Cardano' },
  { curve: 'Schnorrkel', scheme: 'sr25519', covers: "Polkadot, on Substrate's native scheme" },
];

function ChainTile({ chain, asset }: { chain: ChainDef; asset?: ChainAsset }) {
  const [broken, setBroken] = useState(false);
  const symbol = asset?.symbol || chain.symbol;
  const logo = asset?.logo;

  return (
    <motion.li
      variants={STAGGER_CHILD}
      title={`${chain.name} · gas paid in ${symbol}`}
      className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-3 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
    >
      {/* Light disc: several official marks are solid black and would vanish on this background. */}
      <span className="grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-full bg-white/90">
        {logo && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt=""
            width={20}
            height={20}
            loading="lazy"
            onError={() => setBroken(true)}
            className="h-5 w-5 object-contain"
          />
        ) : (
          <span className="text-[8px] font-bold text-black">{symbol.slice(0, 2)}</span>
        )}
      </span>
      <span className="truncate text-[12px] font-semibold tracking-tight">{chain.id}</span>
    </motion.li>
  );
}

export function ChainGrid() {
  const assets = useChainAssets();

  return (
    <Section id="chains">
      <SectionHeader
        eyebrow={`${CHAINS.length} chains · one account`}
        title="Every chain you get, listed."
        lede="Each one is a real address on its own chain. It receives, and it sends — no wrapped balance standing in for the asset, no separate account to manage per network."
      />

      <Reveal delay={0.06} className="mt-10 sm:mt-12">
        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-72px' }}
          variants={STAGGER_PARENT}
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7"
        >
          {CHAINS.map((c) => (
            <ChainTile key={c.id} chain={c} asset={assets[c.id]} />
          ))}
        </motion.ul>
      </Reveal>

      <Reveal delay={0.1} className="mt-12 sm:mt-14">
        <h3 className="text-base sm:text-lg font-bold tracking-[-0.02em]">
          Three keys cover all {CHAINS.length}.
        </h3>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)] text-pretty">
          A key is only a keypair on a curve. What makes it a Bitcoin wallet or a Solana wallet is how
          the public key is encoded into an address and how that chain serialises a transaction — so one
          key already controls a whole family of chains, with no extra key material.
        </p>

        <dl className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-3 border-t border-[var(--border)] pt-6">
          {KEY_GROUPS.map((g) => {
            const count = chainsForCurve(g.curve).length;
            return (
              <div key={g.curve} className="min-w-0">
                <dt className="flex items-baseline gap-2">
                  <span className="num text-xl font-extrabold tracking-[-0.03em]">{count}</span>
                  <span className="mono-label">{g.scheme}</span>
                </dt>
                <dd className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">{g.covers}</dd>
              </div>
            );
          })}
        </dl>
      </Reveal>
    </Section>
  );
}
