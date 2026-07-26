const SOL='So11111111111111111111111111111111111111112';
const q=async(out:string,amt:string)=>{
  const r=await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL}&outputMint=${out}&amount=${amt}&slippageBps=300`);
  if(!r.ok) return null; return await r.json() as any;
};
// find volatile recent tokens
let mints:{sym:string,mint:string}[]=[];
for (const url of ['https://lite-api.jup.ag/tokens/v2/recent','https://lite-api.jup.ag/tokens/v2/toptraded/24h']) {
  const r=await fetch(url); if(!r.ok){console.log('skip',url,r.status);continue;}
  const d=await r.json() as any[];
  console.log(url,'->',d.length,'tokens');
  for(const t of d.slice(0,60)){ if(t.id&&t.id!==SOL) mints.push({sym:t.symbol??'?',mint:t.id}); }
  break;
}
const known=[{sym:'BONK',mint:'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'},{sym:'WIF',mint:'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'},{sym:'JUP',mint:'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'}];
const cands=[...known, ...mints.slice(0,12)];
type Row={sym:string,drift:number,fills:boolean};
const t0:Record<string,any>={};
for(const c of cands){ const x=await q(c.mint,'50000000'); if(x&&x.outAmount) t0[c.mint]=x; }
console.log('baselined',Object.keys(t0).length,'tokens; waiting 13s...');
await new Promise(r=>setTimeout(r,13000));
const rows:Row[]=[];
for(const c of cands){ const a=t0[c.mint]; if(!a) continue; const b=await q(c.mint,'50000000'); if(!b?.outAmount) continue;
  const drift=(Number(b.outAmount)-Number(a.outAmount))/Number(a.outAmount)*100;
  rows.push({sym:c.sym,drift,fills:Number(b.outAmount)>=Number(a.otherAmountThreshold)});
}
rows.sort((x,y)=>Math.abs(y.drift)-Math.abs(x.drift));
console.log('\n13s output drift, 0.05 SOL buys, 300bps slippage baseline:');
for(const r of rows) console.log(`  ${r.sym.padEnd(12)} ${r.drift>=0?'+':''}${r.drift.toFixed(4)}%  stillFillsAt300bps=${r.fills}`);
const abs=rows.map(r=>Math.abs(r.drift)).sort((a,b)=>a-b);
if(abs.length) console.log(`\n  median |drift| = ${abs[Math.floor(abs.length/2)].toFixed(4)}%  max = ${abs[abs.length-1].toFixed(4)}%  n=${abs.length}`);
