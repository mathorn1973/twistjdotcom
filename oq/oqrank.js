/*
 * oqrank.js -- exact Clifford-frame / binary-rank simulation for OQ.
 *
 * Scalar arithmetic is Z[w]/(w^4+1), w = exp(i*pi/4), with a common 2^d
 * denominator. The physical state is C V |a>, where C is a Clifford frame
 * and V|s> = |B s> for an independent binary basis B. Only |a> is stored.
 * This is an observables backend: it does not expose physical amplitudes,
 * the dense fingerprint, or joint sampling. Work remains exponential in r.
 *
 * Port of research/m-linear-compression/m_rank.py. Pauli convention:
 * P = i^phase X^x Z^z; multiplication adds 2 parity(z & x') to phase.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.OQRANK = api;
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var MAX_QUBITS = 4096, DEFAULT_MAX_RANK = 16, HARD_MAX_RANK = 20;
var DEFAULT_MAX_COEFF_BITS = 4096, HARD_MAX_COEFF_BITS = 4096;
var ZERO = Object.freeze([0n, 0n, 0n, 0n]);
var ONE = Object.freeze([1n, 0n, 0n, 0n]);
var HEX_PARITY = [0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0];

function fail(message) { throw new Error('Rank mode: ' + message); }
function mod(k, m) { return ((k % m) + m) % m; }
function abs(v) { return v < 0n ? -v : v; }
function bits(v) { return v === 0n ? 0 : abs(v).toString(2).length; }
function parity(v) {
    var s = v.toString(16), p = 0;
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        p ^= HEX_PARITY[c <= 57 ? c - 48 : c - 87];
    }
    return p;
}
function smallParity(v) {
    v ^= v >>> 16; v ^= v >>> 8; v ^= v >>> 4;
    return (0x6996 >>> (v & 15)) & 1;
}
function isZero(a) { return a[0] === 0n && a[1] === 0n && a[2] === 0n && a[3] === 0n; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]]; }
function negate(a) { return [-a[0], -a[1], -a[2], -a[3]]; }
function rotate(a, power) {
    power = mod(power, 8);
    var out = [0n, 0n, 0n, 0n];
    for (var i = 0; i < 4; i++) {
        var j = i + power;
        out[j & 3] = ((j >>> 2) & 1) ? -a[i] : a[i];
    }
    return out;
}
function multiply(a, b) {
    var out = [0n, 0n, 0n, 0n];
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
        var k = i + j, value = a[i] * b[j];
        out[k & 3] += k < 4 ? value : -value;
    }
    return out;
}
function conjugate(a) { return [a[0], -a[3], -a[2], -a[1]]; }
function trailingZeros(v) { return bits(abs(v) & -abs(v)) - 1; }
function exact(a, denominator) {
    if (isZero(a)) return { numerator: [0n, 0n, 0n, 0n], denominatorExp: 0 };
    var shift = denominator;
    for (var j = 0; j < 4 && shift; j++)
        if (a[j] !== 0n) shift = Math.min(shift, trailingZeros(a[j]));
    var q = BigInt(shift);
    return { numerator: [a[0] >> q, a[1] >> q, a[2] >> q, a[3] >> q],
             denominatorExp: denominator - shift };
}

function registerSize(n) {
    if (!Number.isSafeInteger(n) || n < 1 || n > MAX_QUBITS)
        fail('qubit count must be between 1 and ' + MAX_QUBITS + '.');
}
function checkQubit(q, n) {
    if (!Number.isSafeInteger(q) || q < 0 || q >= n)
        fail('qubit index is outside the register.');
}
function pauli(x, z, phase) { return { x: x, z: z, phase: mod(phase || 0, 4) }; }
function times(a, b) {
    return pauli(a.x ^ b.x, a.z ^ b.z, a.phase + b.phase + 2 * parity(a.z & b.x));
}
function phased(a, phase) { return pauli(a.x, a.z, a.phase + phase); }
function validatedPauli(p, n) {
    if (!p || typeof p.x !== 'bigint' || typeof p.z !== 'bigint' ||
        p.x < 0n || p.z < 0n || !Number.isSafeInteger(p.phase === undefined ? 0 : p.phase))
        fail('observable needs nonnegative BigInt x/z masks and an integer phase.');
    if ((p.x | p.z) >> BigInt(n)) fail('observable exceeds the register.');
    var out = pauli(p.x, p.z, p.phase || 0);
    if ((out.phase & 1) !== parity(out.x & out.z)) fail('observable must be a Hermitian Pauli.');
    return out;
}

/* Rows are C† X_q C and C† Z_q C. Updates replace rows; rotations already
 * recorded in a plan therefore keep their original Pauli axes. */
