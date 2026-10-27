/*
 * oqactive.js -- Clifford active-space compilation into exact phase queries.
 * (c) Marek Spanel 2026. All rights reserved.
 * NON-CANONICAL C-OQ-ACTIVE-PHASE-N. General acceleration remains H.
 * Uses OQRANK.plan, never OQRANK.create/run or an active statevector.
 */
(function(root,factory){
    if(typeof module==='object'&&module.exports)
        module.exports=factory(require('./oqrank.js'),require('./oqaffine.js'),require('./oqcount.js'));
    else root.OQACTIVE=factory(root.OQRANK,root.OQAFFINE,root.OQCOUNT);
})(typeof self!=='undefined'?self:this,function(RANK,AFFINE,COUNT){
'use strict';
if(!RANK||!AFFINE||!COUNT)throw new Error('OQACTIVE requires OQRANK, OQAFFINE and OQCOUNT');
const plans=new WeakMap(),LimitError=COUNT.LimitError;
const mod=(x,m)=>((x%m)+m)%m;
function integer(x,name,lo,hi){
    if(!Number.isSafeInteger(x)||x<lo||x>hi)throw new TypeError(name+' must be an integer in ['+lo+','+hi+']');
    return x;
}
function limit(o,name,value,lo,hi){return integer(o[name]===undefined?value:o[name],name,lo,hi);}
function abort(o){
    if((o.signal&&o.signal.aborted)||(o.shouldStop&&o.shouldStop()))
        throw new LimitError('active query cancelled; no final result');
}
function word(x,name,n){
    if(typeof x==='number')x=BigInt(integer(x,name,0,Number.MAX_SAFE_INTEGER));
    if(typeof x!=='bigint'||x<0n||(x>>BigInt(n))!==0n)throw new TypeError(name+' must be an unsigned '+n+'-bit word');
    return x;
}
function popcount(x){let n=0;while(x){x&=x-1n;n++;}return n;}
function positions(x){const out=[];let j=0;while(x){if(x&1n)out.push(j);x>>=1n;j++;}return out;}
function pauli(value,n){
    if(typeof value==='string')value=RANK.parseObservable(value,n);
    if(!value||typeof value!=='object')throw new TypeError('Hermitian Pauli required');
    const x=word(value.x,'Pauli X',n),z=word(value.z,'Pauli Z',n);
    const phase=mod(integer(value.phase===undefined?0:value.phase,'Pauli phase',-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER),4);
    if((phase&1)!==(popcount(x&z)&1))throw new TypeError('Pauli must be Hermitian');
    return {x,z,phase};
}
function freezeProgram(n,gates){return Object.freeze({n,ring:8,gates:Object.freeze(gates.map(g=>Object.freeze(g.slice())))});}
/* D P D^dagger = sign*Z_target. For Y: apply S^dagger, then H. */
function diagonalize(p,n){
    p=pauli(p,n);
    const support=positions(p.x|p.z),ys=popcount(p.x&p.z);
    const difference=mod(p.phase-ys,4);
    const sign=difference===0?1:-1;
    if(!support.length)return {gates:[],target:null,sign};
    const gates=[];
    for(const q of support){
        const bit=1n<<BigInt(q);
        if(p.x&bit){if(p.z&bit)gates.push(['zpow',q,6]);gates.push(['h',q]);}
    }
    const target=support[support.length-1];
    for(const q of support)if(q!==target)gates.push(['cx',q,target]);
    return {gates,target,sign};
}
function inverse(gates){return gates.slice().reverse().map(g=>g[0]==='zpow'?['zpow',g[1],mod(-g[2],8)]:g.slice());}
/* The phase on a negative Pauli axis MUST include the global w^k factor. */
function rotationCircuit(n,p,k){
    integer(n,'active qubits',1,20);k=mod(integer(k,'rotation power',-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER),8);
    const d=diagonalize(p,n),gates=[];
    if(k===0)return freezeProgram(n,gates);
    if(d.target===null){if(d.sign<0)gates.push(['gphase',k]);return freezeProgram(n,gates);}
    gates.push(...d.gates);
    if(d.sign<0)gates.push(['gphase',k]);
    gates.push(['zpow',d.target,mod(d.sign*k,8)]);
    gates.push(...inverse(d.gates));
    return freezeProgram(n,gates);
}
function validate(program,o){
    if(!program||typeof program!=='object')throw new TypeError('ordinary static OQ program required');
    const n=integer(program.n,'qubits',1,4096);
    if(program.ring!==8)throw new TypeError('active compiler supports ring8 only');
    if(program.dynamic)throw new TypeError('dynamic circuits are unsupported');
    if(program.backend==='compressed'||program.ignoredGlobalPhases)throw new TypeError('ordinary input required, not compressed input');
    if(program.synthesis&&program.synthesis.length)throw new TypeError('approximate synthesis is unsupported');
    if(!Array.isArray(program.gates))throw new TypeError('gate array required');
    if(program.gates.length>limit(o,'maxGates',100000,0,1000000))throw new LimitError('input gate limit exceeded');
    const input=word(o.input===undefined?0n:o.input,'input',n),gates=positions(input).map(q=>['x',q]);
    const q=x=>integer(x,'qubit',0,n-1),power=x=>mod(integer(x,'phase power',-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER),8);
    let h=0;
    for(const source of program.gates){
        abort(o);if(!Array.isArray(source))throw new TypeError('invalid gate');
        const g=source.slice(),op=g[0];
        if(op==='h'||op==='x'){
            if(g.length!==2)throw new TypeError('invalid gate arity');q(g[1]);if(op==='h')h++;gates.push(g);
        }else if(op==='cx'||op==='swap'){
            if(g.length!==3)throw new TypeError('invalid gate arity');q(g[1]);q(g[2]);
            if(g[1]===g[2])throw new TypeError('distinct operands required');gates.push(g);
        }else if(op==='zpow'){
            if(g.length!==3)throw new TypeError('invalid gate arity');q(g[1]);g[2]=power(g[2]);gates.push(g);
        }else if(op==='gphase'){
            if(g.length!==2)throw new TypeError('invalid gate arity');g[1]=power(g[1]);gates.push(g);
        }else if(op==='mcpow'){
            if(g.length!==3)throw new TypeError('ordinary controlled phase mask required');
            const mask=word(g[1],'control mask',n),qs=positions(mask),k=power(g[2]);
            if(!qs.length){gates.push(['gphase',k]);continue;}
            if(qs.length===1){gates.push(['zpow',qs[0],k]);continue;}
            if(k===0)continue;
            if(qs.length!==2||k!==4)throw new TypeError('controlled phase is outside the active Clifford+T interface');
            gates.push(['mcpow',null,4,qs]);
        }else throw new TypeError('unsupported operation '+String(op));
    }
    return {n,input,gates,h,sourceGates:program.gates.length};
}
/* Cancel exact inverse pairs across gates on disjoint wires. Full phase is retained.
 * Per-wire live stacks prove that a removed pair commutes past every intervening gate. */
function reduceCircuit(gates,n,o){
    const out=[],history=Array.from({length:n},()=>[]);let global=0;
    const last=q=>history[q][history[q].length-1];
    for(const source of gates){
        abort(o);let g=source;
        if(g[0]==='gphase'){global=mod(global+g[1],8);continue;}
        const wires=g[0]==='cx'?[g[1],g[2]]:[g[1]];
        while(g){
            const previous=last(wires[0]),p=previous===undefined?null:out[previous];
            const samePrevious=p&&wires.every(q=>last(q)===previous);
            const inversePair=samePrevious&&p[0]===g[0]&&
                ((g[0]==='h'&&p[1]===g[1])||
                 (g[0]==='cx'&&p[1]===g[1]&&p[2]===g[2]));
            const phasePair=samePrevious&&p[0]==='zpow'&&g[0]==='zpow'&&p[1]===g[1];
            if(inversePair||phasePair){
                for(const q of wires)history[q].pop();out[previous]=null;
                const k=phasePair?mod(p[2]+g[2],8):0;
                g=k?['zpow',g[1],k]:null;
            }else{
                const index=out.length;out.push(g);for(const q of wires)history[q].push(index);break;
            }
        }
    }
    const result=out.filter(g=>g!==null);if(global)result.push(['gphase',global]);return result;
}
function prepare(program,options){
    const o=options||{};abort(o);const p=validate(program,o);
    const maxRank=limit(o,'maxRank',20,0,20);
    const maxActiveGates=limit(o,'maxActiveGates',100000,0,1000000);
    const maxRotations=limit(o,'maxRotations',4096,0,16384);
    const planner=RANK.plan(p.gates,p.n,{maxRank});abort(o);
    if(planner.tCount>maxRotations)throw new LimitError('active rotation limit exceeded');
    const n=Math.max(1,planner.rank),gates=[];
    for(const r of planner.rotations){
        abort(o);
        const block=rotationCircuit(n,{x:BigInt(r.shift),z:BigInt(r.z),phase:r.pauli.phase},r.power);
        if(gates.length+block.gates.length>maxActiveGates)throw new LimitError('active gate limit exceeded');
        for(const g of block.gates)gates.push(g);
    }
    const activeProgram=freezeProgram(n,reduceCircuit(gates,n,o));
    const stats=Object.freeze({physicalQubits:p.n,activeRank:planner.rank,activeQubits:n,
        originalGates:p.sourceGates,originalHadamards:p.h,nonCliffordRotations:planner.tCount,
        rawActiveGates:gates.length,activeGates:activeProgram.gates.length,
        rawActiveHadamards:gates.filter(g=>g[0]==='h').length,
        activeHadamards:activeProgram.gates.filter(g=>g[0]==='h').length,
        activeStatevectorAllocated:false,physicalStatevectorAllocated:false,
        ignoredPhysicalGlobalPhases:planner.ignoredGlobalPhases,performanceStatus:'H'});
    const prepared=Object.freeze({schema:'oq-active-v1',stats,activeProgram});
    plans.set(prepared,{planner,input:p.input});return prepared;
}
function data(prepared){const p=plans.get(prepared);if(!p)throw new TypeError('expected an OQACTIVE preparation');return p;}
function scalar(k){return COUNT.normalize([BigInt(k),0n,0n,0n],0,8);}
function restriction(prepared,observable){
    const p=data(prepared).planner,original=pauli(observable,p.n),pulled=p.frame.pullback(original);
    const x=p.basis.coordinates(pulled.x);
    if(x===null)return null;
    return pauli({x:BigInt(x),z:BigInt(p.basis.restrictZ(pulled.z)),phase:pulled.phase},prepared.activeProgram.n);
}
function query(prepared,observable,options){
    const o=options||{};abort(o);data(prepared);
    const p=restriction(prepared,observable);
    if(p===null)return Object.freeze({kind:'constant',value:scalar(0),reason:'outside active binary span'});
    const d=diagonalize(p,prepared.activeProgram.n);
    if(d.target===null)return Object.freeze({kind:'constant',value:scalar(d.sign),reason:'scalar on active code'});
    const gates=prepared.activeProgram.gates.concat(d.gates);
    if(gates.length>limit(o,'maxQueryGates',100000,0,1000000))throw new LimitError('active query gate limit exceeded');
    const program=freezeProgram(prepared.activeProgram.n,reduceCircuit(gates,prepared.activeProgram.n,o));
    // The original basis input is ALREADY in the frame; active state starts at zero.
    const affine=AFFINE.probability(program,1n<<BigInt(d.target),0n,Object.assign({},o,{input:0n}));
    const result=Object.freeze({kind:'affine-probability',sign:d.sign,query:affine,
        stats:Object.freeze(Object.assign({},prepared.stats,{queryHadamards:affine.hadamards,
            phaseRank:affine.stats.phaseRank,linearFreeBits:affine.stats.linearFreeBits,
            plannedAssignments:affine.stats.assignments,linearWork:affine.stats.linearWork}))});
    return result;
}
function budget(o){
    const backend=o.backend===undefined?'auto':o.backend;
    if(!['auto','enumerate','cnf'].includes(backend))throw new TypeError('backend must be auto, enumerate or cnf');
    if(o.counter!==undefined&&typeof o.counter!=='function')throw new TypeError('counter must be a function');
    return {backend,assignments:limit(o,'maxAssignments',1048576,0,67108864),
        nodes:limit(o,'maxNodes',250000,0,Number.MAX_SAFE_INTEGER),
        linearWork:limit(o,'maxLinearWork',20000000,0,200000000),
        queries:limit(o,'maxQueries',256,0,65536),
        stats:{queries:0,constantQueries:0,countedQueries:0,enumeratedAssignments:0n,
            dpllNodes:0,externalCalls:0,linearWork:0,maxPhaseRank:0,maxCNFVariables:0,maxCNFClauses:0}};
}
function compute(prepared,observable,o,b){
    abort(o);if(b.queries===0)throw new LimitError('shared query budget exceeded');b.queries--;b.stats.queries++;
    const q=query(prepared,observable,Object.assign({},o,{maxLinearWork:b.linearWork}));
    if(q.kind==='constant'){b.stats.constantQueries++;return q.value;}
    b.stats.countedQueries++;b.stats.maxPhaseRank=Math.max(b.stats.maxPhaseRank,q.stats.phaseRank);
    b.linearWork-=q.stats.linearWork;b.stats.linearWork+=q.stats.linearWork;
    const enumeration=q.query.stats.assignments<=BigInt(b.assignments);
    const backend=b.backend==='auto'?(enumeration?'enumerate':'cnf'):b.backend;
    const out=AFFINE.solve(q.query,Object.assign({},o,{backend,input:0n,
        maxAssignments:b.assignments,maxNodes:b.nodes}));
    if(backend==='enumerate'){
        b.assignments-=Number(out.stats.evaluatedAssignments);
        b.stats.enumeratedAssignments+=out.stats.evaluatedAssignments;
    }else{
        b.stats.maxCNFVariables=Math.max(b.stats.maxCNFVariables,out.stats.cnf.variables);
        b.stats.maxCNFClauses=Math.max(b.stats.maxCNFClauses,out.stats.cnf.clauses);
        const nodes=out.stats.counter.nodes;
        if(nodes===null)b.stats.externalCalls+=out.stats.counter.phases;
        else {b.nodes-=nodes;b.stats.dpllNodes+=nodes;}
    }
    const a=out.value.numerator.map(x=>2n*x);
    a[0]-=1n<<BigInt(out.value.denominatorExp);
    const value=COUNT.normalize(a.map(x=>BigInt(q.sign)*x),out.value.denominatorExp,8);
    if(value.numerator[2]!==0n||value.numerator[1]!==-value.numerator[3])throw new Error('Hermitian expectation is not real');
    return value;
}
function expectation(prepared,observable,options){
    data(prepared);const o=options||{},b=budget(o),value=compute(prepared,observable,o,b);
    return {value,stats:Object.assign({},prepared.stats,b.stats,{backend:'active-phase',queryType:'Pauli expectation'})};
}
function probability(prepared,mask,value,options){
    const p=data(prepared).planner,o=options||{};abort(o);
    mask=word(mask,'event mask',p.n);value=word(value,'event value',p.n);
    if(value&~mask)throw new TypeError('event value has bits outside mask');
    const measured=positions(mask),m=measured.length;
    if(m>limit(o,'maxProjectorBits',8,0,16))throw new LimitError('joint projector expansion exceeds budget');
    const terms=2**m,b=budget(o);
    if(terms>b.queries)throw new LimitError('shared query budget exceeded before projector expansion');
    let numerator=[0n,0n,0n,0n],den=0;
    for(let subset=0;subset<terms;subset++){
        abort(o);let z=0n;
        for(let j=0;j<m;j++)if(subset&(1<<j))z|=1n<<BigInt(measured[j]);
        const e=compute(prepared,{x:0n,z,phase:0},o,b),next=Math.max(den,e.denominatorExp);
        if(next>den){numerator=numerator.map(x=>x<<BigInt(next-den));den=next;}
        const sign=(popcount(z&value)&1)?-1n:1n,shift=BigInt(den-e.denominatorExp);
        for(let j=0;j<4;j++)numerator[j]+=sign*(e.numerator[j]<<shift);
    }
    return {value:COUNT.normalize(numerator,den+m,8),stats:Object.assign({},prepared.stats,b.stats,
        {backend:'active-phase-projector',queryType:'joint Born event',projectorBits:m,projectorTerms:terms})};
}
function solve(program,request,options){
    if(!request||!['expectation','probability'].includes(request.kind))
        throw new TypeError('only physical expectation or probability requests are supported; no amplitude API');
    const prepared=prepare(program,options);
    return request.kind==='expectation'?expectation(prepared,request.observable,options):
        probability(prepared,request.mask,request.value,options);
}
return Object.freeze({version:'0.1.0-experimental',status:'H-performance',prepare,query,
    expectation,probability,solve,rotationCircuit,LimitError});
});
