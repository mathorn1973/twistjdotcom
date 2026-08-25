/*
 * oq16.js -- Ordinary Quantum over Z[zeta_16].
 *
 * (c) Marek Spanel 2026  All rights reserved.
 *
 * The same engine one cyclotomic step up: zeta = e^{i pi/8}, zeta^16 = 1,
 * zeta^8 = -1, and an amplitude is EIGHT integers over a shared power of two
 * instead of four.
 *
 *   amp(b) = (c0 + c1 z + ... + c7 z^7) / 2^denom
 *   sqrt2  = z^2 - z^6            (so the Hadamard still closes)
 *   z^k    : c_i -> slot (i+k) mod 8, negated when it passes z^8 = -1
 *   H pair : new = M(a +/- b), denom += 1, with M = multiply by (z^2 - z^6):
 *            (c2-c6, c3-c7, c0+c4, c1+c5, c2+c6, c3+c7, c4-c0, c5-c1)
 *
 * What the extra four integers buy: the phase lattice halves from pi/4 to
 * pi/8. T becomes z^2, and z itself is the pi/8 gate that Z[zeta_8] cannot
 * hold -- which is what lets an inverse QFT reach four counting bits instead
 * of three. The price is exactly what the ring costs: twice the coefficients,
 * twice the memory, and a Born rule with four terms instead of two.
 *
 *   |amp|^2 * 2 * 2^(2d) = P + Q*sqrt2 + R*s + T*sqrt2*s,   s = sqrt(2+sqrt2)
 *
 * Ordering those is still exact, just two levels deep: write it as U + V*s
 * with U, V in Z[sqrt2], and when their signs disagree compare U^2 against
 * V^2*(2+sqrt2) -- both back in Z[sqrt2], where the old comparator works.
 * No irrational is ever approximated on the measurement path.
 *
 * The fingerprint is deliberately compatible with the Z[zeta_8] engine: when
 * the odd slots are all zero the state IS a Z[zeta_8] state, and it hashes as
 * one. A circuit that never needed pi/8 gets the same fingerprint here, on
 * the smaller ring, and in the native C core.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.OQ16 = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var M64   = (1n << 64n) - 1n;
var PRIME = 1099511628211n;
var BASIS = 1469598103934665603n;
var SQRT2 = Math.SQRT2;
var S16   = Math.sqrt(2 + Math.SQRT2);          /* s = sqrt(2+sqrt2), display only */

var SAFE_BITS = 28;                             /* H can quadruple: 4*2^28 < 2^31 */
var MODE_I32 = 0, MODE_BIG = 1;
var SLOTS = 8;

/* ---- statevector ---------------------------------------------------- */

function State(n) {
    this.n = n;
    this.denom = 0;
    this.size = Math.pow(2, n);
    this.mode = MODE_I32;
    this.c = new Array(SLOTS);
    for (var i = 0; i < SLOTS; i++) this.c[i] = new Int32Array(this.size);
    this.c[0][0] = 1;
    this.maxBits = 1;
    this.maxDenom = 0;
    this.gates = 0;
    this.hCount = 0;
    this.phaseCount = 0;
    this.promotions = 0;
}

State.prototype.amp = function (b) {
    var out = new Array(SLOTS), i;
    if (this.mode === MODE_I32) {
        for (i = 0; i < SLOTS; i++) out[i] = BigInt(this.c[i][b]);
    } else {
        for (i = 0; i < SLOTS; i++) out[i] = this.c[i][b];
    }
    return out;
};

State.prototype.promote = function () {
    if (this.mode === MODE_BIG) return this;
    var i, b, arr;
    for (i = 0; i < SLOTS; i++) {
        arr = new Array(this.size);
        for (b = 0; b < this.size; b++) arr[b] = BigInt(this.c[i][b]);
        this.c[i] = arr;
    }
    this.mode = MODE_BIG;
    this.promotions++;
    return this;
};

State.prototype.isZero = function (b) {
    var i, z = this.mode === MODE_I32 ? 0 : 0n;
    for (i = 0; i < SLOTS; i++) if (this.c[i][b] !== z) return false;
    return true;
};

