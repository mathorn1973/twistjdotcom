/*
 * oqcount.js -- experimental exact phase counting for Ordinary Quantum.
 * (c) Marek Spanel 2026. All rights reserved.
 *
 * NON-CANONICAL C-OQ-PATHCOUNT-N. Acceleration status: H.
 * The reference counter is exponential-time DPLL, NOT a subexponential solver.
 * No statevector is allocated. All scientific coefficients/counts are BigInt.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.OQCOUNT = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

class LimitError extends Error {
    constructor(message) { super(message); this.name = 'OQCountLimitError'; }
}
function integer(x, name, lo, hi) {
    if (!Number.isSafeInteger(x) || x < lo || x > hi)
        throw new TypeError(name + ' must be a safe integer in [' + lo + ', ' + hi + ']');
    return x;
}
function option(o, name, fallback, lo, hi) {
    return integer(o[name] === undefined ? fallback : o[name], name, lo, hi);
}
function word(x, name, n) {
    if (typeof x === 'number') {
        integer(x, name, 0, Number.MAX_SAFE_INTEGER); x = BigInt(x);
    }
    if (typeof x !== 'bigint' || x < 0n || (x >> BigInt(n)) !== 0n)
        throw new TypeError(name + ' must be a nonnegative ' + n + '-bit integer');
    return x;
}
function abort(o) {
    if ((o.signal && o.signal.aborted) || (o.shouldStop && o.shouldStop()))
        throw new LimitError('counting cancelled; no final result');
}
function neg(a) { return typeof a === 'boolean' ? !a : -a; }
function modulo(k, r) { return ((k % r) + r) % r; }

class Builder {
    constructor(o) {
        this.options = o; this.nVars = 0; this.clauses = []; this.pathBits = 0;
        this.maxVars = option(o, 'maxVariables', 200000, 0, 2000000);
        this.maxClauses = option(o, 'maxClauses', 1000000, 0, 10000000);
    }
    fresh(path) {
        abort(this.options);
        if (this.nVars >= this.maxVars) throw new LimitError('CNF variable limit exceeded');
        if (path) this.pathBits++;
        return ++this.nVars;
    }
    clause(lits) {
        var out = [], seen = new Set();
        for (var a of lits) {
            if (a === true) return;
            if (a === false) continue;
            if (seen.has(-a)) return;
            if (!seen.has(a)) { seen.add(a); out.push(a); }
        }
        if (out.length > 3) throw new Error('internal error: clause exceeds width three');
        if (this.clauses.length >= this.maxClauses) throw new LimitError('CNF clause limit exceeded');
        this.clauses.push(out);
    }
    and(a, b) {
        if (a === false || b === false) return false;
        if (a === true) return b;
        if (b === true || a === b) return a;
        if (a === -b) return false;
        var v = this.fresh(false);
        this.clause([-v, a]); this.clause([-v, b]); this.clause([v, -a, -b]);
        return v;
    }
    xor(a, b) {
        if (a === false) return b;
        if (b === false) return a;
        if (a === true) return neg(b);
        if (b === true) return neg(a);
        if (a === b) return false;
        if (a === -b) return true;
        var v = this.fresh(false);
        this.clause([-a, -b, -v]); this.clause([a, b, -v]);
        this.clause([a, -b, v]); this.clause([-a, b, v]);
        return v;
    }
    or(a, b) { return neg(this.and(neg(a), neg(b))); }
    equal(a, b) { this.clause([neg(a), b]); this.clause([a, neg(b)]); }
    pin(a, bit) { this.clause([bit ? a : neg(a)]); }
    addPhase(phase, condition, k, ring) {
        k = modulo(k, ring);
        if (k === 0 || condition === false) return;
        var carry = false;
        for (var i = 0; i < phase.length; i++) {
            var a = phase[i], b = (k & (1 << i)) ? condition : false;
            var t = this.xor(a, b);
            phase[i] = this.xor(t, carry);
            if (i + 1 < phase.length)
                carry = this.or(this.and(a, b), this.and(carry, t));
        }
    }
}

function validateProgram(program, o) {
    if (!program || typeof program !== 'object') throw new TypeError('expected a parsed OQ program');
    var n = integer(program.n, 'n', 1, option(o, 'maxQubits', 4096, 1, 65536));
    var ring = program.ring;
    if (ring !== 8 && ring !== 16) throw new TypeError('explicit program.ring must be 8 or 16');
    if (program.dynamic) throw new TypeError('dynamic circuits, feedback and reset are unsupported');
    if (program.backend === 'compressed' || program.ignoredGlobalPhases)
        throw new TypeError('compressed programs may discard global phase; use ordinary QASM parsing');
    if (program.synthesis && program.synthesis.length)
        throw new TypeError('approximate synthesis is outside the exact input contract');
    if (!Array.isArray(program.gates)) throw new TypeError('program.gates must be an array');
    if (program.gates.length > option(o, 'maxGates', 100000, 0, 1000000))
        throw new LimitError('gate limit exceeded');
    var gates = [], h = 0;
    function q(x) { return integer(x, 'qubit index', 0, n - 1); }
    function exponent(x) { return integer(x, 'phase exponent', -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER); }
    for (var source of program.gates) {
        abort(o);
        if (!Array.isArray(source)) throw new TypeError('gate must be an array');
        var g = source.slice(), op = g[0];
        if (op === 'h' || op === 'x') {
            if (g.length !== 2) throw new TypeError('wrong gate arity: ' + op);
            q(g[1]); if (op === 'h') h++;
        } else if (op === 'cx' || op === 'swap') {
            if (g.length !== 3) throw new TypeError('wrong gate arity: ' + op);
            q(g[1]); q(g[2]);
            if (g[1] === g[2]) throw new TypeError('gate operands must be distinct');
        } else if (op === 'zpow') {
            if (g.length !== 3) throw new TypeError('wrong gate arity: zpow');
            q(g[1]); g[2] = modulo(exponent(g[2]), ring);
        } else if (op === 'mcpow') {
            if (g.length !== 3) throw new TypeError('wrong gate arity: mcpow');
            g[1] = word(g[1], 'control mask', n); g[2] = modulo(exponent(g[2]), ring);
        } else if (op === 'gphase') {
            if (g.length !== 2) throw new TypeError('wrong gate arity: gphase');
            g[1] = modulo(exponent(g[1]), ring);
        } else {
            throw new TypeError('unsupported op ' + String(op) + '; measurement must be terminal parser metadata');
        }
        gates.push(g);
    }
    return { n: n, ring: ring, gates: gates, h: h };
}
function walk(b, p, input, phase, sign) {
    var wires = Array.from({length: p.n}, (_, i) => ((input >> BigInt(i)) & 1n) !== 0n);
    for (var g of p.gates) {
        abort(b.options);
        if (g[0] === 'h') {
            var old = wires[g[1]], v = b.fresh(true);
            b.addPhase(phase, b.and(old, v), p.ring / 2, p.ring);
            wires[g[1]] = v;
        } else if (g[0] === 'x') wires[g[1]] = neg(wires[g[1]]);
        else if (g[0] === 'cx') wires[g[2]] = b.xor(wires[g[1]], wires[g[2]]);
        else if (g[0] === 'swap') {
            var t = wires[g[1]]; wires[g[1]] = wires[g[2]]; wires[g[2]] = t;
        } else if (g[0] === 'gphase') b.addPhase(phase, true, sign * g[1], p.ring);
        else if (g[0] === 'zpow') b.addPhase(phase, wires[g[1]], sign * g[2], p.ring);
        else if (g[0] === 'mcpow') {
            var mask = g[1], condition = true, i = 0;
            while (mask) {
                if (mask & 1n) condition = b.and(condition, wires[i]);
                mask >>= 1n; i++;
            }
            b.addPhase(phase, condition, sign * g[2], p.ring);
        }
    }
    return wires;
}
function compile(program, kind, mask, value, options) {
    var o = options || {}, p = validateProgram(program, o);
    var input = word(o.input === undefined ? 0n : o.input, 'input', p.n);
    mask = word(mask, 'event mask', p.n); value = word(value, 'output/event value', p.n);
    if ((value & ~mask) !== 0n) throw new TypeError('event value sets bits outside its mask');
    var b = new Builder(o), phase = Array(p.ring === 8 ? 3 : 4).fill(false);
    var left = walk(b, p, input, phase, 1);
    if (kind === 'probability') {
        var right = walk(b, p, input, phase, -1);
        for (var i = 0; i < p.n; i++) b.equal(left[i], right[i]);
    }
    for (var j = 0; j < p.n; j++)
        if ((mask >> BigInt(j)) & 1n) b.pin(left[j], ((value >> BigInt(j)) & 1n) !== 0n);
    var clauses = Object.freeze(b.clauses.map(c => Object.freeze(c)));
    return Object.freeze({
        schema: 'oq-count-v1', status: 'H-performance', kind: kind, ring: p.ring,
        n: p.n, hadamards: p.h, pathBits: b.pathBits, nVars: b.nVars,
        clauses: clauses, phaseBits: Object.freeze(phase.slice()),
        input: input, mask: mask, value: value,
        stats: Object.freeze({gates: p.gates.length, variables: b.nVars,
            clauses: clauses.length, pathBits: b.pathBits, maxClauseWidth: 3})
    });
}
function amplitude(program, output, options) {
    if (!program || !Number.isSafeInteger(program.n) || program.n < 1 || program.n > 65536)
        throw new TypeError('invalid qubit count');
    return compile(program, 'amplitude', (1n << BigInt(program.n)) - 1n, output, options);
}
function probability(program, mask, value, options) {
    return compile(program, 'probability', mask, value, options);
}
function phaseQuery(problem, r) {
    integer(r, 'phase', 0, problem.ring - 1);
    var clauses = problem.clauses.slice();
    for (var i = 0; i < problem.phaseBits.length; i++) {
        var a = (r & (1 << i)) ? problem.phaseBits[i] : neg(problem.phaseBits[i]);
        if (a === false) clauses.push([]);
        else if (a !== true) clauses.push([a]);
    }
    return { nVars: problem.nVars, clauses: clauses };
}
function dimacs(problem, r) {
    var q = phaseQuery(problem, r);
    return 'c OQ exact unweighted phase count; performance status H\n' +
        'c All declared variables count. No projection and no weights.\n' +
        'p cnf ' + q.nVars + ' ' + q.clauses.length + '\n' +
        q.clauses.map(c => c.join(' ') + (c.length ? ' ' : '') + '0\n').join('');
}

function validateCNF(cnf) {
    if (!cnf || !Array.isArray(cnf.clauses)) throw new TypeError('invalid CNF');
    integer(cnf.nVars, 'CNF nVars', 0, 2000000);
    if (cnf.clauses.length > 10000000) throw new LimitError('CNF input limit exceeded');
    for (var c of cnf.clauses) {
        if (!Array.isArray(c) || c.length > 3) throw new TypeError('expected width-at-most-three CNF');
        for (var l of c)
            if (!Number.isSafeInteger(l) || l === 0 || Math.abs(l) > cnf.nVars)
                throw new TypeError('invalid CNF literal');
    }
}
function budget(options) {
    var o = options || {};
    return { options: o, nodes: 0, deepest: 0,
        limit: option(o, 'maxNodes', 250000, 0, Number.MAX_SAFE_INTEGER),
        depthLimit: option(o, 'maxDepth', 512, 0, 1024) };
}
function countWithBudget(cnf, b) {
    validateCNF(cnf);
    function visit(values, depth) {
        abort(b.options);
        b.nodes++;
        b.deepest = Math.max(b.deepest, depth);
        if (b.nodes > b.limit) throw new LimitError('DPLL node budget exceeded; no final result');
        if (depth > b.depthLimit) throw new LimitError('DPLL depth budget exceeded; no final result');
        var changed = true;
        while (changed) {
            abort(b.options); changed = false;
            for (var c of cnf.clauses) {
                var sat = false, unset = 0, last = 0;
                for (var l of c) {
                    var v = values[Math.abs(l)];
                    if (v === (l > 0 ? 1 : -1)) { sat = true; break; }
                    if (!v) { unset++; last = l; }
                }
                if (sat) continue;
                if (!unset) return 0n;
                if (unset === 1) { values[Math.abs(last)] = last > 0 ? 1 : -1; changed = true; }
            }
        }
        var scores = new Uint32Array(cnf.nVars + 1), selected = 0, best = 0;
        for (var clause of cnf.clauses) {
            if (clause.some(l => values[Math.abs(l)] === (l > 0 ? 1 : -1))) continue;
            for (var lit of clause) {
                var index = Math.abs(lit);
                if (!values[index] && ++scores[index] > best) { selected = index; best = scores[index]; }
            }
        }
        if (!selected) {
            var free = 0;
            for (var k = 1; k <= cnf.nVars; k++) if (!values[k]) free++;
            return 1n << BigInt(free);
        }
        var other = values.slice();
        values[selected] = -1; other[selected] = 1;
        return visit(values, depth + 1) + visit(other, depth + 1);
    }
    return visit(new Int8Array(cnf.nVars + 1), 0);
}
function countCNF(cnf, options) { return countWithBudget(cnf, budget(options)); }

function rotate(a, k, ring) {
    var d = ring / 2, out = Array(d).fill(0n);
    for (var i = 0; i < d; i++) {
        var j = modulo(i + k, ring);
        out[j % d] += j < d ? a[i] : -a[i];
    }
    return out;
}
function normalize(numerator, denominatorExp, ring) {
    if (ring !== 8 && ring !== 16) throw new TypeError('unsupported ring');
    integer(denominatorExp, 'denominatorExp', 0, 2000000);
    if (!Array.isArray(numerator) || numerator.length !== ring / 2 ||
        numerator.some(x => typeof x !== 'bigint')) throw new TypeError('invalid exact numerator');
    var a = numerator.slice(), d = denominatorExp;
    if (a.every(x => x === 0n)) d = 0;
    else while (d > 0 && a.every(x => (x & 1n) === 0n)) { a = a.map(x => x / 2n); d--; }
    return { ring: ring, numerator: a, denominatorExp: d };
}
function reconstruct(problem, counts) {
    if (!Array.isArray(counts) || counts.length !== problem.ring ||
        counts.some(x => typeof x !== 'bigint' || x < 0n))
        throw new TypeError('counter must supply one nonnegative BigInt count per phase');
    if (counts.reduce((s, x) => s + x, 0n) > (1n << BigInt(problem.pathBits)))
        throw new Error('counts exceed the number of histories; auxiliary uniqueness or counter failed');
    var d = problem.ring / 2, a = counts.slice(0, d).map((x, i) => x - counts[i + d]);
    var den = problem.hadamards;
    if (problem.kind === 'amplitude') {
        den = Math.floor((problem.hadamards + 1) / 2);
        if (problem.hadamards % 2) {
            var plus = rotate(a, problem.ring / 8, problem.ring);
            var minus = rotate(a, -problem.ring / 8, problem.ring);
            a = plus.map((x, i) => x + minus[i]);
        }
    }
    return normalize(a, den, problem.ring);
}
function solve(problem, options) {
    var o = options || {}, b = budget(o), counts = [];
    if (o.counter !== undefined && typeof o.counter !== 'function') throw new TypeError('counter must be a function');
    for (var r = 0; r < problem.ring; r++) {
        abort(o);
        var query = phaseQuery(problem, r);
        var value = o.counter ? o.counter(query, {phase: r, ring: problem.ring}) : countWithBudget(query, b);
        if (typeof value !== 'bigint' || value < 0n) throw new TypeError('exact counter result must be a nonnegative BigInt');
        counts.push(value);
    }
    return { counts: counts, value: reconstruct(problem, counts),
        stats: { backend: o.counter ? 'external-unweighted-count' : 'reference-dpll',
            nodes: o.counter ? null : b.nodes, maxDepth: o.counter ? null : b.deepest,
            phases: problem.ring, accelerationStatus: 'H' } };
}
return { version: '0.1.0-experimental', status: 'H-performance',
    amplitude: amplitude, probability: probability, phaseQuery: phaseQuery,
    dimacs: dimacs, solve: solve, countCNF: countCNF, reconstruct: reconstruct,
    normalize: normalize, LimitError: LimitError };
});
