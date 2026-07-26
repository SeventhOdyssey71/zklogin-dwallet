import {
  Connection, PublicKey, SystemProgram, TransactionInstruction,
  TransactionMessage, VersionedTransaction, AddressLookupTableAccount,
  NONCE_ACCOUNT_LENGTH,
} from '@solana/web3.js';

const RPC = 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC, 'confirmed');
console.log('NONCE_ACCOUNT_LENGTH =', NONCE_ACCOUNT_LENGTH);
console.log('rent-exempt lamports =', await conn.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH));

const USER = new PublicKey('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const quote = async (amt: string) =>
  (await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL}&outputMint=${USDC}&amount=${amt}&slippageBps=50`)).json() as any;

const q1 = await quote('100000000');
console.log('\n-- quote t=0: outAmount', q1.outAmount, 'threshold', q1.otherAmountThreshold, 'slot', q1.contextSlot);

const ix = await (await fetch('https://lite-api.jup.ag/swap/v1/swap-instructions', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userPublicKey: USER.toBase58(), quoteResponse: q1 }),
})).json() as any;

const de = (i: any) => new TransactionInstruction({
  programId: new PublicKey(i.programId),
  keys: i.accounts.map((a: any) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
  data: Buffer.from(i.data, 'base64'),
});

const altAddrs: string[] = ix.addressLookupTableAddresses ?? [];
const alts: AddressLookupTableAccount[] = [];
for (const a of altAddrs) {
  const r = await conn.getAddressLookupTable(new PublicKey(a));
  if (r.value) alts.push(r.value);
}
console.log('ALTs used:', altAddrs.length, '-> resolved', alts.length, 'containing', alts.map(a=>a.state.addresses.length), 'addresses');

// Fake nonce account + nonce value: prove the message compiles with nonceAdvance first.
const NONCE_ACCT = new PublicKey('11111111111111111111111111111112'); // placeholder, not a real nonce acct
const FAKE_NONCE = q1.contextSlot ? 'AkrQn5QWLACSP5EMT2R1ZHyKaGWVFrDHJ6NL89HKtwjQ' : '';

const advance = SystemProgram.nonceAdvance({ noncePubkey: NONCE_ACCT, authorizedPubkey: USER });

const instructions = [
  advance,
  ...(ix.computeBudgetInstructions ?? []).map(de),
  ...(ix.setupInstructions ?? []).map(de),
  de(ix.swapInstruction),
  ...(ix.cleanupInstruction ? [de(ix.cleanupInstruction)] : []),
];

const msg = new TransactionMessage({
  payerKey: USER,
  recentBlockhash: FAKE_NONCE,   // the durable nonce goes here
  instructions,
}).compileToV0Message(alts);

const vtx = new VersionedTransaction(msg);
const signable = msg.serialize();
console.log('\n-- durable-nonce v0 message compiled OK');
console.log('   numRequiredSignatures =', msg.header.numRequiredSignatures);
console.log('   static keys =', msg.staticAccountKeys.length, '| ALT lookups =', msg.addressTableLookups.length);
console.log('   first ix programId =', msg.staticAccountKeys[msg.compiledInstructions[0].programIdIndex].toBase58());
console.log('   nonce acct index =', msg.compiledInstructions[0].accountKeyIndexes[0],
            'writable =', msg.isAccountWritable(msg.compiledInstructions[0].accountKeyIndexes[0]));
console.log('   signable message bytes =', signable.length, '(this is what Ika would sign)');
console.log('   total wire size with 1 sig =', 1 + 64 + signable.length, 'bytes (limit 1232)');
console.log('   recentBlockhash field =', msg.recentBlockhash);

// Now measure 13s price drift
await new Promise(r => setTimeout(r, 13000));
const q2 = await quote('100000000');
const d = (Number(q2.outAmount) - Number(q1.outAmount)) / Number(q1.outAmount) * 100;
console.log('\n-- quote t=13s: outAmount', q2.outAmount, ' drift vs t=0:', d.toFixed(4), '%');
console.log('   t=0 minReceived (50bps) =', q1.otherAmountThreshold, '| t=13s actual out =', q2.outAmount,
            '| would still fill?', Number(q2.outAmount) >= Number(q1.otherAmountThreshold));
