/*
 * oqsynth.js -- Solovay-Kitaev synthesis for angles that are not in the ring.
 *
 * (c) Marek Spanel 2026  All rights reserved.
 *
 * THIS IS THE ONE PLACE IN oq WHERE SOMETHING IS APPROXIMATE, AND IT IS OPT-IN.
 *
 * The rest of the engine refuses an angle off the lattice rather than round it,
 * because rounding an amplitude is the first lie in a chain of them. This
 * module does something different, and the difference is the whole point:
 * given a rotation that has no exact representative, it produces a DIFFERENT
 * circuit -- an exact Clifford+T word -- whose operator sits within a stated
 * distance of the one that was asked for. The engine then runs that word with
 * no rounding at all.
 *
 *   exact arithmetic on a deliberately chosen neighbour,
 *   which is a different claim from exact theta.
 *
 * So the page must always say which circuit it ran and how far away it is. A
 * synthesized run is not an exact run of the user's circuit; it is an exact
 * run of a nearby one.
 *
 * The search is floating point. Nothing it produces is: the output is a word
 * over {H, S, S+, T, T+, X, Y, Z}, every one of which is exact in Z[zeta_8].
 *
 * DETERMINISM. Same target, same parameters, same word, so fingerprints of
 * synthesized circuits reproduce. There is no randomness anywhere below.
 *
 * GLOBAL PHASE IS NOT PRESERVED. Solovay-Kitaev approximates in SU(2), i.e.
 * up to a global phase, and a synthesized gate carries whatever phase its word
 * happens to have. No measurement can see it, but this engine does track it,
 * so the fingerprint of a synthesized circuit depends on the synthesis. That
 * is inherent, not a defect.
 *
 * COST, measured (net length 20, Rz(0.3)):
 *
 *   depth 0   eps 4.5e-2       12 T      24 gates
 *   depth 1   eps 1.2e-2       56 T     106
 *   depth 2   eps 1.2e-3      288 T     538
 *   depth 3   eps 9.9e-5     1460 T    2742      denom 2^281, BigInt
 *
 * Solovay-Kitaev is the cheap route, not the good one. Ross-Selinger
 * (gridsynth) reaches eps = 1e-4 in about 40 T gates rather than 1460 -- 35x
 * shorter, and since width here grows with the H count, 35x matters. This is
 * the prototype that proves the two-layer architecture works; if synthesis
 * becomes load-bearing, gridsynth is the replacement.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.OQSYNTH = api;
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* ---- complex 2x2 -------------------------------------------------------
 * A matrix is [m00, m01, m10, m11], each entry a [re, im] pair. */

function C(re, im) { return [re, im || 0]; }
function cadd(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
function csub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function cmul(a, b) { return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]; }
function cconj(a) { return [a[0], -a[1]]; }

function mmul(A, B) {
    return [cadd(cmul(A[0], B[0]), cmul(A[1], B[2])), cadd(cmul(A[0], B[1]), cmul(A[1], B[3])),
            cadd(cmul(A[2], B[0]), cmul(A[3], B[2])), cadd(cmul(A[2], B[1]), cmul(A[3], B[3]))];
}
function mdag(A) { return [cconj(A[0]), cconj(A[2]), cconj(A[1]), cconj(A[3])]; }

var ID = [C(1), C(0), C(0), C(1)];

/* Strip the global phase: divide by a square root of the determinant so the
 * matrix lands in SU(2). Everything below compares in SU(2). */
function toSU2(A) {
    var det = csub(cmul(A[0], A[3]), cmul(A[1], A[2]));
    var r = Math.sqrt(Math.hypot(det[0], det[1]));
    var th = Math.atan2(det[1], det[0]) / 2;
    var s = [Math.cos(th) / r, -Math.sin(th) / r];
    return [cmul(A[0], s), cmul(A[1], s), cmul(A[2], s), cmul(A[3], s)];
}

/* Operator-norm distance, minimized over the global phase. For SU(2) the
 * trace is real and the answer is sqrt(2 - |tr(A* B)|). Zero iff equal up to
 * phase, sqrt(2) at worst. */
function dist(A, B) {
    var M = mmul(mdag(A), B), tr = cadd(M[0], M[3]);
    return Math.sqrt(Math.max(0, 2 - Math.hypot(tr[0], tr[1])));
}

/* rotation angle: tr = 2 cos(theta/2), with |tr| so U and -U agree */
function angleOf(U) {
    var tr = cadd(U[0], U[3]), c = Math.abs(tr[0]) / 2;
    if (c > 1) c = 1;
    return 2 * Math.acos(c);
}

/* U = cos(t/2) I - i sin(t/2) (n . sigma); read n back off the entries */
function axisOf(U) {
    var V = U, tr = cadd(U[0], U[3]), t, s, nx, ny, nz, L;
    if (tr[0] < 0) V = [[-U[0][0], -U[0][1]], [-U[1][0], -U[1][1]],
                        [-U[2][0], -U[2][1]], [-U[3][0], -U[3][1]]];
    t = angleOf(V); s = Math.sin(t / 2);
    if (Math.abs(s) < 1e-12) return [0, 0, 1];
    nx = -(V[1][1] + V[2][1]) / (2 * s);
    ny = (V[2][0] - V[1][0]) / (2 * s);
    nz = -(V[0][1] - V[3][1]) / (2 * s);
    L = Math.hypot(nx, ny, nz) || 1;
    return [nx / L, ny / L, nz / L];
}

