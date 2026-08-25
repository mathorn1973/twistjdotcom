/*
 * oqsparse.js -- Ordinary Quantum, sparse backend over Z[zeta_8].
 *
 * (c) Marek Spanel 2026  All rights reserved.
 *
 * The dense engine stores 2^n amplitudes because that is what a scrambling
 * circuit needs. Most circuits are not scrambling. X, CX, CCX, MCX and SWAP
 * are permutations of the basis index, and Z, S, T, P, CZ, CP, MCZ, MCP are
 * diagonal: neither kind changes WHICH basis states carry weight, only where
 * that weight sits and what phase it has. The support is set by the input,
 * not by n. H is the only gate in the set that can enlarge it, and then by at
 * most a factor of two.
 *
 * So a reversible-arithmetic circuit on 433 qubits has support 1 from start
 * to finish, and the honest cost of running it exactly is 433 bit flips, not
 * 2^433 amplitudes. That is the whole idea here.
 *
 *   support after the circuit <= min(2^hCount, 2^n)
 *
 * Same algebra as oq.js, same canonical form, same normalization -- this is a
 * different CONTAINER for the statevector, not a different mathematics. For
 * any n the dense engine can also run, toDense() reproduces the dense state
 * bit-for-bit, so the canonical fingerprint of Section 4.1 still applies and
 * is checked in the test suite.
 *
 * ONE REPRESENTATION, NOT TWO. oq.js keeps an int32 kernel and a BigInt
 * kernel apart because it is a memory-bandwidth engine and int32 moves half
 * the bytes. This one is not: its cost is dominated by hashing BigInt keys,
 * and the states it is built for keep their coefficients tiny -- support 1
 * means a coefficient never leaves {0, +-1}. BigInt throughout, no promotion
 * path, no second kernel to keep in step.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.OQS = api;
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var BASIS = 1469598103934665603n;
var M64   = 0xFFFFFFFFFFFFFFFFn;
var PRIME = 1099511628211n;

var DEFAULT_CAP = 1 << 21;              /* 2 M live amplitudes */

/* ---- Z[zeta_8] on a single amplitude -------------------------------- */

/* u * zeta^k. zeta^4 = -1, so this is a rotation of (c0..c3) with signs and
 * costs no width at all. */
function zmul(a, k) {
    var c0 = a[0], c1 = a[1], c2 = a[2], c3 = a[3];
    switch (((k % 8) + 8) % 8) {
    case 0:  return [ c0,  c1,  c2,  c3];
    case 1:  return [-c3,  c0,  c1,  c2];
    case 2:  return [-c2, -c3,  c0,  c1];
    case 3:  return [-c1, -c2, -c3,  c0];
    case 4:  return [-c0, -c1, -c2, -c3];
    case 5:  return [ c3, -c0, -c1, -c2];
    case 6:  return [ c2,  c3, -c0, -c1];
    default: return [ c1,  c2,  c3, -c0];
    }
}

/* M = multiplication by sqrt2 = zeta - zeta^3. The Hadamard kernel. */
function M(a) {
    return [a[1] - a[3], a[0] + a[2], a[1] + a[3], a[2] - a[0]];
}

function isZero(a) {
    return a[0] === 0n && a[1] === 0n && a[2] === 0n && a[3] === 0n;
}

function ctz(v) {
    if (v === 0n) return Infinity;
    if (v < 0n) v = -v;
    var k = 0;
    while ((v & 1n) === 0n) { v >>= 1n; k++; }
    return k;
}

/* ---- state ----------------------------------------------------------- */

function SparseState(n, cap) {
    this.n = n;
    this.denom = 0;
    this.cap = cap || DEFAULT_CAP;
    this.map = new Map();               /* BigInt index -> [c0,c1,c2,c3] */
    this.map.set(0n, [1n, 0n, 0n, 0n]); /* |0..0> */
    this.gates = 0;
    this.hCount = 0;
    this.phaseCount = 0;
    this.permCount = 0;
    this.maxSupport = 1;
    this.maxDenom = 0;
}

