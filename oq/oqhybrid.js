/*
 * oqhybrid.js -- guarded selection between exact OQ query methods.
 * (c) Marek Spanel 2026. All rights reserved.
 * NON-CANONICAL C-OQ-AFFINE-PHASE-N. No general speedup theorem.
 * Route scores are structural proxies, not operation/time bounds.
 */
(function(root,factory){
    if(typeof module==='object'&&module.exports)
        module.exports=factory(require('./oqaffine.js'),require('./oqcount.js'),require('./oqrank.js'));
    else root.OQHYBRID=factory(root.OQAFFINE,root.OQCOUNT,root.OQRANK);
})(typeof self!=='undefined'?self:this,function(AFFINE,COUNT,RANK){
'use strict';
if(!AFFINE||!COUNT)throw new Error('OQHYBRID requires OQAFFINE and OQCOUNT');
const plans=new WeakMap();
function limit(o,name,value,lo,hi){
    const n=o[name]===undefined?value:o[name];
    if(!Number.isSafeInteger(n)||n<lo||n>hi)throw new TypeError(name+' must be an integer in ['+lo+','+hi+']');
    return n;
}
function abort(o){
    if((o.signal&&o.signal.aborted)||(o.shouldStop&&o.shouldStop()))
        throw new AFFINE.LimitError('hybrid computation cancelled; no final result');
}
function positions(mask){const out=[];let q=0;while(mask){if(mask&1n)out.push(q);mask>>=1n;q++;}return out;}
function rankCandidate(query,o){
    const p=AFFINE.program(query);
    if(query.kind!=='probability')return {reason:'amplitude requires retained global phase'};
    if(p.ring!==8)return {reason:'existing rank engine is ring8 only'};
    if(!RANK)return {reason:'rank engine is not loaded'};
    const measured=positions(query.mask);
    if(measured.length>limit(o,'maxProjectorBits',8,0,16))return {reason:'projector expansion exceeds measured-bit budget'};
    const gates=[];
    for(const q of positions(query.input))gates.push(['x',q]);
    for(const g of p.gates){
        abort(o);
        if(g[0]!=='mcpow'){gates.push(g.slice());continue;}
        const qs=positions(g[1]);
        if(g[2]===0||qs.length===0)continue; // Zero phase or global phase: probability only.
        if(qs.length===1){gates.push(['zpow',qs[0],g[2]]);continue;}
        if(qs.length!==2||g[2]!==4)return {reason:'controlled phase is outside rank capability'};
        gates.push(['mcpow',null,4,qs]); // Exact mask/list adapter, including qubits above 30.
    }
    const maxRank=limit(o,'maxRank',16,0,20),maxCoeffBits=limit(o,'maxCoeffBits',4096,1,4096);
    let prepared;
    try{prepared=RANK.plan(gates,p.n,{maxRank,maxCoeffBits});}
    catch(e){
        if(/^Rank mode: active rank exceeds /.test(String(e.message)))return {reason:'active rank exceeds budget'};
        throw e; // Do not disguise implementation faults as unsupported circuits.
    }
    abort(o);
    const projectorTerms=1n<<BigInt(measured.length);
    const score=(BigInt(prepared.tCount)+projectorTerms+1n)*(1n<<BigInt(prepared.rank));
    const cap=BigInt(limit(o,'maxRankWork',50000000,0,1000000000));
    if(score>cap)return {reason:'rank work proxy exceeds budget',rank:prepared.rank,score};
    return {prepared,measured,projectorTerms,score,rank:prepared.rank,reason:null};
}
function plan(program,request,options){
    const o=options||{};abort(o);
    if(!request||typeof request!=='object')throw new TypeError('query request required');
    const backend=o.backend===undefined?'auto':o.backend;
    if(!['auto','affine','cnf','rank'].includes(backend))throw new TypeError('unknown hybrid backend');
    let query;
    if(request.kind==='amplitude')query=AFFINE.amplitude(program,request.output,o);
    else if(request.kind==='probability')query=AFFINE.probability(program,request.mask,request.value,o);
    else throw new TypeError('request kind must be amplitude or probability');
    const rank=(backend==='rank'||backend==='auto')?rankCandidate(query,o):{reason:'not requested'};
    const affineScore=query.stats.assignments*BigInt(1+query.stats.phaseFactors+query.stats.phaseTerms);
    const canEnumerate=query.stats.assignments<=BigInt(limit(o,'maxAssignments',1048576,0,67108864));
    let chosen;
    if(backend==='rank'){
        if(!rank.prepared)throw new TypeError('rank route unavailable: '+rank.reason);
        chosen='rank-projector';
    }else if(backend==='affine'){
        if(!canEnumerate)throw new AFFINE.LimitError('reduced assignment budget exceeded');
        chosen='affine-enumeration';
    }else if(backend==='cnf')chosen='reduced-cnf';
    else if(rank.prepared&&(!canEnumerate||rank.score<affineScore))chosen='rank-projector';
    else chosen=canEnumerate?'affine-enumeration':'reduced-cnf';
    const stats=Object.freeze(Object.assign({},query.stats,{
        backend:chosen,activeRank:rank.rank===undefined?null:rank.rank,
        projectorBits:rank.measured?rank.measured.length:null,
        projectorTerms:rank.projectorTerms||null,rankUnavailableReason:rank.reason,
        affineWorkProxy:affineScore,rankWorkProxy:rank.score===undefined?null:rank.score,
        scoreMeaning:'structural proxy only; not a bit-operation or time bound'}));
    const result=Object.freeze({schema:'oq-hybrid-v1',kind:query.kind,ring:query.ring,stats});
    plans.set(result,{query,rank});return result;
}
function executeRank(query,candidate,o){
    abort(o);const state=RANK.create(candidate.prepared);
    while(state.done<state.tCount){abort(o);state.step();}
    let numerator=[0n,0n,0n,0n],den=0;
    const m=candidate.measured.length,count=1<<m;
    for(let subset=0;subset<count;subset++){
        abort(o);let z=0n,negative=0;
        for(let i=0;i<m;i++)if(subset&(1<<i)){
            const bit=1n<<BigInt(candidate.measured[i]);z|=bit;if(query.value&bit)negative^=1;
        }
        const e=state.expectation({x:0n,z,phase:0}),next=Math.max(den,e.denominatorExp);
        if(next>den){numerator=numerator.map(x=>x<<BigInt(next-den));den=next;}
        const sign=negative?-1n:1n,shift=BigInt(den-e.denominatorExp);
        for(let j=0;j<4;j++)numerator[j]+=sign*(e.numerator[j]<<shift);
    }
    return {value:COUNT.normalize(numerator,den+m,8),stats:{
        backend:'rank-projector',activeRank:state.rank,rankCoefficients:state.size,
        projectorTerms:BigInt(count),phaseSteps:state.tCount,peakCoefficientBits:state.peakBits,
        phaseHistogramProvided:false}};
}
function solve(program,request,options){
    const o=options||{},prepared=plan(program,request,o),p=plans.get(prepared);
    let out;
    if(prepared.stats.backend==='rank-projector')out=executeRank(p.query,p.rank,o);
    else out=AFFINE.solve(p.query,Object.assign({},o,{backend:prepared.stats.backend==='reduced-cnf'?'cnf':'enumerate'}));
    return Object.assign({},out,{stats:Object.assign({},prepared.stats,out.stats)});
}
return Object.freeze({version:'0.1.0-experimental',status:'H-performance',plan,solve});
});