/* ---- int32 kernels -------------------------------------------------- */

function hI32(s, q) {
    var m = 1 << q, size = s.size, b, b1;
    var c = s.c;
    var a0 = c[0], a1 = c[1], a2 = c[2], a3 = c[3];
    var a4 = c[4], a5 = c[5], a6 = c[6], a7 = c[7];
    var u0, u1, u2, u3, u4, u5, u6, u7, v0, v1, v2, v3, v4, v5, v6, v7;
    for (b = 0; b < size; b++) {
        if (b & m) continue;
        b1 = b | m;
        u0 = a0[b] + a0[b1]; v0 = a0[b] - a0[b1];
        u1 = a1[b] + a1[b1]; v1 = a1[b] - a1[b1];
        u2 = a2[b] + a2[b1]; v2 = a2[b] - a2[b1];
        u3 = a3[b] + a3[b1]; v3 = a3[b] - a3[b1];
        u4 = a4[b] + a4[b1]; v4 = a4[b] - a4[b1];
        u5 = a5[b] + a5[b1]; v5 = a5[b] - a5[b1];
        u6 = a6[b] + a6[b1]; v6 = a6[b] - a6[b1];
        u7 = a7[b] + a7[b1]; v7 = a7[b] - a7[b1];
        /* M = multiply by (z^2 - z^6) */
        a0[b] = u2 - u6; a1[b] = u3 - u7; a2[b] = u0 + u4; a3[b] = u1 + u5;
        a4[b] = u2 + u6; a5[b] = u3 + u7; a6[b] = u4 - u0; a7[b] = u5 - u1;
        a0[b1] = v2 - v6; a1[b1] = v3 - v7; a2[b1] = v0 + v4; a3[b1] = v1 + v5;
        a4[b1] = v2 + v6; a5[b1] = v3 + v7; a6[b1] = v4 - v0; a7[b1] = v5 - v1;
    }
}

function permI32(s, sel) {                       /* swap amplitudes pairwise */
    var size = s.size, c = s.c, b, b1, i, t;
    for (b = 0; b < size; b++) {
        b1 = sel(b);
        if (b1 <= b) continue;
        for (i = 0; i < SLOTS; i++) { t = c[i][b]; c[i][b] = c[i][b1]; c[i][b1] = t; }
    }
}

function zetaI32(c, b, k) {
    var a = new Array(SLOTS), i, p;
    for (i = 0; i < SLOTS; i++) a[i] = c[i][b];
    for (i = 0; i < SLOTS; i++) c[i][b] = 0;
    for (i = 0; i < SLOTS; i++) {
        p = i + k;
        c[p & 7][b] += (p & 8) ? -a[i] : a[i];
    }
}

function normalizeI32(s) {
    var size = s.size, c = s.c, b, i, v, acc = 0, wide = 0, arr;
    for (i = 0; i < SLOTS; i++) {
        arr = c[i];
        for (b = 0; b < size; b++) { v = arr[b]; acc |= v; wide |= v ^ (v >> 31); }
    }
    var k = 0;
    if (acc !== 0 && s.denom > 0) {
        k = 31 - Math.clz32(acc & -acc);
        if (k > s.denom) k = s.denom;
    }
    if (k > 0) {
        for (b = 0; b < size; b++) for (i = 0; i < SLOTS; i++) c[i][b] >>= k;
        s.denom -= k;
        wide >>= k;
    }
    s.maxBits = wide === 0 ? 0 : 32 - Math.clz32(wide);
}

/* ---- BigInt kernels ------------------------------------------------- */

