/*
 * qasm.js -- OpenQASM 2.0 front end for the OQ browser engine.
 *
 * (c) Marek Spanel 2026  All rights reserved.
 *
 * Compiles QASM text into the engine's gate list. Everything that closes in
 * Z[zeta_8] is accepted; anything that does not is refused by name, with the
 * reason, rather than silently approximated. That refusal is the product:
 * an angle that is not a multiple of pi/4 has no exact representative in this
 * ring, and rounding it would be the first lie in a chain of them.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.QASM = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

function QasmError(line, message, hint) {
    this.line = line; this.message = message; this.hint = hint || null;
    this.name = 'QasmError';
}
QasmError.prototype = Object.create(Error.prototype);

/* ---- angle expressions ---------------------------------------------- *
 * A tiny recursive-descent evaluator over + - * / ( ) pi. No eval, and the
 * result is immediately quantized: k = angle / (pi/4) must be an integer. */

function evalAngle(src, line) {
    var i = 0;

    function skip() { while (i < src.length && /\s/.test(src[i])) i++; }

    function primary() {
        skip();
        if (src[i] === '(') {
            i++;
            var v = expr();
            skip();
            if (src[i] !== ')') throw new QasmError(line, 'unbalanced ( in angle "' + src + '"');
            i++;
            return v;
        }
        if (src[i] === '-') { i++; return -primary(); }
        if (src[i] === '+') { i++; return primary(); }
        var m = /^(pi|π)/.exec(src.slice(i));
        if (m) { i += m[0].length; return Math.PI; }
        m = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i));
        if (m) { i += m[0].length; return parseFloat(m[0]); }
        throw new QasmError(line, 'cannot read angle "' + src + '"',
            'angles may use numbers, pi, + - * / and parentheses');
    }

    /* right-associative power, checked before '*' so 3**2 does not read as a
     * multiplication by nothing */
    function power() {
        var v = primary();
        skip();
        if (src[i] === '*' && src[i + 1] === '*') { i += 2; return Math.pow(v, power()); }
        return v;
    }

    function term() {
        var v = power();
        for (;;) {
            skip();
            if (src[i] === '*' && src[i + 1] === '*') { i += 2; v = Math.pow(v, power()); }
            else if (src[i] === '*') { i++; v *= power(); }
            else if (src[i] === '/') { i++; v /= power(); }
            else return v;
        }
    }

    function expr() {
        var v = term();
        for (;;) {
            skip();
            if (src[i] === '+') { i++; v += term(); }
            else if (src[i] === '-') { i++; v -= term(); }
            else return v;
        }
    }

    var val = expr();
    skip();
    if (i < src.length) throw new QasmError(line, 'trailing text in angle "' + src + '"');
    return val;
}

/* angle -> k in SIXTEENTHS, so the phase is zeta_16^k = e^(i k pi/8). A k that
 * is odd needs the bigger ring; the parser tracks that and the page picks the
 * engine accordingly, the same way the C core picks a limb count. */
function quantize(angle, line, gate) {
    var k = angle / (Math.PI / 8);
    var r = Math.round(k);
    if (Math.abs(k - r) > 1e-9) {
        throw new QasmError(line,
            gate + '(' + (angle / Math.PI).toFixed(6) + '·pi) is not a multiple of pi/8',
            'Z[ζ₈] holds eighth roots of unity, Z[ζ₁₆] sixteenths, and oq will ' +
            'reach for the bigger ring on its own. Below pi/8 there is no exact ' +
            'representative at all — rewrite the angle, or decompose the gate ' +
            'into H, S, T, which is universal.');
    }
    return r;                    /* signed: rz's global phase needs the sign */
}

/* ---- gate table ----------------------------------------------------- *
 * Each entry: [qubit count, parameter count, emit(gates, q, k)]. */

/* The dense kernel wants a machine-word control mask, which runs out at 31
 * qubits. Past that the sparse backend is the only one that can run the
 * circuit anyway, and it reads the qubit list instead — so return null rather
 * than a silently wrong mask, and let the dense side fail loudly if it ever
 * sees one. */
function mask(qs) {
    var m = 0, i;
    for (i = 0; i < qs.length; i++) {
        if (qs[i] > 30) return null;
        m |= (1 << qs[i]);
    }
    return m;
}

/* Every controlled phase carries both forms: the mask the dense engine reads,
 * and the qubit list the sparse engine reads. */
function mcpow(qs, k) { return ['mcpow', mask(qs), k, qs.slice()]; }

/* name(params) operands, with the parameter list matched by counting
 * brackets rather than by "everything up to the first )". Substituting a
 * gate parameter puts parentheses inside parentheses -- cphase(pi/2) turns
 * the body's "θ / 2" into "(pi / 2) / 2" -- and a non-nesting match reads
 * that as an unbalanced angle. */
/* if (cond) rest -- with the condition delimited by counting brackets. A
 * greedy match runs to the LAST ')' in the statement, so
 * "if (c0 == 1) rz(pi / 2) q[1]" reads its condition as "c0 == 1) rz(pi / 2".
 * teleport.qasm has no second bracket and never showed it; inverseqft2 does. */