SparseState.prototype.support = function () { return this.map.size; };

function bit(q) { return 1n << BigInt(q); }

SparseState.prototype.checkQubit = function (q) {
    if (!(q >= 0 && q < this.n))
        throw new Error('qubit ' + q + ' out of range (n = ' + this.n + ')');
};

SparseState.prototype.note = function () {
    if (this.map.size > this.maxSupport) this.maxSupport = this.map.size;
    if (this.map.size > this.cap)
        throw new Error('sparse support exceeded ' + this.cap +
                        ' amplitudes -- this circuit is dense, use the dense engine');
    if (this.denom > this.maxDenom) this.maxDenom = this.denom;
};

/* ---- permutations: support is carried, never created ----------------- */

/* Rebuild the map under an index permutation. The map is a bijection, so no
 * two keys can collide and no amplitude is ever added into another. */
SparseState.prototype.permute = function (f) {
    var out = new Map(), it, e;
    for (it = this.map.entries(), e = it.next(); !e.done; e = it.next())
        out.set(f(e.value[0]), e.value[1]);
    this.map = out;
    this.gates++; this.permCount++;
    return this;
};

SparseState.prototype.x = function (q) {
    this.checkQubit(q);
    var m = bit(q);
    return this.permute(function (k) { return k ^ m; });
};

SparseState.prototype.cx = function (c, t) {
    this.checkQubit(c); this.checkQubit(t);
    if (c === t) throw new Error('cx uses the same qubit twice');
    var mc = bit(c), mt = bit(t);
    return this.permute(function (k) { return (k & mc) !== 0n ? (k ^ mt) : k; });
};

/* CCX and every wider Toffoli: flip the target iff all controls are set. */
SparseState.prototype.mcx = function (controls, t) {
    var i, all = 0n, mt = bit(t);
    this.checkQubit(t);
    for (i = 0; i < controls.length; i++) {
        this.checkQubit(controls[i]);
        if (controls[i] === t) throw new Error('mcx control equals target');
        all |= bit(controls[i]);
    }
    return this.permute(function (k) { return (k & all) === all ? (k ^ mt) : k; });
};

SparseState.prototype.ccx = function (a, b, t) { return this.mcx([a, b], t); };

SparseState.prototype.swap = function (a, b) {
    this.checkQubit(a); this.checkQubit(b);
    if (a === b) return this;
    var ma = bit(a), mb = bit(b);
    return this.permute(function (k) {
        var ka = (k & ma) !== 0n, kb = (k & mb) !== 0n;
        return ka === kb ? k : (k ^ ma ^ mb);
    });
};

/* ---- diagonal phases: support untouched, width untouched ------------- */

/* zeta^k on every basis state whose control mask is fully set. Covers Z, S,
 * T, P and their controlled forms all the way up to MCP. */
SparseState.prototype.mcpow = function (qs, k) {
    var i, all = 0n, it, e;
    for (i = 0; i < qs.length; i++) { this.checkQubit(qs[i]); all |= bit(qs[i]); }
    k = ((k % 8) + 8) % 8;
    if (k !== 0)
        for (it = this.map.entries(), e = it.next(); !e.done; e = it.next())
            if ((e.value[0] & all) === all)
                this.map.set(e.value[0], zmul(e.value[1], k));
    this.gates++; this.phaseCount++;
    return this;
};

SparseState.prototype.zpow = function (q, k) { return this.mcpow([q], k); };

SparseState.prototype.gphase = function (k) {
    var it, e;
    k = ((k % 8) + 8) % 8;
    if (k !== 0)
        for (it = this.map.entries(), e = it.next(); !e.done; e = it.next())
            this.map.set(e.value[0], zmul(e.value[1], k));
    this.gates++; this.phaseCount++;
    return this;
};

/* ---- Hadamard: the only gate that can grow the support --------------- */

