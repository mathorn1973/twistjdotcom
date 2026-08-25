/*
 * oq.js -- Ordinary Quantum, browser engine.
 *
 * (c) Marek Spanel 2026  All rights reserved.
 *
 * A faithful JavaScript port of the OQ k-limb C core (oq_core.c). Same
 * algebra, same canonical fingerprint: a circuit run in this browser produces
 * the byte-identical statevector, and the identical hash, as the native engine
 * and as the Atari int16 engine.
 *
 *   z := zeta_8,  z^4 = -1,  z^8 = 1
 *   sqrt2 = z - z^3,   1/sqrt2 = (z - z^3)/2
 *   amp(b) = (c0 + c1 z + c2 z^2 + c3 z^3) / 2^denom
 *   H pair : new = M_{z-z^3}(a +/- b), denom += 1
 *   M_{z-z^3}: (c0,c1,c2,c3) -> (c1-c3, c0+c2, c1+c3, c2-c0)
 *   z^k    : a permutation of (c0..c3) with signs -- zero width cost
 *
 * TWO REPRESENTATIONS, ONE ALGEBRA. The state starts in Int32Array (16 bytes
 * per amplitude, and the fastest thing a browser can do to a large array) and
 * is promoted to BigInt the moment the coefficients outgrow it. That is the
 * same decision the C engine makes when it picks k limbs per circuit, taken
 * here at run time instead of compile time. Measured, on this kernel:
 *
 *   Int32Array    535 M amp/s in cache,  474 M amp/s at 32 MB   16 B/amp
 *   Float64Array  599 M                  357 M                  32 B/amp
 *   BigInt        50 M                    14 M                   78 B/amp
 *
 * Int32 wins where it matters -- past the cache, where this engine actually
 * lives, because it moves half the bytes. Same reason the C core wants the
 * narrowest limb count that fits: this is a memory-bandwidth engine.
 *
 * The two kernel sets below are deliberately duplicated rather than shared.
 * A single kernel called with both an Int32Array and a BigInt array goes
 * polymorphic and V8 stops specializing it -- measured at roughly 8x slower
 * than either monomorphic version.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.OQ = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var M64   = (1n << 64n) - 1n;
var PRIME = 1099511628211n;
var BASIS = 1469598103934665603n;      /* the C core's offset basis */
var SQRT2 = Math.SQRT2;

/* A Hadamard can quadruple a coefficient before normalization takes a factor
 * of two back: |c| -> |c1 - c3| over sums, so 4|c| must stay inside int32.
 * Promote at 28 bits and the worst intermediate is 2^30, comfortably short of
 * 2^31. Nothing else in the gate set changes a magnitude. */
var SAFE_BITS = 28;

var MODE_I32 = 0, MODE_BIG = 1;

/* ---- statevector ---------------------------------------------------- */

function State(n) {
    this.n = n;
    this.denom = 0;
    this.size = Math.pow(2, n);
    this.mode = MODE_I32;
    this.c0 = new Int32Array(this.size);
    this.c1 = new Int32Array(this.size);
    this.c2 = new Int32Array(this.size);
    this.c3 = new Int32Array(this.size);
    this.c0[0] = 1;                    /* |0..0> */
    this.maxBits = 1;                  /* widest coefficient seen, in bits */
    this.maxDenom = 0;
    this.gates = 0;
    this.hCount = 0;
    this.phaseCount = 0;
    this.promotions = 0;

    /* ---- dynamic circuits -------------------------------------------- *
     * A mid-circuit measurement collapses the state, and the surviving
     * amplitudes are still exactly in the ring -- but their total is no
     * longer 1, and it cannot be made 1, because renormalizing means dividing
     * by sqrt(p) and sqrt(p) is not in Z[zeta_8].
     *
     * So the state is deliberately left UNNORMALIZED and the norm is carried
     * alongside it as a ring element (normS + normX*sqrt2) / 2^(2*denom).
     * Every probability is then a RATIO of two ring elements, which is exact:
     *
     *     p(b) = (S_b + X_b sqrt2) / (normS + normX sqrt2)
     *
     * Nothing is approximated. What is lost is Section 4.2: sum S = 2^(2d)
     * stops holding the moment a measurement collapses anything, and a circuit
     * with feedback has one fingerprint per outcome rather than one. Both are
     * properties of the execution model, not of this implementation.
     *
     * normS === null means nothing has collapsed yet and the norm is exactly
     * 2^(2*denom), which is the invariant the rest of the engine relies on. */
    this.cbits = [];                   /* classical register, written by measure */
    this.measured = 0;                 /* mid-circuit measurements so far */
    this.normS = null;
    this.normX = 0n;
    this.rng = null;
}