function splitIf(text) {
    var m = /^if\s*\(/i.exec(text);
    if (!m) return null;
    var i = m[0].length - 1, depth = 0, j;
    for (j = i; j < text.length; j++) {
        if (text[j] === '(') depth++;
        else if (text[j] === ')') { depth--; if (!depth) break; }
    }
    if (depth !== 0) return null;
    return { cond: text.slice(i + 1, j), rest: text.slice(j + 1).trim() };
}

function splitCall(text) {
    var m = /^([\p{L}_][\p{L}\p{N}_]*)\s*/u.exec(text);
    if (!m) return null;
    var name = m[1], i = m[0].length, params, depth = 0, j;
    if (text[i] === '(') {
        for (j = i; j < text.length; j++) {
            if (text[j] === '(') depth++;
            else if (text[j] === ')') { depth--; if (!depth) break; }
        }
        if (depth !== 0) return null;
        params = text.slice(i + 1, j);
        i = j + 1;
    }
    return { name: name, params: params, operands: text.slice(i).trim() };
}

/* Split on commas that are not inside brackets. */
function splitTop(str) {
    var parts = [], depth = 0, cur = '', i;
    for (i = 0; i < str.length; i++) {
        if (str[i] === '(' || str[i] === '[') depth++;
        else if (str[i] === ')' || str[i] === ']') depth--;
        if (str[i] === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
        cur += str[i];
    }
    if (cur.trim()) parts.push(cur);
    return parts;
}

function ccx(g, q) {                       /* Toffoli = H · CCZ · H */
    g.push(['h', q[2]], mcpow(q, 8), ['h', q[2]]);
}

/* Approximate synthesis, when and only when the caller asked for it.
 * parse(src, {synth: OQSYNTH, eps: 1e-3}) turns it on; without that object
 * every off-lattice angle is refused exactly as before. The module is passed
 * in rather than required, so nothing here depends on it being loaded. */
var SYNTH = null;

/* Try to replace an unrepresentable single-qubit rotation with a nearby
 * exact word. Returns true if it did, and records what it substituted so the
 * page can say so -- a synthesized run is an exact run of a NEIGHBOURING
 * circuit, and hiding that would be the lie the whole engine avoids. */
function trySynth(g, q, U, line, name, shown) {
    if (!SYNTH) return false;
    var r = SYNTH.mod.synthesize(U, q, SYNTH.eps), i;
    for (i = 0; i < r.gates.length; i++) g.push(r.gates[i]);
    /* checkGate validates a call by emitting it into a throwaway list. That
     * pass must not leave a record behind, or every substitution is reported
     * twice -- once at the line the validator saw and once at the real one. */
    if (!SYNTH.dry)
        SYNTH.log.push({ line: line, gate: name, angle: shown, err: r.err,
                         depth: r.depth, tCount: r.tCount, length: r.length });
    return true;
}

/* The OpenQASM 3 builtin.
 *
 *   U(θ,φ,λ) = P(φ) · RY(θ) · P(λ),   P(x) = diag(1, e^{ix})
 *   RY(θ)    = [[cos θ/2, −sin θ/2], [sin θ/2, cos θ/2]]
 *
 * RY(π/2) = H·Z exactly, and RY is a rotation group, so RY(m·π/2) = (H·Z)^m.
 * H and Z are both in the ring, so **every U whose θ is a multiple of π/2 is
 * exact**, however the two phases fall. That is x, y, z, h, id, phase, u1, u2,
 * and every rx / ry / u3 on the half-π lattice — none of which used to be
 * reachable. A θ off that lattice needs cos(θ/2) itself, and that is where the
 * ring genuinely ends; it is refused, with the reason.
 *
 * φ and λ are ordinary phases and may be any multiple of π/8.
 *
 * The spec writes U as
 *
 *   U(θ,φ,λ) = ½ [[1+e^{iθ}, −i e^{iλ}(1−e^{iθ})], [i e^{iφ}(1−e^{iθ}), e^{i(φ+λ)}(1+e^{iθ})]]
 *
 * which is e^{iθ/2} times the textbook form above — U carries a global phase
 * of θ/2 that the P·RY·P product does not. That is not cosmetic here: this
 * engine tracks global phase, and it is exactly what the gphase corrections in
 * stdgates.inc cancel, which is why U(π/2,0,π) followed by gphase(−π/4) is
 * the Hadamard gate on the nose. θ is a multiple of π/2, so θ/2 is a multiple
 * of π/4 and always lands on the lattice. */
/* A bare phase: exact when the angle is a multiple of pi/8, otherwise
 * synthesized if that was asked for, otherwise refused. */
function emitPhase(g, q, angle, line, name) {
    var k = angle / (Math.PI / 8), r = Math.round(k);
    if (Math.abs(k - r) <= 1e-9) { if (r) g.push(['zpow', q, r]); return; }
    if (SYNTH && trySynth(g, q, SYNTH.mod.rzMatrix(angle), line, name,
                          (angle / Math.PI).toFixed(6) + 'pi')) return;
    quantize(angle, line, name);                  /* refuses, with the reason */
}

function emitU(g, q, theta, phi, lam, line, name) {
    var m = theta / (Math.PI / 2), r = Math.round(m), i, rep;
    if (Math.abs(m - r) > 1e-9) {
        if (SYNTH && SYNTH.mod.uMatrix &&
            trySynth(g, q, SYNTH.mod.uMatrix(theta, phi, lam), line, name,
                     (theta / Math.PI).toFixed(6) + 'pi')) return true;
        throw new QasmError(line,
        (name || 'U') + ' with θ = ' + (theta / Math.PI).toFixed(6) +
        '·pi has no exact representative',
        'θ enters as cos(θ/2) and sin(θ/2), which are in the ring only when θ is a ' +
        'multiple of pi/2. φ and λ are phases and may be any multiple of pi/8, so ' +
        'U(pi/2, pi/8, pi/4) is exact and U(pi/3, 0, 0) is not. Decompose into ' +
        'H, S, T, CX — universal, and exact here, or turn on approximate ' +
        'synthesis, which substitutes a nearby exact circuit and says how near.');
    }
    var kl = quantize(lam, line, name || 'U'), kp = quantize(phi, line, name || 'U');
    if (kl) g.push(['zpow', q, kl]);
    rep = ((r % 8) + 8) % 8;
    for (i = 0; i < rep; i++) { g.push(['zpow', q, 8]); g.push(['h', q]); }
    if (kp) g.push(['zpow', q, kp]);
    if (r) g.push(['gphase', 2 * r]);        /* the e^{i theta/2} the spec carries */
    return false;
}

/* A global phase that is itself off the lattice is the rz situation again:
 * physically invisible, but this engine tracks it, so it has to be exact. */
function emitGphase(g, angle, line, name) {
    var k = angle / (Math.PI / 8), r = Math.round(k);
    if (Math.abs(k - r) > 1e-9) throw new QasmError(line,
        name + ' carries a global phase of e^(i' + (angle / Math.PI).toFixed(6) +
        '·pi), which is off the lattice',
        'the gate itself is exact here; only the global phase convention is not. ' +
        'No measurement can see it — write the same rotation with p() and the ' +
        'circuit stays in the ring.');
    if (r) g.push(['gphase', r]);
}

var TABLE = {
    /* single-qubit, no parameters */
    id:   [1, 0, function () {}],
    h:    [1, 0, function (g, q) { g.push(['h', q[0]]); }],
    x:    [1, 0, function (g, q) { g.push(['x', q[0]]); }],
    y:    [1, 0, function (g, q) { g.push(['zpow', q[0], 8], ['x', q[0]], ['gphase', 4]); }],
    z:    [1, 0, function (g, q) { g.push(['zpow', q[0], 8]); }],
    s:    [1, 0, function (g, q) { g.push(['zpow', q[0], 4]); }],
    sdg:  [1, 0, function (g, q) { g.push(['zpow', q[0], 12]); }],
    t:    [1, 0, function (g, q) { g.push(['zpow', q[0], 2]); }],
    tdg:  [1, 0, function (g, q) { g.push(['zpow', q[0], 14]); }],
    sx:   [1, 0, function (g, q) { g.push(['h', q[0]], ['zpow', q[0], 4], ['h', q[0]]); }],
    sxdg: [1, 0, function (g, q) { g.push(['h', q[0]], ['zpow', q[0], 12], ['h', q[0]]); }],

    /* Single-qubit phases take their angle RAW so they can quantize it, or,
     * if the caller turned synthesis on, reach for a nearby exact word
     * instead of refusing. */
    p:    [1, -1, function (g, q, a, line) { emitPhase(g, q[0], a[0], line, 'p'); }],
    u1:   [1, -1, function (g, q, a, line) { emitPhase(g, q[0], a[0], line, 'u1'); }],
    /* rz(theta) = e^(-i theta/2) diag(1, e^(i theta)) -- the half-angle
     * global phase is only in the ring when k is even. Synthesis does not
     * preserve global phase anyway, so an off-lattice rz synthesizes as the
     * SU(2) rotation it is. */
    rz:   [1, -1, function (g, q, a, line) {
        var ang = a[0], k = ang / (Math.PI / 8), r = Math.round(k);
        if (Math.abs(k - r) > 1e-9 || r % 2 !== 0) {
            if (SYNTH && trySynth(g, q[0], SYNTH.mod.rzMatrix(ang), line, 'rz',
                                  (ang / Math.PI).toFixed(6) + 'pi')) return;
            if (Math.abs(k - r) > 1e-9) quantize(ang, line, 'rz');
            throw new QasmError(line,
                'rz(θ) carries a global phase of e^(-iθ/2), and half of this angle ' +
                'falls off the lattice',
                'use p(' + r + '·pi/8) instead — identical physics, and the phase ' +
                'that differs is global, which no measurement can see');
        }
        g.push(['zpow', q[0], r], ['gphase', -r / 2]);
    }],

    /* two-qubit */
    cx:   [2, 0, function (g, q) { g.push(['cx', q[0], q[1]]); }],
    CX:   [2, 0, function (g, q) { g.push(['cx', q[0], q[1]]); }],
    cnot: [2, 0, function (g, q) { g.push(['cx', q[0], q[1]]); }],
    cz:   [2, 0, function (g, q) { g.push(mcpow(q, 8)); }],
    cy:   [2, 0, function (g, q) {          /* CY = (I⊗S) · CX · (I⊗S†) */
        g.push(['zpow', q[1], 12], ['cx', q[0], q[1]], ['zpow', q[1], 4]);
    }],
    ch:   [2, 0, function (g, q) {          /* CH = (S·H·T) ⊗ CX ⊗ (T†·H·S†) on the target */
        g.push(['zpow', q[1], 4], ['h', q[1]], ['zpow', q[1], 2],
               ['cx', q[0], q[1]],
               ['zpow', q[1], 14], ['h', q[1]], ['zpow', q[1], 12]);
    }],
    swap: [2, 0, function (g, q) { g.push(['swap', q[0], q[1]]); }],
    cp:   [2, 1, function (g, q, k) { g.push(mcpow(q, k)); }],
    cu1:  [2, 1, function (g, q, k) { g.push(mcpow(q, k)); }],
    cs:   [2, 0, function (g, q) { g.push(mcpow(q, 4)); }],
    csdg: [2, 0, function (g, q) { g.push(mcpow(q, 12)); }],

    /* three-qubit */
    ccx:     [3, 0, ccx],
    toffoli: [3, 0, ccx],
    ccz:     [3, 0, function (g, q) { g.push(mcpow(q, 8)); }],
    cswap:   [3, 0, function (g, q) {
        g.push(['cx', q[2], q[1]]);
        ccx(g, [q[0], q[1], q[2]]);
        g.push(['cx', q[2], q[1]]);
    }],
    fredkin: [3, 0, function (g, q) { TABLE.cswap[2](g, q); }],

    /* OpenQASM 3 builtins, and the rotations that land on the half-pi lattice.
     * nP < 0 means |nP| RAW angles: these gates quantize their own parameters,
     * because theta and the phases live on different lattices. */
    U:      [1, -3, function (g, q, a, line) { emitU(g, q[0], a[0], a[1], a[2], line, 'U'); }],
    u:      [1, -3, function (g, q, a, line) { emitU(g, q[0], a[0], a[1], a[2], line, 'u'); }],
    u3:     [1, -3, function (g, q, a, line) {
        /* A synthesized word has whatever global phase it has, so there is
         * nothing left for the correction to correct. */
        if (emitU(g, q[0], a[0], a[1], a[2], line, 'u3')) return;
        emitGphase(g, -(a[1] + a[2] + a[0]) / 2, line, 'u3');
    }],
    u2:     [1, -2, function (g, q, a, line) {
        if (emitU(g, q[0], Math.PI / 2, a[0], a[1], line, 'u2')) return;
        emitGphase(g, -(a[0] + a[1] + Math.PI / 2) / 2, line, 'u2');
    }],
    rx:     [1, -1, function (g, q, a, line) {
        if (emitU(g, q[0], a[0], -Math.PI / 2, Math.PI / 2, line, 'rx')) return;
        emitGphase(g, -a[0] / 2, line, 'rx');
    }],
    ry:     [1, -1, function (g, q, a, line) {
        if (emitU(g, q[0], a[0], 0, 0, line, 'ry')) return;
        emitGphase(g, -a[0] / 2, line, 'ry');
    }],
    gphase: [0, 1, function (g, q, k) { g.push(['gphase', k]); }],

    /* OpenQASM 3 standard-library spellings of gates already in the table */
    phase:  [1, 1, function (g, q, k) { g.push(['zpow', q[0], k]); }],
    cphase: [2, 1, function (g, q, k) { g.push(mcpow(q, k)); }],

    /* Variadic extensions (nQ = -1): the whole operand list is one control
     * set. mcz over a register is the phase flip Grover's diffusion needs,
     * and it is one pass over the statevector -- no ancillas, no ladder. */
    mcz: [-1, 0, function (g, q) { g.push(mcpow(q, 8)); }],
    mcp: [-1, 1, function (g, q, k) { g.push(mcpow(q, k)); }],
    mcx: [-1, 0, function (g, q) {
        var tgt = q[q.length - 1];
        g.push(['h', tgt], mcpow(q, 8), ['h', tgt]);
    }]
};

/* Gates that exist in qelib1.inc but have no exact representative here. */
/* Still nothing here has an exact representative at a general angle. rx, ry,
 * u, u2 and u3 have LEFT this list: they are exact whenever theta lands on the
 * half-pi lattice, and the U decomposition refuses them by angle instead of by
 * name. What remains is the two-qubit rotations and the controlled rotations,
 * which would need a controlled RY kernel that does not exist here. */
var IRRATIONAL = {
    crx: 'crx', cry: 'cry', crz: 'crz',
    rxx: 'rxx', ryy: 'ryy', rzz: 'rzz', cu: 'cu', cu3: 'cu3'
};

/* ---- parser --------------------------------------------------------- */

function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, function (m) {
        return m.replace(/[^\n]/g, ' ');            /* keep line numbering */
    }).replace(/\/\/[^\n]*/g, '');
}

