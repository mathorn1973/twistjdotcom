/* Frozen exact engineering acceptance, C-OQ-AFFINE-PHASE-N. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const fs=require('node:fs'),vm=require('node:vm');
const A=require('./oqaffine.js'),C=require('./oqcount.js'),H=require('./oqhybrid.js');
const source=process.env.OQ_ENGINE_DIR||__dirname;
const OQ=require(path.join(source,'oq.js')),OQ16=require(path.join(source,'oq16.js'));
const QASM=require(path.join(source,'qasm.js'));
const total={circuits:0,amplitudes:0,events:0,histograms:0,dimensions:0,
    cnfHistograms:0,originalHistograms:0,rankQueries:0,hybridQueries:0,
    exhaustiveCNFs:0,guards:0,wide:0,newerParser:0,browserSmoke:0};
const hash=crypto.createHash('sha256');
const serial=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v);
const record=x=>hash.update(serial(x)+'\n');
const P=(n,ring,gates)=>({n,ring,gates});
function amplitude(state,y,ring){const a=state.amp(y);return ring===8?[a.c0,a.c1,a.c2,a.c3]:a;}
function mul(a,b){const d=a.length,out=Array(d).fill(0n);for(let i=0;i<d;i++)for(let j=0;j<d;j++)out[(i+j)%d]+=(i+j<d?1n:-1n)*a[i]*b[j];return out;}
function conjugate(a){const b=Array(a.length).fill(0n);b[0]=a[0];for(let i=1;i<a.length;i++)b[a.length-i]=-a[i];return b;}
function born(state,ring,mask,value){
    const b=Array(ring/2).fill(0n);
    for(let y=0;y<state.size;y++)if((BigInt(y)&mask)===value){const a=amplitude(state,y,ring),v=mul(a,conjugate(a));for(let j=0;j<b.length;j++)b[j]+=v[j];}
    return b;
}
function equal(value,num,den,label){
    assert.equal(value.numerator.length,num.length,label);
    for(let i=0;i<num.length;i++)assert.equal(value.numerator[i]*(1n<<BigInt(den)),num[i]*(1n<<BigInt(value.denominatorExp)),label+' coefficient '+i);
    record(value);
}
/* Concrete bit histories, independent of symbolic forms, Gaussian elimination and CNF. */
function paths(p,input){
    const h=p.gates.filter(g=>g[0]==='h').length;assert.ok(h<=10);
    const result=[];
    for(let z=0;z<2**h;z++){
        let bits=input,phase=0,j=0;
        const bit=q=>Number((bits>>BigInt(q))&1n),flip=q=>{bits^=1n<<BigInt(q);};
        for(const g of p.gates){
            switch(g[0]){
            case 'h':{const a=bit(g[1]),b=(z>>j++)&1;phase+=p.ring/2*a*b;if(a!==b)flip(g[1]);break;}
            case 'x':flip(g[1]);break;
            case 'cx':if(bit(g[1]))flip(g[2]);break;
            case 'swap':if(bit(g[1])!==bit(g[2])){flip(g[1]);flip(g[2]);}break;
            case 'gphase':phase+=g[1];break;
            case 'zpow':phase+=g[2]*bit(g[1]);break;
            case 'mcpow':if((bits&BigInt(g[1]))===BigInt(g[1]))phase+=g[2];break;
            default:throw Error('reference unsupported op');
            }
        }
        result.push({bits,phase:((phase%p.ring)+p.ring)%p.ring});
    }
    return result;
}
function histogram(p,ps,q){
    const a=Array(p.ring).fill(0n);
    if(q.kind==='amplitude'){for(const x of ps)if(x.bits===q.value)a[x.phase]++;}
    else for(const x of ps)if((x.bits&q.mask)===q.value)for(const y of ps)if(x.bits===y.bits)a[(x.phase-y.phase+p.ring)%p.ring]++;
    return a;
}
/* Independent array-of-bits rank, using LEFTMOST pivots rather than packed BigInt rows. */
function rank(rows,n){
    const a=rows.map(r=>Array.from({length:n},(_,i)=>Number((r>>BigInt(i))&1n)));
    let k=0;
    for(let c=0;c<n&&k<a.length;c++){
        let i=k;while(i<a.length&&!a[i][c])i++;
        if(i===a.length)continue;[a[k],a[i]]=[a[i],a[k]];
        for(let j=k+1;j<a.length;j++)if(a[j][c])for(let t=c;t<n;t++)a[j][t]^=a[k][t];
        k++;
    }
    return k;
}
function checkDimension(p,ps,q,expected){
    const h=p.gates.filter(g=>g[0]==='h').length,rows=Array(p.n).fill(0n);
    for(let i=0;i<h;i++){const d=ps[1<<i].bits^ps[0].bits;for(let j=0;j<p.n;j++)if((d>>BigInt(j))&1n)rows[j]|=1n<<BigInt(i);}
    const rho=rank(rows,h),event=rows.filter((_,j)=>(q.mask>>BigInt(j))&1n),rhoE=rank(event,h);
    assert.equal(q.stats.endpointRank,rho);assert.equal(q.stats.eventRank,rhoE);
    assert.equal(q.stats.linearFreeBits,q.kind==='amplitude'?h-rho:2*h-rho-rhoE);
    assert.ok(q.stats.phaseRank<=q.stats.linearFreeBits);
    const count=expected.reduce((a,b)=>a+b,0n);
    assert.equal(q.stats.consistent,count!==0n);
    assert.equal(count,q.stats.consistent?1n<<BigInt(q.stats.linearFreeBits):0n);
    assert.equal(q.stats.assignments*q.stats.phaseMultiplicity,count);
    total.dimensions++;
}
function checkQuery(p,ps,state,q,cnf,original){
    const wanted=histogram(p,ps,q),got=A.solve(q);
    assert.deepEqual(got.counts,wanted,'full phase histogram');total.histograms++;
    checkDimension(p,ps,q,wanted);record({counts:got.counts,stats:q.stats});
    const num=q.kind==='amplitude'?amplitude(state,Number(q.value),p.ring):born(state,p.ring,q.mask,q.value);
    const den=(q.kind==='amplitude'?1:2)*state.denom;
    equal(got.value,num,den,q.kind);
    if(cnf){
        const compiled=A.toCNF(q),counted=A.solve(q,{backend:'cnf',maxNodes:1000000});
        assert.deepEqual(counted.counts,wanted);equal(counted.value,num,den,'CNF');
        assert.ok(compiled.query.clauses.every(c=>c.length<=3));
        assert.equal(compiled.stats.variables,q.stats.phaseRank+compiled.stats.auxiliaryVariables);
        total.cnfHistograms++;
    }
    if(original){
        const old=q.kind==='amplitude'?C.amplitude(p,q.value,{input:q.input}):C.probability(p,q.mask,q.value,{input:q.input});
        assert.deepEqual(C.solve(old,{maxNodes:1000000}).counts,wanted);total.originalHistograms++;
    }
    const request=q.kind==='amplitude'?{kind:q.kind,output:q.value}:{kind:q.kind,mask:q.mask,value:q.value};
    const hybrid=H.solve(p,request,{input:q.input});equal(hybrid.value,num,den,'auto');total.hybridQueries++;
    if(q.kind==='amplitude')assert.notEqual(hybrid.stats.backend,'rank-projector');
    if(q.kind==='amplitude')total.amplitudes++;else total.events++;
}
function circuit(p,input=0n,extra=false){
    const E=p.ring===8?OQ:OQ16,state=new E.State(p.n);
    for(let q=0;q<p.n;q++)if((input>>BigInt(q))&1n)E.apply(state,['x',q]);
    for(const g of p.gates)E.apply(state,g);
    const ps=paths(p,input);total.circuits++;
    for(let y=0;y<state.size;y++)checkQuery(p,ps,state,A.amplitude(p,BigInt(y),{input}),extra&&y<2,extra&&y===0);
    const full=(1n<<BigInt(p.n))-1n;
    const events=[[0n,0n],[1n,0n],[1n,1n],[full,0n],[full,full]];
    if(p.n>=2)events.push([3n,1n]);
    for(const [mask,value]of events)checkQuery(p,ps,state,A.probability(p,mask,value,{input}),extra&&mask===1n,extra&&mask===full&&value===0n);
}
for(const ring of [8,16]){
    const cases=[P(1,ring,[]),P(1,ring,[['h',0]]),P(1,ring,[['h',0],['h',0]]),
        P(1,ring,[['h',0],['zpow',0,1],['h',0]]),
        P(2,ring,[['gphase',-1],['h',0],['cx',0,1],['swap',0,1],['zpow',1,-3]]),
        P(3,ring,[['h',0],['h',1],['x',2],['mcpow',7,1],['cx',0,2],['h',1]]),
        P(2,ring,[['mcpow',0,1],['h',0],['h',1],['mcpow',3,ring/2],['h',0]]),
        P(3,ring,[['h',0],['cx',0,1],['cx',1,2]])];
    for(const p of cases){circuit(p,0n,true);circuit(p,(1n<<BigInt(p.n))-1n,false);}
}
let rng=0xa7710e27;
function random(n){rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng%n;}
for(const ring of [8,16])for(let t=0;t<40;t++){
    const n=1+random(3),gates=[];let h=0;
    for(let j=0;j<18;j++){
        const q=random(n),op=random(n===1?4:7);
        if(op===0&&h<5){gates.push(['h',q]);h++;}
        else if(op===1)gates.push(['x',q]);
        else if(op===2)gates.push(['zpow',q,random(2*ring)-ring]);
        else if(op===3)gates.push(['gphase',random(2*ring)-ring]);
        else if(op===4)gates.push(['cx',q,(q+1+random(n-1))%n]);
        else if(op===5)gates.push(['swap',q,(q+1+random(n-1))%n]);
        else gates.push(['mcpow',random(1<<n),random(ring)]);
    }
    circuit(P(n,ring,gates),BigInt(random(1<<n)),t<3);
}
/* Forced rank: general joint diagonal projectors, nonzero inputs and CZ adapter. */
for(let t=0;t<20;t++){
    const n=3,input=BigInt(random(8)),gates=[];
    for(let j=0;j<16;j++){
        const op=random(6),q=random(n);
        gates.push(op===0?['h',q]:op===1?['x',q]:op===2?['zpow',q,random(8)]:
            op===3?['cx',q,(q+1)%n]:op===4?['mcpow',3,4]:['gphase',1]);
    }
    const p=P(n,8,gates),state=new OQ.State(n);
    for(let q=0;q<n;q++)if((input>>BigInt(q))&1n)OQ.apply(state,['x',q]);
    for(const g of gates)OQ.apply(state,g);
    for(const [mask,value]of [[0n,0n],[1n,1n],[3n,1n],[7n,BigInt(t%8)]]){
        const got=H.solve(p,{kind:'probability',mask,value},{backend:'rank',input});
        equal(got.value,born(state,8,mask,value),2*state.denom,'forced-rank');total.rankQueries++;
        assert.equal(got.stats.backend,'rank-projector');
    }
}
const sample=P(1,8,[['h',0],['zpow',0,1],['h',0]]),event={kind:'probability',mask:1n,value:0n};
for(const backend of ['affine','cnf','rank','auto']){
    const got=H.solve(sample,event,{backend});equal(got.value,[2n,1n,0n,-1n],2,'route equivalence');total.hybridQueries++;
}
/* Explicit CNF header and exhaustive assignment check on tiny reduced formulae. */
for(const ring of [8,16]){
    const q=A.amplitude(P(1,ring,[['h',0],['zpow',0,1],['h',0]]),0n),p=A.toCNF(q).query;
    assert.ok(p.nVars<=12);
    for(let r=0;r<ring;r++){
        const cnf=C.phaseQuery(p,r);let expected=0n;
        for(let z=0;z<2**cnf.nVars;z++)if(cnf.clauses.every(c=>c.some(l=>Boolean((z>>(Math.abs(l)-1))&1)===(l>0))))expected++;
        assert.equal(C.countCNF(cnf),expected);total.exhaustiveCNFs++;
        const lines=C.dimacs(p,r).trim().split('\n').filter(l=>!l.startsWith('c'));
        const header=lines.shift().split(' ');
        assert.equal(Number(header[2]),cnf.nVars);assert.equal(Number(header[3]),cnf.clauses.length);
        assert.deepEqual(lines.map(l=>l.split(' ').map(Number).slice(0,-1)),cnf.clauses);
    }
}
/* Deliberately structured wide examples. One phase evaluation, not a dense vector. */
const witnesses=[];
for(const n of [128,4096]){
    const p=P(n,8,Array.from({length:n},(_,q)=>['h',q]));
    const amplitudeQuery=A.amplitude(p,0n),a=A.solve(amplitudeQuery,{maxAssignments:1});
    assert.equal(a.stats.phaseRank,0);assert.equal(a.stats.endpointRank,n);
    equal(a.value,[1n,0n,0n,0n],n/2,'wide-H amplitude');
    const probabilityQuery=A.probability(p,1n,0n),b=A.solve(probabilityQuery,{maxAssignments:1});
    assert.equal(b.stats.linearFreeBits,n-1);assert.equal(b.stats.phaseRank,0);
    equal(b.value,[1n,0n,0n,0n],1,'wide-H marginal');
    witnesses.push({name:'H-layer-'+n,h:n,rho:n,amplitudeFree:a.stats.linearFreeBits,
        eventFree:b.stats.linearFreeBits,phaseRank:0,evaluations:a.stats.evaluatedAssignments});total.wide++;
}
const deep=P(1,8,Array.from({length:32},()=>[['h',0],['zpow',0,1]]).flat());
const state=new OQ.State(1);for(const g of deep.gates)OQ.apply(state,g);
const deepResult=H.solve(deep,event,{maxAssignments:16});
assert.equal(deepResult.stats.backend,'rank-projector');assert.equal(deepResult.stats.activeRank,1);
equal(deepResult.value,born(state,8,1n,0n),2*state.denom,'deep rank selection');
witnesses.push({name:'HT-32',h:32,r:deepResult.stats.activeRank,chi:deepResult.stats.phaseRank,
    selected:deepResult.stats.backend});total.wide++;