/* Coefficients as BigInt regardless of representation -- everything that
 * leaves the hot path (hash, Born, display) goes through here. */
State.prototype.amp = function (b) {
    if (this.mode === MODE_I32) {
        return { c0: BigInt(this.c0[b]), c1: BigInt(this.c1[b]),
                 c2: BigInt(this.c2[b]), c3: BigInt(this.c3[b]) };
    }
    return { c0: this.c0[b], c1: this.c1[b], c2: this.c2[b], c3: this.c3[b] };
};

/* Int32Array -> BigInt arrays. Called when the next Hadamard could overflow,
 * never in the middle of one, so the state is always consistent. */
State.prototype.promote = function () {
    if (this.mode === MODE_BIG) return this;
    var b, a0 = new Array(this.size), a1 = new Array(this.size),
        a2 = new Array(this.size), a3 = new Array(this.size);
    for (b = 0; b < this.size; b++) {
        a0[b] = BigInt(this.c0[b]); a1[b] = BigInt(this.c1[b]);
        a2[b] = BigInt(this.c2[b]); a3[b] = BigInt(this.c3[b]);
    }
    this.c0 = a0; this.c1 = a1; this.c2 = a2; this.c3 = a3;
    this.mode = MODE_BIG;
    this.promotions++;
    return this;
};

/* ---- int32 kernels -------------------------------------------------- */

function hI32(s, q) {
    var m = 1 << q, size = s.size, b, b1;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    var s0, s1, s2, s3, d0, d1, d2, d3;
    for (b = 0; b < size; b++) {
        if (b & m) continue;
        b1 = b | m;
        s0 = c0[b] + c0[b1]; d0 = c0[b] - c0[b1];
        s1 = c1[b] + c1[b1]; d1 = c1[b] - c1[b1];
        s2 = c2[b] + c2[b1]; d2 = c2[b] - c2[b1];
        s3 = c3[b] + c3[b1]; d3 = c3[b] - c3[b1];
        c0[b]  = s1 - s3; c1[b]  = s0 + s2;
        c2[b]  = s1 + s3; c3[b]  = s2 - s0;
        c0[b1] = d1 - d3; c1[b1] = d0 + d2;
        c2[b1] = d1 + d3; c3[b1] = d2 - d0;
    }
}

function xI32(s, q) {
    var m = 1 << q, size = s.size, b, b1, t;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    for (b = 0; b < size; b++) if (!(b & m)) {
        b1 = b | m;
        t = c0[b]; c0[b] = c0[b1]; c0[b1] = t;
        t = c1[b]; c1[b] = c1[b1]; c1[b1] = t;
        t = c2[b]; c2[b] = c2[b1]; c2[b1] = t;
        t = c3[b]; c3[b] = c3[b1]; c3[b1] = t;
    }
}

function cxI32(s, ctl, tgt) {
    var mc = 1 << ctl, mt = 1 << tgt, size = s.size, b, b1, t;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    for (b = 0; b < size; b++) if ((b & mc) && !(b & mt)) {
        b1 = b | mt;
        t = c0[b]; c0[b] = c0[b1]; c0[b1] = t;
        t = c1[b]; c1[b] = c1[b1]; c1[b1] = t;
        t = c2[b]; c2[b] = c2[b1]; c2[b1] = t;
        t = c3[b]; c3[b] = c3[b1]; c3[b1] = t;
    }
}

function swapI32(s, qa, qb) {
    var ma = 1 << qa, mb = 1 << qb, size = s.size, i, j, t;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    for (i = 0; i < size; i++) if (!(i & ma) && (i & mb)) {
        j = (i ^ ma) ^ mb;
        t = c0[i]; c0[i] = c0[j]; c0[j] = t;
        t = c1[i]; c1[i] = c1[j]; c1[j] = t;
        t = c2[i]; c2[i] = c2[j]; c2[j] = t;
        t = c3[i]; c3[i] = c3[j]; c3[j] = t;
    }
}

/* zeta^k on one amplitude: a permutation of (c0..c3) with signs, spelled out
 * per k so the hot loop has no inner branching beyond the switch. */
function zetaI32(c0, c1, c2, c3, b, k) {
    var a0 = c0[b], a1 = c1[b], a2 = c2[b], a3 = c3[b];
    switch (k) {
    case 1: c0[b] = -a3; c1[b] =  a0; c2[b] =  a1; c3[b] =  a2; break;
    case 2: c0[b] = -a2; c1[b] = -a3; c2[b] =  a0; c3[b] =  a1; break;
    case 3: c0[b] = -a1; c1[b] = -a2; c2[b] = -a3; c3[b] =  a0; break;
    case 4: c0[b] = -a0; c1[b] = -a1; c2[b] = -a2; c3[b] = -a3; break;
    case 5: c0[b] =  a3; c1[b] = -a0; c2[b] = -a1; c3[b] = -a2; break;
    case 6: c0[b] =  a2; c1[b] =  a3; c2[b] = -a0; c3[b] = -a1; break;
    case 7: c0[b] =  a1; c1[b] =  a2; c2[b] =  a3; c3[b] = -a0; break;
    }
}

