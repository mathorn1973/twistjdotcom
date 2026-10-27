/* OQ exact scalar queries, isolated from the UI event loop.
 * (c) Marek Spanel 2026. All rights reserved.
 * NON-CANONICAL engineering. Running faster in general remains H.
 * Classic same-origin worker: only these pinned sibling modules are imported.
 */
'use strict';
importScripts('oqopt.js', 'oqrank.js', 'oqcount.js', 'oqaffine.js',
              'oqhybrid.js', 'oqactive.js', 'qasm.js');

const LIMITS = Object.freeze({
    maxQubits:4096, maxGates:10000, maxHadamards:1024, maxRank:12,
    maxProjectorBits:5, maxAssignments:65536, maxNodes:50000,
    maxDepth:256, maxVariables:30000, maxClauses:100000,
    maxLinearWork:1000000, maxPhaseTerms:10000, maxPhaseFactors:20000,
    maxRotations:512, maxActiveGates:20000, maxQueryGates:20000,
    maxRankWork:2000000, maxQueries:32
});
const SCHEMA = 'oq-exact-ui-v1';
let started = false;
function basisWord(source, label) {
    if (typeof source !== 'string' || source.length > 5000 ||
        !/^(?:0|[1-9][0-9]*|0[bB][01]+|0[xX][a-fA-F0-9]+)$/.test(source.trim()))
        throw new TypeError(label + ' must be a nonnegative decimal, 0b binary or 0x hexadecimal integer');
    return BigInt(source.trim());
}
function measuredBits(source, outcome, n) {
    if (typeof source !== 'string' || source.length > 60)
        throw new TypeError('Measured qubits must be a list such as 0,2,4');
    const indices=[], used=new Set();
    for (const token of source.split(/[\s,]+/).filter(Boolean)) {
        const m=/^([0-9]+)(?:-([0-9]+))?$/.exec(token);
        if (!m) throw new TypeError('Use qubits such as 0,2 or a range 3-5');
        const a=Number(m[1]),b=m[2]===undefined?a:Number(m[2]);
        if (!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a>b||b>=n)
            throw new TypeError('Measured qubits must be between 0 and '+(n-1));
        if (b-a>=5) throw new TypeError('Choose at most five measured qubits');
        for(let q=a;q<=b;q++){
            if(used.has(q))throw new TypeError('Each measured qubit must occur once');
            used.add(q);indices.push(q);
            if(indices.length>5)throw new TypeError('Choose at most five measured qubits');
        }
    }
    if (!indices.length) throw new TypeError('Choose at least one measured qubit');
    if(typeof outcome!=='string'||!/^[01]+$/.test(outcome)||outcome.length!==indices.length)
        throw new TypeError('Outcome must have exactly '+indices.length+' binary digits (in listed qubit order)');
    let mask=0n,value=0n;
    for(let i=0;i<indices.length;i++){
        const bit=1n<<BigInt(indices[i]);mask|=bit;
        if(outcome[i]==='1')value|=bit;
    }
    return {mask,value,indices};
}
function checkRequest(request){
    if (!request || request.schema!==SCHEMA || !Number.isSafeInteger(request.id) || request.id<1)
        throw new TypeError('Unsupported exact-query worker request');
    if(typeof request.source!=='string' || request.source.length>262144)
        throw new TypeError('QASM input exceeds 262144 UTF-16 characters');
    if(!['amplitude','probability','pauli'].includes(request.kind))
        throw new TypeError('Unknown query kind');
    if(!['auto','count','affine','active'].includes(request.method))
        throw new TypeError('Unknown exact method');
}
/* Parser gates carry an optional physical-control list for native kernels.
 * The scalar counters instead require an exact BigInt mask and three fields.
 * Recompute masks from the parser's qubit IDs, including indices above 31. */