function CliffordFrame(n) {
    this.n = n; this.x = new Array(n); this.z = new Array(n);
    for (var q = 0; q < n; q++) {
        var bit = 1n << BigInt(q);
        this.x[q] = pauli(bit, 0n, 0); this.z[q] = pauli(0n, bit, 0);
    }
}
CliffordFrame.prototype.h = function (q) {
    var t = this.x[q]; this.x[q] = this.z[q]; this.z[q] = t;
};
CliffordFrame.prototype.xGate = function (q) { this.z[q] = phased(this.z[q], 2); };
CliffordFrame.prototype.phaseGate = function (q, k) {
    if (k === 2) this.x[q] = phased(times(this.x[q], this.z[q]), -1);
    else if (k === 4) this.x[q] = phased(this.x[q], 2);
    else if (k === 6) this.x[q] = phased(times(this.x[q], this.z[q]), 1);
};
CliffordFrame.prototype.cx = function (control, target) {
    this.x[control] = times(this.x[control], this.x[target]);
    this.z[target] = times(this.z[control], this.z[target]);
};
CliffordFrame.prototype.cz = function (control, target) {
    this.h(target); this.cx(control, target); this.h(target);
};
CliffordFrame.prototype.swap = function (a, b) {
    var t = this.x[a]; this.x[a] = this.x[b]; this.x[b] = t;
    t = this.z[a]; this.z[a] = this.z[b]; this.z[b] = t;
};
CliffordFrame.prototype.pullback = function (p) {
    var out = pauli(0n, 0n, p.phase), masks = [p.x, p.z], rows = [this.x, this.z];
    for (var j = 0; j < 2; j++) {
        var mask = masks[j];
        while (mask) {
            var bit = mask & -mask;
            out = times(out, rows[j][bits(bit) - 1]);
            mask ^= bit;
        }
    }
    return out;
};

function BinaryBasis() { this.vectors = []; this.pivots = new Map(); }
BinaryBasis.prototype.reduce = function (mask) {
    var coordinate = 0;
    while (mask) {
        var entry = this.pivots.get(bits(mask) - 1);
        if (!entry) break;
        mask ^= entry.vector; coordinate ^= entry.label;
    }
    return { remainder: mask, coordinate: coordinate };
};
BinaryBasis.prototype.insert = function (mask, cap) {
    var reduced = this.reduce(mask);
    if (!reduced.remainder) return;
    if (this.vectors.length >= cap)
        fail('active rank exceeds ' + cap + '; the compressed state would need at least 2^' +
             (cap + 1) + ' coefficients. Use Statevector or a smaller circuit.');
    var label = 1 << this.vectors.length;
    this.vectors.push(mask);
    this.pivots.set(bits(reduced.remainder) - 1,
        { vector: reduced.remainder, label: reduced.coordinate ^ label });
};
BinaryBasis.prototype.coordinates = function (mask) {
    var reduced = this.reduce(mask);
    return reduced.remainder ? null : reduced.coordinate;
};
BinaryBasis.prototype.restrictZ = function (mask) {
    var out = 0;
    for (var j = 0; j < this.vectors.length; j++) out |= parity(mask & this.vectors[j]) << j;
    return out;
};

function phaseExponent(value) {
    if (!Number.isSafeInteger(value)) fail('phase exponent must be a safe integer in pi/4 units.');
    return mod(value, 8);
}
function controlledQubits(g, n) {
    var qs;
    if (g[3] !== undefined) {
        if (!Array.isArray(g[3])) fail('controlled phase needs a qubit list.');
        qs = g[3].slice();
        /* The lowered parser carries both forms. Refuse inconsistent forms
         * rather than choosing a different unitary from the dense engine. */
        if (g[1] !== null && g[1] !== undefined) {
            var mask = 0;
            for (var j = 0; j < qs.length; j++) {
                checkQubit(qs[j], n);
                if (qs[j] > 30) fail('controlled phase above qubit 30 needs a null mask and a qubit list.');
                mask |= 1 << qs[j];
            }
            if (mask !== g[1]) fail('controlled phase mask and qubit list disagree.');
        }
    } else {
        if (!Number.isSafeInteger(g[1]) || g[1] < 0 || g[1] > 0x7fffffff)
            fail('controlled phase needs a valid mask or an explicit qubit list.');
        qs = [];
        for (var q = 0; q <= 30; q++) if (g[1] & (1 << q)) qs.push(q);
    }
    for (var i = 0; i < qs.length; i++) checkQubit(qs[i], n);
    if (new Set(qs).size !== qs.length) fail('controlled phase repeats a qubit.');
    return qs;
}

