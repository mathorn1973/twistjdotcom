/*
 * oqaffine.js -- exact affine-history reduction for OQ.
 * (c) Marek Spanel 2026. All rights reserved.
 * NON-CANONICAL C-OQ-AFFINE-PHASE-N. General performance remains H.
 * No subexponential algorithm. Scientific arithmetic is exact BigInt.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports)
        module.exports = factory(require('./oqcount.js'));
    else root.OQAFFINE = factory(root.OQCOUNT);
})(typeof self !== 'undefined' ? self : this, function (COUNT) {
'use strict';
if (!COUNT) throw new Error('OQAFFINE requires OQCOUNT');
const records = new WeakMap(), LimitError = COUNT.LimitError;
const high = x => x.toString(2).length - 1;
const mod = (x, r) => ((x % r) + r) % r;
function integer(x, name, lo, hi) {
    if (!Number.isSafeInteger(x) || x < lo || x > hi)
        throw new TypeError(name + ' must be an integer in [' + lo + ',' + hi + ']');
    return x;
}
function option(o, name, value, lo, hi) {
    return integer(o[name] === undefined ? value : o[name], name, lo, hi);
}
function word(x, name, n) {
    if (typeof x === 'number') x = BigInt(integer(x, name, 0, Number.MAX_SAFE_INTEGER));
    if (typeof x !== 'bigint' || x < 0n || (x >> BigInt(n)) !== 0n)
        throw new TypeError(name + ' must be a nonnegative ' + n + '-bit word');
    return x;
}
function checkAbort(o) {
    if ((o.signal && o.signal.aborted) || (o.shouldStop && o.shouldStop()))
        throw new LimitError('affine computation cancelled; no final result');
}
function budget(o) {
    const max = option(o, 'maxLinearWork', 20000000, 0, 200000000);
    let used = 0;
    return { tick(k = 1) {
        checkAbort(o); used += k;
        if (used > max) throw new LimitError('affine linear-work budget exceeded');
    }, get used() { return used; } };
}
function validate(program, o) {
    if (!program || typeof program !== 'object') throw new TypeError('expected ordinary OQ program');
    const n = integer(program.n, 'n', 1, option(o, 'maxQubits', 4096, 1, 4096));
    const ring = program.ring;
    if (ring !== 8 && ring !== 16) throw new TypeError('ring must be 8 or 16');
    if (program.dynamic) throw new TypeError('dynamic circuits are unsupported');
    if (program.backend === 'compressed' || program.ignoredGlobalPhases)
        throw new TypeError('compressed input may have lost global phase');
    if (program.synthesis && program.synthesis.length) throw new TypeError('approximate synthesis is unsupported');
    if (!Array.isArray(program.gates)) throw new TypeError('gates must be an array');
    if (program.gates.length > option(o, 'maxGates', 100000, 0, 1000000))
        throw new LimitError('gate limit exceeded');
    const maxH = option(o, 'maxHadamards', 4096, 0, 16384), gates = [];
    const q = x => integer(x, 'qubit', 0, n - 1);
    const phase = x => mod(integer(x, 'phase', -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), ring);
    let h = 0;
    for (const source of program.gates) {
        checkAbort(o);
        if (!Array.isArray(source)) throw new TypeError('invalid gate');
        const g = source.slice(), op = g[0];
        if (op === 'h' || op === 'x') {
            if (g.length !== 2) throw new TypeError('wrong gate arity');
            q(g[1]); if (op === 'h' && ++h > maxH) throw new LimitError('Hadamard limit exceeded');
        } else if (op === 'cx' || op === 'swap') {
            if (g.length !== 3) throw new TypeError('wrong gate arity');
            q(g[1]); q(g[2]); if (g[1] === g[2]) throw new TypeError('distinct qubits required');
        } else if (op === 'zpow') {
            if (g.length !== 3) throw new TypeError('wrong gate arity');
            q(g[1]); g[2] = phase(g[2]);
        } else if (op === 'mcpow') {
            if (g.length !== 3) throw new TypeError('ordinary mask-form mcpow required');
            g[1] = word(g[1], 'control mask', n); g[2] = phase(g[2]);
        } else if (op === 'gphase') {
            if (g.length !== 2) throw new TypeError('wrong gate arity');
            g[1] = phase(g[1]);
        } else throw new TypeError('unsupported op ' + String(op));
        gates.push(Object.freeze(g));
    }
    return Object.freeze({n, ring, h, gates: Object.freeze(gates)});
}
/* An affine Boolean form is c + sum a_i z_i: bit 0 is c, bit i+1 is a_i. */
function termStore(ring, o, work) {
    const map = new Map();
    const maxTerms = option(o, 'maxPhaseTerms', 200000, 0, 1000000);
    const maxFactors = option(o, 'maxPhaseFactors', 500000, 0, 4000000);
    const maxBits = option(o, 'maxSymbolicBits', 64000000, 0, 512000000);
    let factorsSeen = 0, bitsSeen = 0;
    return { add(coefficient, factors) {
        coefficient = mod(coefficient, ring);
        if (!coefficient) return;
        const set = new Set();
        for (const e of factors) {
            work.tick();
            if (e === 0n) return;
            if (e === 1n) continue;
            if (set.has(e ^ 1n)) return;
            set.add(e);
        }
        const fs = Array.from(set).sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
        factorsSeen += fs.length;
        for (const e of fs) bitsSeen += high(e) + 1;
        if (factorsSeen > maxFactors || bitsSeen > maxBits)
            throw new LimitError('phase-factor/symbolic-bit budget exceeded');
        const key = fs.map(x => x.toString(16)).join(',');
        const previous = map.get(key);
        coefficient = mod(coefficient + (previous ? previous.coefficient : 0), ring);
        if (!coefficient) map.delete(key);
        else {
            if (!previous && map.size >= maxTerms) throw new LimitError('phase-term limit exceeded');
            map.set(key, {coefficient, factors: fs});
        }
    }, finish() { return Array.from(map.values()); } };
}
function trace(p, input, o, work) {
    const wires = Array.from({length:p.n}, (_,q) => (input >> BigInt(q)) & 1n);
    const store = termStore(p.ring, o, work); let h = 0;
    for (const g of p.gates) {
        work.tick();
        if (g[0] === 'h') {
            const next = 1n << BigInt(++h);
            store.add(p.ring / 2, [wires[g[1]], next]); wires[g[1]] = next;
        } else if (g[0] === 'x') wires[g[1]] ^= 1n;
        else if (g[0] === 'cx') wires[g[2]] ^= wires[g[1]];
        else if (g[0] === 'swap') [wires[g[1]],wires[g[2]]] = [wires[g[2]],wires[g[1]]];
        else if (g[0] === 'gphase') store.add(g[1], []);
        else if (g[0] === 'zpow') store.add(g[2], [wires[g[1]]]);
        else {
            const fs = []; let mask = g[1];
            while (mask) { work.tick(); const bit = mask & -mask; fs.push(wires[high(bit)]); mask ^= bit; }
            store.add(g[2], fs);
        }
    }
    return {wires, terms:store.finish()};
}
/* Echelon rows use the same packed format, with bit 0 holding the RHS. */
function eliminate(rows, work) {
    const pivots = new Map(); let consistent = true;
    for (let row of rows) {
        work.tick();
        while (row >> 1n) {
            work.tick(); const pivot = high(row) - 1, old = pivots.get(pivot);
            if (old === undefined) { pivots.set(pivot, row); break; }
            row ^= old;
        }
        if (row === 1n) consistent = false;
    }
    return {pivots, rank:pivots.size, consistent};
}
function parametrization(system, n, work) {
    const expressions = new Array(n); let free = 0;
    for (let i = 0; i < n; i++) if (!system.pivots.has(i))
        expressions[i] = 1n << BigInt(++free);
    for (const i of Array.from(system.pivots.keys()).sort((a,b)=>a-b)) {
        let row = system.pivots.get(i) ^ (1n << BigInt(i + 1)), e = row & 1n;
        row >>= 1n;
        while (row) { work.tick(); const bit = row & -row; e ^= expressions[high(bit)]; row ^= bit; }
        expressions[i] = e;
    }
    return {expressions, free};
}
function substitute(e, expressions, work) {
    let out = e & 1n, mask = e >> 1n;
    while (mask) { work.tick(); const bit = mask & -mask; out ^= expressions[high(bit)]; mask ^= bit; }
    return out;
}
/* Independent linear phase forms give a surjection onto F2^chi. */
function phaseCoordinates(terms, work) {
    const pivots = new Map(); let rank = 0;
    function reduce(mask, insert) {
        let coordinates = 0n;
        while (mask) {
            work.tick(); const p = high(mask), old = pivots.get(p);
            if (!old) {
                if (!insert) throw new Error('internal phase-span failure');
                const bit = 1n << BigInt(rank++);
                pivots.set(p, {mask, coordinates:coordinates ^ bit});
                return bit;
            }
            mask ^= old.mask; coordinates ^= old.coordinates;
        }
        return coordinates;
    }
    for (const term of terms) for (const e of term.factors) reduce(e >> 1n, true);
    return {rank, terms:terms.map(t => ({coefficient:t.coefficient,
        factors:t.factors.map(e => (reduce(e >> 1n, false) << 1n) | (e & 1n))}))};
}
function compile(program, kind, mask, value, options) {
    const o = options || {}, work = budget(o), p = validate(program, o);
    const input = word(o.input === undefined ? 0n : o.input, 'input', p.n);
    mask = word(mask, 'mask', p.n); value = word(value, 'value', p.n);
    if (value & ~mask) throw new TypeError('value has bits outside mask');
    const raw = trace(p, input, o, work), event = [];
    for (let q=0;q<p.n;q++) if ((mask >> BigInt(q)) & 1n)
        event.push(raw.wires[q] ^ ((value >> BigInt(q)) & 1n));
    const endpointRank = eliminate(raw.wires.map(e => e & ~1n),work).rank;
    const eventRank = eliminate(event.map(e => e & ~1n),work).rank;
    const rows = event.slice();
    if (kind === 'probability') for (const e of raw.wires) {
        const a = e >> 1n; rows.push((a | (a << BigInt(p.h))) << 1n);
    }
    const pathBits = (kind === 'probability' ? 2 : 1) * p.h;
    const system = eliminate(rows,work), free = pathBits-system.rank;
    if (system.rank !== (kind === 'probability' ? endpointRank + eventRank : endpointRank))
        throw new Error('internal affine-rank identity failure');
    let terms = [], phaseRank = 0;
    if (system.consistent) {
        const param = parametrization(system,pathBits,work), store = termStore(p.ring,o,work);
        for (const t of raw.terms) {
            store.add(t.coefficient,t.factors.map(e=>substitute(e,param.expressions,work)));
            if (kind === 'probability') store.add(-t.coefficient,t.factors.map(e=>
                substitute(((e >> 1n) << BigInt(p.h+1)) | (e & 1n),param.expressions,work)));
        }
        const phase = phaseCoordinates(store.finish(),work); phaseRank=phase.rank; terms=phase.terms;
    }
    const multiplicity = system.consistent ? 1n << BigInt(free-phaseRank) : 0n;
    const stats=Object.freeze({qubits:p.n,gates:p.gates.length,hadamards:p.h,
        pathBits,endpointRank,eventRank,constraintRank:system.rank,
        consistent:system.consistent,linearFreeBits:free,phaseRank,
        nullPhaseBits:system.consistent?free-phaseRank:0,phaseMultiplicity:multiplicity,
        assignments:system.consistent?1n<<BigInt(phaseRank):0n,
        phaseTerms:terms.length,phaseFactors:terms.reduce((s,t)=>s+t.factors.length,0),
        linearWork:work.used,accelerationStatus:'H'});
    const query=Object.freeze({schema:'oq-affine-v1',kind,ring:p.ring,n:p.n,input,mask,value,
        hadamards:p.h,pathBits,stats});
    records.set(query,{program:p,terms,multiplicity});
    return query;
}
function amplitude(p,y,o) {
    if (!p || !Number.isSafeInteger(p.n) || p.n<1 || p.n>4096) throw new TypeError('invalid qubit count');
    return compile(p,'amplitude',(1n<<BigInt(p.n))-1n,y,o);
}
function probability(p,mask,value,o) { return compile(p,'probability',mask,value,o); }
function data(query) {
    const d=records.get(query); if(!d) throw new TypeError('expected a plan created by this OQAFFINE instance');
    return d;
}
function program(query) { return data(query).program; }
function parity(x) { let r=0; while(x) {x&=x-1n;r^=1;} return r; }
function evaluate(terms,z,ring) {
    let phase=0;
    for(const t of terms) {
        let on=true;
        for(const e of t.factors) if((parity((e>>1n)&z)^Number(e&1n))===0) {on=false;break;}
        if(on) phase=(phase+t.coefficient)%ring;
    }
    return phase;
}
function enumerationLimit(o) { return option(o,'maxAssignments',1048576,0,67108864); }
function finish(query,counts,stats) {
    const total=counts.reduce((a,b)=>a+b,0n);
    const expected=query.stats.consistent?1n<<BigInt(query.stats.linearFreeBits):0n;
    if(total!==expected) throw new Error('phase histogram has incorrect affine-fibre cardinality');
    return {counts,value:COUNT.reconstruct(query,counts),stats:Object.assign({},query.stats,stats)};
}
function enumerate(query,options) {
    const o=options||{},d=data(query);checkAbort(o);
    const count=query.stats.assignments;
    if(count>BigInt(enumerationLimit(o))) throw new LimitError('reduced assignment budget exceeded before enumeration');
    const counts=Array(query.ring).fill(0n);
    for(let z=0n;z<count;z++) {checkAbort(o);counts[evaluate(d.terms,z,query.ring)]+=d.multiplicity;}
    return finish(query,counts,{backend:'affine-enumeration',evaluatedAssignments:count});
}
/* All new CNF variables have complete functional equivalences. */
class Builder {
    constructor(o) {
        this.o=o;this.nVars=0;this.clauses=[];
        this.maxVars=option(o,'maxVariables',200000,0,2000000);
        this.maxClauses=option(o,'maxClauses',1000000,0,10000000);
    }
    fresh() {checkAbort(this.o);if(this.nVars>=this.maxVars)throw new LimitError('CNF variable limit exceeded');return ++this.nVars;}
    clause(input) {
        const seen=new Set(),c=[];
        for(const x of input){if(x===true)return;if(x===false)continue;if(seen.has(-x))return;if(!seen.has(x)){seen.add(x);c.push(x);}}
        if(this.clauses.length>=this.maxClauses)throw new LimitError('CNF clause limit exceeded');
        if(c.length>3)throw new Error('internal width failure');this.clauses.push(c);
    }
    and(a,b) {
        if(a===false||b===false)return false;if(a===true)return b;if(b===true||a===b)return a;if(a===-b)return false;
        const v=this.fresh();this.clause([-v,a]);this.clause([-v,b]);this.clause([v,-a,-b]);return v;
    }
    xor(a,b) {
        if(a===false)return b;if(b===false)return a;if(a===true)return neg(b);if(b===true)return neg(a);
        if(a===b)return false;if(a===-b)return true;
        const v=this.fresh();this.clause([-a,-b,-v]);this.clause([a,b,-v]);this.clause([a,-b,v]);this.clause([-a,b,v]);return v;
    }
    add(phase,on,k) {
        let carry=false;
        for(let i=0;i<phase.length;i++) {
            const a=phase[i],b=(k&(1<<i))?on:false,t=this.xor(a,b);
            phase[i]=this.xor(t,carry);
            if(i+1<phase.length)carry=neg(this.and(neg(this.and(a,b)),neg(this.and(carry,t))));
        }
    }
}
function neg(a){return typeof a==='boolean'?!a:-a;}
function toCNF(query,options) {
    const o=options||{},d=data(query),b=new Builder(o),vars=[];checkAbort(o);
    for(let i=0;i<query.stats.phaseRank;i++)vars.push(b.fresh());
    const cache=new Map(),phase=Array(query.ring===8?3:4).fill(false);
    function form(e) {
        if(cache.has(e))return cache.get(e);
        let value=Boolean(e&1n),mask=e>>1n;
        while(mask){checkAbort(o);const bit=mask&-mask;value=b.xor(value,vars[high(bit)]);mask^=bit;}
        cache.set(e,value);return value;
    }
    if(!query.stats.consistent)b.clause([]);
    else for(const term of d.terms){checkAbort(o);let on=true;for(const e of term.factors)on=b.and(on,form(e));b.add(phase,on,term.coefficient);}
    const problem=Object.freeze({schema:'oq-count-v1',kind:query.kind,ring:query.ring,
        hadamards:query.hadamards,pathBits:query.stats.phaseRank,nVars:b.nVars,
        clauses:Object.freeze(b.clauses.map(c=>Object.freeze(c))),phaseBits:Object.freeze(phase)});
    return Object.freeze({query:problem,multiplicity:d.multiplicity,
        stats:Object.freeze({variables:b.nVars,clauses:b.clauses.length,
            independentPhaseBits:query.stats.phaseRank,auxiliaryVariables:b.nVars-query.stats.phaseRank})});
}
function solve(query,options) {
    const o=options||{};data(query);
    if(o.backend===undefined||o.backend==='enumerate')return enumerate(query,o);
    if(o.backend!=='cnf')throw new TypeError('backend must be enumerate or cnf');
    const compiled=toCNF(query,o),out=COUNT.solve(compiled.query,o);
    return finish(query,out.counts.map(x=>x*compiled.multiplicity),
        {backend:'affine-'+out.stats.backend,cnf:compiled.stats,counter:out.stats});
}
return Object.freeze({version:'0.1.0-experimental',status:'H-performance',
    amplitude,probability,program,enumerate,toCNF,solve,LimitError});
});