function hBig(s, q) {
    var m = 1 << q, size = s.size, b, b1, i;
    var c = s.c, u = new Array(SLOTS), v = new Array(SLOTS);
    for (b = 0; b < size; b++) {
        if (b & m) continue;
        b1 = b | m;
        for (i = 0; i < SLOTS; i++) { u[i] = c[i][b] + c[i][b1]; v[i] = c[i][b] - c[i][b1]; }
        c[0][b] = u[2] - u[6]; c[1][b] = u[3] - u[7];
        c[2][b] = u[0] + u[4]; c[3][b] = u[1] + u[5];
        c[4][b] = u[2] + u[6]; c[5][b] = u[3] + u[7];
        c[6][b] = u[4] - u[0]; c[7][b] = u[5] - u[1];
        c[0][b1] = v[2] - v[6]; c[1][b1] = v[3] - v[7];
        c[2][b1] = v[0] + v[4]; c[3][b1] = v[1] + v[5];
        c[4][b1] = v[2] + v[6]; c[5][b1] = v[3] + v[7];
        c[6][b1] = v[4] - v[0]; c[7][b1] = v[5] - v[1];
    }
}

function permBig(s, sel) {
    var size = s.size, c = s.c, b, b1, i, t;
    for (b = 0; b < size; b++) {
        b1 = sel(b);
        if (b1 <= b) continue;
        for (i = 0; i < SLOTS; i++) { t = c[i][b]; c[i][b] = c[i][b1]; c[i][b1] = t; }
    }
}

function zetaBig(c, b, k) {
    var a = new Array(SLOTS), i, p;
    for (i = 0; i < SLOTS; i++) a[i] = c[i][b];
    for (i = 0; i < SLOTS; i++) c[i][b] = 0n;
    for (i = 0; i < SLOTS; i++) {
        p = i + k;
        c[p & 7][b] += (p & 8) ? -a[i] : a[i];
    }
}

function ctz(v) {
    if (v === 0n) return Infinity;
    if (v < 0n) v = -v;
    var c = 0;
    while ((v & 0xFFFFFFFFn) === 0n) { v >>= 32n; c += 32; }
    var w = Number(v & 0xFFFFFFFFn);
    while ((w & 1) === 0) { w = w / 2; c++; }
    return c;
}

function normalizeBig(s) {
    if (s.denom === 0) return;
    var size = s.size, c = s.c, k = Infinity, b, i, t;
    for (b = 0; b < size && k > 0; b++) {
        for (i = 0; i < SLOTS; i++) { t = ctz(c[i][b]); if (t < k) k = t; }
    }
    if (k === Infinity) return;
    if (k > s.denom) k = s.denom;
    if (k === 0) return;
    var sh = BigInt(k);
    for (b = 0; b < size; b++) for (i = 0; i < SLOTS; i++) c[i][b] >>= sh;
    s.denom -= k;
}

/* ---- gates ---------------------------------------------------------- */

State.prototype.h = function (q) {
    if (this.mode === MODE_I32 && this.maxBits > SAFE_BITS) this.promote();
    if (this.mode === MODE_I32) { hI32(this, q); this.denom++; normalizeI32(this); }
    else { hBig(this, q); this.denom++; normalizeBig(this); }
    if (this.denom > this.maxDenom) this.maxDenom = this.denom;
    this.gates++; this.hCount++;
    return this;
};

State.prototype.x = function (q) {
    var m = 1 << q, sel = function (b) { return b ^ m; };
    if (this.mode === MODE_I32) permI32(this, sel); else permBig(this, sel);
    this.gates++;
    return this;
};

State.prototype.cx = function (ctl, tgt) {
    var mc = 1 << ctl, mt = 1 << tgt;
    var sel = function (b) { return (b & mc) ? (b ^ mt) : b; };
    if (this.mode === MODE_I32) permI32(this, sel); else permBig(this, sel);
    this.gates++;
    return this;
};

State.prototype.swap = function (a, b) {
    if (a === b) return this;
    var ma = 1 << a, mb = 1 << b;
    var sel = function (i) {
        var x = (i & ma) ? 1 : 0, y = (i & mb) ? 1 : 0;
        return x === y ? i : (i ^ ma ^ mb);
    };
    if (this.mode === MODE_I32) permI32(this, sel); else permBig(this, sel);
    this.gates++;
    return this;
};