function zpowI32(s, q, k) {
    var m = 1 << q, size = s.size, b;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    for (b = 0; b < size; b++) if (b & m) zetaI32(c0, c1, c2, c3, b, k);
}

function mcpowI32(s, mask, k) {
    var size = s.size, b;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    for (b = 0; b < size; b++) if ((b & mask) === mask) zetaI32(c0, c1, c2, c3, b, k);
}

function gphaseI32(s, k) {
    var size = s.size, b;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    for (b = 0; b < size; b++) zetaI32(c0, c1, c2, c3, b, k);
}

/* Common trailing zeros and widest magnitude in one pass -- normalization has
 * to walk the whole array anyway, so the width tracking rides along free. */
/* Dividing every coefficient by 2^k divides S and X by 2^(2k) exactly, so a
 * carried norm stays in step with the state it belongs to. Only runs once
 * something has collapsed; before that the norm is 2^(2*denom) by definition
 * and needs no bookkeeping. */
function scaleNorm(s, k) {
    if (s.normS === null || k === 0) return;
    var sh = BigInt(2 * k);
    s.normS >>= sh; s.normX >>= sh;
}

function normalizeI32(s) {
    var size = s.size, b, v, acc = 0, wide = 0;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    for (b = 0; b < size; b++) {
        v = c0[b]; acc |= v; wide |= v ^ (v >> 31);
        v = c1[b]; acc |= v; wide |= v ^ (v >> 31);
        v = c2[b]; acc |= v; wide |= v ^ (v >> 31);
        v = c3[b]; acc |= v; wide |= v ^ (v >> 31);
    }
    var k = 0;
    if (acc !== 0 && s.denom > 0) {
        k = 31 - Math.clz32(acc & -acc);              /* count trailing zeros */
        if (k > s.denom) k = s.denom;
    }
    if (k > 0) {
        for (b = 0; b < size; b++) {
            c0[b] >>= k; c1[b] >>= k; c2[b] >>= k; c3[b] >>= k;
        }
        s.denom -= k;
        wide >>= k;
        scaleNorm(s, k);
    }
    s.maxBits = wide === 0 ? 0 : 32 - Math.clz32(wide);
}

/* ---- BigInt kernels ------------------------------------------------- *
 * Same algebra, unbounded width. Reached by promotion when int32 runs out. */

function hBig(s, q) {
    var m = 1 << q, size = s.size, b, b1;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    var s0, s1, s2, s3, d0, d1, d2, d3;
    for (b = 0; b < size; b++) {
        if (b & m) continue;
        b1 = b | m;
        s0 = c0[b] + c0[b1]; d0 = c0[b] - c0[b1];
        s1 = c1[b] + c1[b1]; d1 = c1[b] - c1[b1];
        s2 = c2[b] + c2[b1]; d2 = c2[b] - c2[b1];
        s3 = c3[b] + c3[b1]; d3 = c3[b] - c3[b1];
        c0[b]  = s1 - s3; c1[b]  = s0 + s2;
        c2[b]  = s1 + s3; c3[b]  = s2 - s0;
        c0[b1] = d1 - d3; c1[b1] = d0 + d2;
        c2[b1] = d1 + d3; c3[b1] = d2 - d0;
    }
}

function xBig(s, q) {
    var m = 1 << q, size = s.size, b, b1, t;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    for (b = 0; b < size; b++) if (!(b & m)) {
        b1 = b | m;
        t = c0[b]; c0[b] = c0[b1]; c0[b1] = t;
        t = c1[b]; c1[b] = c1[b1]; c1[b1] = t;
        t = c2[b]; c2[b] = c2[b1]; c2[b1] = t;
        t = c3[b]; c3[b] = c3[b1]; c3[b1] = t;
    }
}

function cxBig(s, ctl, tgt) {
    var mc = 1 << ctl, mt = 1 << tgt, size = s.size, b, b1, t;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    for (b = 0; b < size; b++) if ((b & mc) && !(b & mt)) {
        b1 = b | mt;
        t = c0[b]; c0[b] = c0[b1]; c0[b1] = t;
        t = c1[b]; c1[b] = c1[b1]; c1[b1] = t;
        t = c2[b]; c2[b] = c2[b1]; c2[b1] = t;
        t = c3[b]; c3[b] = c3[b1]; c3[b1] = t;
    }
}