function statements(src) {
    var out = [], buf = '', line = 1, start = 1, i, ch;
    for (i = 0; i < src.length; i++) {
        ch = src[i];
        if (ch === '\n') line++;
        if (ch === ';') {
            if (buf.trim()) out.push({ text: buf.trim(), line: start });
            buf = ''; start = line + (ch === '\n' ? 1 : 0);
            continue;
        }
        if (!buf.trim() && /\s/.test(ch)) { start = line; continue; }
        buf += ch;
    }
    if (buf.trim()) out.push({ text: buf.trim(), line: start });
    return out;
}

/* "q[2]" -> [index]; "q" -> every index of that register (broadcast). */
/* Classical bits are never renumbered, so a scratch bit for reset can simply
 * live above every declared one. */
var SCRATCH_BASE = 4096;

/* A condition on classical bits: "c == 3", "c0 == 1", "int[2](syn) == 1",
 * or a bare bit. The bits come back least significant first, matching the way
 * an integer is read off a register everywhere else here. */
function parseCond(src, cregs, line) {
    var t = src.trim(), m, bits, val;
    t = t.replace(/\b(u?int|bit|bool)\s*(\[\s*\d*\s*\])?\s*\(/g, '(');
    m = /^\(?(.+?)\)?\s*(==|!=)\s*(\d+)$/.exec(t);
    if (m) {
        bits = resolve(m[1].replace(/^\(|\)$/g, '').trim(), cregs, line);
        val = parseInt(m[3], 10);
        if (m[2] === '!=') throw new QasmError(line,
            'only == is supported in a classical condition',
            'write the equalities you want as separate if statements');
        if (val >= Math.pow(2, bits.length)) throw new QasmError(line,
            'condition compares ' + bits.length + ' bit(s) against ' + val +
            ', which does not fit');
        return { bits: bits, value: val };
    }
    m = /^\(?([A-Za-z_][A-Za-z0-9_]*(\[\s*\d+\s*\])?)\)?$/.exec(t);
    if (m) {
        bits = resolve(m[1], cregs, line);
        if (bits.length !== 1) throw new QasmError(line,
            'a bare classical condition needs a single bit, not a register');
        return { bits: bits, value: 1 };
    }
    throw new QasmError(line, 'cannot read the condition "' + src.trim() + '"',
        'supported: if (c == 3), if (c0 == 1), if (int[2](syn) == 1), if (c0)');
}

function resolve(arg, regs, line) {
    var m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[\s*(\d+)\s*\])?$/.exec(arg.trim());
    if (!m) throw new QasmError(line, 'cannot read operand "' + arg.trim() + '"');
    var reg = regs[m[1]];
    if (!reg) throw new QasmError(line, 'unknown register "' + m[1] + '"');
    if (m[2] === undefined) {
        var all = [], i;
        for (i = 0; i < reg.size; i++) all.push(reg.base + i);
        return all;
    }
    var idx = parseInt(m[2], 10);
    if (idx >= reg.size) throw new QasmError(line,
        m[1] + '[' + idx + '] is out of range — ' + m[1] + ' has ' + reg.size + ' bits');
    return [reg.base + idx];
}

/* ---- OpenQASM 3 front end -------------------------------------------- *
 * Translated down to the OpenQASM 2 statement stream above rather than given
 * a second parser: the gate table, the angle lattice and the refusals are the
 * product, and there should be exactly one of each.
 *
 * What survives translation is everything that is STRUCTURE — declarations,
 * gate definitions, for-loops, compile-time conditionals, slices. What does
 * not is everything that is TIME or CONTINUUM: pulses, durations, and the
 * angles that fall off the lattice. Those are refused by name, as always. */