const highCZ=P(96,8,[['h',0],['cx',0,95],['mcpow',(1n<<95n)|1n,4]]);
const hz=H.solve(highCZ,{kind:'probability',mask:1n<<95n,value:1n<<95n},{backend:'rank'});
equal(hz.value,[1n,0n,0n,0n],1,'high-bit CZ rank adapter');total.wide++;
function refused(fn,pattern){assert.throws(fn,pattern);total.guards++;}
refused(()=>A.amplitude({...sample,dynamic:true},0n),/dynamic/);
refused(()=>A.amplitude({...sample,backend:'compressed'},0n),/compressed/);
refused(()=>A.amplitude({...sample,synthesis:[{}]},0n),/synthesis/);
refused(()=>A.amplitude(P(0,8,[]),0n),/qubit/);
refused(()=>A.amplitude(P(4097,8,[]),0n),/qubit/);
refused(()=>A.amplitude(P(1,4,[]),0n),/ring/);
refused(()=>A.amplitude(P(1,8,[['cx',0,0]]),0n),/distinct/);
refused(()=>A.amplitude(P(1,8,[['h',0,1]]),0n),/arity/);
refused(()=>A.amplitude(P(1,8,[['h',2]]),0n),/qubit/);
refused(()=>A.amplitude(P(1,8,[['zpow',0,0.5]]),0n),/phase/);
refused(()=>A.amplitude(P(1,8,[['mcpow',2,1]]),0n),/word/);
for(const op of ['measure','reset','if','bad'])refused(()=>A.amplitude(P(1,8,[[op,0]]),0n),/unsupported/);
refused(()=>A.probability(sample,0n,1n),/outside/);
refused(()=>A.amplitude(P(64,8,[]),Number.MAX_SAFE_INTEGER+1),/integer/);
refused(()=>A.amplitude(sample,0n,{maxHadamards:0}),/Hadamard/);
refused(()=>A.amplitude(sample,0n,{maxGates:0}),/gate/);
refused(()=>A.amplitude(sample,0n,{maxLinearWork:0}),/work/);
refused(()=>A.amplitude(sample,0n,{maxPhaseTerms:0}),/term/);
refused(()=>A.amplitude(sample,0n,{maxPhaseFactors:0}),/factor/);
refused(()=>A.amplitude(sample,0n,{maxSymbolicBits:0}),/symbolic/);
refused(()=>A.amplitude(sample,0n,{signal:{aborted:true}}),/cancelled/);
const query=A.amplitude(sample,0n);
refused(()=>A.solve(query,{maxAssignments:0}),/assignment/);
refused(()=>A.solve(query,{shouldStop:()=>true}),/cancelled/);
refused(()=>A.solve(query,{backend:'bad'}),/backend/);
refused(()=>A.solve({}),/plan/);
refused(()=>A.toCNF(query,{maxVariables:0}),/variable/);
refused(()=>A.solve(query,{backend:'cnf',maxNodes:0}),/budget/);
refused(()=>A.solve(query,{backend:'cnf',counter:()=>1}),/BigInt/);
refused(()=>A.solve(query,{backend:'cnf',counter:()=>0n}),/cardinality/);
refused(()=>H.solve(sample,{kind:'amplitude',output:0n},{backend:'rank'}),/global phase/);
refused(()=>H.solve({...sample,ring:16},event,{backend:'rank'}),/ring8/);
refused(()=>H.solve(P(2,8,[['mcpow',3,1]]),event,{backend:'rank'}),/controlled/);
refused(()=>H.solve(sample,event,{backend:'rank',maxProjectorBits:0}),/measured/);
refused(()=>H.solve(sample,event,{backend:'rank',maxRank:0}),/rank/);
refused(()=>H.solve(sample,event,{backend:'rank',maxRankWork:0}),/work/);
refused(()=>H.solve(sample,event,{backend:'bad'}),/backend/);
refused(()=>H.solve(sample,{kind:'bad'}),/kind/);
refused(()=>H.solve(sample,event,{shouldStop:()=>true}),/cancelled/);
refused(()=>H.solve(deep,event,{backend:'affine',maxAssignments:1}),/assignment/);
/* Input mutation cannot alter an already compiled query. */
const mutable=P(1,8,[['h',0]]),frozen=A.amplitude(mutable,0n);mutable.gates[0][0]='x';
equal(A.solve(frozen).value,[0n,1n,0n,-1n],1,'immutable input snapshot');
/* Newer parser, with no approximate synthesis. */
const sources=['OPENQASM 3.0; qubit q; h q; t q; h q;',
    'OPENQASM 3.0; qubit[2] q; h q[0]; cx q[0], q[1];'];
if(process.env.OQ_REQUIRE_MATEMATYKA){
    sources.push('OPENQASM 3.0; qubit q; phase(pi/4) q;',
        'OPENQASM 3.0; qubit[3] q; for int k in {0,2} { h q[k]; }');
}
for(const text of sources){const p=QASM.parse(text,{optimize:false});circuit(p,0n,false);total.newerParser++;}
/* Browser UMD/global export, not an actual browser or UI run. */
const ctx=vm.createContext({});
for(const name of ['oqcount.js','oqrank.js','oqaffine.js','oqhybrid.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,name),'utf8'),ctx,{filename:name});
assert.equal(vm.runInContext("OQHYBRID.solve({n:1,ring:8,gates:[['h',0]]},{kind:'probability',mask:1n,value:0n}).value.denominatorExp",ctx),1);
total.browserSmoke++;
record(witnesses);
console.log('C-OQ-AFFINE-PHASE-N exact acceptance');
console.log(JSON.stringify(total));
console.log('WITNESSES '+serial(witnesses));
console.log('DIGEST '+hash.digest('hex'));
console.log('PASS: exact finite tests only; general acceleration remains H');