function rot(n, t) {
    var c = Math.cos(t / 2), s = Math.sin(t / 2);
    return [C(c, -s * n[2]), C(-s * n[1], -s * n[0]),
            C(s * n[1], -s * n[0]), C(c, s * n[2])];
}

/* ---- the exact generators ---------------------------------------------
 * Every one of these is in Z[zeta_8], so every word over them is too, and the
 * dense and sparse engines run it with no rounding. */

var R2 = Math.SQRT1_2, W8 = Math.cos(Math.PI / 4);
var GATES = {
    h:   toSU2([C(R2), C(R2), C(R2), C(-R2)]),
    t:   toSU2([C(1), C(0), C(0), C(W8, W8)]),
    tdg: toSU2([C(1), C(0), C(0), C(W8, -W8)]),
    s:   toSU2([C(1), C(0), C(0), C(0, 1)]),
    sdg: toSU2([C(1), C(0), C(0), C(0, -1)]),
    x:   toSU2([C(0), C(1), C(1), C(0)]),
    y:   toSU2([C(0), C(0, -1), C(0, 1), C(0)]),
    z:   toSU2([C(1), C(0), C(0), C(-1)])
};
var INV = { h: 'h', t: 'tdg', tdg: 't', s: 'sdg', sdg: 's', x: 'x', y: 'y', z: 'z' };

/* Phase exponents in SIXTEENTHS, which is what the gate list carries before
 * the parser halves them for Z[zeta_8]. */
var ZPOW = { t: 2, tdg: 14, s: 4, sdg: 12, z: 8 };

function wordMatrix(word) {
    var M = ID, i;
    for (i = 0; i < word.length; i++) M = mmul(M, GATES[word[i]]);
    return M;
}
function invWord(word) {
    var out = [], i;
    for (i = word.length - 1; i >= 0; i--) out.push(INV[word[i]]);
    return out;
}

/* Turn a synthesized word into the engine's own gate ops on qubit q.
 *
 * REVERSED, and it matters. wordMatrix multiplies left to right, so the
 * operator of [g0, g1, ..., gn] is G0·G1·…·Gn — in which Gn acts on the state
 * FIRST. A circuit applies its gates in the order they are written, so the
 * circuit for that operator is the word backwards. Diagonal rotations commute
 * and hide this; ry(1.0) does not, and produced a state with the amplitude
 * magnitudes swapped until this line was fixed. */
function wordToGates(word, q) {
    var out = [], i, g;
    for (i = word.length - 1; i >= 0; i--) {
        g = word[i];
        if (g === 'h') out.push(['h', q]);
        else if (g === 'x') out.push(['x', q]);
        else if (g === 'y') out.push(['zpow', q, 8], ['x', q], ['gphase', 4]);
        else out.push(['zpow', q, ZPOW[g]]);
    }
    return out;
}

/* ---- the basic approximation net --------------------------------------
 * BFS over {h, t, tdg}: three letters are enough to generate Clifford+T up to
 * phase, and a small alphabet keeps the tree enumerable. Distinct group
 * elements are deduped by a quantized key, so h.h = 1 and t^8 = 1 collapse on
 * their own without anyone writing the relations down. */

function netKey(M) {
    var p = null, i, r, ph, out = [];
    for (i = 0; i < 4; i++) if (Math.hypot(M[i][0], M[i][1]) > 1e-9) { p = M[i]; break; }
    r = Math.hypot(p[0], p[1]);
    ph = [p[0] / r, -p[1] / r];                    /* first real: kills the phase */
    for (i = 0; i < 4; i++) {
        var e = cmul(M[i], ph);
        out.push(Math.round(e[0] * 1e6) + ',' + Math.round(e[1] * 1e6));
    }
    return out.join(';');
}

function buildNet(maxLen) {
    var seen = {}, net = [], frontier = [[]], L, i, j, word, nw, M, k, next;
    var letters = ['h', 't', 'tdg'];
    seen[netKey(ID)] = 1;
    net.push({ word: [], M: ID });
    for (L = 1; L <= maxLen; L++) {
        next = [];
        for (i = 0; i < frontier.length; i++) {
            word = frontier[i];
            for (j = 0; j < 3; j++) {
                if (word.length && word[word.length - 1] === 'h' && letters[j] === 'h') continue;
                nw = word.concat(letters[j]);
                M = wordMatrix(nw);
                k = netKey(M);
                if (seen[k]) continue;
                seen[k] = 1;
                net.push({ word: nw, M: M });
                next.push(nw);
            }
        }
        frontier = next;
        if (!next.length) break;
    }
    return net;
}

function nearest(net, U) {
    var best = null, bd = Infinity, i, d;
    for (i = 0; i < net.length; i++) {
        d = dist(U, net[i].M);
        if (d < bd) { bd = d; best = net[i]; }
    }
    return best;
}