function swapBig(s, qa, qb) {
    var ma = 1 << qa, mb = 1 << qb, size = s.size, i, j, t;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    for (i = 0; i < size; i++) if (!(i & ma) && (i & mb)) {
        j = (i ^ ma) ^ mb;
        t = c0[i]; c0[i] = c0[j]; c0[j] = t;
        t = c1[i]; c1[i] = c1[j]; c1[j] = t;
        t = c2[i]; c2[i] = c2[j]; c2[j] = t;
        t = c3[i]; c3[i] = c3[j]; c3[j] = t;
    }
}

function zetaBig(c0, c1, c2, c3, b, k) {
    var a0 = c0[b], a1 = c1[b], a2 = c2[b], a3 = c3[b];
    switch (k) {
    case 1: c0[b] = -a3; c1[b] =  a0; c2[b] =  a1; c3[b] =  a2; break;
    case 2: c0[b] = -a2; c1[b] = -a3; c2[b] =  a0; c3[b] =  a1; break;
    case 3: c0[b] = -a1; c1[b] = -a2; c2[b] = -a3; c3[b] =  a0; break;
    case 4: c0[b] = -a0; c1[b] = -a1; c2[b] = -a2; c3[b] = -a3; break;
    case 5: c0[b] =  a3; c1[b] = -a0; c2[b] = -a1; c3[b] = -a2; break;
    case 6: c0[b] =  a2; c1[b] =  a3; c2[b] = -a0; c3[b] = -a1; break;
    case 7: c0[b] =  a1; c1[b] =  a2; c2[b] =  a3; c3[b] = -a0; break;
    }
}

function zpowBig(s, q, k) {
    var m = 1 << q, size = s.size, b;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    for (b = 0; b < size; b++) if (b & m) zetaBig(c0, c1, c2, c3, b, k);
}

function mcpowBig(s, mask, k) {
    var size = s.size, b;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    for (b = 0; b < size; b++) if ((b & mask) === mask) zetaBig(c0, c1, c2, c3, b, k);
}

function gphaseBig(s, k) {
    var size = s.size, b;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    for (b = 0; b < size; b++) zetaBig(c0, c1, c2, c3, b, k);
}

/* Trailing-zero count of a BigInt magnitude, 32 bits at a time. */
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
    var size = s.size, k = Infinity, b, t;
    var c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    for (b = 0; b < size && k > 0; b++) {
        t = ctz(c0[b]); if (t < k) k = t;
        t = ctz(c1[b]); if (t < k) k = t;
        t = ctz(c2[b]); if (t < k) k = t;
        t = ctz(c3[b]); if (t < k) k = t;
    }
    if (k === Infinity) return;                      /* all-zero state */
    if (k > s.denom) k = s.denom;
    if (k === 0) return;
    var sh = BigInt(k);
    for (b = 0; b < size; b++) {
        c0[b] >>= sh; c1[b] >>= sh; c2[b] >>= sh; c3[b] >>= sh;
    }
    s.denom -= k;
    scaleNorm(s, k);
}

/* ---- gates (dispatch) ------------------------------------------------ */

State.prototype.x = function (q) {
    if (this.mode === MODE_I32) xI32(this, q); else xBig(this, q);
    this.gates++;
    return this;
};

State.prototype.cx = function (ctl, tgt) {
    if (this.mode === MODE_I32) cxI32(this, ctl, tgt); else cxBig(this, ctl, tgt);
    this.gates++;
    return this;
};

State.prototype.swap = function (a, b) {
    if (a === b) return this;
    if (this.mode === MODE_I32) swapI32(this, a, b); else swapBig(this, a, b);
    this.gates++;
    return this;
};

State.prototype.zpow = function (q, k) {
    k = ((k % 8) + 8) % 8;
    if (k === 0) { this.gates++; return this; }
    if (this.mode === MODE_I32) zpowI32(this, q, k); else zpowBig(this, q, k);
    this.gates++; this.phaseCount++;
    return this;
};

/* Multi-controlled zeta^k: the phase lands on every basis state that has all
 * of `mask` set. cz, ccz and the Grover phase flip are all this one gate. */
State.prototype.mcpow = function (mask, k) {
    k = ((k % 8) + 8) % 8;
    if (k === 0) { this.gates++; return this; }
    if (this.mode === MODE_I32) mcpowI32(this, mask, k); else mcpowBig(this, mask, k);
    this.gates++; this.phaseCount++;
    return this;
};

/* Global phase zeta^k -- invisible to measurement, carried exactly anyway. */
State.prototype.gphase = function (k) {
    k = ((k % 8) + 8) % 8;
    if (k === 0) return this;
    if (this.mode === MODE_I32) gphaseI32(this, k); else gphaseBig(this, k);
    this.phaseCount++;
    return this;
};