function q3Detect(src) {
    var s = stripComments(src);
    return /(^|\n)\s*OPENQASM\s+3/i.test(s) ||
           /stdgates\.inc/.test(s) ||
           /(^|\n)\s*(qubit|bit)\s*(\[|[A-Za-z_])/.test(s) ||
           /[πτ]/.test(s) ||                       /* the unicode pi and tau */
           /(^|\n)\s*(gate|def)\s+[^;]*\{/.test(s);
}

/* Brace-aware statement split. Returns simple statements and block
 * statements ({head, body}) with the line each one started on. */
function q3Split(src, base) {
    var out = [], buf = '', line = base || 1, start = line, depth, i, ch, head, bodyStart;
    for (i = 0; i < src.length; i++) {
        ch = src[i];
        if (ch === '\n') line++;
        if (ch === ';') {
            if (buf.trim()) out.push({ text: buf.trim(), line: start });
            buf = ''; start = line;
            continue;
        }
        if (ch === '{') {
            head = buf.trim(); buf = '';
            depth = 1; i++; bodyStart = line;
            var body = '';
            for (; i < src.length && depth > 0; i++) {
                if (src[i] === '\n') line++;
                if (src[i] === '{') depth++;
                else if (src[i] === '}') { depth--; if (!depth) break; }
                body += src[i];
            }
            if (depth > 0) throw new QasmError(start, 'unbalanced { in "' + head + '"');
            out.push({ text: head, line: start, body: body, bodyLine: bodyStart });
            start = line;
            continue;
        }
        if (ch === '}') throw new QasmError(line, 'unmatched }');
        if (!buf.trim() && /\s/.test(ch)) { start = line; continue; }
        buf += ch;
    }
    if (buf.trim()) out.push({ text: buf.trim(), line: start });
    return out;
}

/* Compile-time integer arithmetic over the loop variables and the classical
 * constants. Anything a measurement wrote is deliberately NOT in scope --
 * that is the line between unrolling and feedback. */
function q3Int(expr, env, line, what) {
    var t = expr.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*([^\]]+)\s*\]/g, function (m, nm, ix) {
        if (!(nm in env)) return m;
        var b = q3Int(ix, env, line, what);
        return String((BigInt(env[nm]) >> BigInt(b)) & 1n);       /* bit i, LSB first */
    });
    t = t.replace(/\bbool\s*\(/g, '(').replace(/\b(u?int|float)\s*(\[\s*\d+\s*\])?\s*\(/g, '(');
    t = t.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, function (m) {
        if (m === 'pi' || m === 'tau' || m === 'euler') return m;
        if (m in env) return String(env[m]);
        throw new QasmError(line, 'cannot evaluate "' + expr.trim() + '" at translation time',
            '"' + m + '" is not a compile-time constant here. ' + (what || ''));
    });
    var v = evalAngle(t, line);
    if (Math.abs(v - Math.round(v)) > 1e-9)
        throw new QasmError(line, '"' + expr.trim() + '" is not an integer (' + v + ')');
    return Math.round(v);
}

/* name, name[i], name[a:b] and name[a:step:b] -> a list of "name[k]" */
function q3Operand(arg, regs, env, line) {
    arg = arg.trim();
    var m = /^([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*([^\]]*)\s*\]$/.exec(arg), nm, size, i, out = [];
    if (!m) {
        nm = arg;
        if (!(nm in regs)) return null;
        for (i = 0; i < regs[nm]; i++) out.push(nm + '[' + i + ']');
        return out;
    }
    nm = m[1];
    if (!(nm in regs)) return null;
    size = regs[nm];
    var parts = m[2].split(':');
    if (parts.length === 1) return [nm + '[' + q3Int(parts[0], env, line) + ']'];
    var a = q3Int(parts[0], env, line);
    var step = parts.length === 3 ? q3Int(parts[1], env, line) : 1;
    var b = q3Int(parts[parts.length - 1], env, line);
    if (step === 0) throw new QasmError(line, 'a slice step of 0 never ends');
    for (i = a; step > 0 ? i <= b : i >= b; i += step) {
        if (i < 0 || i >= size) throw new QasmError(line,
            nm + '[' + i + '] is out of range — ' + nm + ' has ' + size + ' bits');
        out.push(nm + '[' + i + ']');
    }
    return out;
}

/* Everything OpenQASM 3 has that this engine has no answer for, refused by
 * name and with the reason. Nothing here is an oversight. */
var Q3_NO = {
    defcalgrammar: ['pulse-level calibration', 'oq simulates the gate layer; there is no pulse, no channel and no waveform under it'],
    defcal: ['pulse-level calibration', 'oq simulates the gate layer; there is no pulse, no channel and no waveform under it'],
    cal: ['pulse-level calibration', 'oq simulates the gate layer; there is no pulse, no channel and no waveform under it'],
    duration: ['timing', 'the state here advances by gates, not by seconds — there is no clock to hang a duration on'],
    stretch: ['timing', 'the state here advances by gates, not by seconds — there is no clock to hang a duration on'],
    delay: ['timing', 'the state here advances by gates, not by seconds — there is no clock to hang a duration on'],
    box: ['a timing box', 'the state here advances by gates, not by seconds'],
    barrier_: [null, null],
    array: ['classical arrays', 'oq compiles a circuit, it does not run a classical program alongside it'],
    /* def is handled by inlining now -- see q3Translate. */
    extern: ['external classical functions', 'nothing outside the circuit can be called from inside it'],
    input: ['runtime input parameters', 'the circuit has to be fully determined before it runs — bind the value in the source'],
    output: ['runtime output parameters', 'read the state out of the panel instead'],
    pragma: ['pragmas', 'nothing here is backend-specific'],
    while: ['unbounded loops', 'a while loop cannot be unrolled without knowing the measurement outcomes']
};

/* Identifiers may be Greek: stdgates.inc and the examples both name their
 * parameters theta, lambda and phi in the alphabet those letters came from. */
var Q3_IDENT = /[\p{L}_][\p{L}\p{N}_]*/gu;

