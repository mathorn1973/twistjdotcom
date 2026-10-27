/* Exact finite regression for C-OQ-PATHCOUNT-N. No performance theorem. */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const C = require('./oqcount.js');
const source = process.env.OQ_ENGINE_DIR || __dirname;
const OQ = require(path.join(source, 'oq.js'));
const OQ16 = require(path.join(source, 'oq16.js'));
const QASM = require(path.join(source, 'qasm.js'));
const total = {circuits:0, amplitudes:0, probabilities:0, histograms:0, tinyCNFs:0,
    genericCNFs:0, guards:0, qasmPrograms:0, newerQasmPrograms:0, wide:0};
let digest = crypto.createHash('sha256');
const record = obj => digest.update(JSON.stringify(obj, (_,v) => typeof v === 'bigint' ? v.toString() : v)+'\n');
const options = {maxNodes: 500000};
function coefficients(state, b, ring) {
    const a = state.amp(b);
    return ring === 8 ? [a.c0,a.c1,a.c2,a.c3] : a;
}
function equal(actual, num, den, label) {
    assert.equal(actual.numerator.length,num.length,label);
    for (let i=0;i<num.length;i++) assert.equal(
        actual.numerator[i] * (1n << BigInt(den)),
        num[i] * (1n << BigInt(actual.denominatorExp)),label+' coefficient '+i);
    record(actual);
}
/* Independent polynomial multiplication and conjugation for dense Born data. */
function multiply(a,b) {
    const d=a.length, out=Array(d).fill(0n);
    for(let i=0;i<d;i++) for(let j=0;j<d;j++)
        out[(i+j)%d] += (i+j<d ? 1n:-1n)*a[i]*b[j];
    return out;
}
function conjugate(a) {
    const out=Array(a.length).fill(0n); out[0]=a[0];
    for(let i=1;i<a.length;i++) out[a.length-i]=-a[i];
    return out;
}
function denseProbability(state, ring, mask, value) {
    const sum=Array(ring/2).fill(0n);
    for(let b=0;b<state.size;b++) if((BigInt(b)&mask)===value) {
        const a=coefficients(state,b,ring), z=multiply(a,conjugate(a));
        for(let i=0;i<sum.length;i++)sum[i]+=z[i];
    }
    return sum;
}
/* Independent path enumeration, not CNF interpretation and not dense algebra. */
function histories(p,input) {
    const h=p.gates.filter(g=>g[0]==='h').length;
    assert.ok(h<=12,'test-only path enumerator bound');
    const out=[];
    for(let assignment=0;assignment<2**h;assignment++) {
        let bits=input,phase=0,j=0;
        for(const g of p.gates) {
            const get=q=>Number((bits>>BigInt(q))&1n);
            const flip=q=>{bits^=1n<<BigInt(q);};
            switch(g[0]) {
            case 'h': {const old=get(g[1]), next=(assignment>>j++)&1;
                phase += p.ring/2*old*next; if(old!==next)flip(g[1]); break;}
            case 'x':flip(g[1]);break;
            case 'cx':if(get(g[1]))flip(g[2]);break;
            case 'swap':if(get(g[1])!==get(g[2])){flip(g[1]);flip(g[2]);}break;
            case 'gphase':phase+=g[1];break;
            case 'zpow':phase+=g[2]*get(g[1]);break;
            case 'mcpow':if((bits&BigInt(g[1]))===BigInt(g[1]))phase+=g[2];break;
            default:throw Error('unknown reference op');
            }
        }
        out.push({bits,phase:((phase%p.ring)+p.ring)%p.ring});
    }
    return out;
}
function expectedHistogram(p,paths,problem) {
    const counts=Array(p.ring).fill(0n);
    if(problem.kind==='amplitude') {
        for(const a of paths)if(a.bits===problem.value)counts[a.phase]++;
    } else {
        for(const a of paths) if((a.bits&problem.mask)===problem.value)
            for(const b of paths) if(a.bits===b.bits)
                counts[(a.phase-b.phase+p.ring)%p.ring]++;
    }
    return counts;
}
function checkCircuit(p,input=0n,full=true) {
    const engine=p.ring===8?OQ:OQ16;
    const state=new engine.State(p.n);
    for(let q=0;q<p.n;q++)if((input>>BigInt(q))&1n)engine.apply(state,['x',q]);
    for(const g of p.gates)engine.apply(state,g);
    const paths=histories(p,input); total.circuits++;
    const outs=full ? Array.from({length:state.size},(_,i)=>i) : [0,state.size-1];
    for(const y of outs) {
        const problem=C.amplitude(p,BigInt(y),{input}); const got=C.solve(problem,options);
        assert.deepEqual(got.counts,expectedHistogram(p,paths,problem),'amplitude histogram');
        total.histograms++;equal(got.value,coefficients(state,y,p.ring),state.denom,'amplitude');
        total.amplitudes++;
    }
    const events=[[0n,0n],[1n,0n],[1n,1n],[(1n<<BigInt(p.n))-1n,0n]];
    for(const [mask,value] of events) {
        const problem=C.probability(p,mask,value,{input});const got=C.solve(problem,options);
        assert.deepEqual(got.counts,expectedHistogram(p,paths,problem),'paired-path histogram');
        total.histograms++; equal(got.value,denseProbability(state,p.ring,mask,value),2*state.denom,'probability');
        if(mask===0n)equal(got.value,[1n,...Array(p.ring/2-1).fill(0n)],0,'Born normalization');
        total.probabilities++;
    }
}
function program(n,ring,gates){return {n,ring,gates};}
for(const ring of [8,16]) {
    const t=ring/8;
    const cases=[program(1,ring,[]),program(1,ring,[['h',0]]),
        program(1,ring,[['h',0],['h',0]]),
        program(1,ring,[['h',0],['zpow',0,t],['h',0]]),
        program(1,ring,[['gphase',1],['h',0],['zpow',0,-1],['h',0]]),
        program(2,ring,[['h',0],['cx',0,1]]),
        program(3,ring,[['h',0],['cx',0,1],['cx',1,2],['swap',0,2],['mcpow',7,1]]),
        program(2,ring,[['h',0],['h',1],['mcpow',3,-1],['h',1]]),
        program(2,ring,[['mcpow',0,1],['x',1],['swap',0,1]])];
    for(const p of cases){checkCircuit(p);checkCircuit(p,(1n<<BigInt(p.n))-1n);}
}
let rng=0x3782026;
function rand(n){rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng%n;}
for(const ring of [8,16]) for(let test=0;test<32;test++) {
    const n=1+rand(3), gates=[];let h=0;
    for(let j=0;j<16;j++) {
        let op=rand(n===1?4:7),q=rand(n);
        if(op===0&&h<4){gates.push(['h',q]);h++;}
        else if(op===1)gates.push(['x',q]);
        else if(op===2)gates.push(['zpow',q,rand(2*ring)-ring]);
        else if(op===3)gates.push(['gphase',rand(2*ring)-ring]);
        else if(op===4)gates.push(['cx',q,(q+1+rand(n-1))%n]);
        else if(op===5)gates.push(['swap',q,(q+1+rand(n-1))%n]);
        else gates.push(['mcpow',1+rand((1<<n)-1),rand(ring)]);
    }
    checkCircuit(program(n,ring,gates),BigInt(rand(1<<n)));
}
function brute(cnf) {
    assert.ok(cnf.nVars<=18);let count=0n;
    for(let a=0;a<2**cnf.nVars;a++)if(cnf.clauses.every(c=>c.some(l=>
        Boolean((a>>(Math.abs(l)-1))&1)===(l>0))))count++;
    return count;
}
for(let t=0;t<50;t++) {
    const n=1+rand(7),cs=[];
    for(let j=0;j<rand(12);j++) {const c=[];for(let k=0;k<rand(4);k++)c.push((rand(2)?1:-1)*(1+rand(n)));cs.push(c);}
    const q={nVars:n,clauses:cs};assert.equal(C.countCNF(q),brute(q));total.genericCNFs++;
}
const tiny=C.amplitude(program(1,8,[['h',0],['zpow',0,1],['h',0]]),0n);
assert.ok(tiny.nVars<=18);
for(let r=0;r<8;r++) {const q=C.phaseQuery(tiny,r);assert.equal(C.countCNF(q),brute(q));total.tinyCNFs++;}
assert.equal(C.countCNF({nVars:80,clauses:[]}),1n<<80n);
assert.equal(C.countCNF({nVars:0,clauses:[]}),1n);
assert.equal(C.countCNF({nVars:0,clauses:[[]]}),0n);
assert.equal(C.countCNF({nVars:4,clauses:[[1],[-1]]}),0n);
total.genericCNFs+=4;
const text=C.dimacs(tiny,3), lines=text.trim().split('\n').filter(x=>x[0]!=='c');
const header=lines.shift().split(' '), dim={nVars:Number(header[2]),clauses:lines.map(x=>x.split(' ').map(Number).slice(0,-1))};
assert.equal(dim.clauses.length,Number(header[3]));assert.deepEqual(dim,C.phaseQuery(tiny,3));
function refusal(fn,regex){assert.throws(fn,regex);total.guards++;}
const h1=program(1,8,[['h',0]]);
refusal(()=>C.amplitude({...h1,dynamic:true},0n),/dynamic/);
refusal(()=>C.amplitude({...h1,backend:'compressed'},0n),/compressed/);
refusal(()=>C.amplitude({...h1,synthesis:[{}]},0n),/synthesis/);
for(const op of ['measure','reset','if','unknown'])refusal(()=>C.amplitude(program(1,8,[[op,0]]),0n),/unsupported/);
refusal(()=>C.amplitude(program(1,4,[]),0n),/ring/);
refusal(()=>C.amplitude(program(1,8,[['cx',0,0]]),0n),/distinct/);
refusal(()=>C.amplitude(program(1,8,[['zpow',0,0.5]]),0n),/integer/);
refusal(()=>C.amplitude(program(1,8,[['x',2]]),0n),/integer/);
refusal(()=>C.amplitude(program(1,8,[['mcpow',-1,1]]),0n),/integer/);
refusal(()=>C.amplitude(program(64,8,[]),Number.MAX_SAFE_INTEGER+1),/integer/);
refusal(()=>C.probability(h1,0n,1n),/outside/);
refusal(()=>C.amplitude(h1,0n,{maxVariables:0}),/limit/);
refusal(()=>C.amplitude(h1,0n,{maxGates:0}),/limit/);
refusal(()=>C.amplitude(program(1,8,[['x',0]]),0n,{maxClauses:0}),/limit/);
refusal(()=>C.amplitude(h1,0n,{shouldStop:()=>true}),/cancelled/);
refusal(()=>C.solve(tiny,{maxNodes:0}),/budget/);
refusal(()=>C.solve(tiny,{signal:{aborted:true}}),/cancelled/);
refusal(()=>C.countCNF({nVars:2,clauses:[[1,2]]},{maxDepth:0}),/depth/);
refusal(()=>C.countCNF({nVars:1,clauses:[[0]]}),/literal/);
refusal(()=>C.solve(tiny,{counter:()=>1}),/BigInt/);
refusal(()=>C.solve(tiny,{counter:()=>-1n}),/BigInt/);
refusal(()=>C.reconstruct(tiny,Array(8).fill(1000n)),/exceed/);
const external=C.solve(tiny,{counter:q=>C.countCNF(q)});
assert.deepEqual(external.value,C.solve(tiny).value);
for(const n of [128,4096]) {
    const p=program(n,8,[['h',0],['cx',0,n-1]]), bit=1n<<BigInt(n-1);
    const q=C.probability(p,bit,bit);assert.ok(q.nVars<20);assert.ok(q.clauses.length<50);
    equal(C.solve(q).value,[1n,0n,0n,0n],1,'wide marginal');
    equal(C.solve(C.amplitude(p,1n|bit)).value,[0n,1n,0n,-1n],1,'wide amplitude');
    const high=program(n,16,[['h',n-1],['mcpow',bit,1]]);
    const got=C.solve(C.amplitude(high,bit));
    equal(got.value,[0n,0n,0n,1n,0n,0n,0n,-1n],1,'high mask ring16');
    total.wide++;
}
const qasm=[
 'OPENQASM 2.0; include "qelib1.inc"; qreg q[2]; creg c[2]; h q[0]; cx q[0],q[1]; measure q -> c;',
 'OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; h q[0]; p(pi/8) q[0]; cx q[0],q[1];',
 'OPENQASM 3.0; qubit[3] q; for int i in [0:2] { h q[i]; } t q[1];'
];
for(const src of qasm){const p=QASM.parse(src,{optimize:false});checkCircuit(p);total.qasmPrograms++;}
for(const src of [
 'OPENQASM 3.0; qubit q; bit c; h q; c = measure q; h q;',
 'OPENQASM 3.0; qubit q; bit c; h q; c = measure q; if (c == 1) { x q; }'
]) {const p=QASM.parse(src,{optimize:false});refusal(()=>C.amplitude(p,0n),/dynamic/);}
if(QASM.TABLE.dcx) {
    const extras=[
      'OPENQASM 3.0; qubit[2] q; h q[0]; dcx q[0],q[1];',
      'OPENQASM 3.0; qubit[2] q; h q[0]; iswap q[0],q[1];',
      'OPENQASM 3.0; qubit[2] q; h q[0]; ecr q[0],q[1];',
      'OPENQASM 3.0; qubit[3] q; for int j in {0,2} { h q[j]; }',
      'OPENQASM 3.0; qubit[2] q; box { h q[0]; delay[10ns] q[0]; cx q[0],q[1]; }',
      'OPENQASM 3.0; qubit[2] q; h q[0]; rzx(pi/2) q[0],q[1];'
    ];
    for(const src of extras){const p=QASM.parse(src,{optimize:false});checkCircuit(p);total.newerQasmPrograms++;}
} else if(process.env.OQ_REQUIRE_MATEMATYKA==='1')throw Error('newer Matematyka parser required');
record(total);
console.log('OQ-PATHCOUNT finite exact regression: PASS');
console.log(JSON.stringify(total));
console.log('evidence-sha256 '+digest.digest('hex'));
for(const name of ['oq.js','oq16.js','oqopt.js','qasm.js'])console.log('source '+name+' '+crypto.createHash('sha256').update(fs.readFileSync(path.join(source,name))).digest('hex'));
console.log('Status: finite engineering evidence only; acceleration H; reference DPLL exponential; no deployment.');