/* Hadamard: the only gate that costs width, and so the only one that can
 * force a promotion. The check happens before the gate, never during. */
State.prototype.h = function (q) {
    if (this.mode === MODE_I32 && this.maxBits > SAFE_BITS) this.promote();
    /* denom going UP re-scales a carried norm, exactly as normalize going down
     * does. The norm is (normS + normX·sqrt2) / 2^(2·denom) and H does not
     * change its value, so raising denom by one multiplies both parts by four.
     * Miss this and the norm marches to zero over a few Hadamards and every
     * probability afterwards comes out NaN. */
    if (this.normS !== null) { this.normS <<= 2n; this.normX <<= 2n; }
    if (this.mode === MODE_I32) {
        hI32(this, q);
        this.denom++;
        normalizeI32(this);
    } else {
        hBig(this, q);
        this.denom++;
        normalizeBig(this);
    }
    if (this.denom > this.maxDenom) this.maxDenom = this.denom;
    this.gates++; this.hCount++;
    return this;
};

State.prototype.z   = function (q) { return this.zpow(q, 4); };
State.prototype.s   = function (q) { return this.zpow(q, 2); };
State.prototype.sdg = function (q) { return this.zpow(q, 6); };
State.prototype.t   = function (q) { return this.zpow(q, 1); };
State.prototype.tdg = function (q) { return this.zpow(q, 7); };
State.prototype.cz  = function (c, t) { return this.mcpow((1 << c) | (1 << t), 4); };
State.prototype.cpow = function (c, t, k) { return this.mcpow((1 << c) | (1 << t), k); };
State.prototype.ccz = function (a, b, c) { return this.mcpow((1 << a) | (1 << b) | (1 << c), 4); };
State.prototype.mcz = function () { return this.mcpow(this.size - 1, 4); };

State.prototype.normalize = function () {
    if (this.mode === MODE_I32) normalizeI32(this); else normalizeBig(this);
    return this;
};

/* ---- canonical fingerprint ------------------------------------------ */

function hashU64(h, v) {
    v = BigInt.asUintN(64, v);
    for (var i = 0; i < 8; i++) {
        h = (h ^ (v & 0xFFn)) & M64;
        h = (h * PRIME) & M64;
        v >>= 8n;
    }
    return h;
}

/* Significant 64-bit limb count: the smallest sig such that v fits in sig
 * two's-complement limbs. This is what makes the fingerprint width
 * independent -- k=2 and k=16 in C hash alike, and so does this engine
 * whether it is running on int32 or on BigInt. */
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
    h = hashU64(h, sig);                          /* length delimiter */
    var u = BigInt.asUintN(Number(64n * sig), v);
    for (i = 0n; i < sig; i++) h = hashU64(h, (u >> (64n * i)) & M64);
    return h;
}

/* ---- fast path: the same FNV-1a in 32-bit halves --------------------- *
 * At 2^20 amplitudes the BigInt hash walks four million coefficients and
 * costs more than the whole circuit did. While the state is on int32 every
 * coefficient has sig = 1, so the canonical form is just (1, sign-extended
 * value) and the whole thing can be done in machine words. Byte for byte the
 * same fingerprint -- the self-test checks that on every run. */

/* FNV prime = 0x100000001B3, so its low half is 0x1B3 — under 16 bits, which
 * collapses the 64x64 multiply to a handful of terms. Everything below stays
 * in locals: module-level accumulators measured 2x SLOWER than this, and an
 * array per byte slower still. */