function q3Translate(src) {
    var out = [], map = [], gdefs = {}, ddefs = {}, qregs = {}, cregs = {}, env = {}, fenv = {};
    var problems = [];
    var order = [], measured = {}, warnings = [], anyGate = false;

    function push(text, line) { out.push(text); map.push(line); }

    /* A circuit can be out of reach for more than one reason, and reporting
     * only the one the translator happened to reach first is how you send
     * someone off to rewrite their feedback when the rotation on line 11 was
     * never going to work either. Statement-level refusals are collected, the
     * statement is skipped, and the whole list comes back at the end in source
     * order. Structural errors -- a brace that does not close, a register that
     * was never declared -- still throw where they are, because everything
     * after them is guesswork. */
    function refuse(line, message, hint) {
        problems.push({ line: line, message: message, hint: hint || null });
    }

    /* Validate a gate call where it is written, so the angle on line 11 is
     * reported as line 11 and not swallowed by a later refusal. The emit runs
     * into a throwaway list; only its exceptions matter here. */
    function checkGate(name, params, line) {
        if (IRRATIONAL[name]) {
            refuse(line, name + ' has no exact representative in Z[ζ₈]',
                'continuous rotations are where float simulators start rounding. ' +
                'Express the gate over {H, S, T, CX} — universal, and exact here.');
            return false;
        }
        var te = TABLE[name];
        if (!te) return true;                  /* unknown: let the gate layer say so */
        var np = te[1], dry = [], raw, wasDry = SYNTH && SYNTH.dry;
        if (SYNTH) SYNTH.dry = true;
        try {
            if (np < 0) {
                raw = params === undefined || !params.trim() ? [] : splitTop(substConst(params));
                if (raw.length !== -np) return true;
                te[2](dry, [0, 0, 0], raw.map(function (a) { return evalAngle(a, line); }), line);
            } else if (np) {
                if (params === undefined) return true;
                te[2](dry, [0, 0, 0], quantize(evalAngle(substConst(params), line), line, name), line);
            }
        } catch (e) {
            if (e.name !== 'QasmError') throw e;
            refuse(line, e.message, e.hint);
            return false;
        } finally { if (SYNTH) SYNTH.dry = wasDry; }
        return true;
    }

    /* Angle constants back into an angle expression, verbatim. */
    function substConst(t) {
        return t.replace(Q3_IDENT, function (w) {
            return Object.prototype.hasOwnProperty.call(fenv, w) ? fenv[w] : w;
        });
    }

    function emitCall(name, params, operands, line, depth) {
        if (depth > 32) throw new QasmError(line, 'gate definitions nested more than 32 deep');
        var g = gdefs[name], i, j, sub, argNames, args = [], flat;
        if (!g) return false;
        /* operands may be registers; broadcast the way the gate layer does */
        argNames = operands.split(',').map(function (a) { return q3Operand(a, qregs, env, line) || [a.trim()]; });
        var width = 1;
        for (i = 0; i < argNames.length; i++) if (argNames[i].length > 1) width = argNames[i].length;
        var pv = params === undefined || !params.trim() ? [] : splitTop(params);
        if (pv.length !== g.params.length) throw new QasmError(line,
            name + ' takes ' + g.params.length + ' parameter(s), got ' + pv.length);
        for (var w = 0; w < width; w++) {
            sub = {};
            for (i = 0; i < g.args.length; i++)
                sub[g.args[i]] = argNames[i].length === 1 ? argNames[i][0] : argNames[i][w];
            for (i = 0; i < g.params.length; i++) sub[g.params[i]] = '(' + pv[i] + ')';
            for (j = 0; j < g.body.length; j++) walk(substitute(g.body[j], sub), line, depth + 1);
        }
        return true;
    }

    /* Textual substitution on a gate body, on whole identifiers only. */
    function substitute(st, sub) {
        function one(t) {
            return t.replace(Q3_IDENT, function (m) {
                return Object.prototype.hasOwnProperty.call(sub, m) ? sub[m] : m;
            });
        }
        return { text: one(st.text), body: st.body === undefined ? undefined : one(st.body),
                 line: st.line };
    }

    function walk(st, callerLine, depth) {
        var text = st.text, line = st.line || callerLine, m, i;
        if (!text) return;

        if (/^OPENQASM\b/i.test(text)) return;
        if (/^include\b/i.test(text)) return;                 /* stdgates is the table below */
        if (/^barrier\b/i.test(text)) return;

        /* declarations */
        m = /^(?:const\s+)?qubit\s*(?:\[\s*([^\]]+)\s*\])?\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(text);
        if (m) {
            var qs = m[1] === undefined ? 1 : q3Int(m[1], env, line);
            if (anyGate) throw new QasmError(line, 'qubit registers must all be declared before the first gate');
            qregs[m[2]] = qs; order.push(m[2]);
            push('qreg ' + m[2] + '[' + qs + '];', line);
            return;
        }
        m = /^(?:const\s+)?bit\s*(?:\[\s*([^\]]+)\s*\])?\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*=.*)?$/i.exec(text);
        if (m) {
            var cs = m[1] === undefined ? 1 : q3Int(m[1], env, line);
            /* An inlined subroutine declares its own local bit register, and
             * the binding has already aliased it to the caller's. Declaring it
             * again would shadow the alias. */
            if (cregs[m[2]] !== undefined) return;
            cregs[m[2]] = cs;
            push('creg ' + m[2] + '[' + cs + '];', line);
            return;
        }
        /* Compile-time classical constants. int and uint become numbers the
         * loop and index arithmetic can use; angle and float are kept as the
         * EXPRESSION the user wrote and substituted back verbatim, so 3*pi/8
         * reaches the lattice check as 3*pi/8 and not as 1.178. */
        m = /^(?:const\s+)?(u?int|float|angle)\s*(?:\[\s*[^\]]*\s*\])?\s+([\p{L}_][\p{L}\p{N}_]*)\s*=\s*(.+)$/iu.exec(text);
        if (m) {
            if (/^u?int$/i.test(m[1])) env[m[2]] = q3Int(m[3], env, line);
            else fenv[m[2]] = '(' + substConst(m[3]) + ')';
            return;
        }

        /* reset: free at the top, because the state starts there anyway */
        if (/^reset\b/i.test(text)) {
            /* Before any gate this is free: the state starts in |0..0>.
             * After one it is measure-and-correct, which the gate layer
             * now knows how to do, so hand it down instead of refusing. */
            if (anyGate) { push(text + ';', line); return; }
            if (false) refuse(line,
                'mid-circuit reset is not a unitary',
                'a reset before any gate is free — the state starts in |0..0> — but once ' +
                'the circuit has begun, resetting means measuring and discarding, which ' +
                'needs mid-circuit measurement');
            return;
        }

        /* measurement, in both spellings, with slices on either side */
        m = /^([A-Za-z_][A-Za-z0-9_]*(?:\s*\[[^\]]*\])?)\s*=\s*measure\s+(.+)$/i.exec(text);
        if (!m) { var mm = /^measure\s+(.+?)\s*->\s*(.+)$/i.exec(text); if (mm) m = [null, mm[2], mm[1]]; }
        if (m) {
            var cbits = q3Operand(m[1], cregs, env, line), qbits = q3Operand(m[2], qregs, env, line);
            if (!cbits) throw new QasmError(line, 'unknown classical register "' + m[1].trim() + '"');
            if (!qbits) throw new QasmError(line, 'unknown quantum register "' + m[2].trim() + '"');
            if (cbits.length !== qbits.length) throw new QasmError(line,
                'measure maps ' + qbits.length + ' qubits onto ' + cbits.length + ' classical bits');
            for (i = 0; i < qbits.length; i++) {
                measured[cbits[i].replace(/\[.*/, '')] = line;
                push('measure ' + qbits[i] + ' -> ' + cbits[i] + ';', line);
            }
            return;
        }

        /* refusals, by name */
        var head = (/^([A-Za-z_][A-Za-z0-9_]*)/.exec(text) || [])[1];
        /* These DEFINE things -- an array, a subroutine, a duration. Skipping
         * one and carrying on means every later use of the name it introduced
         * produces a worse error than the real one, so this class throws where
         * it stands. */
        if (head && Q3_NO[head] && Q3_NO[head][0]) throw new QasmError(line,
            Q3_NO[head][0] + ' (' + head + ') has no meaning in an exact statevector',
            Q3_NO[head][1]);
        if (/@/.test(text) && /^(ctrl|negctrl|inv|pow)\b/.test(text)) return refuse(line,
            'gate modifiers (ctrl @, inv @, pow @) are not supported yet',
            'write the controlled or inverted form directly — cx, cz, cp, ccx, sdg, tdg ' +
            'are all in the table');

        /* gate definition */
        m = /^gate\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(.*)$/i.exec(text);
        if (m && st.body !== undefined) {
            gdefs[m[1]] = {
                params: m[2] === undefined || !m[2].trim() ? [] : splitTop(m[2]).map(function (s) { return s.trim(); }),
                args: m[3].trim() ? splitTop(m[3]).map(function (s) { return s.trim(); }) : [],
                body: q3Split(st.body, st.bodyLine || line)
            };
            return;
        }

        /* def name(params) -> bit[n] { body } -- a subroutine that measures
         * inside it and hands the outcome back. Inlined, exactly like a gate
         * definition, with one extra binding: the local register it returns is
         * aliased to whatever the caller assigned it to, so "return b" needs
         * no machinery of its own. */
        m = /^def\s+([\p{L}_][\p{L}\p{N}_]*)\s*\(([^)]*)\)/iu.exec(text);
        if (m && st.body !== undefined) {
            var dps = m[2].trim() ? splitTop(m[2]).map(function (x) {
                var w = x.trim().split(/\s+/); return w[w.length - 1];
            }) : [];
            ddefs[m[1]] = { params: dps, body: q3Split(st.body, st.bodyLine || line) };
            return;
        }
        if (/^return\b/i.test(text)) return;      /* handled by the caller binding */

        m = /^([\p{L}_][\p{L}\p{N}_]*)\s*=\s*([\p{L}_][\p{L}\p{N}_]*)\s*\((.*)\)$/u.exec(text);
        if (m && ddefs[m[2]]) {
            var dd = ddefs[m[2]], dargs = m[3].trim() ? splitTop(m[3]).map(function (x) { return x.trim(); }) : [];
            if (dargs.length !== dd.params.length) throw new QasmError(line,
                m[2] + ' takes ' + dd.params.length + ' argument(s), got ' + dargs.length);
            var dsub = {}, di;
            for (di = 0; di < dd.params.length; di++) dsub[dd.params[di]] = dargs[di];
            /* whatever the body returns is the caller's register */
            for (di = 0; di < dd.body.length; di++) {
                var rm = /^return\s+([\p{L}_][\p{L}\p{N}_]*)/u.exec(dd.body[di].text);
                if (rm) { dsub[rm[1]] = m[1]; break; }
            }
            for (di = 0; di < dd.body.length; di++) walk(substitute(dd.body[di], dsub), line, depth + 1);
            return;
        }

        /* for uint i in [a:b] { } and [a:step:b] */
        m = /^for\s+(?:\w+(?:\[[^\]]*\])?\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+in\s*\[\s*([^\]]+)\s*\]$/i.exec(text);
        if (m && st.body !== undefined) {
            var pr = m[2].split(':');
            var a = q3Int(pr[0], env, line);
            var stp = pr.length === 3 ? q3Int(pr[1], env, line) : 1;
            var b = q3Int(pr[pr.length - 1], env, line);
            if (stp === 0) throw new QasmError(line, 'a for-loop step of 0 never ends');
            var inner = q3Split(st.body, st.bodyLine || line), had = m[1] in env, old = env[m[1]];
            for (var v = a; stp > 0 ? v <= b : v >= b; v += stp) {
                env[m[1]] = v;
                for (i = 0; i < inner.length; i++) walk(inner[i], line, depth);
            }
            if (had) env[m[1]] = old; else delete env[m[1]];
            return;
        }

        /* if: a compile-time condition is unrolling, a measured one is feedback */
        var q3if = splitIf(text);
        if (q3if) {
            var cond = q3if.cond, taken;
            m = [null, q3if.cond, q3if.rest];
            try { taken = q3Int(cond, env, line) !== 0; }
            catch (e) {
                /* Not a compile-time condition, so it reads something a
                 * measurement wrote: emit it as a RUNTIME branch. Each
                 * statement of the block gets the condition prefixed on its
                 * own, which is the same thing -- classical bits do not change
                 * inside the block. */
                var mark = out.length, bi, blk2;
                if (st.body !== undefined) {
                    blk2 = q3Split(st.body, st.bodyLine || line);
                    for (bi = 0; bi < blk2.length; bi++) walk(blk2[bi], line, depth);
                } else if (m[2].trim()) walk({ text: m[2].trim(), line: line }, line, depth);
                for (bi = mark; bi < out.length; bi++)
                    out[bi] = 'if (' + cond.trim() + ') ' + out[bi];
                return;
            }
            if (false) {
                refuse(line,
                    'classical control on a measurement is not supported yet',
                    'this branch depends on a bit a measurement wrote, so the circuit is ' +
                    'not fixed before it runs. oq applies the whole circuit and reads the ' +
                    'exact state at the end; feeding an outcome back in mid-circuit is a ' +
                    'different execution model. A condition on compile-time constants ' +
                    'does work — it is unrolled.');
            }
            if (!taken) return;
            if (st.body !== undefined) {
                var blk = q3Split(st.body, st.bodyLine || line);
                for (i = 0; i < blk.length; i++) walk(blk[i], line, depth);
            } else if (m[2].trim()) walk({ text: m[2].trim(), line: line }, line, depth);
            return;
        }

        /* U, gphase and every rotation fall through to the gate table below */

        /* a call: user gate first, then the built-in table */
        var call = splitCall(text);
        if (!call) throw new QasmError(line, 'cannot read statement "' + text + '"');
        if (gdefs[call.name]) {
            anyGate = true;
            if (emitCall(call.name, call.params, call.operands, line, depth)) return;
        }

        /* fall through to the OpenQASM 2 gate layer, with operands normalized */
        var opsrc = call.operands;
        if (call.name !== 'gphase' && !opsrc.trim())
            throw new QasmError(line, 'unknown statement "' + text + '"');
        /* Broadcast here rather than downstream. A bare register and a slice
         * both stand for several qubits, and expanding them into a comma list
         * would hand a one-qubit gate four operands instead of running it four
         * times. Zip them the way the gate layer does: every operand is either
         * a single qubit or the full width. */
        var argv = opsrc.trim() ? splitTop(opsrc).map(function (a) {
            return q3Operand(a, qregs, env, line) || [a.trim()];
        }) : [];
        anyGate = true;
        if (!checkGate(call.name, call.params, line)) return;   /* reported where written */
        var ptxt = call.params !== undefined ? '(' + substConst(call.params) + ')' : '';

        /* mcz, mcx and mcp are variadic: the whole operand list is ONE control
         * set, so it must not be broadcast apart. */
        var te = TABLE[call.name];
        if (te && te[0] === -1) {
            var flatq = [];
            for (var fi = 0; fi < argv.length; fi++) flatq = flatq.concat(argv[fi]);
            push(call.name + ptxt + ' ' + flatq.join(',') + ';', line);
            return;
        }

        var width = 1, ai;
        for (ai = 0; ai < argv.length; ai++) {
            if (argv[ai].length > 1) {
                if (width > 1 && width !== argv[ai].length) throw new QasmError(line,
                    'operands of different widths cannot be broadcast together');
                width = argv[ai].length;
            }
        }
        for (var wq = 0; wq < width; wq++) {
            var sel = argv.map(function (a) { return a.length === 1 ? a[0] : a[wq]; });
            push(call.name + ptxt + (sel.length ? ' ' + sel.join(',') : '') + ';', line);
        }
    }

    var stmts = q3Split(stripComments(src), 1);
    try {
        for (var s3 = 0; s3 < stmts.length; s3++) walk(stmts[s3], stmts[s3].line, 0);
    } catch (e) {
        /* A hard error AFTER something was already refused is usually a
         * consequence of skipping it, not an independent fact. Report what was
         * actually wrong first, and let the reader get there before inventing
         * a second problem for them. */
        if (!problems.length) throw e;
    }

    /* Report the first reason, and say what else is waiting behind it. */
    if (problems.length) {
        problems.sort(function (a, b) { return a.line - b.line; });
        var first = problems[0], rest = problems.slice(1), hint = first.hint || '', i;
        if (rest.length) {
            hint += (hint ? '\n\n' : '') + 'And ' + rest.length + ' more ' +
                    (rest.length === 1 ? 'reason' : 'reasons') +
                    ' this circuit cannot run as written:';
            for (i = 0; i < rest.length && i < 6; i++)
                hint += '\n  line ' + rest[i].line + ': ' + rest[i].message;
            if (rest.length > 6) hint += '\n  … and ' + (rest.length - 6) + ' more';
        }
        throw new QasmError(first.line, first.message, hint || null);
    }
    return { text: out.join('\n'), map: map, warnings: warnings };
}