function plan(gates, n, opts) {
    registerSize(n);
    if (!Array.isArray(gates)) fail('circuit must be a lowered OQ gate list.');
    opts = opts || {};
    var maxRank = opts.maxRank === undefined ? DEFAULT_MAX_RANK : opts.maxRank;
    var maxCoeffBits = opts.maxCoeffBits === undefined ? DEFAULT_MAX_COEFF_BITS : opts.maxCoeffBits;
    if (!Number.isSafeInteger(maxRank) || maxRank < 0 || maxRank > HARD_MAX_RANK)
        fail('maxRank must be an integer from 0 to ' + HARD_MAX_RANK + '.');
    if (!Number.isSafeInteger(maxCoeffBits) || maxCoeffBits < 1 || maxCoeffBits > HARD_MAX_COEFF_BITS)
        fail('maxCoeffBits must be an integer from 1 to ' + HARD_MAX_COEFF_BITS + '.');
    var frame = new CliffordFrame(n), basis = new BinaryBasis(), rotations = [], ignored = 0;
    for (var i = 0; i < gates.length; i++) {
        var g = gates[i], op, k, qs;
        if (!Array.isArray(g) || typeof g[0] !== 'string') fail('invalid gate at index ' + i + '.');
        op = g[0];
        if (op === 'h' || op === 'x' || op === 'zpow') {
            checkQubit(g[1], n);
            if (op === 'h') frame.h(g[1]);
            else if (op === 'x') frame.xGate(g[1]);
            else {
                k = phaseExponent(g[2]);
                if (k & 1) {
                    var p = frame.z[g[1]];
                    basis.insert(p.x, maxRank);
                    rotations.push({ pauli: p, power: k });
                } else frame.phaseGate(g[1], k);
            }
        } else if (op === 'cx' || op === 'swap') {
            checkQubit(g[1], n); checkQubit(g[2], n);
            if (g[1] === g[2]) fail(op + ' needs distinct qubits.');
            if (op === 'cx') frame.cx(g[1], g[2]); else frame.swap(g[1], g[2]);
        } else if (op === 'gphase') {
            phaseExponent(g[1]); ignored++;
        } else if (op === 'mcpow') {
            k = phaseExponent(g[2]); qs = controlledQubits(g, n);
            if (k !== 4 || qs.length !== 2)
                fail('only two-qubit CZ controlled phases are supported. Use Statevector for this circuit.');
            frame.cz(qs[0], qs[1]);
        } else if (op === 'measure' || op === 'if') {
            fail('mid-circuit measurement and classical control are not supported. Use Statevector.');
        } else fail('unsupported operation "' + op + '". Use Statevector for this circuit.');
    }
    for (var j = 0; j < rotations.length; j++) {
        rotations[j].shift = basis.coordinates(rotations[j].pauli.x);
        rotations[j].z = basis.restrictZ(rotations[j].pauli.z);
    }
    return { n: n, rank: basis.vectors.length, size: 1 << basis.vectors.length,
             tCount: rotations.length, frame: frame, basis: basis, rotations: rotations,
             ignoredGlobalPhases: ignored, maxRank: maxRank, maxCoeffBits: maxCoeffBits };
}