function countingCircuit(parsed){
    const gates=parsed.gates.map(g=>{
        if(g[0]!=='mcpow')return g;
        if(g.length===3)return g;
        if(g.length!==4||!Array.isArray(g[3]))
            throw new TypeError('Unknown controlled-phase encoding');
        let mask=0n;
        for(const q of g[3]){
            if(!Number.isSafeInteger(q)||q<0||q>=parsed.n)
                throw new TypeError('Invalid controlled-phase qubit');
            const bit=1n<<BigInt(q);
            if(mask&bit)throw new TypeError('Repeated controlled-phase qubit');
            mask|=bit;
        }
        if(g[1]!==null && g[1]!==undefined && BigInt(g[1])!==mask)
            throw new TypeError('Controlled-phase mask disagrees with qubit list');
        return ['mcpow',mask,g[2]];
    });
    return Object.assign({},parsed,{gates});
}
function run(request){
    checkRequest(request);
    const input=basisWord(request.input,'Input |x>');
    self.postMessage({schema:SCHEMA,id:request.id,type:'progress',stage:'reading QASM'});
    const parsed=QASM.parse(request.source,{mode:'exact-query',optimize:false});
    if (parsed.dynamic || parsed.backend!=='exact-query')
        throw new TypeError('Exact query requires a static unitary circuit');
    if (parsed.n>LIMITS.maxQubits || parsed.gates.length>LIMITS.maxGates)
        throw new TypeError('Qubit or gate limit exceeded for experimental exact query');
    const p=countingCircuit(parsed);
    if(request.kind==='pauli' && (!request.pauli || typeof request.pauli!=='string' || request.pauli.length>240))
        throw new TypeError('Enter one Pauli product, e.g. Z0 or X0 Z1');
    self.postMessage({schema:SCHEMA,id:request.id,type:'progress',stage:'computing exact result'});
    const options=Object.assign({input},LIMITS);
    let result, label, kind=request.kind, selected=request.method;
    if (kind==='amplitude'){
        const y=basisWord(request.output,'Output |y>');
        if(selected==='active')throw new TypeError('Physical amplitudes cannot use the active Clifford frame: select Auto, Path counts or Affine paths');
        if(selected==='count')result=OQCOUNT.solve(OQCOUNT.amplitude(p,y,options),options);
        else if(selected==='affine')result=OQAFFINE.solve(OQAFFINE.amplitude(p,y,options),Object.assign({},options,{backend:'enumerate'}));
        else result=OQHYBRID.solve(p,{kind:'amplitude',output:y},options);
        label='⟨'+y.toString()+'|U|'+input.toString()+'⟩';
    } else if(kind==='probability'){
        const bits=measuredBits(request.qubits,request.outcome,p.n);
        if(selected==='count')result=OQCOUNT.solve(OQCOUNT.probability(p,bits.mask,bits.value,options),options);
        else if(selected==='affine')result=OQAFFINE.solve(OQAFFINE.probability(p,bits.mask,bits.value,options),Object.assign({},options,{backend:'enumerate'}));
        else if(selected==='active')result=OQACTIVE.solve(p,{kind:'probability',mask:bits.mask,value:bits.value},options);
        else result=OQHYBRID.solve(p,{kind:'probability',mask:bits.mask,value:bits.value},options);
        label='P(q['+bits.indices.join(',')+'] = '+request.outcome+')';
    } else {
        if(p.ring!==8)throw new TypeError('Physical Pauli reading currently requires ring8, not ring16');
        const backend=selected==='count'?'cnf':selected==='affine'?'enumerate':'auto';
        result=OQACTIVE.solve(p,{kind:'expectation',observable:request.pauli},Object.assign({},options,{backend}));
        label='⟨'+request.pauli.trim()+'⟩';
    }
    if(!result || !result.value || typeof result.value.denominatorExp!=='number' ||
       !Array.isArray(result.value.numerator) ||
       !result.value.numerator.every(c=>typeof c==='bigint'))
        throw new Error('Exact backend did not return a complete integer result');
    return {
        kind,method:selected,label,ring:p.ring,qubits:p.n,gates:p.gates.length,
        input,terminalMeasurements:p.measures.length, value:result.value,stats:result.stats||{}
    };
}
self.onmessage=function(event){
    const m=event.data;
    if(started)return;
    started=true;
    try{
        const res=run(m);
        self.postMessage({schema:SCHEMA,id:m.id,type:'done',result:res});
    }catch(e){
        const name=e && e.name ? String(e.name) : 'Error';
        const detail=e && e.message ? String(e.message) : String(e);
        self.postMessage({schema:SCHEMA,id:m && Number.isSafeInteger(m.id) ? m.id : 0,
            type:'error',name,message:detail.slice(0,500),line:e && Number.isInteger(e.line)?e.line:null});
    }
};