function hashI32(s) {
    var hi = 0x14650FB0, lo = 0x739D0383;          /* BASIS = 1469598103934665603 */
    var size = s.size, c0 = s.c0, c1 = s.c1, c2 = s.c2, c3 = s.c3;
    var b, j, k, v, vl, vh, byt, a0, a1, t, r0, cy, m, cy2, oldLo, oldHi;
    var head = [s.n, s.denom], hj;

    for (hj = 0; hj < 2; hj++) {
        vl = head[hj] >>> 0; vh = 0;
        for (k = 0; k < 8; k++) {
            byt = k < 4 ? (vl >>> (k * 8)) & 0xFF : (vh >>> ((k - 4) * 8)) & 0xFF;
            lo = (lo ^ byt) >>> 0; oldLo = lo; oldHi = hi;
            a0 = lo & 0xFFFF; a1 = lo >>> 16;
            t = a0 * 435; r0 = t & 0xFFFF; cy = t >>> 16;
            t = a1 * 435 + cy; m = t & 0xFFFF; cy2 = t >>> 16;
            lo = ((m << 16) | r0) >>> 0;
            hi = (cy2 + Math.imul(oldLo, 256) + Math.imul(oldHi, 435)) >>> 0;
        }
    }

    for (b = 0; b < size; b++) {
        for (j = 0; j < 4; j++) {
            v = j === 0 ? c0[b] : (j === 1 ? c1[b] : (j === 2 ? c2[b] : c3[b]));
            vl = v >>> 0; vh = v < 0 ? 0xFFFFFFFF : 0;
            /* sig = 1 (eight bytes), then the sign-extended value (eight more) */
            for (k = 0; k < 16; k++) {
                byt = k === 0 ? 1
                    : (k < 8 ? 0
                    : (k < 12 ? (vl >>> ((k - 8) * 8)) & 0xFF
                              : (vh >>> ((k - 12) * 8)) & 0xFF));
                lo = (lo ^ byt) >>> 0; oldLo = lo; oldHi = hi;
                a0 = lo & 0xFFFF; a1 = lo >>> 16;
                t = a0 * 435; r0 = t & 0xFFFF; cy = t >>> 16;
                t = a1 * 435 + cy; m = t & 0xFFFF; cy2 = t >>> 16;
                lo = ((m << 16) | r0) >>> 0;
                hi = (cy2 + Math.imul(oldLo, 256) + Math.imul(oldHi, 435)) >>> 0;
            }
        }
    }
    return (hi >>> 0).toString(16).padStart(8, '0') +
           (lo >>> 0).toString(16).padStart(8, '0');
}

/* FNV-1a over the canonical statevector. Compare these across machines
 * instead of comparing floats within an epsilon. */
State.prototype.hash = function () {
    if (this.mode === MODE_I32) return hashI32(this);
    var h = BASIS, b, a;
    h = hashU64(h, BigInt(this.n));
    h = hashU64(h, BigInt(this.denom));
    for (b = 0; b < this.size; b++) {
        a = this.amp(b);
        h = hashCoeff(h, a.c0);
        h = hashCoeff(h, a.c1);
        h = hashCoeff(h, a.c2);
        h = hashCoeff(h, a.c3);
    }
    return h.toString(16).padStart(16, '0');
};

/* The slow, obviously-correct one, kept so the fast path can be checked. */
State.prototype.hashBig = function () {
    var h = BASIS, b, a;
    h = hashU64(h, BigInt(this.n));
    h = hashU64(h, BigInt(this.denom));
    for (b = 0; b < this.size; b++) {
        a = this.amp(b);
        h = hashCoeff(h, a.c0);
        h = hashCoeff(h, a.c1);
        h = hashCoeff(h, a.c2);
        h = hashCoeff(h, a.c3);
    }
    return h.toString(16).padStart(16, '0');
};

/* Bit-exact equality, the mirror of oq_equal in the C core -- and it holds
 * across representations: an int32 state equals the same state promoted. */
State.prototype.equals = function (o) {
    if (this.n !== o.n || this.denom !== o.denom) return false;
    var b, x, y;
    for (b = 0; b < this.size; b++) {
        x = this.amp(b); y = o.amp(b);
        if (x.c0 !== y.c0 || x.c1 !== y.c1 || x.c2 !== y.c2 || x.c3 !== y.c3) return false;
    }
    return true;
};

/* Widest coefficient, in bits -- the width the C engine has to compile for. */
State.prototype.widthBits = function () {
    if (this.mode === MODE_I32) return this.maxBits;
    var w = 0, b, i, v, bl, arr = [this.c0, this.c1, this.c2, this.c3];
    for (i = 0; i < 4; i++) for (b = 0; b < this.size; b++) {
        v = arr[i][b]; if (v < 0n) v = -v;
        bl = v === 0n ? 0 : v.toString(2).length;
        if (bl > w) w = bl;
    }
    return w;
};

State.prototype.limbs = function () {
    return Math.max(1, Math.ceil((this.widthBits() + 1) / 64));
};

/* Bytes per amplitude in the current representation. */
State.prototype.bytesPerAmp = function () {
    return this.mode === MODE_I32 ? 16 : 4 * (8 + 8 * this.limbs());
};

/* ---- exact Born measurement ----------------------------------------- */

/* |amp(b)|^2 = (S + X*sqrt2) / 2^(2*denom), with
 *   S = c0^2+c1^2+c2^2+c3^2,  X = c0c1+c1c2+c2c3 - c0c3.
 * sum_b S = 2^(2*denom) exactly, and sum_b X = 0 for a normalized state. */
State.prototype.bornPair = function (b) {
    var m = this.amp(b), a = m.c0, c = m.c1, d = m.c2, e = m.c3;
    return {
        S: a * a + c * c + d * d + e * e,
        X: a * c + c * d + d * e - a * e
    };
};

