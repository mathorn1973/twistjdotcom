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

    function term() {
        var v = primary();
        for (;;) {
            skip();
            if (src[i] === '*') { i++; v *= primary(); }
            else if (src[i] === '/') { i++; v /= primary(); }
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

function mask(qs) {
    var m = 0, i;
    for (i = 0; i < qs.length; i++) m |= (1 << qs[i]);
    return m;
}

function ccx(g, q) {                       /* Toffoli = H · CCZ · H */
    g.push(['h', q[2]], ['mcpow', mask(q), 8], ['h', q[2]]);
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

    /* single-qubit phase, parameterized */
    p:    [1, 1, function (g, q, k) { g.push(['zpow', q[0], k]); }],
    u1:   [1, 1, function (g, q, k) { g.push(['zpow', q[0], k]); }],
    /* rz(theta) = e^(-i theta/2) diag(1, e^(i theta)) -- the half-angle
     * global phase is only in the ring when k is even. */
    rz:   [1, 1, function (g, q, k, line) {
        if (k % 2 !== 0) throw new QasmError(line,
            'rz(θ) carries a global phase of e^(-iθ/2), and half of this angle ' +
            'falls off the lattice',
            'use p(' + k + '·pi/8) instead — identical physics, and the phase ' +
            'that differs is global, which no measurement can see');
        g.push(['zpow', q[0], k], ['gphase', -k / 2]);
    }],

    /* two-qubit */
    cx:   [2, 0, function (g, q) { g.push(['cx', q[0], q[1]]); }],
    CX:   [2, 0, function (g, q) { g.push(['cx', q[0], q[1]]); }],
    cnot: [2, 0, function (g, q) { g.push(['cx', q[0], q[1]]); }],
    cz:   [2, 0, function (g, q) { g.push(['mcpow', mask(q), 8]); }],
    cy:   [2, 0, function (g, q) {          /* CY = (I⊗S) · CX · (I⊗S†) */
        g.push(['zpow', q[1], 12], ['cx', q[0], q[1]], ['zpow', q[1], 4]);
    }],
    ch:   [2, 0, function (g, q) {          /* CH = (S·H·T) ⊗ CX ⊗ (T†·H·S†) on the target */
        g.push(['zpow', q[1], 4], ['h', q[1]], ['zpow', q[1], 2],
               ['cx', q[0], q[1]],
               ['zpow', q[1], 14], ['h', q[1]], ['zpow', q[1], 12]);
    }],
    swap: [2, 0, function (g, q) { g.push(['swap', q[0], q[1]]); }],
    cp:   [2, 1, function (g, q, k) { g.push(['mcpow', mask(q), k]); }],
    cu1:  [2, 1, function (g, q, k) { g.push(['mcpow', mask(q), k]); }],
    cs:   [2, 0, function (g, q) { g.push(['mcpow', mask(q), 4]); }],
    csdg: [2, 0, function (g, q) { g.push(['mcpow', mask(q), 12]); }],

    /* three-qubit */
    ccx:     [3, 0, ccx],
    toffoli: [3, 0, ccx],
    ccz:     [3, 0, function (g, q) { g.push(['mcpow', mask(q), 8]); }],
    cswap:   [3, 0, function (g, q) {
        g.push(['cx', q[2], q[1]]);
        ccx(g, [q[0], q[1], q[2]]);
        g.push(['cx', q[2], q[1]]);
    }],
    fredkin: [3, 0, function (g, q) { TABLE.cswap[2](g, q); }],

    /* Variadic extensions (nQ = -1): the whole operand list is one control
     * set. mcz over a register is the phase flip Grover's diffusion needs,
     * and it is one pass over the statevector -- no ancillas, no ladder. */
    mcz: [-1, 0, function (g, q) { g.push(['mcpow', mask(q), 8]); }],
    mcp: [-1, 1, function (g, q, k) { g.push(['mcpow', mask(q), k]); }],
    mcx: [-1, 0, function (g, q) {
        var tgt = q[q.length - 1];
        g.push(['h', tgt], ['mcpow', mask(q), 8], ['h', tgt]);
    }]
};

/* Gates that exist in qelib1.inc but have no exact representative here. */
var IRRATIONAL = {
    rx: 'rx', ry: 'ry', u: 'u', u2: 'u2', u3: 'u3', crx: 'crx', cry: 'cry',
    crz: 'crz', rxx: 'rxx', ryy: 'ryy', rzz: 'rzz', cu: 'cu', cu3: 'cu3'
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

var MAX_QUBITS = 26;      /* 2^26 int32 amplitudes = 1.07 GB in Z[ζ₈] */

function parse(src) {
    var stmts = statements(stripComments(src));
    var qregs = {}, cregs = {}, nq = 0, nc = 0;
    var gates = [], measures = [], warnings = [], si, st, text, line;

    for (si = 0; si < stmts.length; si++) {
        st = stmts[si]; text = st.text; line = st.line;

        if (/^OPENQASM\b/i.test(text) || /^include\b/i.test(text)) continue;

        var m = /^(qreg|creg)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*(\d+)\s*\]$/.exec(text);
        if (m) {
            var size = parseInt(m[3], 10);
            if (size < 1) throw new QasmError(line, 'register size must be at least 1');
            if (m[1] === 'qreg') {
                if (qregs[m[2]]) throw new QasmError(line, 'register "' + m[2] + '" already declared');
                qregs[m[2]] = { base: nq, size: size };
                nq += size;
                if (nq > MAX_QUBITS) throw new QasmError(line,
                    nq + ' qubits — this page caps a dense exact statevector at ' + MAX_QUBITS,
                    '2^' + nq + ' amplitudes is ' + Math.round(Math.pow(2, nq) * 16 / 1048576) +
                    ' MB at 16 bytes each, and more if the coefficients outgrow int32. ' +
                    'The native engine has no such cap.');
            } else {
                cregs[m[2]] = { base: nc, size: size };
                nc += size;
            }
            continue;
        }

        if (/^barrier\b/i.test(text)) continue;

        if (/^(gate|opaque)\b/i.test(text)) throw new QasmError(line,
            'custom gate definitions are not supported yet',
            'inline the body — every gate in it must be from the exact set anyway');

        if (/^if\s*\(/i.test(text)) throw new QasmError(line,
            'classical control flow is not supported yet');

        if (/^reset\b/i.test(text)) throw new QasmError(line,
            'reset is not a unitary — mid-circuit reset is not supported');

        m = /^measure\s+(.+?)\s*->\s*(.+)$/i.exec(text);
        if (m) {
            var qs = resolve(m[1], qregs, line), cs = resolve(m[2], cregs, line), i;
            if (qs.length !== cs.length) throw new QasmError(line,
                'measure maps ' + qs.length + ' qubits onto ' + cs.length + ' classical bits');
            for (i = 0; i < qs.length; i++) measures.push({ q: qs[i], c: cs[i] });
            continue;
        }

        /* name(params) operands */
        m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(\(([^)]*)\))?\s*(.*)$/.exec(text);
        if (!m) throw new QasmError(line, 'cannot read statement "' + text + '"');
        var name = m[1], params = m[3], operands = m[4];

        if (IRRATIONAL[name]) throw new QasmError(line,
            name + ' has no exact representative in Z[ζ₈]',
            'continuous rotations are where float simulators start rounding. ' +
            'Express the gate over {H, S, T, CX} — universal, and exact here.');

        var entry = TABLE[name];
        if (!entry) throw new QasmError(line, 'unknown gate "' + name + '"',
            'supported: ' + Object.keys(TABLE).sort().join(' '));

        var nQ = entry[0], nP = entry[1], emit = entry[2];
        var k = 0;
        if (nP) {
            if (params === undefined) throw new QasmError(line, name + ' takes an angle, e.g. ' + name + '(pi/4)');
            k = quantize(evalAngle(params, line), line, name);
        } else if (params !== undefined && params.trim()) {
            throw new QasmError(line, name + ' takes no parameters');
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
            continue;
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

    if (nq === 0) throw new QasmError(1, 'no qreg declared',
        'start with: OPENQASM 2.0; include "qelib1.inc"; qreg q[2];');

    /* Which ring does this circuit actually need? Phases are counted in
     * sixteenths above; if every one of them is even, the circuit lives in
     * Z[ζ₈] and the exponents are halved so the smaller, faster engine can
     * run it. Same decision the C core makes when it sizes a limb count --
     * take the narrowest representation that is still exact. */
    var ring = 8, gi, ge, oddPhase = false, oddGlobal = false;
    for (gi = 0; gi < gates.length; gi++) {
        ge = gates[gi];
        if (ge[0] === 'zpow' || ge[0] === 'mcpow') { if (ge[2] % 2 !== 0) oddPhase = true; }
        else if (ge[0] === 'gphase') { if (ge[1] % 2 !== 0) oddGlobal = true; }
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
    if (ring === 8) {
        for (gi = 0; gi < gates.length; gi++) {
            ge = gates[gi];
            if (ge[0] === 'zpow' || ge[0] === 'mcpow') ge[2] = ge[2] / 2;
            else if (ge[0] === 'gphase') ge[1] = ge[1] / 2;
        }
    }

    return {
        n: nq, nc: nc, qregs: qregs, cregs: cregs, ring: ring,
        gates: gates, measures: measures, warnings: warnings
    };
}

return { parse: parse, QasmError: QasmError, TABLE: TABLE, MAX_QUBITS: MAX_QUBITS };
});