function State(prepared) {
    /* A plan is produced by this module, not a serialized program. Check the
     * allocation invariants again at the allocation boundary. */
    if (!prepared || !(prepared.frame instanceof CliffordFrame) || !(prepared.basis instanceof BinaryBasis))
        fail('create expects the result of plan().');
    registerSize(prepared.n);
    if (!Number.isSafeInteger(prepared.rank) || prepared.rank < 0 || prepared.rank > HARD_MAX_RANK ||
        prepared.rank > prepared.maxRank || prepared.size !== Math.pow(2, prepared.rank) ||
        prepared.rank !== prepared.basis.vectors.length ||
        !Number.isSafeInteger(prepared.maxCoeffBits) || prepared.maxCoeffBits < 1 ||
        prepared.maxCoeffBits > HARD_MAX_COEFF_BITS || !Array.isArray(prepared.rotations) ||
        prepared.tCount !== prepared.rotations.length)
        fail('invalid plan allocation limits.');
    this.n = prepared.n; this.rank = prepared.rank; this.size = prepared.size;
    this.tCount = prepared.tCount; this.frame = prepared.frame; this.basis = prepared.basis;
    this.rotations = prepared.rotations; this.ignoredGlobalPhases = prepared.ignoredGlobalPhases;
    this.maxCoeffBits = prepared.maxCoeffBits;
    this.coefficients = new Array(this.size).fill(ZERO); this.coefficients[0] = ONE;
    this.done = 0; this.denom = 0; this.peakBits = 1;
}

State.prototype.step = function () {
    if (this.done >= this.tCount) return false;
    var r = this.rotations[this.done], out = new Array(this.size).fill(ZERO);
    for (var source = 0; source < this.size; source++) {
        var a = this.coefficients[source];
        if (isZero(a)) continue;
        var wa = rotate(a, r.power);
        out[source] = add(out[source], add(a, wa));
        var branch = add(a, negate(wa));
        var phase = 2 * r.pauli.phase + 4 * smallParity(r.z & source);
        var target = source ^ r.shift;
        out[target] = add(out[target], rotate(branch, phase));
    }
    var denominator = this.denom + 1, common = denominator, peak = 0;
    for (var i = 0; i < out.length; i++) for (var j = 0; j < 4; j++) {
        var value = out[i][j];
        if (value === 0n) continue;
        peak = Math.max(peak, bits(value));
        if (peak > this.maxCoeffBits)
            fail('coefficient size exceeds ' + this.maxCoeffBits + ' bits before normalization. ' +
                 'Use Statevector or a smaller circuit.');
        if (common) common = Math.min(common, trailingZeros(value));
    }
    if (common) {
        var shift = BigInt(common);
        for (var k = 0; k < out.length; k++) if (!isZero(out[k])) {
            var c = out[k];
            out[k] = [c[0] >> shift, c[1] >> shift, c[2] >> shift, c[3] >> shift];
        }
        denominator -= common;
    }
    this.coefficients = out; this.denom = denominator;
    this.peakBits = Math.max(this.peakBits, peak); this.done++;
    return true;
};

State.prototype.expectation = function (observable) {
    if (this.done !== this.tCount) fail('finish the simulation before reading an observable.');
    var p = this.frame.pullback(validatedPauli(observable, this.n));
    var shift = this.basis.coordinates(p.x);
    if (shift === null) return exact(ZERO, 0);
    var z = this.basis.restrictZ(p.z), total = ZERO;
    for (var source = 0; source < this.size; source++) {
        var a = this.coefficients[source], b = this.coefficients[source ^ shift];
        if (isZero(a) || isZero(b)) continue;
        /* Phase belongs to the source ket. Reversing this sign is the common
         * error that changes Y expectations. */
        var product = multiply(conjugate(b), a);
        total = add(total, rotate(product, 2 * p.phase + 4 * smallParity(z & source)));
    }
    return exact(total, 2 * this.denom);
};
State.prototype.probabilityOne = function (q) {
    checkQubit(q, this.n);
    var e = this.expectation(pauli(0n, 1n << BigInt(q), 0));
    var one = [1n << BigInt(e.denominatorExp), 0n, 0n, 0n];
    return exact(add(one, negate(e.numerator)), e.denominatorExp + 1);
};
State.prototype.checkNorm = function () {
    var total = ZERO;
    for (var i = 0; i < this.size; i++) {
        var a = this.coefficients[i];
        if (!isZero(a)) total = add(total, multiply(conjugate(a), a));
    }
    var value = exact(total, 2 * this.denom), a = value.numerator;
    return { ok: value.denominatorExp === 0 && a[0] === 1n && a[1] === 0n && a[2] === 0n && a[3] === 0n,
             exact: value };
};
function create(prepared) { return new State(prepared); }
function run(gates, n, opts) {
    var state = create(plan(gates, n, opts));
    while (state.step()) { /* callers needing cancellation should drive step() themselves */ }
    return state;
}