var MAX_QUBITS = 26;      /* 2^26 int32 amplitudes = 1.07 GB in Z[ζ₈] */

/* Past the dense cap a circuit is not automatically out of reach: if it never
 * builds a wide superposition, the sparse backend carries only the amplitudes
 * that are actually non-zero and n stops mattering. This is the ceiling on
 * that, and it is a sanity bound on the qubit INDEX, not on the work. */
var SPARSE_MAX_QUBITS = 4096;
var SPARSE_CAP = 1 << 21;          /* live amplitudes the sparse map will hold */

/* How wide can the support get? Every gate here is a permutation of the basis
 * index or a diagonal phase except H, and H at most doubles it. So the bound
 * is 2^(H count), capped by 2^n -- and Toffolis do not count, because the
 * sparse backend fuses H·MCZ(π)·H back into the permutation it always was. */
function sparsePlan(gates, n) {
    var i = 0, h = 0, a, b, c;
    /* A conditional block can hold Hadamards too. */
    for (i = 0; i < gates.length; i++)
        if (gates[i][0] === 'if') return Math.pow(2, n);      /* do not guess: assume dense */
    i = 0;
    while (i < gates.length) {
        a = gates[i]; b = gates[i + 1]; c = gates[i + 2];
        if (a && b && c && a[0] === 'h' && c[0] === 'h' && b[0] === 'mcpow' &&
            a[1] === c[1] && (((b[2] % 8) + 8) % 8) === 4 &&
            b[3] && b[3].indexOf(a[1]) >= 0) { i += 3; continue; }
        if (a[0] === 'h') h++;
        i++;
    }
    return Math.min(Math.pow(2, h), Math.pow(2, n));
}