/* zeta^k on one qubit's |1> subspace. k counts sixteenths now: T is k=2. */
State.prototype.zpow = function (q, k) {
    k = ((k % 16) + 16) % 16;
    if (k === 0) { this.gates++; return this; }
    var m = 1 << q, b, c = this.c;
    if (this.mode === MODE_I32) {
        for (b = 0; b < this.size; b++) if (b & m) zetaI32(c, b, k);
    } else {
        for (b = 0; b < this.size; b++) if (b & m) zetaBig(c, b, k);
    }
    this.gates++; this.phaseCount++;
    return this;
};

State.prototype.mcpow = function (mask, k) {
    k = ((k % 16) + 16) % 16;
    if (k === 0) { this.gates++; return this; }
    var b, c = this.c;
    if (this.mode === MODE_I32) {
        for (b = 0; b < this.size; b++) if ((b & mask) === mask) zetaI32(c, b, k);
    } else {
        for (b = 0; b < this.size; b++) if ((b & mask) === mask) zetaBig(c, b, k);
    }
    this.gates++; this.phaseCount++;
    return this;
};

State.prototype.gphase = function (k) {
    k = ((k % 16) + 16) % 16;
    if (k === 0) return this;
    var b, c = this.c;
    if (this.mode === MODE_I32) {
        for (b = 0; b < this.size; b++) zetaI32(c, b, k);
    } else {
        for (b = 0; b < this.size; b++) zetaBig(c, b, k);
    }
    this.phaseCount++;
    return this;
};

State.prototype.z   = function (q) { return this.zpow(q, 8); };
State.prototype.s   = function (q) { return this.zpow(q, 4); };
State.prototype.t   = function (q) { return this.zpow(q, 2); };
State.prototype.tdg = function (q) { return this.zpow(q, 14); };
State.prototype.cz  = function (a, b) { return this.mcpow((1 << a) | (1 << b), 8); };
State.prototype.ccz = function (a, b, c) { return this.mcpow((1 << a) | (1 << b) | (1 << c), 8); };

State.prototype.normalize = function () {
    if (this.mode === MODE_I32) normalizeI32(this); else normalizeBig(this);
    return this;
};

/* ---- fingerprint ---------------------------------------------------- */

function hashU64(h, v) {
    v = BigInt.asUintN(64, v);
    for (var i = 0; i < 8; i++) {
        h = (h ^ (v & 0xFFn)) & M64;
        h = (h * PRIME) & M64;
        v >>= 8n;
    }
    return h;
}

function sigLimbs(v) {
    var sig = 1n, lim;
    for (;;) {
        lim = 1n << (64n * sig - 1n);
        if (v >= -lim && v < lim) return sig;
        sig++;
    }
}

function hashCoeff(h, v) {
    var sig = sigLimbs(v), i;
    h = hashU64(h, sig);
    var u = BigInt.asUintN(Number(64n * sig), v);
    for (i = 0n; i < sig; i++) h = hashU64(h, (u >> (64n * i)) & M64);
    return h;
}

/* True when every odd slot is zero -- then this state lives in the zeta_8
 * sub-ring and is hashed as one, so fingerprints stay comparable with the
 * smaller engine and with the C core. */
State.prototype.inZ8 = function () {
    var b, i, z = this.mode === MODE_I32 ? 0 : 0n;
    for (b = 0; b < this.size; b++) {
        for (i = 1; i < SLOTS; i += 2) if (this.c[i][b] !== z) return false;
    }
    return true;
};

State.prototype.hash = function () {
    var h = BASIS, b, i, a, z8 = this.inZ8();
    h = hashU64(h, BigInt(this.n));
    h = hashU64(h, BigInt(this.denom));
    for (b = 0; b < this.size; b++) {
        a = this.amp(b);
        if (z8) { for (i = 0; i < SLOTS; i += 2) h = hashCoeff(h, a[i]); }
        else    { for (i = 0; i < SLOTS; i++)    h = hashCoeff(h, a[i]); }
    }
    return h.toString(16).padStart(16, '0');
};

State.prototype.equals = function (o) {
    if (this.n !== o.n || this.denom !== o.denom) return false;
    var b, i, x, y;
    for (b = 0; b < this.size; b++) {
        x = this.amp(b); y = o.amp(b);
        for (i = 0; i < SLOTS; i++) if (x[i] !== y[i]) return false;
    }
    return true;
};