State.prototype.bornTotals = function () {
    var S = 0n, X = 0n, p, b;
    for (b = 0; b < this.size; b++) { p = this.bornPair(b); S += p.S; X += p.X; }
    return { S: S, X: X };
};

/* Sign of A + B*sqrt2, decided by integer comparison only (A^2 vs 2B^2).
 * sqrt2 is never approximated anywhere in the measurement path. */
function sqrt2Sign(A, B) {
    if (B === 0n) return A === 0n ? 0 : (A < 0n ? -1 : 1);
    if (A >= 0n && B > 0n) return 1;
    if (A <= 0n && B < 0n) return -1;
    var ua = A < 0n ? -A : A, ub = B < 0n ? -B : B;
    var a2 = ua * ua, b2t = 2n * ub * ub;
    var c = a2 > b2t ? 1 : (a2 < b2t ? -1 : 0);
    if (A > 0n) return c > 0 ? 1 : -1;            /* A>0, B<0 */
    return c < 0 ? 1 : -1;                        /* A<0, B>0 */
}

/* splitmix64 -- deterministic, seeded, identical on every platform. */
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

/* Streaming sampler: sort the draws, then walk the statevector once with a
 * running cumulative. O(shots) memory, no 2^n CDF table -- the same shape as
 * oq_born_sample_many in the C engine. The extra 64 bits of scale give the
 * draw a resolution finer than the exact irrational threshold grid. */
State.prototype.sample = function (shots, seed) {
    var EXTRA = 64n;
    var bits = 2 * this.denom + 64;
    var rng = new Rng(seed), draws = new Array(shots), i;
    for (i = 0; i < shots; i++) draws[i] = rng.bits(bits);
    var idx = draws.map(function (_, j) { return j; });
    idx.sort(function (a, b) {
        return draws[a] < draws[b] ? -1 : (draws[a] > draws[b] ? 1 : 0);
    });

    var out = new Array(shots), cumS = 0n, cumX = 0n, p = 0, b, pr, cS, cX, A;
    for (b = 0; b < this.size && p < shots; b++) {
        pr = this.bornPair(b);
        cumS += pr.S; cumX += pr.X;
        cS = cumS << EXTRA; cX = cumX << EXTRA;
        while (p < shots) {
            A = cS - draws[idx[p]];
            if (sqrt2Sign(A, cX) > 0) { out[idx[p]] = b; p++; } else break;
        }
    }
    while (p < shots) { out[idx[p]] = this.size - 1; p++; }
    return out;
};

/* ---- readable (lossy) views ----------------------------------------- */

/* BigInt ratio -> double without overflowing on huge numerators: divide in
 * BigInt at 64 bits of fixed point, then convert. Display only -- every
 * decision inside the engine stays integer. */
function ratio(num, den) {
    if (num === 0n) return 0;
    var neg = num < 0n;
    if (neg) num = -num;
    var q = (num << 64n) / den;
    return (neg ? -1 : 1) * Number(q) / 18446744073709551616;
}

/* amp = (c0 + c1 z + c2 z^2 + c3 z^3)/2^d, z = e^{i pi/4}
 *   Re = (c0 + (c1-c3)/sqrt2) / 2^d     Im = (c2 + (c1+c3)/sqrt2) / 2^d */
State.prototype.ampFloat = function (b) {
    var den = 1n << BigInt(this.denom), a = this.amp(b);
    return {
        re: ratio(a.c0, den) + ratio(a.c1 - a.c3, den) * SQRT2 / 2,
        im: ratio(a.c2, den) + ratio(a.c1 + a.c3, den) * SQRT2 / 2
    };
};

/* (S + X*sqrt2) / 2^(2*denom) as a double. Only the last step is floating
 * point, and only so the number can be printed. */
State.prototype.ringFloat = function (S, X) {
    var den = 1n << BigInt(2 * this.denom);
    return ratio(S, den) + ratio(X, den) * SQRT2;
};

State.prototype.probFloat = function (b) {
    var pr = this.bornPair(b), den = 1n << BigInt(2 * this.denom);
    if (this.normS === null)
        return ratio(pr.S, den) + ratio(pr.X, den) * SQRT2;
    /* collapsed: a ratio of two ring elements, exact until this division */
    return this.ringFloat(pr.S, pr.X) / this.ringFloat(this.normS, this.normX);
};

/* The total (S, X) over every amplitude. Equal to (2^(2d), 0) until something
 * collapses, which is Section 4.2 restated. */
State.prototype.totalBorn = function () {
    var S = 0n, X = 0n, b, pr;
    for (b = 0; b < this.size; b++) { pr = this.bornPair(b); S += pr.S; X += pr.X; }
    return { S: S, X: X };
};