function parse2(src) {
    var stmts = statements(stripComments(src));
    var qregs = {}, cregs = {}, nq = 0, nc = 0;
    var gates = [], measures = [], warnings = [], si, st;
    var dynamic = false, scratchBits = 0;

    /* One statement, emitted into a gate list. Pulled out of the loop so an
     * if-block can run it too: classical control applies the same statement
     * machinery, only conditionally. */
    function doStatement(text, line, gates) {
        var m, i;

            if (/^OPENQASM\b/i.test(text) || /^include\b/i.test(text)) return;

            var m = /^(qreg|creg)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*(\d+)\s*\]$/.exec(text);
            if (m) {
                var size = parseInt(m[3], 10);
                if (size < 1) throw new QasmError(line, 'register size must be at least 1');
                if (m[1] === 'qreg') {
                    if (qregs[m[2]]) throw new QasmError(line, 'register "' + m[2] + '" already declared');
                    qregs[m[2]] = { base: nq, size: size };
                    nq += size;
                    /* Only the index ceiling is enforced here. Whether this many
                     * qubits is actually runnable depends on how wide the
                     * superposition gets, and that is not known until the whole
                     * gate list has been read — see the backend choice below. */
                    if (nq > SPARSE_MAX_QUBITS) throw new QasmError(line,
                        nq + ' qubits — this page caps the qubit index at ' + SPARSE_MAX_QUBITS,
                        'past the dense cap of ' + MAX_QUBITS + ' a circuit still runs if it ' +
                        'stays sparse, but the index has to stop somewhere. ' +
                        'The native engine has no such cap.');
                } else {
                    cregs[m[2]] = { base: nc, size: size };
                    nc += size;
                }
                return;
            }

            if (/^barrier\b/i.test(text)) return;

            if (/^(gate|opaque)\b/i.test(text)) throw new QasmError(line,
                'custom gate definitions are not supported yet',
                'inline the body — every gate in it must be from the exact set anyway');

            /* ---- classical control ------------------------------------ *
             * if (c == v) <statement>. The condition reads bits a measurement
             * wrote, so the circuit is not fixed before it runs -- which is
             * the point of a dynamic circuit, and the reason the state it
             * produces belongs to one trajectory rather than to the circuit. */
            var iff = splitIf(text);
            if (iff && iff.rest) {
                var cnd = parseCond(iff.cond, cregs, line), sub = [];
                doStatement(iff.rest, line, sub);
                if (sub.length) gates.push(['if', cnd, sub]);
                dynamic = true;
                return;
            }

            /* reset is measure-and-correct: not unitary, but perfectly
             * definite once mid-circuit measurement exists. The bit it
             * measures into is scratch and the program never reads it. */
            m = /^reset\s+(.+)$/i.exec(text);
            if (m) {
                var rq = resolve(m[1], qregs, line), ri, scratch;
                for (ri = 0; ri < rq.length; ri++) {
                    scratch = SCRATCH_BASE + scratchBits++;
                    gates.push(['measure', rq[ri], scratch]);
                    gates.push(['if', { bits: [scratch], value: 1 }, [['x', rq[ri]]]]);
                }
                dynamic = true;
                return;
            }

            m = /^measure\s+(.+?)\s*->\s*(.+)$/i.exec(text);
            if (m) {
                var qs = resolve(m[1], qregs, line), cs = resolve(m[2], cregs, line), i;
                if (qs.length !== cs.length) throw new QasmError(line,
                    'measure maps ' + qs.length + ' qubits onto ' + cs.length + ' classical bits');
                /* Recorded twice, deliberately. A circuit with no classical
                 * control uses `measures` and samples the final state, which
                 * is the cheap and exact thing to do. One WITH control has to
                 * collapse where the measurement stands, so the same
                 * measurement is also a gate; which of the two the page uses
                 * is decided at the end, once it is known whether any
                 * condition reads a measured bit. */
                for (i = 0; i < qs.length; i++) {
                    measures.push({ q: qs[i], c: cs[i] });
                    gates.push(['measure', qs[i], cs[i]]);
                }
                return;
            }

            /* name(params) operands */
            var call = splitCall(text);
            if (!call) throw new QasmError(line, 'cannot read statement "' + text + '"');
            var name = call.name, params = call.params, operands = call.operands;

            if (IRRATIONAL[name]) throw new QasmError(line,
                name + ' has no exact representative in Z[ζ₈]',
                'continuous rotations are where float simulators start rounding. ' +
                'Express the gate over {H, S, T, CX} — universal, and exact here.');

            var entry = TABLE[name];
            if (!entry) throw new QasmError(line, 'unknown gate "' + name + '"',
                'supported: ' + Object.keys(TABLE).sort().join(' '));

            var nQ = entry[0], nP = entry[1], emit = entry[2];
            var k = 0;
            if (nP < 0) {
                /* raw angles -- these gates quantize their own, because theta and
                 * the phases do not live on the same lattice */
                var raw = params === undefined || !params.trim() ? [] : splitTop(params);
                if (raw.length !== -nP) throw new QasmError(line,
                    name + ' takes ' + (-nP) + ' angle(s), got ' + raw.length);
                k = raw.map(function (a) { return evalAngle(a, line); });
            } else if (nP) {
                if (params === undefined) throw new QasmError(line, name + ' takes an angle, e.g. ' + name + '(pi/4)');
                k = quantize(evalAngle(params, line), line, name);
            } else if (params !== undefined && params.trim()) {
                throw new QasmError(line, name + ' takes no parameters');
            }

            if (nQ === 0) {                       /* gphase: acts on the whole state */
                if (operands.trim()) throw new QasmError(line, name + ' takes no qubit operands');
                emit(gates, [], k, line);
                return;
            }

            if (!operands.trim()) throw new QasmError(line, name + ' needs qubit operand(s)');
            var argv = operands.split(',').map(function (a) { return resolve(a, qregs, line); });

            if (nQ === -1) {
                /* variadic: every operand, register or bit, joins one control set */
                var flat = [], fi, fj, seenV = {};
                for (fi = 0; fi < argv.length; fi++) for (fj = 0; fj < argv[fi].length; fj++) {
                    if (seenV[argv[fi][fj]]) throw new QasmError(line, name + ' uses the same qubit twice');
                    seenV[argv[fi][fj]] = 1;
                    flat.push(argv[fi][fj]);
                }
                if (flat.length < 2) throw new QasmError(line, name + ' needs at least 2 qubits');
                emit(gates, flat, k, line);
                return;
            }

            if (argv.length !== nQ) throw new QasmError(line,
                name + ' takes ' + nQ + ' qubit operand(s), got ' + argv.length);

            /* Register broadcast: h q; over a 3-bit register is three gates. */
            var width = 1, ai;
            for (ai = 0; ai < argv.length; ai++) {
                if (argv[ai].length > 1) {
                    if (width > 1 && width !== argv[ai].length) throw new QasmError(line,
                        'register operands of different sizes cannot be broadcast together');
                    width = argv[ai].length;
                }
            }
            var w, qsel;
            for (w = 0; w < width; w++) {
                qsel = argv.map(function (a) { return a.length === 1 ? a[0] : a[w]; });
                var seen = {}, qi;
                for (qi = 0; qi < qsel.length; qi++) {
                    if (seen[qsel[qi]]) throw new QasmError(line, name + ' uses the same qubit twice');
                    seen[qsel[qi]] = 1;
                }
                emit(gates, qsel, k, line);
            }
    }

    for (si = 0; si < stmts.length; si++) {
        st = stmts[si];
        doStatement(st.text, st.line, gates);
    }

    if (nq === 0) throw new QasmError(1, 'no qreg declared',
        'start with: OPENQASM 2.0; include "qelib1.inc"; qreg q[2];');

    /* Which ring does this circuit actually need? Phases are counted in
     * sixteenths above; if every one of them is even, the circuit lives in
     * Z[ζ₈] and the exponents are halved so the smaller, faster engine can
     * run it. Same decision the C core makes when it sizes a limb count --
     * take the narrowest representation that is still exact. */
    /* Both of these have to walk INTO an if-block. A phase inside a classical
     * branch is still a phase: it decides the ring the same way, and it needs
     * halving the same way. Missing that leaves a conditional Z sitting at
     * k = 8 sixteenths, which in Z[zeta_8] is zeta^8 = 1 -- the correction
     * silently becomes the identity, and a teleported qubit comes back wrong
     * in exactly the two branches that needed it. */
    var ring = 8, oddPhase = false, oddGlobal = false;
    function scanPhases(list) {
        var gi, ge;
        for (gi = 0; gi < list.length; gi++) {
            ge = list[gi];
            if (ge[0] === 'if') { scanPhases(ge[2]); continue; }
            if (ge[0] === 'zpow' || ge[0] === 'mcpow') { if (ge[2] % 2 !== 0) oddPhase = true; }
            else if (ge[0] === 'gphase') { if (ge[1] % 2 !== 0) oddGlobal = true; }
        }
    }
    scanPhases(gates);
    /* A global phase can drag a circuit into the bigger ring all by itself --
     * rz(pi/4) does exactly that, and the warning below has always said so. For
     * a DYNAMIC circuit that is the difference between running and not, because
     * collapse lives in Z[zeta_8] only. Since no measurement can see a global
     * phase, drop the ones that fall off the lattice and say so out loud. */
    if (oddGlobal && !oddPhase && dynamic) {
        (function dropOddGlobal(list) {
            var gi;
            for (gi = list.length - 1; gi >= 0; gi--) {
                if (list[gi][0] === 'if') { dropOddGlobal(list[gi][2]); continue; }
                if (list[gi][0] === 'gphase' && list[gi][1] % 2 !== 0) list.splice(gi, 1);
            }
        }(gates));
        oddGlobal = false;
        warnings.push('this circuit is dynamic, and the only thing asking for Z[ζ₁₆] was ' +
            'a global phase (rz carries one). Those phases have been DROPPED so the ' +
            'circuit can run in Z[ζ₈], where mid-circuit measurement lives. No ' +
            'measurement can see the difference — but the fingerprint can, so it is ' +
            'not the fingerprint of the circuit exactly as written.');
    }
    if (oddPhase || oddGlobal) ring = 16;
    /* Worth saying out loud: a global phase costs nothing physically but can
     * still drag the circuit into the bigger, slower ring. rz does this; p
     * does not. */
    /* The bigger ring doubles the state, so the qubit ceiling comes down with
     * it — 2^24 amplitudes at 32 bytes each is over half a gigabyte. */
    if (ring === 16 && nq > 22) throw new QasmError(1,
        nq + ' qubits in Z[ζ₁₆] — the bigger ring caps at 22',
        'Z[ζ₁₆] carries eight integers per amplitude, so 2^' + nq + ' of them is ' +
        Math.round(Math.pow(2, nq) * 32 / 1048576) + ' MB. Keep the phases on the π/4 ' +
        'lattice and the same circuit fits in Z[ζ₈] at half that.');
    if (oddGlobal && !oddPhase) warnings.push(
        'this circuit needs Z[ζ₁₆] only for a global phase (rz carries one) — ' +
        'writing those rotations as p() keeps it in Z[ζ₈], which is half the ' +
        'memory and faster, and no measurement can tell the difference');
    function halvePhases(list) {
        var gi, ge;
        for (gi = 0; gi < list.length; gi++) {
            ge = list[gi];
            if (ge[0] === 'if') { halvePhases(ge[2]); continue; }
            if (ge[0] === 'zpow' || ge[0] === 'mcpow') ge[2] = ge[2] / 2;
            else if (ge[0] === 'gphase') ge[1] = ge[1] / 2;
        }
    }
    if (ring === 8) halvePhases(gates);

    /* Which container? Dense stores 2^n amplitudes whatever the circuit does
     * with them; sparse stores only the non-zero ones and pays BigInt prices
     * per amplitude. Take dense unless sparse is holding far less — and past
     * the dense cap, take sparse or refuse with the reason. */
    var backend = 'dense', bound = Infinity;
    if (ring === 8) {
        bound = sparsePlan(gates, nq);
        if (nq > MAX_QUBITS) {
            if (bound > SPARSE_CAP) throw new QasmError(1,
                nq + ' qubits with a superposition up to 2^' +
                Math.round(Math.log2(bound)) + ' wide — past both engines',
                'the dense engine caps at ' + MAX_QUBITS + ' qubits, and the sparse one ' +
                'carries at most ' + SPARSE_CAP + ' live amplitudes. A circuit this ' +
                'size runs here only if it stays sparse: permutations (x, cx, ccx, ' +
                'mcx, swap) and phases cost nothing, and it is the Hadamards that ' +
                'open the support. This one has enough of them to fill it.');
            backend = 'sparse';
        } else if (bound * 64 <= Math.pow(2, nq)) {
            backend = 'sparse';
        }
    } else if (nq > MAX_QUBITS) {
        throw new QasmError(1,
            nq + ' qubits in Z[ζ₁₆] — the sparse backend is Z[ζ₈] only',
            'keep the phases on the π/4 lattice and this circuit runs sparse in ' +
            'the smaller ring.');
    }

    /* No condition reads a measured bit, so nothing depends on an outcome and
     * the measurements can stay where they have always been: at the end, as a
     * sampling step over the finished state. Strictly cheaper, and it keeps
     * every circuit that worked before byte-identical. */
    if (!dynamic) gates = gates.filter(function (g) { return g[0] !== 'measure'; });
    if (dynamic && ring === 16) throw new QasmError(1,
        'a dynamic circuit in Z[ζ₁₆] — mid-circuit measurement is Z[ζ₈] only',
        'collapse and the carried norm are implemented in the smaller ring. ' +
        'Keep the phases on the π/4 lattice and the same circuit runs.');

    return {
        n: nq, nc: nc, qregs: qregs, cregs: cregs, ring: ring,
        gates: gates, measures: measures, warnings: warnings,
        backend: backend, supportBound: bound,
        dynamic: dynamic
    };
}

