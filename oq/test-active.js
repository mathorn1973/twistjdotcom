/* Exact engineering acceptance for C-OQ-ACTIVE-PHASE-N. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const fs=require('node:fs'),vm=require('node:vm');
const ACTIVE=require('./oqactive.js'),AFFINE=require('./oqaffine.js');
const originalRank=require('./oqrank.js');
const source=process.env.OQ_ENGINE_DIR||__dirname;
const OQ=require(path.join(source,'oq.js')),RREF=require(path.join(source,'oqrank.js'));
const QASM=require(path.join(source,'qasm.js'));
const total={rotationBases:0,rotationEntries:0,circuits:0,activeAmplitudes:0,
    physicalExpectations:0,jointEvents:0,cnfQueries:0,phaseHistograms:0,
    scalarQueries:0,guards:0,wide:0,parserPrograms:0,allocationGuards:0,browserSmoke:0};
const hash=crypto.createHash('sha256'),serial=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v);
function record(x){hash.update(serial(x)+'\n');}
function eq(v,num,den,label){
    assert.equal(v.numerator.length,4,label);
    for(let j=0;j<4;j++)assert.equal(v.numerator[j]*(1n<<BigInt(den)),num[j]*(1n<<BigInt(v.denominatorExp)),label+' c'+j);
    record(v);
}
function amp(state,y){const a=state.amp(y);return [a.c0,a.c1,a.c2,a.c3];}
function mul(a,b){const c=[0n,0n,0n,0n];for(let i=0;i<4;i++)for(let j=0;j<4;j++)c[(i+j)%4]+=(i+j<4?1n:-1n)*a[i]*b[j];return c;}
function conj(a){return [a[0],-a[3],-a[2],-a[1]];}
function rotate(a,k){k=((k%8)+8)%8;const b=[0n,0n,0n,0n];for(let i=0;i<4;i++)b[(i+k)%4]+=((i+k)%8<4?1n:-1n)*a[i];return b;}
function pop(x){let n=0;while(x){x&=x-1n;n++;}return n;}
function scalarBasis(k){return rotate([1n,0n,0n,0n],k);}
function add(a,b){return a.map((x,i)=>x+b[i]);}
function dense(gates,n,input=0n){const state=new OQ.State(n);for(let j=0;j<n;j++)if((input>>BigInt(j))&1n)OQ.apply(state,['x',j]);for(const g of gates)OQ.apply(state,g);return state;}
function expectation(state,p){
    const out=[0n,0n,0n,0n];
    for(let s=0;s<state.size;s++){
        const t=Number(BigInt(s)^p.x);
        const v=rotate(mul(conj(amp(state,t)),amp(state,s)),2*p.phase+4*(pop(p.z&BigInt(s))%2));
        for(let j=0;j<4;j++)out[j]+=v[j];
    }
    return out;
}
function probability(state,mask,value){
    let out=[0n,0n,0n,0n];for(let s=0;s<state.size;s++)if((BigInt(s)&mask)===value){const a=amp(state,s);out=add(out,mul(conj(a),a));}return out;
}
function allPaulis(n){
    const out=[];
    for(let x=0;x<2**n;x++)for(let z=0;z<2**n;z++)for(let sign=0;sign<2;sign++)
        out.push({x:BigInt(x),z:BigInt(z),phase:(pop(BigInt(x&z))+2*sign)%4});
    return out;
}
/* Direct algebraic matrix formula, independent of the production diagonalizer. */
for(let n=1;n<=3;n++)for(const p of allPaulis(n))for(let k=0;k<8;k++){
    const program=ACTIVE.rotationCircuit(n,p,k);
    for(let s=0;s<2**n;s++){
        const state=dense(program.gates,n,BigInt(s));total.rotationBases++;
        for(let y=0;y<state.size;y++){
            let expected=[0n,0n,0n,0n];
            if(y===s)expected=add(expected,add(scalarBasis(0),scalarBasis(k)));
            if(BigInt(y)===(BigInt(s)^p.x)){
                const theta=2*p.phase+4*(pop(p.z&BigInt(s))%2);
                expected=add(expected,add(scalarBasis(theta),scalarBasis(theta+k).map(x=>-x)));
            }
            eq({numerator:amp(state,y),denominatorExp:state.denom},expected,1,'rotation matrix');total.rotationEntries++;
        }
    }
}
/* Any accidental call by the new backend to the 2^r state allocator is fatal. */
const saved={create:originalRank.create,run:originalRank.run};
originalRank.create=()=>{throw Error('FORBIDDEN active-vector allocation');};
originalRank.run=()=>{throw Error('FORBIDDEN rank statevector execution');};
const P=(n,gates)=>({n,ring:8,gates});
function refGates(program,input){
    const gates=[];for(let q=0;q<program.n;q++)if((input>>BigInt(q))&1n)gates.push(['x',q]);
    for(const g of program.gates){
        if(g[0]!=='mcpow'){gates.push(g);continue;}
        const qs=[];for(let q=0;q<program.n;q++)if((BigInt(g[1])>>BigInt(q))&1n)qs.push(q);
        const k=((g[2]%8)+8)%8;
        if(!qs.length)gates.push(['gphase',k]);
        else if(qs.length===1)gates.push(['zpow',qs[0],k]);
        else if(k)gates.push(['mcpow',null,k,qs]);
    }
    return gates;
}
let cnfRemaining=16,histRemaining=12;
function circuit(program,input=0n){
    const reference=dense(program.gates,program.n,input);
    // RREF is separately loaded from the frozen target directory by the target runner.
    const rankState=RREF.create(RREF.plan(refGates(program,input),program.n));while(rankState.step()){}
    const prepared=ACTIVE.prepare(program,{input});total.circuits++;total.allocationGuards++;
    const active=dense(prepared.activeProgram.gates,prepared.activeProgram.n);
    assert.equal(prepared.stats.activeRank,rankState.rank);
    for(let y=0;y<active.size;y++){
        const expected=y<rankState.size?rankState.coefficients[y]:[0n,0n,0n,0n];
        eq({numerator:amp(active,y),denominatorExp:active.denom},expected,rankState.denom,'active circuit state');total.activeAmplitudes++;
    }
    for(const p of allPaulis(program.n)){
        const q=ACTIVE.query(prepared,p),got=ACTIVE.expectation(prepared,p,{backend:'enumerate',maxAssignments:1048576,input});
        eq(got.value,expectation(reference,p),2*reference.denom,'physical expectation');total.physicalExpectations++;
        eq(got.value,rankState.expectation(p).numerator,rankState.expectation(p).denominatorExp,'rank expectation');
        if(q.kind==='constant')total.scalarQueries++;
        else{
            if(cnfRemaining>0&&q.query.stats.phaseRank<=6){
                const counted=ACTIVE.expectation(prepared,p,{backend:'cnf',maxNodes:1000000});
                eq(counted.value,got.value.numerator,got.value.denominatorExp,'counted expectation');cnfRemaining--;total.cnfQueries++;
            }
            if(histRemaining>0&&q.query.stats.phaseRank<=6){
                assert.deepEqual(AFFINE.solve(q.query,{backend:'cnf',maxNodes:1000000}).counts,AFFINE.solve(q.query).counts);
                histRemaining--;total.phaseHistograms++;
            }
        }
    }
    const full=(1n<<BigInt(program.n))-1n;
    for(const [mask,value]of [[0n,0n],[1n,0n],[1n,1n],[full,0n],[full,full]]){
        const got=ACTIVE.probability(prepared,mask,value,{backend:'enumerate',maxAssignments:4194304});
        eq(got.value,probability(reference,mask,value),2*reference.denom,'joint event');total.jointEvents++;
        assert.equal(got.stats.queries,2**pop(mask));
    }
}
const fixed=[P(1,[]),P(1,[['x',0]]),P(1,[['zpow',0,1]]),
    P(1,[['h',0],['zpow',0,1],['h',0]]),
    P(2,[['h',0],['cx',0,1]]),
    P(2,[['h',0],['zpow',0,6],['zpow',0,1],['h',0],['cx',0,1],['zpow',1,1]]),
    P(3,[['h',0],['h',1],['mcpow',3,4],['zpow',0,1],['cx',1,2],['h',2],['zpow',2,7]]),
    P(3,[['gphase',-3],['mcpow',0,1],['h',0],['mcpow',1,-1],['swap',0,2],['mcpow',5,4]])];