/* ---- the group commutator ---------------------------------------------
 * Find V, W with V W V* W* = D. The commutator of Rx(phi) and Ry(phi) is a
 * rotation whose angle grows monotonically in phi, so phi is found by
 * bisection rather than by transcribing a closed form and hoping. Then the
 * commutator's axis is rotated onto D's. */

var RX = function (t) { return rot([1, 0, 0], t); };
var RY = function (t) { return rot([0, 1, 0], t); };

function commutatorAngle(phi) {
    var V = RX(phi), W = RY(phi);
    return angleOf(mmul(mmul(V, W), mmul(mdag(V), mdag(W))));
}

function gcDecompose(D) {
    var theta = angleOf(D), lo = 0, hi = Math.PI, i, mid, phi, V, W, Cm, a, b, cr, dot, cl, S, Sd;
    for (i = 0; i < 60; i++) {
        mid = (lo + hi) / 2;
        if (commutatorAngle(mid) < theta) lo = mid; else hi = mid;
    }
    phi = (lo + hi) / 2;
    V = RX(phi); W = RY(phi);
    Cm = mmul(mmul(V, W), mmul(mdag(V), mdag(W)));
    a = axisOf(Cm); b = axisOf(D);
    cr = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    cl = Math.hypot(cr[0], cr[1], cr[2]);
    S = ID;
    if (cl > 1e-12) S = rot([cr[0] / cl, cr[1] / cl, cr[2] / cl],
                            Math.acos(Math.max(-1, Math.min(1, dot))));
    else if (dot < 0) S = rot([1, 0, 0], Math.PI);
    Sd = mdag(S);
    return [mmul(mmul(S, V), Sd), mmul(mmul(S, W), Sd)];
}

function skRec(net, U, n) {
    if (n === 0) return nearest(net, U).word;
    var prev = skRec(net, U, n - 1);
    var D = mmul(U, mdag(wordMatrix(prev)));
    var vw = gcDecompose(D);
    var v = skRec(net, vw[0], n - 1), w = skRec(net, vw[1], n - 1);
    return v.concat(w, invWord(v), invWord(w), prev);
}

/* ---- the public face ---------------------------------------------------- */

var NET_LEN = 20;          /* 27k elements, ~160 ms, eps0 about 5.7e-2 */
var MAX_DEPTH = 4;
var cachedNet = null, cache = {};

function net() {
    if (!cachedNet) cachedNet = buildNet(NET_LEN);
    return cachedNet;
}

/* Approximate an SU(2) target to within eps, going no deeper than needed.
 * Returns { word, err, depth }. Deterministic and memoized. */
function approximate(U, eps) {
    var key = U.map(function (e) {
        return Math.round(e[0] * 1e12) + ',' + Math.round(e[1] * 1e12);
    }).join(';') + '|' + eps;
    if (cache[key]) return cache[key];
    var N = net(), best = null, d, word, err;
    for (d = 0; d <= MAX_DEPTH; d++) {
        word = skRec(N, U, d);
        err = dist(U, wordMatrix(word));
        if (!best || err < best.err) best = { word: word, err: err, depth: d };
        if (err <= eps) break;
    }
    cache[key] = best;
    return best;
}

/* The targets the parser knows how to hand over. Each is built as a matrix and
 * projected into SU(2), so the global phase convention of the caller does not
 * matter -- and is not preserved. */
function uMatrix(theta, phi, lam) {
    var c = Math.cos(theta / 2), s = Math.sin(theta / 2);
    var el = C(Math.cos(lam), Math.sin(lam));
    var ep = C(Math.cos(phi), Math.sin(phi));
    var epl = C(Math.cos(phi + lam), Math.sin(phi + lam));
    return toSU2([C(c), [-cmul(el, C(s))[0], -cmul(el, C(s))[1]],
                  cmul(ep, C(s)), cmul(epl, C(c))]);
}
function rzMatrix(t) { return uMatrix(0, 0, t); }
function rxMatrix(t) { return uMatrix(t, -Math.PI / 2, Math.PI / 2); }
function ryMatrix(t) { return uMatrix(t, 0, 0); }

/* Synthesize onto qubit q. Returns { gates, err, depth, tCount, length }. */
function synthesize(U, q, eps) {
    var r = approximate(U, eps === undefined ? 1e-3 : eps);
    var tc = 0, i;
    for (i = 0; i < r.word.length; i++) if (r.word[i] === 't' || r.word[i] === 'tdg') tc++;
    return { gates: wordToGates(r.word, q), err: r.err, depth: r.depth,
             tCount: tc, length: r.word.length, word: r.word };
}

return {
    synthesize: synthesize, approximate: approximate,
    uMatrix: uMatrix, rzMatrix: rzMatrix, rxMatrix: rxMatrix, ryMatrix: ryMatrix,
    wordToGates: wordToGates, wordMatrix: wordMatrix, dist: dist, toSU2: toSU2, C: C,
    buildNet: buildNet, net: net, NET_LEN: NET_LEN, MAX_DEPTH: MAX_DEPTH
};
}));