/* One entry point. OpenQASM 3 is translated down and then goes through the
 * same gate layer, the same lattice check and the same refusals; a line
 * number that comes back out of that layer is carried back to the line the
 * user actually wrote. */
function parse(src, opts) {
    /* Synthesis is off unless the caller hands over the module AND says so.
     * Off is not a limitation to apologise for: it is the difference between
     * running the circuit that was written and running one near it. */
    var prev = SYNTH;
    SYNTH = (opts && opts.synth) ? { mod: opts.synth, log: [],
                                     eps: opts.eps === undefined ? 1e-3 : opts.eps } : null;
    var mine = SYNTH;
    try {
        var r;
        if (!q3Detect(src)) r = parse2(src);
        else {
            var tr = q3Translate(src);
            try { r = parse2(tr.text); }
            catch (e) {
                if (e.name === 'QasmError' && tr.map[e.line - 1] !== undefined)
                    e.line = tr.map[e.line - 1];
                throw e;
            }
            r.qasm3 = true;
            r.translated = tr.text;
            /* The synthesis log records the line it was emitted at, which is a
             * line of the TRANSLATED text. Carry it back the same way errors
             * are carried back, or it points at the wrong statement. */
            if (mine) {
                var li;
                for (li = 0; li < mine.log.length; li++)
                    if (tr.map[mine.log[li].line - 1] !== undefined)
                        mine.log[li].line = tr.map[mine.log[li].line - 1];
            }
        }
        if (mine && mine.log.length) {
            mine.log.sort(function (a, b) { return a.line - b.line; });
            r.synthesis = mine.log;
            r.synthEps = mine.eps;
            /* worst case over every substitution, which is what the page has
             * to quote: the circuit as a whole is no closer than this */
            var worst = 0, i;
            for (i = 0; i < mine.log.length; i++)
                if (mine.log[i].err > worst) worst = mine.log[i].err;
            r.synthWorst = worst;
        }
        return r;
    } finally { SYNTH = prev; }
}

return { parse: parse, parse2: parse2, QasmError: QasmError, TABLE: TABLE,
         MAX_QUBITS: MAX_QUBITS, SPARSE_MAX_QUBITS: SPARSE_MAX_QUBITS,
         SPARSE_CAP: SPARSE_CAP, sparsePlan: sparsePlan,
         q3Detect: q3Detect, q3Translate: q3Translate };
});