function parseObservable(text, n) {
    registerSize(n);
    if (typeof text !== 'string') fail('observable must be text such as X0 Y1 Z7.');
    var source = text.trim(), phase = 0, x = 0n, z = 0n, seen = new Set();
    if (source[0] === '-') { phase = 2; source = source.slice(1).trim(); }
    if (!source || /^i$/i.test(source)) return pauli(0n, 0n, phase);
    var tokens = source.split(/\s+/);
    for (var i = 0; i < tokens.length; i++) {
        var match = /^([XYZ])(\d+)$/i.exec(tokens[i]);
        if (!match) fail('observable syntax is X0 Y1 Z7, optionally prefixed by -, or I.');
        var q = Number(match[2]), name = match[1].toUpperCase();
        checkQubit(q, n);
        if (seen.has(q)) fail('observable names qubit ' + q + ' more than once.');
        seen.add(q);
        var bit = 1n << BigInt(q);
        if (name === 'X' || name === 'Y') x |= bit;
        if (name === 'Z' || name === 'Y') z |= bit;
        if (name === 'Y') phase++;
    }
    return pauli(x, z, phase);
}

function checkExact(value) {
    if (!value || !Array.isArray(value.numerator) || value.numerator.length !== 4 ||
        !value.numerator.every(function (x) { return typeof x === 'bigint'; }) ||
        !Number.isSafeInteger(value.denominatorExp) || value.denominatorExp < 0)
        fail('invalid exact scalar.');
    return value;
}
function scalarString(value) {
    checkExact(value);
    var a = value.numerator, terms = [];
    function term(coefficient, suffix) {
        if (coefficient === 0n) return;
        var magnitude = abs(coefficient), body = (suffix && magnitude === 1n ? '' : magnitude.toString()) + suffix;
        terms.push((terms.length ? (coefficient < 0n ? ' - ' : ' + ') : (coefficient < 0n ? '-' : '')) + body);
    }
    if (a[2] === 0n && a[1] === -a[3]) { term(a[0], ''); term(a[1], '√2'); }
    else { term(a[0], ''); term(a[1], 'ζ'); term(a[2], 'ζ²'); term(a[3], 'ζ³'); }
    var out = terms.join('') || '0';
    if (!value.denominatorExp || out === '0') return out;
    return (terms.length > 1 ? '(' + out + ')' : out) + '/2^' + value.denominatorExp;
}
function integerSqrt(n) {
    if (n < 2n) return n;
    var x = 1n << BigInt(Math.ceil(bits(n) / 2)), y = (x + n / x) >> 1n;
    while (y < x) { x = y; y = (x + n / x) >> 1n; }
    return x;
}
function dyadicNumber(numerator, denominator) {
    if (!numerator) return 0;
    var length = bits(numerator), shift = Math.max(0, length - 53);
    var top = Number(abs(numerator) >> BigInt(shift));
    var fraction = top / Math.pow(2, length - 1 - shift);
    return (numerator < 0n ? -fraction : fraction) * Math.pow(2, length - 1 - denominator);
}
function scalarNumber(value) {
    checkExact(value);
    var a = value.numerator;
    if (a[2] !== 0n || a[1] !== -a[3]) fail('toNumber expects a real observable result.');
    if (!a[1]) return dyadicNumber(a[0], value.denominatorExp);
    /* Display only. Scale sqrt(2) with enough integer precision to survive
     * cancellation of large A+B sqrt(2), instead of Infinity-Infinity or
     * cancellation between rounded doubles. Exact results stay untouched. */
    var precision = 2 * Math.max(bits(a[0]), bits(a[1])) + 64;
    var p = BigInt(precision), root = integerSqrt(2n << (2n * p));
    var scaled = (a[0] << p) + a[1] * root;
    return dyadicNumber(scaled, value.denominatorExp + precision);
}

return { plan: plan, create: create, run: run, parseObservable: parseObservable,
         toString: scalarString, toNumber: scalarNumber,
         MAX_QUBITS: MAX_QUBITS, DEFAULT_MAX_RANK: DEFAULT_MAX_RANK, HARD_MAX_RANK: HARD_MAX_RANK,
         DEFAULT_MAX_COEFF_BITS: DEFAULT_MAX_COEFF_BITS, HARD_MAX_COEFF_BITS: HARD_MAX_COEFF_BITS };
}));