for(const p of fixed){circuit(p,0n);circuit(p,(1n<<BigInt(p.n))-1n);}
let seed=0xacc71e27;
function random(n){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;}
for(let t=0;t<20;t++){
    const n=1+random(3),gates=[];let nonClifford=0;
    for(let j=0;j<14;j++){
        const op=random(n===1?4:6),q=random(n);
        if(op===0)gates.push(['h',q]);
        else if(op===1)gates.push(['x',q]);
        else if(op===2){let k=random(8);if((k&1)&&nonClifford===2)k^=1;if(k&1)nonClifford++;gates.push(['zpow',q,k]);}
        else if(op===3)gates.push(['gphase',random(8)]);
        else if(op===4)gates.push(['cx',q,(q+1)%n]);
        else gates.push(['mcpow',(1<<q)|(1<<((q+1)%n)),4]);
    }
    circuit(P(n,gates),BigInt(random(1<<n)));
}
assert.equal(cnfRemaining,0);assert.equal(histRemaining,0);
const witnesses=[];
for(const n of [128,4096]){
    const gates=Array.from({length:n},(_,q)=>['h',q]);gates.push(['zpow',0,1]);
    for(let q=1;q<n;q++)gates.push(['mcpow',(1n<<BigInt(q))|1n,4]);
    for(let q=0;q<n;q++)gates.push(['h',q]);
    const prepared=ACTIVE.prepare(P(n,gates));
    const p={x:((1n<<BigInt(n))-1n)^1n,z:1n,phase:0};
    const got=ACTIVE.expectation(prepared,p,{backend:'enumerate',maxAssignments:256});
    eq(got.value,[0n,1n,0n,-1n],1,'wide graph observable');
    assert.equal(prepared.stats.activeRank,1);assert.equal(prepared.stats.activeHadamards,2);
    const joint=ACTIVE.probability(prepared,3n,0n,{maxAssignments:1024});
    // No dense physical or active arrays were used in these new-module calls.
    assert.equal(got.stats.activeStatevectorAllocated,false);assert.equal(joint.stats.physicalStatevectorAllocated,false);
    witnesses.push({name:'Clifford-graph-'+n,q:n,r:1,originalH:prepared.stats.originalHadamards,
        activeH:prepared.stats.activeHadamards,chi:got.stats.maxPhaseRank,evaluated:got.stats.enumeratedAssignments,
        joint:joint.value});total.wide++;
}
const deep=P(1,Array.from({length:32},()=>[['h',0],['zpow',0,1]]).flat());
const deepPrepared=ACTIVE.prepare(deep),deepQuery=ACTIVE.query(deepPrepared,'Z0');
assert.equal(deepPrepared.stats.activeRank,1);assert.ok(deepQuery.query.stats.assignments>16n);
assert.throws(()=>ACTIVE.expectation(deepPrepared,'Z0',{backend:'enumerate',maxAssignments:16}),/budget/);
witnesses.push({name:'HT-32-unfavorable',r:1,chi:deepQuery.stats.phaseRank,
    refusedAssignments:deepQuery.query.stats.assignments});total.wide++;