State.prototype.widthBits = function () {
    if (this.mode === MODE_I32) return this.maxBits;
    var w = 0, b, i, v, bl;
    for (b = 0; b < this.size; b++) for (i = 0; i < SLOTS; i++) {
        v = this.c[i][b]; if (v < 0n) v = -v;
        bl = v === 0n ? 0 : v.toString(2).length;
        if (bl > w) w = bl;
    }
    return w;
};

State.prototype.limbs = function () {
    return Math.max(1, Math.ceil((this.widthBits() + 1) / 64));
};

/* ---- exact Born measurement ----------------------------------------- */

/* 2*|amp|^2 * 2^(2d) = P + Q*sqrt2 + R*s + T*sqrt2*s, with s = sqrt(2+sqrt2).
 * The cross terms fold onto cos(k pi/8): cos(4pi/8) = 0 and cos(k) = -cos(8-k)
 * kill half of them, and cos(3pi/8) = (sqrt2*s - s)/2 puts the rest in this
 * four-integer basis. */
State.prototype.bornQuad = function (b) {
    var a = this.amp(b), r = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n], i, j, d;
    for (i = 0; i < SLOTS; i++) {
        for (j = 0; j < SLOTS; j++) {
            d = i - j; if (d < 0) d = -d;
            r[d] += a[i] * a[j];
        }
    }
    var cos1 = r[1] - r[7], cos2 = r[2] - r[6], cos3 = r[3] - r[5];
    return { P: 2n * r[0], Q: cos2, R: cos1 - cos3, T: cos3 };
};

State.prototype.bornTotals = function () {
    var P = 0n, Q = 0n, R = 0n, T = 0n, b, q;
    for (b = 0; b < this.size; b++) {
        q = this.bornQuad(b);
        P += q.P; Q += q.Q; R += q.R; T += q.T;
    }
    return { P: P, Q: Q, R: R, T: T };
};

/* sign of A + B*sqrt2 */
function signSqrt2(A, B) {
    if (B === 0n) return A === 0n ? 0 : (A < 0n ? -1 : 1);
    if (A >= 0n && B > 0n) return 1;
    if (A <= 0n && B < 0n) return -1;
    var ua = A < 0n ? -A : A, ub = B < 0n ? -B : B;
    var a2 = ua * ua, b2 = 2n * ub * ub;
    var c = a2 > b2 ? 1 : (a2 < b2 ? -1 : 0);
    if (A > 0n) return c > 0 ? 1 : -1;
    return c < 0 ? 1 : -1;
}

/* sign of (P + Q*sqrt2) + (R + T*sqrt2)*s, exactly. When the two halves
 * disagree, compare U^2 against V^2*(2+sqrt2) -- both land back in Z[sqrt2],
 * where the comparator above finishes the job. Still no irrational touched. */
function signQuad(P, Q, R, T) {
    var su = signSqrt2(P, Q), sv = signSqrt2(R, T);
    if (sv === 0) return su;
    if (su === 0) return sv;
    if (su > 0 && sv > 0) return 1;
    if (su < 0 && sv < 0) return -1;
    var u2A = P * P + 2n * Q * Q, u2B = 2n * P * Q;
    var v2A = R * R + 2n * T * T, v2B = 2n * R * T;
    var wA = 2n * (v2A + v2B), wB = v2A + 2n * v2B;      /* V^2 * (2 + sqrt2) */
    var d = signSqrt2(u2A - wA, u2B - wB);
    if (su > 0) return d > 0 ? 1 : -1;
    return d < 0 ? 1 : -1;
}

function Rng(seed) { this.s = BigInt.asUintN(64, BigInt(seed)); }
Rng.prototype.next = function () {
    this.s = BigInt.asUintN(64, this.s + 0x9E3779B97F4A7C15n);
    var z = this.s;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94D049BB133111EBn);
    return BigInt.asUintN(64, z ^ (z >> 31n));
};
Rng.prototype.bits = function (bits) {
    var r = 0n, got = 0;
    while (got < bits) { r = (r << 64n) | this.next(); got += 64; }
    return r >> BigInt(got - bits);
};