SparseState.prototype.h = function (q) {
    this.checkQubit(q);
    var m = bit(q), out = new Map(), done = new Set();
    var it, e, k, k0, k1, a0, a1, n0, n1;
    var Z = [0n, 0n, 0n, 0n];

    for (it = this.map.keys(), e = it.next(); !e.done; e = it.next()) {
        k = e.value;
        k0 = (k & m) !== 0n ? (k ^ m) : k;           /* the bit-clear partner */
        if (done.has(k0)) continue;
        done.add(k0);
        k1 = k0 ^ m;
        a0 = this.map.get(k0) || Z;
        a1 = this.map.get(k1) || Z;
        n0 = M([a0[0] + a1[0], a0[1] + a1[1], a0[2] + a1[2], a0[3] + a1[3]]);
        n1 = M([a0[0] - a1[0], a0[1] - a1[1], a0[2] - a1[2], a0[3] - a1[3]]);
        if (!isZero(n0)) out.set(k0, n0);
        if (!isZero(n1)) out.set(k1, n1);            /* cancellation prunes */
    }
    this.map = out;
    this.denom++;
    this.normalize();
    this.gates++; this.hCount++;
    this.note();
    return this;
};

/* Same canonical form as the dense engine: divide out the largest power of
 * two common to every coefficient of every live amplitude. */
SparseState.prototype.normalize = function () {
    if (this.denom === 0 || this.map.size === 0) return this;
    var k = Infinity, it, e, a, i, t, sh;
    for (it = this.map.values(), e = it.next(); !e.done && k > 0; e = it.next()) {
        a = e.value;
        for (i = 0; i < 4; i++) { t = ctz(a[i]); if (t < k) k = t; }
    }
    if (k === Infinity || k === 0) return this;
    if (k > this.denom) k = this.denom;
    sh = BigInt(k);
    for (it = this.map.entries(), e = it.next(); !e.done; e = it.next()) {
        a = e.value[1];
        this.map.set(e.value[0], [a[0] >> sh, a[1] >> sh, a[2] >> sh, a[3] >> sh]);
    }
    this.denom -= k;
    return this;
};

/* ---- readout --------------------------------------------------------- */

/* |amp|^2 = (S + X*sqrt2) / 2^(2*denom), exactly as in the dense engine.
 * Nothing irrational is approximated on this path either. */
function bornOf(a) {
    var c0 = a[0], c1 = a[1], c2 = a[2], c3 = a[3];
    return { S: c0 * c0 + c1 * c1 + c2 * c2 + c3 * c3,
             X: c0 * c1 + c1 * c2 + c2 * c3 - c0 * c3 };
}

SparseState.prototype.bornPair = function (key) {
    var a = this.map.get(key);
    return a ? bornOf(a) : { S: 0n, X: 0n };
};

/* Section 4.2, carried over unchanged: sum S = 2^(2*denom) and sum X = 0.
 * The zeros the dense engine sums over contribute nothing, so pruning them
 * cannot move either total -- which is exactly why this is worth checking. */
SparseState.prototype.checkNorm = function () {
    var S = 0n, X = 0n, it, e, p;
    for (it = this.map.values(), e = it.next(); !e.done; e = it.next()) {
        p = bornOf(e.value); S += p.S; X += p.X;
    }
    return { S: S, X: X, want: 1n << BigInt(2 * this.denom),
             ok: S === (1n << BigInt(2 * this.denom)) && X === 0n };
};

function ratio(num, den) {
    if (num === 0n) return 0;
    var neg = num < 0n;
    if (neg) num = -num;
    var q = (num << 64n) / den;
    return (neg ? -1 : 1) * Number(q) / 18446744073709551616;
}

/* The exact probability, rounded to a double only at the very last step and
 * only so it can be printed. */
SparseState.prototype.probFloat = function (key) {
    var pr = this.bornPair(key), den = 1n << BigInt(2 * this.denom);
    return ratio(pr.S, den) + ratio(pr.X, den) * Math.SQRT2;
};