function refused(fn,re){assert.throws(fn,re);total.guards++;}
const sample=P(1,[['h',0],['zpow',0,1],['h',0]]),prepared=ACTIVE.prepare(sample);
refused(()=>ACTIVE.prepare({...sample,ring:16}),/ring8/);
refused(()=>ACTIVE.prepare({...sample,dynamic:true}),/dynamic/);
refused(()=>ACTIVE.prepare({...sample,backend:'compressed'}),/compressed/);
refused(()=>ACTIVE.prepare({...sample,synthesis:[1]}),/synthesis/);
refused(()=>ACTIVE.prepare(P(1,[['mcpow',2,4]])),/mask/);
refused(()=>ACTIVE.prepare(P(2,[['mcpow',3,1]])),/controlled/);
refused(()=>ACTIVE.prepare(P(1,[['h',0,1]])),/arity/);
refused(()=>ACTIVE.prepare(P(1,[['cx',0,0]])),/distinct/);
refused(()=>ACTIVE.prepare(P(1,[['zpow',0,0.5]])),/power/);
refused(()=>ACTIVE.prepare(P(1,[['measure',0]])),/unsupported/);
refused(()=>ACTIVE.prepare(sample,{input:2n}),/input/);
refused(()=>ACTIVE.prepare(sample,{maxRank:0}),/rank/);
refused(()=>ACTIVE.prepare(sample,{maxRank:21}),/maxRank/);
refused(()=>ACTIVE.prepare(sample,{maxGates:0}),/gate/);
refused(()=>ACTIVE.prepare(sample,{maxActiveGates:0}),/gate/);
refused(()=>ACTIVE.prepare(sample,{maxRotations:0}),/rotation/);
refused(()=>ACTIVE.prepare(sample,{shouldStop:()=>true}),/cancelled/);
refused(()=>ACTIVE.expectation({},'Z0'),/preparation/);
refused(()=>ACTIVE.expectation(prepared,{x:1n,z:1n,phase:0}),/Hermitian/);
refused(()=>ACTIVE.expectation(prepared,{x:-1n,z:0n}),/Pauli/);
refused(()=>ACTIVE.expectation(prepared,'X1'),/register/);
refused(()=>ACTIVE.expectation(prepared,'Y0 Z0'),/more than once/);
refused(()=>ACTIVE.expectation(prepared,'Z0',{backend:'bad'}),/backend/);
refused(()=>ACTIVE.expectation(prepared,'Z0',{maxQueries:0}),/query budget/);
refused(()=>ACTIVE.expectation(prepared,'Z0',{maxAssignments:0,backend:'enumerate'}),/assignment budget/);
refused(()=>ACTIVE.expectation(prepared,'Z0',{maxNodes:0,backend:'cnf'}),/budget/);
refused(()=>ACTIVE.expectation(prepared,'Z0',{maxLinearWork:0}),/linear-work/);
refused(()=>ACTIVE.expectation(prepared,'Z0',{maxQueryGates:0}),/query gate/);
refused(()=>ACTIVE.expectation(prepared,'Z0',{backend:'cnf',counter:()=>0n}),/cardinality/);
refused(()=>ACTIVE.expectation(prepared,'Z0',{counter:1}),/counter/);
refused(()=>ACTIVE.probability(prepared,0n,1n),/outside/);
refused(()=>ACTIVE.probability(prepared,1n,0n,{maxProjectorBits:0}),/projector/);
refused(()=>ACTIVE.probability(prepared,1n,0n,{maxQueries:1}),/query budget/);
refused(()=>ACTIVE.probability(prepared,1n,0n,{signal:{aborted:true}}),/cancelled/);
refused(()=>ACTIVE.solve(sample,{kind:'amplitude',output:0n}),/amplitude/);
refused(()=>ACTIVE.rotationCircuit(1,{x:1n,z:0n,phase:1},1),/Hermitian/);
refused(()=>ACTIVE.rotationCircuit(21,{x:0n,z:0n,phase:0},1),/active qubits/);
const result=ACTIVE.solve(sample,{kind:'probability',mask:1n,value:0n});
eq(result.value,[2n,1n,0n,-1n],2,'solve API');
// Cumulative limit: two nonconstant Pauli terms may not each reuse a full allowance.
const pair=ACTIVE.prepare(P(2,[['h',0],['zpow',0,1],['h',0],['h',1],['zpow',1,1],['h',1]]));
const one=ACTIVE.expectation(pair,'Z0',{backend:'enumerate'}).stats.enumeratedAssignments;
refused(()=>ACTIVE.probability(pair,3n,0n,{backend:'enumerate',maxAssignments:Number(one)}),/assignment budget/);
// An already prepared object is immutable with respect to caller edits.
const mutable=P(1,[['h',0],['zpow',0,1],['h',0]]),frozen=ACTIVE.prepare(mutable);
mutable.gates[1][2]=3;
eq(ACTIVE.probability(frozen,1n,0n).value,[2n,1n,0n,-1n],2,'immutable source');
const examples=['OPENQASM 3.0; qubit q; h q; t q; h q;',
    'OPENQASM 3.0; qubit[2] q; h q[0]; cx q[0],q[1];'];
if(process.env.OQ_REQUIRE_MATEMATYKA)examples.push('OPENQASM 3.0; qubit q; phase(pi/4) q;',
    'OPENQASM 3.0; qubit[3] q; for int k in {0,2} { h q[k]; }');
for(const text of examples){circuit(QASM.parse(text,{optimize:false}));total.parserPrograms++;}
// Browser exports only. No claim that UI integration or a real browser was tested.
const ctx=vm.createContext({});
for(const name of ['oqcount.js','oqrank.js','oqaffine.js','oqactive.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,name),'utf8'),ctx,{filename:name});
assert.equal(vm.runInContext("OQACTIVE.solve({n:1,ring:8,gates:[['h',0]]},{kind:'probability',mask:1n,value:0n}).value.denominatorExp",ctx),1);
total.browserSmoke++;
originalRank.create=saved.create;originalRank.run=saved.run;
record(witnesses);
console.log('C-OQ-ACTIVE-PHASE-N exact acceptance');
console.log(JSON.stringify(total));
console.log('WITNESSES '+serial(witnesses));
console.log('DIGEST '+hash.digest('hex'));
console.log('PASS: exact finite composition; general acceleration remains H');