/* Streaming sampler, same shape as the zeta_8 one: the cumulative is now a
 * quadruple and the threshold test is signQuad instead of sqrt2Sign. */
State.prototype.sample = function (shots, seed) {
    var EXTRA = 64n;
    var bits = 2 * this.denom + 65;              /* +1 for the factor of two in P */
    var rng = new Rng(seed), draws = new Array(shots), i;
    for (i = 0; i < shots; i++) draws[i] = rng.bits(bits);
    var idx = draws.map(function (_, j) { return j; });
    idx.sort(function (a, b) {
        return draws[a] < draws[b] ? -1 : (draws[a] > draws[b] ? 1 : 0);
    });

    var out = new Array(shots), P = 0n, Q = 0n, R = 0n, T = 0n, p = 0, b, q;
    for (b = 0; b < this.size && p < shots; b++) {
        q = this.bornQuad(b);
        P += q.P; Q += q.Q; R += q.R; T += q.T;
        var sP = P << EXTRA, sQ = Q << EXTRA, sR = R << EXTRA, sT = T << EXTRA;
        while (p < shots) {
            if (signQuad(sP - draws[idx[p]], sQ, sR, sT) > 0) { out[idx[p]] = b; p++; }
            else break;
        }
    }
    while (p < shots) { out[idx[p]] = this.size - 1; p++; }
    return out;
};

/* ---- readable views -------------------------------------------------- */

function ratio(num, den) {
    if (num === 0n) return 0;
    var neg = num < 0n;
    if (neg) num = -num;
    var q = (num << 64n) / den;
    return (neg ? -1 : 1) * Number(q) / 18446744073709551616;
}

State.prototype.ampFloat = function (b) {
    var a = this.amp(b), den = 1n << BigInt(this.denom), re = 0, im = 0, i, ang;
    for (i = 0; i < SLOTS; i++) {
        ang = i * Math.PI / 8;
        re += ratio(a[i], den) * Math.cos(ang);
        im += ratio(a[i], den) * Math.sin(ang);
    }
    return { re: re, im: im };
};

State.prototype.probFloat = function (b) {
    var q = this.bornQuad(b), den = 2n * (1n << BigInt(2 * this.denom));
    return ratio(q.P, den) + ratio(q.Q, den) * SQRT2 +
           ratio(q.R, den) * S16 + ratio(q.T, den) * SQRT2 * S16;
};

/* ---- gate list execution -------------------------------------------- */

var GATES = {
    h:      function (s, g) { s.h(g[1]); },
    x:      function (s, g) { s.x(g[1]); },
    zpow:   function (s, g) { s.zpow(g[1], g[2]); },
    cx:     function (s, g) { s.cx(g[1], g[2]); },
    mcpow:  function (s, g) { s.mcpow(g[1], g[2]); },
    swap:   function (s, g) { s.swap(g[1], g[2]); },
    gphase: function (s, g) { s.gphase(g[1]); }
};

function apply(s, g) {
    var f = GATES[g[0]];
    if (!f) throw new Error('unknown op ' + g[0]);
    f(s, g);
}

/* A gate list written for Z[zeta_8] counts phases in eighths; here they are
 * sixteenths, so every phase exponent doubles. */
function widen(gates) {
    var out = [], i, g;
    for (i = 0; i < gates.length; i++) {
        g = gates[i].slice();
        if (g[0] === 'zpow' || g[0] === 'mcpow') g[2] = g[2] * 2;
        else if (g[0] === 'gphase') g[1] = g[1] * 2;
        out.push(g);
    }
    return out;
}

function run(gates, n) {
    var s = new State(n), i;
    for (i = 0; i < gates.length; i++) apply(s, gates[i]);
    return s;
}

return {
    State: State, Rng: Rng,
    apply: apply, run: run, widen: widen,
    signQuad: signQuad, signSqrt2: signSqrt2, ratio: ratio,
    SAFE_BITS: SAFE_BITS, MODE_I32: MODE_I32, MODE_BIG: MODE_BIG, SLOTS: SLOTS
};
});