SparseState.prototype.widthBits = function () {
    var w = 0, it, e, a, i, v, bl;
    for (it = this.map.values(), e = it.next(); !e.done; e = it.next()) {
        a = e.value;
        for (i = 0; i < 4; i++) {
            v = a[i] < 0n ? -a[i] : a[i];
            bl = v === 0n ? 0 : v.toString(2).length;
            if (bl > w) w = bl;
        }
    }
    return w;
};

/* Live amplitudes in ascending index order. */
SparseState.prototype.entries = function () {
    var keys = [], it, e, i, out = [];
    for (it = this.map.keys(), e = it.next(); !e.done; e = it.next()) keys.push(e.value);
    keys.sort(function (p, q) { return p < q ? -1 : (p > q ? 1 : 0); });
    for (i = 0; i < keys.length; i++) out.push([keys[i], this.map.get(keys[i])]);
    return out;
};

/* ---- bridges --------------------------------------------------------- */

/* Expand into the dense engine State. Only defined when 2^n fits, which is
 * exactly when the canonical Section 4.1 fingerprint is computable at all --
 * this is the bridge the parity tests run over. */
SparseState.prototype.toDense = function (OQ, maxQubits) {
    var lim = maxQubits === undefined ? 26 : maxQubits;
    if (this.n > lim)
        throw new Error('n = ' + this.n + ' is past the dense cap of ' + lim);
    var s = new OQ.State(this.n), it, e, b, a;
    s.promote();                       /* BigInt: the sparse side has no int32 path */
    for (b = 0; b < s.size; b++) { s.c0[b] = 0n; s.c1[b] = 0n; s.c2[b] = 0n; s.c3[b] = 0n; }
    for (it = this.map.entries(), e = it.next(); !e.done; e = it.next()) {
        b = Number(e.value[0]); a = e.value[1];
        s.c0[b] = a[0]; s.c1[b] = a[1]; s.c2[b] = a[2]; s.c3[b] = a[3];
    }
    s.denom = this.denom;
    return s;
};

/* Build a sparse state from a dense one, so the sparse fingerprint can be
 * checked against a state the dense engine produced. */
function fromDense(s) {
    var out = new SparseState(s.n), b, a;
    out.map = new Map();
    for (b = 0; b < s.size; b++) {
        a = s.amp(b);
        if (a.c0 !== 0n || a.c1 !== 0n || a.c2 !== 0n || a.c3 !== 0n)
            out.map.set(BigInt(b), [a.c0, a.c1, a.c2, a.c3]);
    }
    out.denom = s.denom;
    return out;
}

/* ---- fingerprint ------------------------------------------------------ */

function hashU64(h, v) {
    var i;
    for (i = 0; i < 8; i++) { h = ((h ^ (v & 0xFFn)) * PRIME) & M64; v >>= 8n; }
    return h;
}

function sigLimbs(v) {
    var neg = v < 0n, sig = 1n, u, top;
    for (;;) {
        u = BigInt.asIntN(Number(64n * sig), v);
        if (u === v) {
            top = BigInt.asUintN(64, v >> (64n * (sig - 1n)));
            if (neg ? (top >> 63n) === 1n : (top >> 63n) === 0n) return sig;
        }
        sig += 1n;
    }
}

function hashCoeff(h, v) {
    var sig = sigLimbs(v), i, u;
    h = hashU64(h, sig);
    u = BigInt.asUintN(Number(64n * sig), v);
    for (i = 0n; i < sig; i++) h = hashU64(h, (u >> (64n * i)) & M64);
    return h;
}

/* NOT the dense fingerprint, and deliberately so: the dense one walks every
 * one of 2^n amplitudes including the zeros, which is exactly the thing this
 * backend exists not to do. This one feeds (n, denom, support) and then the
 * live amplitudes in ascending index order. It is canonical for a given
 * mathematical state -- zeros are pruned the moment they are created, so two
 * equal states have the same live set -- and it is stable across machines.
 * For any n the dense engine can also reach, use toDense().hash() to get the
 * Section 4.1 value instead. */
