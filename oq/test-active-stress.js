/* Additional adversarial exact tests; same preregistered contract, no relaxed gate. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const A=require('./oqactive.js'),F=require('./oqaffine.js'),R=require('./oqrank.js');
const OQ=require(path.join(process.env.OQ_ENGINE_DIR||__dirname,'oq.js'));
const originalCreate=R.create,originalRun=R.run;
const hash=crypto.createHash('sha256');
const totals={highRankCircuits:0,expectations:0,events:0,amplitudes:0,queries:0,counterChecks:0,guards:0};
const witnesses=[];
function pop(x){let n=0;while(x){x&=x-1n;n++;}return n;}
function mul(a,b){const c=[0n,0n,0n,0n];for(let i=0;i<4;i++)for(let j=0;j<4;j++)c[(i+j)%4]+=(i+j<4?1n:-1n)*a[i]*b[j];return c;}
function rotate(a,k){k=((k%8)+8)%8;const b=[0n,0n,0n,0n];for(let i=0;i<4;i++)b[(i+k)%4]+=((i+k)%8<4?1n:-1n)*a[i];return b;}
function conj(a){return [a[0],-a[3],-a[2],-a[1]];}
function amp(s,y){const a=s.amp(y);return [a.c0,a.c1,a.c2,a.c3];}
function same(v,num,d,label){for(let j=0;j<4;j++)assert.equal(v.numerator[j]*(1n<<BigInt(d)),num[j]*(1n<<BigInt(v.denominatorExp)),label);hash.update(v.numerator.join(',')+'/'+v.denominatorExp+'\n');}
function expected(s,p){let out=[0n,0n,0n,0n];for(let i=0;i<s.size;i++){const term=rotate(mul(conj(amp(s,Number(BigInt(i)^p.x))),amp(s,i)),2*p.phase+4*(pop(BigInt(i)&p.z)%2));out=out.map((x,j)=>x+term[j]);}return out;}
function born(s,mask,value){let out=[0n,0n,0n,0n];for(let i=0;i<s.size;i++)if((BigInt(i)&mask)===value){const v=mul(conj(amp(s,i)),amp(s,i));out=out.map((x,j)=>x+v[j]);}return out;}
R.create=()=>{throw Error('active coefficient array forbidden');};R.run=R.create;
for(const n of [3,4])for(const input of [0n,(1n<<BigInt(n))-1n]){
    const gates=[['h',0],['h',1],['h',2],['cx',0,1],['zpow',1,1],['zpow',0,3],
        ['zpow',2,2],['h',2],['zpow',2,5]];
    if(n===4)gates.push(['h',3],['zpow',3,7]);
    gates.push(['cx',1,2],['h',1],['zpow',0,6],['swap',0,2]);
    if(n===4)gates.push(['cx',2,3],['h',3]);
    const source={n,ring:8,gates},prepared=A.prepare(source,{input});
    assert.equal(prepared.stats.activeRank,n);
    const inputGates=[];for(let q=0;q<n;q++)if((input>>BigInt(q))&1n)inputGates.push(['x',q]);
    const refPlan=R.plan(inputGates.concat(gates),n),ref=originalCreate(refPlan);while(ref.step()){}
    // Nonorthogonality is deliberately present, not assumed away by changing basis.
    assert.ok(refPlan.basis.vectors.some((a,i)=>refPlan.basis.vectors.some((b,j)=>i!==j&&(pop(a&b)&1))));
    const s=new OQ.State(n);for(const g of inputGates.concat(gates))OQ.apply(s,g);
    for(let y=0;y<2**n;y++){
        const out=F.solve(F.amplitude(prepared.activeProgram,BigInt(y)),{maxAssignments:16777216});
        same(out.value,ref.coefficients[y],ref.denom,'active coefficient');totals.amplitudes++;
    }
    let maxChi=0;
    for(let x=0;x<2**n;x++)for(let z=0;z<2**n;z++)for(let sign=0;sign<2;sign++){
        const p={x:BigInt(x),z:BigInt(z),phase:(pop(BigInt(x&z))+2*sign)%4};
        const out=A.expectation(prepared,p,{backend:'enumerate',maxAssignments:16777216});
        same(out.value,expected(s,p),2*s.denom,'high-rank expectation');totals.expectations++;
        maxChi=Math.max(maxChi,out.stats.maxPhaseRank);totals.queries+=out.stats.queries;
    }
    const mask=(1n<<BigInt(n))-1n;
    for(let value=0;value<2**n;value++){
        const out=A.probability(prepared,mask,BigInt(value),{backend:'enumerate',maxAssignments:16777216});
        same(out.value,born(s,mask,BigInt(value)),2*s.denom,'all joint outcomes');totals.events++;
    }
    witnesses.push({n,input:input.toString(),rank:prepared.stats.activeRank,maxChi});totals.highRankCircuits++;
}
// Returned scalars must not depend on discarded physical global phase.
const base={n:1,ring:8,gates:[['h',0],['zpow',0,1],['h',0]]};
for(let k=0;k<8;k++){
    const p=A.prepare({...base,gates:[['gphase',k],...base.gates]});
    same(A.probability(p,1n,0n).value,[2n,1n,0n,-1n],2,'physical global phase');
}
const p=A.prepare(base),q=A.query(p,'Z0');
const compiled=F.toCNF(q.query);
function brute(cnf){assert.ok(cnf.nVars<=16);let count=0n;for(let z=0;z<2**cnf.nVars;z++)if(cnf.clauses.every(c=>c.some(l=>Boolean((z>>(Math.abs(l)-1))&1)===(l>0))))count++;return count;}
const counted=A.expectation(p,'Z0',{backend:'cnf',counter(cnf){totals.counterChecks++;return brute(cnf);}});
same(counted.value,[0n,1n,0n,-1n],1,'external exact counter');
assert.equal(counted.stats.externalCalls,8);assert.equal(counted.stats.dpllNodes,0);
function refused(fn,re){assert.throws(fn,re);totals.guards++;}
refused(()=>A.expectation(p,'Z0',{backend:'cnf',counter:()=>Promise.resolve(1n)}),/BigInt/);
refused(()=>A.expectation(p,'Z0',{backend:'cnf',counter:()=>-1n}),/BigInt/);
refused(()=>A.expectation(p,'Z0',{backend:'cnf',maxVariables:0}),/variable/);
refused(()=>A.prepare({...base,gates:[['mcpow',1,4,[0]]]}),/mask/);
refused(()=>A.query(p,{x:0n,z:2n,phase:0}),/Pauli/);
refused(()=>A.probability(p,-1n,0n),/mask/);
refused(()=>A.probability(p,1n,-1n),/value/);
// Shared query and linear-work budgets do not restart for each projector term.
refused(()=>A.probability(p,1n,0n,{maxQueries:0}),/budget/);
refused(()=>A.probability(p,1n,0n,{maxLinearWork:0}),/work/);
// Deep case is intentionally NOT asserted fast.
const deep=A.prepare({n:1,ring:8,gates:Array.from({length:32},()=>[['h',0],['zpow',0,1]]).flat()});
refused(()=>A.expectation(deep,'Z0',{backend:'cnf',maxNodes:8}),/budget/);
R.create=originalCreate;R.run=originalRun;
console.log('C-OQ-ACTIVE-PHASE-N adversarial high-rank acceptance');
console.log(JSON.stringify(totals));
console.log('WITNESSES '+JSON.stringify(witnesses));
console.log('DIGEST '+hash.digest('hex'));
console.log('PASS: signed observables, nonorthogonal bases and explicit unfavorable case');