/* The norm this state is carrying, as a ring element over 2^(2*denom). */
State.prototype.normPair = function () {
    if (this.normS === null) return { S: 1n << BigInt(2 * this.denom), X: 0n };
    return { S: this.normS, X: this.normX };
};

/* ---- mid-circuit measurement -----------------------------------------
 * Draw an outcome from the exact conditional probability, then project. The
 * comparison is the same one the shot sampler makes: a uniform rational
 * k/2^m against a ring element, decided by sqrt2Sign, never by a float.
 *
 *   p(1) = (S1 + X1 sqrt2) / (normS + normX sqrt2)
 *   outcome 1  iff  k/2^m < p(1)
 *              iff  2^m S1 - k normS + (2^m X1 - k normX) sqrt2 > 0
 */
State.prototype.measureQubit = function (q, rng) {
    var mk = 1 << q, S1 = 0n, X1 = 0n, b, pr;
    for (b = 0; b < this.size; b++) {
        if (!(b & mk)) continue;                              /* bit q clear */
        pr = this.bornPair(b); S1 += pr.S; X1 += pr.X;
    }
    var tot = this.normPair();
    var m = BigInt(2 * this.denom + 64);
    var k = (rng || this.rng).bits(Number(m));
    var A = (S1 << m) - k * tot.S, B = (X1 << m) - k * tot.X;
    var one = sqrt2Sign(A, B) > 0 ? 1 : 0;

    /* project: everything disagreeing with the outcome goes to exactly zero */
    var z = this.mode === MODE_I32 ? 0 : 0n;
    for (b = 0; b < this.size; b++) {
        if (((b & mk) !== 0) === (one === 1)) continue;
        this.c0[b] = z; this.c1[b] = z; this.c2[b] = z; this.c3[b] = z;
    }
    this.normS = one ? S1 : tot.S - S1;
    this.normX = one ? X1 : tot.X - X1;
    this.measured++;
    this.gates++;
    if (this.normS === 0n && this.normX === 0n)
        throw new Error('measured a branch with probability exactly zero');
    return one;
};

/* Is this basis amplitude exactly zero? Cheap in either representation. */
State.prototype.isZero = function (b) {
    if (this.mode === MODE_I32)
        return this.c0[b] === 0 && this.c1[b] === 0 && this.c2[b] === 0 && this.c3[b] === 0;
    return this.c0[b] === 0n && this.c1[b] === 0n && this.c2[b] === 0n && this.c3[b] === 0n;
};

/* ---- gate list execution -------------------------------------------- */

/* A gate is [op, ...args]; the ops match the C core one to one. */
/* The classical value a condition reads: the bits it names, least significant
 * first, as one integer. Unwritten bits read 0. */
function condValue(s, bits) {
    var v = 0, i;
    for (i = 0; i < bits.length; i++) if (s.cbits[bits[i]]) v |= (1 << i);
    return v;
}

var GATES = {
    h:      function (s, g) { s.h(g[1]); },
    x:      function (s, g) { s.x(g[1]); },
    zpow:   function (s, g) { s.zpow(g[1], g[2]); },
    cx:     function (s, g) { s.cx(g[1], g[2]); },
    mcpow:  function (s, g) { s.mcpow(g[1], g[2]); },
    swap:   function (s, g) { s.swap(g[1], g[2]); },
    gphase: function (s, g) { s.gphase(g[1]); },

    /* ---- dynamic circuits --------------------------------------------- *
     * measure collapses and writes a classical bit; if reads those bits back
     * and applies a block or does not. This is the only place in the engine
     * where what happens next depends on what happened before. */
    measure: function (s, g) { s.cbits[g[2]] = s.measureQubit(g[1], s.rng); },
    if:     function (s, g) {
        if (condValue(s, g[1].bits) !== g[1].value) return;
        var i;
        for (i = 0; i < g[2].length; i++) apply(s, g[2][i]);
    }
};

function apply(s, g) {
    var f = GATES[g[0]];
    if (!f) throw new Error('unknown op ' + g[0]);
    f(s, g);
}

function run(gates, n, seed) {
    var s = new State(n), i;
    /* A circuit with mid-circuit measurement needs a stream of randomness, and
     * it has to be seeded: one trajectory per seed, reproducible. A circuit
     * without one never touches it. */
    s.rng = new Rng(seed === undefined ? 0 : seed);
    for (i = 0; i < gates.length; i++) apply(s, gates[i]);
    return s;
}

return {
    State: State, Rng: Rng,
    apply: apply, run: run,
    sqrt2Sign: sqrt2Sign, ratio: ratio, ctz: ctz,
    SAFE_BITS: SAFE_BITS, MODE_I32: MODE_I32, MODE_BIG: MODE_BIG
};
});