SparseState.prototype.sparseHash = function () {
    var h = BASIS, keys = [], it, e, i, a;
    for (it = this.map.keys(), e = it.next(); !e.done; e = it.next()) keys.push(e.value);
    keys.sort(function (p, q) { return p < q ? -1 : (p > q ? 1 : 0); });
    h = hashU64(h, BigInt(this.n));
    h = hashU64(h, BigInt(this.denom));
    h = hashU64(h, BigInt(keys.length));
    for (i = 0; i < keys.length; i++) {
        h = hashCoeff(h, keys[i]);
        a = this.map.get(keys[i]);
        h = hashCoeff(h, a[0]); h = hashCoeff(h, a[1]);
        h = hashCoeff(h, a[2]); h = hashCoeff(h, a[3]);
    }
    return h.toString(16).padStart(16, '0');
};

/* ---- driver ---------------------------------------------------------- */

/* The dense engine wants a JS bitmask, which runs out at 31 qubits. The
 * parser therefore carries the qubit list alongside it as a fourth element
 * whenever it has one; fall back to decoding the mask when it does not. */
function qubitsOf(g) {
    if (g[3]) return g[3];
    var m = g[1], qs = [], i;
    if (m === null || m === undefined)
        throw new Error('mcpow past 31 qubits needs the qubit list from the parser');
    for (i = 0; i < 31; i++) if (m & (1 << i)) qs.push(i);
    return qs;
}

var GATES = {
    h:      function (s, g) { s.h(g[1]); },
    x:      function (s, g) { s.x(g[1]); },
    zpow:   function (s, g) { s.zpow(g[1], g[2]); },
    cx:     function (s, g) { s.cx(g[1], g[2]); },
    mcpow:  function (s, g) { s.mcpow(qubitsOf(g), g[2]); },
    swap:   function (s, g) { s.swap(g[1], g[2]); },
    gphase: function (s, g) { s.gphase(g[1]); },
    mcx:    function (s, g) { s.mcx(g[1], g[2]); }
};

function apply(s, g) {
    var f = GATES[g[0]];
    if (!f) throw new Error('unknown op ' + g[0]);
    f(s, g);
}

/* Peephole: the parser writes every Toffoli as H . MCZ . H, because that is
 * what the dense kernel wants -- it has no permutation primitive wider than
 * CX. Here it is exactly backwards. Run as written, a Toffoli on a support-1
 * state opens the support to 2, does BigInt arithmetic on both halves, and
 * closes it again. Recognised as the permutation it is, it costs one pass of
 * key remapping and no arithmetic at all.
 *
 *   MCX(controls, t) = H_t . MCZ(controls + t) . H_t
 *
 * Only fires on an exact triple with a pi phase and the H target inside the
 * control mask, so it cannot change the mathematics -- and the parity tests
 * check the fused and unfused runs land on the same fingerprint. */
function fuse(gates) {
    var out = [], i = 0, a, b, c, qs, t, j, ctrl;
    while (i < gates.length) {
        a = gates[i]; b = gates[i + 1]; c = gates[i + 2];
        if (a && b && c && a[0] === 'h' && c[0] === 'h' && b[0] === 'mcpow' &&
            a[1] === c[1] && (((b[2] % 8) + 8) % 8) === 4) {
            try { qs = qubitsOf(b); } catch (e) { qs = null; }
            t = a[1];
            if (qs && qs.indexOf(t) >= 0) {
                ctrl = [];
                for (j = 0; j < qs.length; j++) if (qs[j] !== t) ctrl.push(qs[j]);
                out.push(['mcx', ctrl, t]);
                i += 3;
                continue;
            }
        }
        out.push(a);
        i++;
    }
    return out;
}

function run(gates, n, cap, noFuse) {
    var s = new SparseState(n, cap), g = noFuse ? gates : fuse(gates), i;
    for (i = 0; i < g.length; i++) apply(s, g[i]);
    return s;
}

return {
    SparseState: SparseState, apply: apply, run: run, fuse: fuse,
    fromDense: fromDense, zmul: zmul, M: M, ctz: ctz, bornOf: bornOf,
    qubitsOf: qubitsOf, DEFAULT_CAP: DEFAULT_CAP
};
}));
