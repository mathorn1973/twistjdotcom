/*
 * qasm.js -- OpenQASM 2.0 and a supported OpenQASM 3 subset for OQ.
 *
 * (c) Marek Spanel 2026  All rights reserved.
 *
 * Compiles the supported gate and control constructs into OQ's gate list.
 * Exact phase steps are pi/4 in Z[zeta_8] and pi/8 in Z[zeta_16]. Unsupported
 * instructions and angles receive explicit diagnostics. Approximate gate
 * synthesis is a separate opt-in path and is reported as a changed circuit.
 */
(function (root, factory) {
    var api = factory(typeof module === 'object' && module.exports
        ? require('./oqopt.js') : root.OQOPT);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.QASM = api;
})(typeof self !== 'undefined' ? self : this, function (OPT) {
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

/* ---- gate modifiers --------------------------------------------------- *
 * ctrl @, negctrl @, inv @ and pow(k) @, handled at the GATE-LIST level and
 * not by a second table of pre-controlled gates. The reason it can be done
 * that way is that every primitive this engine has — h, x, zpow, cx, swap,
 * mcpow, gphase — has an exact controlled form, and control passes straight
 * through a conjugation:
 *
 *     ctrl(P† D P) = (I⊗P†) · ctrl(D) · (I⊗P)      because P†P = I
 *
 * so a controlled H is A† · ctrl(X) · A with A = T·H·S, which is the CH
 * decomposition already in the table, and nothing new has to become exact.
 * ctrl is a homomorphism — ctrl(ABC) = ctrl(A)ctrl(B)ctrl(C) — so controlling
 * a gate means controlling the word it emits, whatever that word is. That is
 * why ctrl @ U(θ,φ,λ) is exact on the same half-pi lattice U itself is: the
 * word is p, Z, H and gphase, and each of those controls exactly. */

/* Phases in this layer are counted in SIXTEENTHS (pi/8) and halved later if
 * the whole circuit fits in Z[ζ₈] — see halvePhases. Keep them in [0,16). */
function mod16(k) {
    k = Math.round(k) % 16;
    return k < 0 ? k + 16 : k;
}

/* A leading chain of "name @" / "name(arg) @". The @ is what makes it a
 * modifier: without it "pow(2) q[0]" is an ordinary call to a gate named pow,
 * and refusing it as a malformed modifier would be a worse error. */
function splitMods(text) {
    var mods = [], t = text.trim(), m, i, j, depth, arg, after;
    for (;;) {
        m = /^(ctrl|negctrl|inv|pow)\b/.exec(t);
        if (!m) break;
        i = m[0].length; arg = undefined;
        while (i < t.length && /\s/.test(t.charAt(i))) i++;
        if (t.charAt(i) === '(') {
            depth = 0;
            for (j = i; j < t.length; j++) {
                if (t.charAt(j) === '(') depth++;
                else if (t.charAt(j) === ')') { depth--; if (!depth) break; }
            }
            if (depth !== 0) break;
            arg = t.slice(i + 1, j); i = j + 1;
        }
        after = t.slice(i).replace(/^\s+/, '');
        if (after.charAt(0) !== '@') break;
        mods.push({ kind: m[1], arg: arg });
        t = after.slice(1).trim();
    }
    return { mods: mods, rest: t };
}

/* The inverse of splitMods, so a modifier chain can be re-attached to a
 * statement that has been rewritten underneath it. */
function modText(mods) {
    var s = '', i;
    for (i = 0; i < mods.length; i++)
        s += mods[i].kind + (mods[i].arg === undefined ? '' : '(' + mods[i].arg + ')') + ' @ ';
    return s;
}

/* ctrl and negctrl take control qubits off the FRONT of the operand list, in
 * modifier order. inv and pow fold into one exponent, because all three
 * commute the way they have to: ctrl(U^k) = ctrl(U)^k, ctrl(U†) = ctrl(U)†,
 * and (U^a)^b = U^ab. So the whole chain is (controls, exponent). */
function foldMods(mods, line, num) {
    var ctrls = [], e = 1, i, kind, arg, n, c;
    for (i = 0; i < mods.length; i++) {
        kind = mods[i].kind; arg = mods[i].arg;
        if (kind === 'inv') {
            if (arg !== undefined && arg.trim()) throw new QasmError(line, 'inv takes no argument');
            e = -e;
        } else if (kind === 'pow') {
            if (arg === undefined || !arg.trim()) throw new QasmError(line,
                'pow needs an exponent, as in pow(2) @');
            e *= num(arg);
        } else {
            n = arg === undefined || !arg.trim() ? 1 : num(arg);
            if (n < 0 || Math.abs(n - Math.round(n)) > 1e-9) throw new QasmError(line,
                kind + ' needs a whole, non-negative number of control qubits');
            for (c = 0; c < Math.round(n); c++) ctrls.push(kind === 'negctrl');
        }
    }
    return { ctrls: ctrls, e: e };
}

var MAX_POW = 4096;               /* a sanity bound on pow(k) @, not a physics one */

/* U† is the word backwards with every letter inverted. h, x, cx and swap are
 * their own inverses; a phase negates. */
function invertGates(list, line) {
    var out = [], i, g;
    for (i = list.length - 1; i >= 0; i--) {
        g = list[i];
        switch (g[0]) {
        case 'h': case 'x': case 'cx': case 'swap': out.push(g); break;
        case 'zpow':   out.push(['zpow', g[1], mod16(-g[2])]); break;
        case 'mcpow':  out.push(['mcpow', g[1], mod16(-g[2]), g[3]]); break;
        case 'gphase': out.push(['gphase', mod16(-g[1])]); break;
        case 'if':
            var inverseBranch = ['if', g[1], invertGates(g[2], line)];
            if (g[3]) inverseBranch.push(invertGates(g[3], line));
            out.push(inverseBranch); break;
        default: throw new QasmError(line,
            'inv @ cannot invert a ' + g[0] + ' — it is not a unitary',
            'measurement and reset destroy information, so there is nothing to run ' +
            'backwards. Invert the unitary part and leave the measurement where it is.');
        }
    }
    return out;
}

/* Every primitive, with controls added. Nothing here needs a kernel the
 * engine does not already have. */
function controlGates(list, cq, line) {
    var out = [], i, g, t, seen = {}, j;
    for (j = 0; j < cq.length; j++) {
        if (seen[cq[j]]) throw new QasmError(line, 'the same qubit is named as a control twice');
        seen[cq[j]] = 1;
    }
    function span(extra, tgt) {                       /* the qubit set of one mcpow */
        var qs = cq.concat(extra).concat([tgt]), k;
        for (k = 0; k < qs.length; k++) if (qs.lastIndexOf(qs[k]) !== k) throw new QasmError(line,
            'a qubit cannot be a control and a target of the same gate');
        return qs;
    }
    function ctrlX(extra, tgt) {                      /* controlled X = H · MCZ(pi) · H */
        out.push(['h', tgt], mcpow(span(extra, tgt), 8), ['h', tgt]);
    }
    for (i = 0; i < list.length; i++) {
        g = list[i];
        switch (g[0]) {
        case 'x':      ctrlX([], g[1]); break;
        case 'cx':     ctrlX([g[1]], g[2]); break;
        case 'zpow':   out.push(mcpow(span([], g[1]), g[2])); break;
        case 'mcpow':  out.push(mcpow(cq.concat(g[3]), g[2])); break;
        case 'gphase': out.push(mcpow(cq.slice(), g[1])); break;
        case 'h':                                     /* H = A† · X · A, A = T·H·S */
            t = g[1];
            out.push(['zpow', t, 4], ['h', t], ['zpow', t, 2]);
            ctrlX([], t);
            out.push(['zpow', t, 14], ['h', t], ['zpow', t, 12]);
            break;
        case 'swap':                                  /* the Fredkin decomposition */
            out.push(['cx', g[2], g[1]]);
            ctrlX([g[1]], g[2]);
            out.push(['cx', g[2], g[1]]);
            break;
        case 'if':
            var controlledBranch = ['if', g[1], controlGates(g[2], cq, line)];
            if (g[3]) controlledBranch.push(controlGates(g[3], cq, line));
            out.push(controlledBranch); break;
        default: throw new QasmError(line,
            'ctrl @ cannot control a ' + g[0],
            'a measurement is not a unitary, so there is no controlled form of it.');
        }
    }
    return out;
}

/* U^k for a whole word. A word made only of phases folds into one phase per
 * gate instead of k copies of it, which is what keeps pow(512) @ cp(θ) a
 * single gate rather than 512 of them. */
function repeatGates(list, e) {
    var out = [], i, allPhase = list.length > 0;
    for (i = 0; i < list.length; i++)
        if (list[i][0] !== 'zpow' && list[i][0] !== 'mcpow' && list[i][0] !== 'gphase')
            { allPhase = false; break; }
    if (allPhase) {
        for (i = 0; i < list.length; i++) {
            if (list[i][0] === 'gphase') out.push(['gphase', mod16(list[i][1] * e)]);
            else if (list[i][0] === 'zpow') out.push(['zpow', list[i][1], mod16(list[i][2] * e)]);
            else out.push(['mcpow', list[i][1], mod16(list[i][2] * e), list[i][3]]);
        }
        return out;
    }
    for (i = 0; i < e; i++) out = out.concat(list);
    return out;
}

/* A FRACTIONAL power needs the gate written as a phase in some basis:
 *
 *     G = P† · diag(1, e^{iθ}) · P     and then     G^e = P† · diag(1, e^{ieθ}) · P
 *
 * Every gate below is one of those, with P built from H, S and T. The
 * rewrite is emitted as ordinary statements so the lattice check, the
 * refusal messages and the broadcast rules stay in one place: pow(1/2) @ x
 * becomes h; p(pi/2); h, and pow(1/3) @ x becomes h; p(pi/3); h, which is
 * then refused for the angle, which is the honest reason. */
var FRAC_BASIS = {
    z: ['Z', 8], s: ['Z', 4], sdg: ['Z', -4], t: ['Z', 2], tdg: ['Z', -2],
    cz: ['Z', 8], cs: ['Z', 4], csdg: ['Z', -4], ccz: ['Z', 8], mcz: ['Z', 8],
    x: ['X', 8], sx: ['X', 4], sxdg: ['X', -4],
    cx: ['X', 8], CX: ['X', 8], cnot: ['X', 8], ccx: ['X', 8], toffoli: ['X', 8], mcx: ['X', 8],
    y: ['Y', 8], cy: ['Y', 8],
    h: ['H', 8], ch: ['H', 8],
    id: ['I', 0]
};

/* Gates whose angle IS the whole gate: a fractional power just scales it. */
var FRAC_SCALE = { p: 1, u1: 1, phase: 1, cp: 1, cphase: 1, cu1: 1, mcp: 1,
                   gphase: 1, rz: 1, rx: 1, ry: 1 };

function fracPowStatements(name, params, ops, e, line) {
    var E = '(' + e + ')';
    if (Object.prototype.hasOwnProperty.call(FRAC_SCALE, name)) {
        if (params === undefined || !params.trim()) throw new QasmError(line,
            name + ' takes an angle, e.g. ' + name + '(pi/4)');
        return [name + '(' + E + '*(' + params + '))' + (ops ? ' ' + ops : '')];
    }
    var f = FRAC_BASIS[name];
    if (!f) throw new QasmError(line,
        'pow(' + e + ') @ ' + name + ' — a fractional power of ' + name + ' is not exact here',
        'a fractional power is exact when the gate is a phase in some basis reachable ' +
        'from H, S and T: z, s, t, x, sx, y, h and their controlled forms all are, and ' +
        'so is anything whose angle is a parameter (p, rz, rx, ry, cp, mcp, gphase). ' +
        'swap and U are not — write the gate you mean directly.');
    if (params !== undefined && params.trim()) throw new QasmError(line, name + ' takes no parameters');
    if (f[0] === 'I') return [];
    var oo = ops.trim() ? splitTop(ops).map(function (s) { return s.trim(); }) : [];
    if (!oo.length) throw new QasmError(line, name + ' needs qubit operand(s)');
    var tgt = oo[oo.length - 1];
    var ang = (f[1] < 0 ? '-' : '') + E + '*pi' + (Math.abs(f[1]) === 4 ? '/2' :
              Math.abs(f[1]) === 2 ? '/4' : '');
    var core = oo.length === 1 ? ['p(' + ang + ') ' + tgt]
                               : ['mcp(' + ang + ') ' + oo.join(',')];
    if (f[0] === 'Z') return core;
    if (f[0] === 'X') return ['h ' + tgt].concat(core, ['h ' + tgt]);
    if (f[0] === 'Y') return ['sdg ' + tgt, 'h ' + tgt].concat(core, ['h ' + tgt, 's ' + tgt]);
    /* H = A† · X · A with A = T·H·S, and X = H · Z · H */
    return ['s ' + tgt, 'h ' + tgt, 't ' + tgt, 'h ' + tgt].concat(core,
           ['h ' + tgt, 'tdg ' + tgt, 'h ' + tgt, 'sdg ' + tgt]);
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

/* The controlled and two-qubit rotations, as CIRCUITS rather than as
 * refusals — the last names in qelib1.inc that were refused by name.
 *
 * They were refused because a controlled rotation looked like it needed a
 * controlled-RY kernel. It does not. RY(m·pi/2) = (H·Z)^m, and ctrl @ is
 * applied to the WORD a gate emits, letter by letter, so a controlled
 * rotation is exact on exactly the lattice the rotation itself is exact on.
 * And rzz is rz conjugated by CX — the sandwich, which costs nothing — with
 * rxx and ryy the same thing in a rotated basis.
 *
 * So these are refused by ANGLE now, like rx and ry before them, which is
 * the whole pattern: the lattice is the product, the gate table is not. */
function twoq(o, line, name) {
    var q = o.trim() ? splitTop(o).map(function (s) { return s.trim(); }) : [];
    if (q.length !== 2) throw new QasmError(line,
        name + ' takes 2 qubit operands, got ' + q.length);
    return q;
}

var REWRITE = {
    crx: function (p, o) { return ['ctrl @ rx(' + p + ') ' + o]; },
    cry: function (p, o) { return ['ctrl @ ry(' + p + ') ' + o]; },
    crz: function (p, o) { return ['ctrl @ rz(' + p + ') ' + o]; },
    /* cu3 is a qelib1 name and means the controlled TEXTBOOK u3. The u3 in
     * this table is the OpenQASM 3 one, which stdgates.inc defines with a
     * gphase of -(theta+phi+lambda)/2 — that is e^{-i(phi+lambda)/2} times
     * the textbook matrix. Global, and invisible, until it is controlled:
     * then it is a relative phase on the control and very visible. So it is
     * cancelled there, with the same u1((phi+lambda)/2) qelib1's own cu3
     * decomposition carries. */
    cu3: function (p, o, line) {
        var a = p.trim() ? splitTop(p).map(function (s) { return s.trim(); }) : [], q = twoq(o, line, 'cu3');
        if (a.length !== 3) throw new QasmError(line,
            'cu3 takes 3 angles (theta, phi, lambda), got ' + a.length);
        return ['p(((' + a[1] + ')+(' + a[2] + '))/2) ' + q[0],
                'ctrl @ u3(' + p + ') ' + o];
    },
    /* stdgates.inc, verbatim: p(gamma - theta/2) on the control, then the
     * controlled U — whose own e^{i theta/2} becomes p(theta/2) there, so the
     * two together leave p(gamma) and the textbook controlled-U. */
    cu:  function (p, o, line) {
        var a = p.trim() ? splitTop(p).map(function (s) { return s.trim(); }) : [], q = twoq(o, line, 'cu');
        if (a.length !== 4) throw new QasmError(line,
            'cu takes 4 angles (theta, phi, lambda, gamma), got ' + a.length);
        return ['p((' + a[3] + ')-(' + a[0] + ')/2) ' + q[0],
                'ctrl @ U(' + a[0] + ',' + a[1] + ',' + a[2] + ') ' + o];
    },
    /* exp(-i theta/2 · Z⊗Z): the parity a xor b decides the sign, and CX is
     * what writes the parity onto one qubit. */
    rzz: function (p, o, line) {
        var q = twoq(o, line, 'rzz');
        return ['cx ' + q[0] + ',' + q[1], 'rz(' + p + ') ' + q[1], 'cx ' + q[0] + ',' + q[1]];
    },
    rxx: function (p, o, line) {
        var q = twoq(o, line, 'rxx');
        return ['h ' + q[0], 'h ' + q[1]].concat(REWRITE.rzz(p, o, line),
               ['h ' + q[0], 'h ' + q[1]]);
    },
    ryy: function (p, o, line) {
        var q = twoq(o, line, 'ryy');
        return ['rx(pi/2) ' + q[0], 'rx(pi/2) ' + q[1]].concat(REWRITE.rzz(p, o, line),
               ['rx(-pi/2) ' + q[0], 'rx(-pi/2) ' + q[1]]);
    }
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
    var t = src.trim(), m, bits, val, negate = false;
    var booleanCast = /\bbool\s*\(/.test(t);
    t = t.replace(/\b(u?int|bit|bool)\s*(\[\s*\d*\s*\])?\s*\(/g, '(');
    function unwrap(value) {
        value = value.trim();
        while (value[0] === '(') {
            var depth = 0, end = -1;
            for (var i = 0; i < value.length; i++) {
                if (value[i] === '(') depth++;
                else if (value[i] === ')' && --depth === 0) { end = i; break; }
            }
            if (end !== value.length - 1) break;
            value = value.slice(1, -1).trim();
        }
        return value;
    }
    t = unwrap(t);
    while (t[0] === '!') { negate = !negate; t = unwrap(t.slice(1)); }
    if (/^(true|false)$/i.test(t)) return { constant: (t.toLowerCase() === 'true') !== negate };
    m = /^(.+?)\s*(==|!=)\s*(\d+|true|false)$/i.exec(t);
    if (m) {
        bits = resolve(unwrap(m[1]), cregs, line);
        if ((booleanCast || negate) && bits.length !== 1)
            throw new QasmError(line, 'Boolean casts and negation currently require a single classical bit',
                'compare a register directly, for example c != 0');
        val = /^true$/i.test(m[3]) ? 1 : /^false$/i.test(m[3]) ? 0 : Number(m[3]);
        if (!Number.isSafeInteger(val)) throw new QasmError(line, 'classical comparison literal exceeds the safe integer range');
        if (val >= Math.pow(2, bits.length)) throw new QasmError(line,
            'condition compares ' + bits.length + ' bit(s) against ' + val +
            ', which does not fit');
        var equality = { bits: bits, value: val };
        if (negate !== (m[2] === '!=')) equality.negate = true;
        return equality;
    }
    m = /^([A-Za-z_][A-Za-z0-9_]*(\[\s*\d+\s*\])?)$/.exec(t);
    if (m) {
        bits = resolve(m[1], cregs, line);
        if (bits.length !== 1) throw new QasmError(line,
            'a bare classical condition needs a single bit, not a register');
        var single = { bits: bits, value: 1 };
        if (negate) single.negate = true;
        return single;
    }
    throw new QasmError(line, 'cannot read the condition "' + src.trim() + '"',
        'supported: equality or inequality to a literal, a single bit, !bit, bool(bit), true or false');
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
    var out = [], at = 0, line = base || 1;
    function advance() { if (src[at] === '\n') line++; at++; }
    function space() { while (at < src.length && /\s/.test(src[at])) advance(); }
    function keyword(word) {
        return src.slice(at, at + word.length).toLowerCase() === word &&
               !/[A-Za-z0-9_]/.test(src[at + word.length] || '');
    }
    function balanced(open, close) {
        var start = at, startLine = line, depth = 0, quote = false;
        if (src[at] !== open) throw new QasmError(line, 'expected ' + open);
        do {
            var ch = src[at];
            if (ch === '"' && src[at - 1] !== '\\') quote = !quote;
            if (!quote) {
                if (ch === open) depth++;
                else if (ch === close) depth--;
            }
            advance();
        } while (at < src.length && depth);
        if (depth) throw new QasmError(startLine, 'unbalanced ' + open);
        return src.slice(start + 1, at - 1);
    }
    function clause() {
        space();
        var start = at, startLine = line;
        if (src[at] === '{') return { body: balanced('{', '}'), line: startLine };
        if (at >= src.length) throw new QasmError(line, 'if/else needs a body');
        statement();
        return { body: src.slice(start, at), line: startLine };
    }
    function statement() {
        space();
        var start = at, startLine = line;
        /* Read the whole branch recursively. This is what associates an
         * unbraced else with the nearest unmatched if, and what keeps a
         * runtime condition from being re-read for each gate in its body. */
        if (keyword('if')) {
            at += 2; space();
            var condition = balanced('(', ')'), yes = clause();
            var result = { text: 'if (' + condition + ')', line: startLine,
                           body: yes.body, bodyLine: yes.line };
            space();
            if (keyword('else')) {
                at += 4;
                var no = clause();
                result.elseBody = no.body; result.elseLine = no.line;
            }
            return result;
        }
        var depth = 0, quote = false;
        while (at < src.length) {
            var ch = src[at];
            if (ch === '"' && src[at - 1] !== '\\') quote = !quote;
            if (!quote) {
                if (ch === '[' || ch === '(') depth++;
                else if (ch === ']' || ch === ')') depth--;
                if (depth < 0) throw new QasmError(line, 'unmatched ' + ch);
                if (depth === 0 && ch === ';') {
                    var text = src.slice(start, at).trim(); advance();
                    return { text: text, line: startLine };
                }
                if (depth === 0 && ch === '{') {
                    var head = src.slice(start, at).trim(), bodyLine = line;
                    return { text: head, line: startLine, body: balanced('{', '}'), bodyLine: bodyLine };
                }
                if (depth === 0 && ch === '}') throw new QasmError(line, 'unmatched }');
            }
            advance();
        }
        if (depth || quote) throw new QasmError(startLine, 'unbalanced statement');
        return { text: src.slice(start, at).trim(), line: startLine };
    }
    while (at < src.length) {
        space();
        if (at >= src.length) break;
        var st = statement();
        if (st.text) out.push(st);
    }
    return out;
}

/* Compile-time integer arithmetic over the loop variables and the classical
 * constants. Anything a measurement wrote is deliberately NOT in scope --
 * that is the line between unrolling and feedback. */
function q3Num(expr, env, line, what) {
    var t = expr.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*([^\]]+)\s*\]/g, function (m, nm, ix) {
        if (!(nm in env)) return m;
        var b = q3Int(ix, env, line, what);
        return String((BigInt(env[nm]) >> BigInt(b)) & 1n);       /* bit i, LSB first */
    });
    t = t.replace(/\bbool\s*\(/g, '(').replace(/\b(u?int|float)\s*(\[\s*\d+\s*\])?\s*\(/g, '(');
    t = t.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, function (m) {
        if (m === 'true') return '1';
        if (m === 'false') return '0';
        if (m === 'pi' || m === 'tau' || m === 'euler') return m;
        if (m in env) return String(env[m]);
        throw new QasmError(line, 'cannot evaluate "' + expr.trim() + '" at translation time',
            '"' + m + '" is not a compile-time constant here. ' + (what || ''));
    });
    return evalAngle(t, line);
}

/* Compile-time Boolean expressions only. Runtime bit conditions remain a
 * deliberately smaller grammar in parseCond; this never evaluates JS. */
function q3Bool(expr, env, line) {
    var t = expr.trim(), depth, i;
    while (t[0] === '(') {
        depth = 0;
        for (i = 0; i < t.length; i++) {
            if (t[i] === '(') depth++;
            else if (t[i] === ')' && --depth === 0) break;
        }
        if (i !== t.length - 1) break;
        t = t.slice(1, -1).trim();
    }
    var levels = [['||'], ['&&'], ['==', '!=', '<=', '>=', '<', '>']];
    for (var level = 0; level < levels.length; level++) {
        depth = 0;
        for (i = 0; i < t.length; i++) {
            if (t[i] === '(' || t[i] === '[') { depth++; continue; }
            if (t[i] === ')' || t[i] === ']') { depth--; continue; }
            if (depth) continue;
            for (var j = 0; j < levels[level].length; j++) {
                var op = levels[level][j];
                if (t.slice(i, i + op.length) !== op) continue;
                var left = t.slice(0, i), right = t.slice(i + op.length);
                if (op === '||') return q3Bool(left, env, line) || q3Bool(right, env, line);
                if (op === '&&') return q3Bool(left, env, line) && q3Bool(right, env, line);
                function comparisonValue(value) {
                    if (/^\s*(?:!|bool\s*\()/.test(value)) return q3Bool(value, env, line) ? 1 : 0;
                    return q3Num(value, env, line);
                }
                var a = comparisonValue(left), b = comparisonValue(right);
                if (op === '==') return a === b;
                if (op === '!=') return a !== b;
                if (op === '<=') return a <= b;
                if (op === '>=') return a >= b;
                if (op === '<') return a < b;
                return a > b;
            }
        }
    }
    if (t[0] === '!') return !q3Bool(t.slice(1), env, line);
    var cast = splitCall(t);
    if (cast && cast.name === 'bool' && cast.params !== undefined && !cast.operands.trim())
        return q3Bool(cast.params, env, line);
    return q3Num(t, env, line) !== 0;
}

function q3Int(expr, env, line, what) {
    var v = q3Num(expr, env, line, what);
    if (Math.abs(v - Math.round(v)) > 1e-9)
        throw new QasmError(line, '"' + expr.trim() + '" is not an integer (' + v + ')');
    return Math.round(v);
}

/* name, name[i], name[a:b], name[a:step:b] and the index set name[{i,j,k}]
 * -> a list of element names.
 *
 * An ALIAS ("let bp = q[{2*i, 2*i+1}]") is already such a list, so it slices
 * and indexes exactly like a register does — the only difference is that its
 * elements name the qubits of whatever it was cut from. Everything below the
 * translator therefore never learns that aliases exist. */
function q3Operand(arg, regs, env, line, alias, allowConcat, nesting) {
    arg = arg.trim();
    nesting = nesting || 0;
    if (nesting > 32) throw new QasmError(line, 'alias expression nested more than 32 deep');
    /* ++ belongs to an alias expression, not to a gate operand. Split only
     * outside index expressions; resolve aliases before checking overlap. */
    var pieces = [], level = 0, from = 0, outerEnd = -1;
    for (var ci = 0; ci < arg.length; ci++) {
        var ch = arg[ci];
        if (ch === '(' || ch === '[' || ch === '{') level++;
        else if (ch === ')' || ch === ']' || ch === '}') {
            level--;
            if (level < 0) throw new QasmError(line, 'unbalanced brackets in operand "' + arg + '"');
            if (level === 0 && arg[0] === '(' && outerEnd < 0) outerEnd = ci;
        }
        if (level === 0 && ch === '+' && arg[ci + 1] === '+') {
            pieces.push(arg.slice(from, ci).trim()); from = ci + 2; ci++;
        }
    }
    if (level !== 0) throw new QasmError(line, 'unbalanced brackets in operand "' + arg + '"');
    if (pieces.length) {
        if (!allowConcat) throw new QasmError(line, 'register concatenation belongs in a let alias',
            'write let joined = a ++ b; then apply a gate to joined');
        pieces.push(arg.slice(from).trim());
        var joined = [], used = new Set();
        for (ci = 0; ci < pieces.length; ci++) {
            if (!pieces[ci]) throw new QasmError(line, 'missing register beside ++');
            var segment = q3Operand(pieces[ci], regs, env, line, alias, true, nesting + 1);
            if (!segment) throw new QasmError(line, 'unknown register in alias: "' + pieces[ci] + '"');
            for (var sj = 0; sj < segment.length; sj++) {
                if (used.has(segment[sj])) throw new QasmError(line,
                    'concatenated registers overlap at ' + segment[sj],
                    'a register cannot be concatenated with any part of itself');
            }
            segment.forEach(function (q) { used.add(q); });
            joined = joined.concat(segment);
            if (joined.length > 4096) throw new QasmError(line, 'an alias selects more than 4096 qubits');
        }
        return joined;
    }
    if (allowConcat && arg[0] === '(' && outerEnd === arg.length - 1)
        return q3Operand(arg.slice(1, -1), regs, env, line, alias, true, nesting + 1);
    var m = /^([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*([^\]]*)\s*\]$/.exec(arg), nm, i, out = [], elems;
    function index(expr) {
        var v = q3Int(expr, env, line);
        if (!Number.isSafeInteger(v)) throw new QasmError(line, 'register index or step must be a finite safe integer');
        return v;
    }
    function elemsOf(name) {
        var k, e;
        if (alias && Object.prototype.hasOwnProperty.call(alias, name)) return alias[name];
        if (!(name in regs)) return null;
        if (!Number.isSafeInteger(regs[name]) || regs[name] < 1 || regs[name] > 4096)
            throw new QasmError(line, 'register size must be an integer from 1 to 4096');
        e = [];
        for (k = 0; k < regs[name]; k++) e.push(name + '[' + k + ']');
        return e;
    }
    if (!m) {
        elems = elemsOf(arg);
        return elems ? elems.slice() : null;
    }
    nm = m[1];
    elems = elemsOf(nm);
    if (!elems) return null;
    function at(ix) {
        if (ix < 0) ix += elems.length;                /* the spec counts back from -1 */
        if (ix < 0 || ix >= elems.length) throw new QasmError(line,
            nm + '[' + ix + '] is out of range — ' + nm + ' has ' + elems.length + ' bits');
        return elems[ix];
    }
    var inner = m[2].trim();
    if (inner.charAt(0) === '{') {                      /* an index set, in the order written */
        if (inner.charAt(inner.length - 1) !== '}') throw new QasmError(line,
            'unbalanced { in "' + arg + '"');
        var set = inner.slice(1, -1).split(',');
        if (set.length > 1 && !set[set.length - 1].trim()) set.pop();
        for (i = 0; i < set.length; i++) {
            if (!set[i].trim()) throw new QasmError(line, 'an index set cannot contain an empty element');
            out.push(at(index(set[i])));
        }
        return out;
    }
    var parts = inner.split(':');
    if (parts.length === 1) return [at(index(parts[0]))];
    if (parts.length > 3) throw new QasmError(line, 'a slice must have the form start:end or start:step:end');
    if (parts.some(function (p) { return !p.trim(); })) throw new QasmError(line,
        'open-ended slices are not supported here', 'supply explicit start, optional step, and inclusive end indices');
    var a = index(parts[0]);
    var step = parts.length === 3 ? index(parts[1]) : 1;
    var b = index(parts[parts.length - 1]);
    if (step === 0) throw new QasmError(line, 'a slice step of 0 never ends');
    if ((step > 0 && a > b) || (step < 0 && a < b))
        throw new QasmError(line, 'a register cannot be indexed by an empty range');
    for (i = a; step > 0 ? i <= b : i >= b; i += step) out.push(at(i));
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
    var qalias = {};
    var problems = [];
    var order = [], measured = {}, warnings = [], anyGate = false, runtimeDepth = 0, branchDepth = 0;

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

    function distinctOperands(operands, name, line) {
        var seen = new Set();
        for (var i = 0; i < operands.length; i++) {
            if (seen.has(operands[i])) throw new QasmError(line,
                name + ' uses the same qubit twice (' + operands[i] + ')',
                'each gate-call instance must use distinct qubits, including controls and aliased operands');
            seen.add(operands[i]);
        }
    }

    function emitCall(name, params, operands, line, depth) {
        if (depth > 32) throw new QasmError(line, 'gate definitions nested more than 32 deep');
        var g = gdefs[name], i, j, sub, argNames, args = [], flat;
        if (!g) return false;
        /* operands may be registers; broadcast the way the gate layer does */
        argNames = splitTop(operands).map(function (a) { return q3Operand(a, qregs, env, line, qalias) || [a.trim()]; });
        if (argNames.length !== g.args.length) throw new QasmError(line,
            name + ' takes ' + g.args.length + ' qubit operand(s), got ' + argNames.length);
        var width = 1;
        for (i = 0; i < argNames.length; i++) if (argNames[i].length > 1) {
            if (width > 1 && width !== argNames[i].length) throw new QasmError(line,
                'operands of different widths cannot be broadcast together');
            width = argNames[i].length;
        }
        var pv = params === undefined || !params.trim() ? [] : splitTop(params);
        if (pv.length !== g.params.length) throw new QasmError(line,
            name + ' takes ' + g.params.length + ' parameter(s), got ' + pv.length);
        for (var w = 0; w < width; w++) {
            distinctOperands(argNames.map(function (operand) {
                return operand.length === 1 ? operand[0] : operand[w];
            }), name, line);
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
                 elseBody: st.elseBody === undefined ? undefined : one(st.elseBody),
                 line: st.line, bodyLine: st.bodyLine, elseLine: st.elseLine };
    }

    /* ---- gate modifiers ------------------------------------------------ *
     * A modifier on a BUILT-IN goes straight down to the gate layer, which
     * controls the word the gate emits. A modifier on a user-defined gate is
     * distributed over the inlined body instead, because ctrl and inv are
     * homomorphisms — ctrl(A·B) = ctrl(A)·ctrl(B), (A·B)† = B†·A† — so the
     * body carries them one statement at a time and bottoms out at built-ins.
     *
     * The control qubits sit at the FRONT of the operand list, in modifier
     * order, and stay there through every rewrite: prependCtrls puts the
     * outer controls in front of whatever list the inner statement already
     * had, which is exactly what nesting means. */
    function prependCtrls(stmtText, ctrlOps, extraMods, line) {
        var im = splitMods(stmtText), ic = splitCall(im.rest), ops;
        if (!ic) throw new QasmError(line,
            'cannot read "' + stmtText + '" inside a modified gate');
        ops = ic.operands.trim() ? splitTop(ic.operands).map(function (s) { return s.trim(); }) : [];
        ops = ctrlOps.concat(ops);
        return extraMods + modText(im.mods) + ic.name +
               (ic.params === undefined ? '' : '(' + ic.params + ')') +
               (ops.length ? ' ' + ops.join(',') : '');
    }

    function modBody(body, pre, e, ctrlSel, line, depth) {
        var i, r, reps;
        for (i = 0; i < body.length; i++) if (body[i].body !== undefined) throw new QasmError(line,
            'a gate body with a block statement in it cannot carry a modifier');
        if (Math.abs(e - Math.round(e)) > 1e-9) {
            /* (A·B)^k is not A^k·B^k, so a fractional power can only be pushed
             * into a body that is ONE gate. gphase statements do not count:
             * a global phase is a scalar, it commutes with everything, and
             * its fractional power is unambiguous on this lattice. */
            var real = 0;
            for (i = 0; i < body.length; i++)
                if (!/^gphase\b/i.test(body[i].text.trim())) real++;
            if (real > 1) throw new QasmError(line,
                'pow(' + e + ') @ over a gate of ' + real + ' statements is not exact',
                'a fractional power distributes over a product only when the factors ' +
                'commute, so it can be pushed inside a one-gate body and no further. ' +
                'Write the root you mean as its own gate.');
            for (i = 0; i < body.length; i++)
                walk({ text: prependCtrls(body[i].text, ctrlSel, pre + 'pow(' + e + ') @ ', line),
                       line: body[i].line }, line, depth + 1);
            return;
        }
        reps = Math.abs(Math.round(e));
        if (reps * body.length > MAX_POW) throw new QasmError(line,
            'pow(' + Math.round(e) + ') @ would emit more than ' + MAX_POW + ' gates');
        for (r = 0; r < reps; r++) {
            if (e < 0) for (i = body.length - 1; i >= 0; i--)
                walk({ text: prependCtrls(body[i].text, ctrlSel, pre + 'inv @ ', line),
                       line: body[i].line }, line, depth + 1);
            else for (i = 0; i < body.length; i++)
                walk({ text: prependCtrls(body[i].text, ctrlSel, pre, line),
                       line: body[i].line }, line, depth + 1);
        }
    }

    /* Inline a subroutine, like a gate definition, with one extra binding: the
     * local register the body returns is aliased to whatever the caller
     * assigned it to, so "return b" needs no machinery of its own. A void def
     * passes retTo = null and there is nothing to bind. */
    function inlineDef(name, dargs, retTo, line, depth) {
        var dd = ddefs[name], dsub = {}, di, rm;
        if (dargs.length !== dd.params.length) throw new QasmError(line,
            name + ' takes ' + dd.params.length + ' argument(s), got ' + dargs.length);
        for (di = 0; di < dd.params.length; di++) dsub[dd.params[di]] = dargs[di];
        if (retTo) for (di = 0; di < dd.body.length; di++) {
            rm = /^return\s+([\p{L}_][\p{L}\p{N}_]*)/u.exec(dd.body[di].text);
            if (rm) { dsub[rm[1]] = retTo; break; }
        }
        for (di = 0; di < dd.body.length; di++) walk(substitute(dd.body[di], dsub), line, depth + 1);
    }

    function walkMod(md, st, line, depth) {
        if (depth > 32) throw new QasmError(line, 'gate modifiers nested more than 32 deep');
        var call = splitCall(md.rest);
        if (!call) throw new QasmError(line, 'cannot read statement "' + md.rest + '"');
        var f = foldMods(md.mods, line, function (a) { return q3Num(a, env, line); });
        var C = f.ctrls.length, i, w, pre = '';
        var items = call.operands.trim()
            ? splitTop(call.operands).map(function (s) { return s.trim(); }) : [];
        if (items.length < C) throw new QasmError(line,
            'this names ' + C + ' control qubit(s) before the gate operands, but only ' +
            items.length + ' operand(s) were given');
        for (i = 0; i < C; i++) pre += f.ctrls[i] ? 'negctrl @ ' : 'ctrl @ ';
        var argv = items.map(function (a) { return q3Operand(a, qregs, env, line, qalias) || [a]; });
        var ctrlSel = [];
        for (i = 0; i < C; i++) {
            if (argv[i].length !== 1) throw new QasmError(line,
                'a control operand has to be a single qubit, not a whole register',
                'name the bit — q[0] — or write ctrl @ once per control.');
            ctrlSel.push(argv[i][0]);
        }
        anyGate = true;

        var g = gdefs[call.name];
        if (g) {
            var pv = call.params === undefined || !call.params.trim() ? [] : splitTop(call.params);
            if (pv.length !== g.params.length) throw new QasmError(line,
                call.name + ' takes ' + g.params.length + ' parameter(s), got ' + pv.length);
            if (argv.length - C !== g.args.length) throw new QasmError(line,
                call.name + ' takes ' + g.args.length + ' qubit operand(s), got ' + (argv.length - C));
            var width = 1;
            for (i = C; i < argv.length; i++) if (argv[i].length > 1) {
                if (width > 1 && width !== argv[i].length) throw new QasmError(line,
                    'operands of different widths cannot be broadcast together');
                width = argv[i].length;
            }
            for (w = 0; w < width; w++) {
                distinctOperands(ctrlSel.concat(argv.slice(C).map(function (operand) {
                    return operand.length === 1 ? operand[0] : operand[w];
                })), call.name, line);
                var sub = {}, body = [], j;
                for (i = 0; i < g.args.length; i++)
                    sub[g.args[i]] = argv[C + i].length === 1 ? argv[C + i][0] : argv[C + i][w];
                for (i = 0; i < g.params.length; i++) sub[g.params[i]] = '(' + pv[i] + ')';
                for (j = 0; j < g.body.length; j++) body.push(substitute(g.body[j], sub));
                modBody(body, pre, f.e, ctrlSel, line, depth);
            }
            return;
        }

        /* a built-in: the gate layer knows how to control the word it emits */
        if (f.e !== 1) pre += 'pow(' + f.e + ') @ ';
        else if (!checkGate(call.name, call.params, line)) return;
        var ptxt = call.params === undefined ? '' : '(' + substConst(call.params) + ')';
        var te = TABLE[call.name], flatq, sel;
        if (te && te[0] === -1) {                     /* variadic: one control set */
            flatq = ctrlSel.slice();
            for (i = C; i < argv.length; i++) flatq = flatq.concat(argv[i]);
            push(pre + call.name + ptxt + ' ' + flatq.join(',') + ';', line);
            return;
        }
        var wd = 1;
        for (i = C; i < argv.length; i++) if (argv[i].length > 1) {
            if (wd > 1 && wd !== argv[i].length) throw new QasmError(line,
                'operands of different widths cannot be broadcast together');
            wd = argv[i].length;
        }
        for (w = 0; w < wd; w++) {
            sel = ctrlSel.slice();
            for (i = C; i < argv.length; i++) sel.push(argv[i].length === 1 ? argv[i][0] : argv[i][w]);
            push(pre + call.name + ptxt + (sel.length ? ' ' + sel.join(',') : '') + ';', line);
        }
    }

    function walk(st, callerLine, depth) {
        var text = st.text, line = st.line || callerLine, m, i;
        if (!text) return;

        if (/^OPENQASM\b/i.test(text)) return;
        if (/^include\b/i.test(text)) return;                 /* stdgates is the table below */
        if (/^barrier\b/i.test(text)) return;

        if (runtimeDepth && /^(?:(?:const)\s+)?(?:qubit|bit|bool|int|uint|float|angle|let|gate|def)\b/i.test(text))
            throw new QasmError(line, 'declarations inside a runtime branch are not supported',
                'declare registers and constants before the branch; its body may contain gates, measurements and nested conditions');
        if (branchDepth && /^(?:const\s+)?(?:qubit|bit|qreg|creg)\b/i.test(text))
            throw new QasmError(line, 'register declarations inside an if/else branch are not supported',
                'declare quantum and classical registers before the branch; block-local register names require separate storage');

        /* declarations */
        m = /^(?:const\s+)?qubit\s*(?:\[\s*([^\]]+)\s*\])?\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(text);
        if (m) {
            var qs = m[1] === undefined ? 1 : q3Int(m[1], env, line);
            if (anyGate) throw new QasmError(line, 'qubit registers must all be declared before the first gate');
            qregs[m[2]] = qs; order.push(m[2]);
            push('qreg ' + m[2] + '[' + qs + '];', line);
            return;
        }
        m = /^(?:const\s+)?bit\s*(?:\[\s*([^\]]+)\s*\])?\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*(.+))?$/i.exec(text);
        if (m) {
            var cs = m[1] === undefined ? 1 : q3Int(m[1], env, line);
            /* An inlined subroutine declares its own local bit register, and
             * the binding has already aliased it to the caller's. Declaring it
             * again would shadow the alias. */
            if (cregs[m[2]] === undefined) {
                cregs[m[2]] = cs;
                push('creg ' + m[2] + '[' + cs + '];', line);
            }
            if (m[3] !== undefined) {
                if (/^const\b/i.test(text) || !/^measure\s+/i.test(m[3]))
                    throw new QasmError(line, 'only a measurement initializer is supported for bit declarations',
                        'use bit c = measure q; other classical initializers are not silently ignored');
                walk({ text: m[2] + ' = ' + m[3], line: line }, line, depth);
            }
            return;
        }
        m = /^(?:const\s+)?bool\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/i.exec(text);
        if (m) {
            env[m[1]] = q3Bool(m[2], env, line) ? 1 : 0;
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
        /* An angle register with no value exists to be WRITTEN while the
         * circuit runs — iterative phase estimation shifts measurement
         * outcomes into one and feeds it back as a phase. That is a runtime
         * angle, and this engine fixes the circuit before it runs. Thrown
         * rather than collected, because it declares a name: skipping it makes
         * every later use of that name report something worse. */
        m = /^(?:const\s+)?angle\s*(?:\[\s*([^\]]*)\s*\])?\s+([\p{L}_][\p{L}\p{N}_]*)$/iu.exec(text);
        if (m) throw new QasmError(line,
            'angle' + (m[1] ? '[' + m[1] + ']' : '') + ' ' + m[2] +
            ' — an angle register with no value is a runtime angle',
            'oq needs the circuit fixed before it runs, and a phase a measurement ' +
            'writes is not. An angle declared WITH a value is substituted verbatim ' +
            'and works. Note that this is not the only obstacle for iterative phase ' +
            'estimation: an n-bit angle register steps by 2·pi/2^n, which is off the ' +
            'pi/8 lattice for every n above 4.');

        /* let: an alias for a register, a slice, or an index set. Nothing but
         * a name for a list of qubits that already exist — so it is resolved
         * here and never travels any further. Re-binding a name is allowed
         * and is how varteleport.qasm walks its chain of Bell pairs: each
         * iteration re-points "io" at the qubit the state just moved to. */
        m = /^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/i.exec(text);
        if (m) {
            var alias = q3Operand(m[2], qregs, env, line, qalias, true);
            if (!alias) throw new QasmError(line,
                'let ' + m[1] + ' = "' + m[2].trim() + '" — that is not a qubit register, ' +
                'slice or index set',
                'an alias names qubits that already exist: let a = q[0:3], ' +
                'let a = q[{0, 2, 5}], or let a = q.');
            qalias[m[1]] = alias;
            return;
        }

        /* reset: free at the top, because the state starts there anyway */
        if (/^reset\b/i.test(text)) {
            /* Before any gate this is free: the state starts in |0..0>.
             * After one it is measure-and-correct, which the gate layer
             * now knows how to do, so hand it down instead of refusing.
             * The operand is expanded here, because an alias is a translator
             * idea and the gate layer has never heard of one. */
            if (anyGate) {
                var rq = q3Operand(text.replace(/^reset\s+/i, ''), qregs, env, line, qalias);
                if (!rq) throw new QasmError(line,
                    'unknown quantum register in "' + text + '"');
                for (i = 0; i < rq.length; i++) push('reset ' + rq[i] + ';', line);
                return;
            }
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
            var cbits = q3Operand(m[1], cregs, env, line), qbits = q3Operand(m[2], qregs, env, line, qalias);
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
        /* gate modifiers: ctrl @, negctrl @, inv @, pow(k) @ */
        var mdq = splitMods(text);
        if (mdq.mods.length) return walkMod(mdq, st, line, depth);

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

        /* A subroutine call, in all three spellings the official examples
         * actually use: assigned ("t = ymeasure(q)"), void as a statement
         * ("xprepare(input_qubit);"), and the gate-call form the examples
         * write for a void def with quantum operands ("bellprep bp;",
         * "distill_and_buffer(buffer_size) workspace, buffer;"). The last
         * one puts the classical arguments in the parentheses and the
         * quantum ones after, so the argument list is the two concatenated. */
        m = /^([\p{L}_][\p{L}\p{N}_]*)\s*=\s*([\p{L}_][\p{L}\p{N}_]*)\s*\((.*)\)$/u.exec(text);
        if (m && ddefs[m[2]]) {
            inlineDef(m[2], m[3].trim() ? splitTop(m[3]).map(function (x) { return x.trim(); }) : [],
                      m[1], line, depth);
            return;
        }
        {
            var dcall = splitCall(text);
            if (dcall && ddefs[dcall.name] && !gdefs[dcall.name]) {
                var dargs = [];
                if (dcall.params !== undefined && dcall.params.trim())
                    dargs = splitTop(dcall.params).map(function (x) { return x.trim(); });
                if (dcall.operands.trim())
                    dargs = dargs.concat(splitTop(dcall.operands).map(function (x) { return x.trim(); }));
                inlineDef(dcall.name, dargs, null, line, depth);
                return;
            }
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

        /* A runtime branch stays a block all the way to the executor. The
         * condition is evaluated once, even when its body measures into the
         * very bit used by the condition. */
        var q3if = splitIf(text);
        if (q3if) {
            var cond = q3if.cond, taken;
            m = [null, q3if.cond, q3if.rest];
            function walkBranch(body, bodyLine) {
                /* A selected compile-time branch still has lexical scope.
                 * Its constants, aliases and definitions may shadow outer
                 * names, but must not affect translation after the branch.
                 * Entries are immutable values or replaced as a whole. */
                var previous = { env: env, fenv: fenv, qalias: qalias, gdefs: gdefs, ddefs: ddefs };
                env = Object.assign({}, env); fenv = Object.assign({}, fenv);
                qalias = Object.assign({}, qalias); gdefs = Object.assign({}, gdefs); ddefs = Object.assign({}, ddefs);
                branchDepth++;
                try {
                    var statements = q3Split(body, bodyLine || line);
                    for (var bi = 0; bi < statements.length; bi++) walk(statements[bi], line, depth);
                } finally {
                    branchDepth--;
                    env = previous.env; fenv = previous.fenv; qalias = previous.qalias;
                    gdefs = previous.gdefs; ddefs = previous.ddefs;
                }
            }
            try { taken = q3Bool(cond, env, line); }
            catch (e) {
                if (e.name !== 'QasmError') throw e;
                push('if (' + cond.trim() + ') {', line);
                runtimeDepth++;
                try {
                    if (st.body !== undefined) walkBranch(st.body, st.bodyLine);
                    else if (m[2].trim()) walk({ text: m[2].trim(), line: line }, line, depth);
                    push('}', line);
                    if (st.elseBody !== undefined) {
                        push('else {', st.elseLine || line);
                        walkBranch(st.elseBody, st.elseLine);
                        push('}', st.elseLine || line);
                    }
                } finally { runtimeDepth--; }
                return;
            }
            if (!taken) {
                if (st.elseBody !== undefined) walkBranch(st.elseBody, st.elseLine);
                return;
            }
            if (st.body !== undefined) walkBranch(st.body, st.bodyLine);
            else if (m[2].trim()) walk({ text: m[2].trim(), line: line }, line, depth);
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
            return q3Operand(a, qregs, env, line, qalias) || [a.trim()];
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

function parse2(src, opts) {
    var stmts = q3Split(stripComments(src), 1);
    var qregs = {}, cregs = {}, nq = 0, nc = 0;
    var gates = [], measures = [], warnings = [], si, st;
    var dynamic = false, scratchBits = 0;

    /* One statement, emitted into a gate list. Pulled out of the loop so an
     * if-block can run it too: classical control applies the same statement
     * machinery, only conditionally. */
    function doStatement(text, line, gates, block) {
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
            if (iff && (iff.rest || (block && block.body !== undefined))) {
                var cnd = parseCond(iff.cond, cregs, line), sub = [], otherwise = [];
                function branch(body, baseLine, target) {
                    var parts = q3Split(body, baseLine || line);
                    for (var bi = 0; bi < parts.length; bi++) {
                        if (/^(?:qreg|creg)\b/i.test(parts[bi].text))
                            throw new QasmError(parts[bi].line, 'register declarations inside a runtime branch are not supported');
                        doStatement(parts[bi].text, parts[bi].line, target, parts[bi]);
                    }
                }
                if (block && block.body !== undefined) branch(block.body, block.bodyLine, sub);
                else doStatement(iff.rest, line, sub);
                if (block && block.elseBody !== undefined) branch(block.elseBody, block.elseLine, otherwise);
                if (sub.length || otherwise.length) {
                    var conditional = ['if', cnd, sub];
                    if (block && block.elseBody !== undefined) conditional.push(otherwise);
                    gates.push(conditional);
                }
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

            /* ---- gate modifiers ---------------------------------------- *
             * ctrl @, negctrl @, inv @ and pow(k) @. The base gate is emitted
             * into a list of its own, and then that WORD is inverted, repeated
             * and controlled — see controlGates. Nothing about the base gate
             * has to know it is being modified, which is why a modifier works
             * on everything the table has, U included. */
            var md = splitMods(text);
            if (md.mods.length) { emitModified(md, line, gates); return; }

            /* name(params) operands */
            var call = splitCall(text);
            if (!call) throw new QasmError(line, 'cannot read statement "' + text + '"');
            var name = call.name, params = call.params, operands = call.operands;

            /* the controlled and two-qubit rotations, as the circuits they are */
            if (REWRITE[name]) {
                if (params === undefined || !params.trim()) throw new QasmError(line,
                    name + ' takes an angle, e.g. ' + name + '(pi/2)');
                var rw = REWRITE[name](params, operands, line), ri;
                for (ri = 0; ri < rw.length; ri++) doStatement(rw[ri], line, gates);
                return;
            }

            var entry = TABLE[name];
            if (!entry) throw new QasmError(line, 'unknown gate "' + name + '"',
                'supported: ' + Object.keys(TABLE).concat(Object.keys(REWRITE)).sort().join(' '));

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

    /* One modified statement. The controls come off the front of the operand
     * list, in modifier order; the rest of the list belongs to the base gate,
     * which is emitted through doStatement so it keeps its own broadcast,
     * its own angle checks and its own refusals. negctrl is X-conjugation
     * around the whole thing, which is the definition, not a trick. */
    function emitModified(md, line, gates) {
        var f = foldMods(md.mods, line, function (a) { return evalAngle(a, line); });
        var call = splitCall(md.rest);
        if (!call) throw new QasmError(line, 'cannot read statement "' + md.rest + '"');
        var items = call.operands.trim() ? splitTop(call.operands) : [];
        var C = f.ctrls.length, i, r, cq = [], sub = [], one = [], e = f.e;
        if (items.length < C) throw new QasmError(line,
            'this names ' + C + ' control qubit(s) before the gate operands, but only ' +
            items.length + ' operand(s) were given');
        for (i = 0; i < C; i++) {
            r = resolve(items[i], qregs, line);
            if (r.length !== 1) throw new QasmError(line,
                'a control operand has to be a single qubit, not a whole register',
                'write ctrl @ once per control qubit, or name the bit: q[0].');
        cq.push(r[0]);
        }
        var rest = items.slice(C).join(',');
        var ptxt = call.params !== undefined ? '(' + call.params + ')' : '';
        var isFrac = Math.abs(e - Math.round(e)) > 1e-9;

        /* Approximate synthesis is SUPPRESSED here, and that is correctness,
         * not caution. Solovay-Kitaev approximates in SU(2), so the word it
         * returns carries whatever global phase it happens to have. A global
         * phase is invisible — until the gate is CONTROLLED, when it becomes a
         * relative phase on the control qubit and is very visible indeed, in a
         * way the quoted epsilon does not cover. Repeating a word k times is
         * the same problem from the other end: the error the panel reports is
         * the error of one copy. A fractional power is fine, because it is
         * taken by scaling the ANGLE and then synthesizing that. */
        var prevSynth = SYNTH;
        var suppress = C > 0 || (!isFrac && Math.abs(Math.round(e)) > 1);
        if (suppress) SYNTH = null;
        try {
            if (isFrac) {
                var frac = fracPowStatements(call.name, call.params, rest, e, line), fi;
                for (fi = 0; fi < frac.length; fi++) doStatement(frac[fi], line, sub);
            } else {
                e = Math.round(e);
                if (e !== 0) {
                    doStatement(call.name + ptxt + (rest ? ' ' + rest : ''), line, one);
                    if (e < 0) { one = invertGates(one, line); e = -e; }
                    if (e > MAX_POW) throw new QasmError(line,
                        'pow(' + e + ') @ ' + call.name + ' would emit more than ' + MAX_POW + ' gates',
                        'a power of a phase gate folds into the angle and costs nothing; ' +
                        'this one does not, so it really is that many gates.');
                    sub = repeatGates(one, e);
                }
            }
        } catch (err) {
            if (err.name === 'QasmError' && prevSynth && suppress)
                err.hint = (err.hint ? err.hint + '\n\n' : '') +
                    'Approximate synthesis is on, but it does not apply under ' +
                    (C > 0 ? 'ctrl @' : 'pow(k) @') + '. A synthesized word carries ' +
                    'whatever global phase it has, which is invisible — until it is ' +
                    (C > 0 ? 'controlled, when it becomes a relative phase on the control qubit. '
                           : 'repeated, when the error it is allowed grows with k. ') +
                    'Synthesize the rotation as its own gate and control that, if that ' +
                    'is really what you mean.';
            throw err;
        } finally { SYNTH = prevSynth; }
        if (!sub.length) return;
        if (C) sub = controlGates(sub, cq, line);
        for (i = 0; i < C; i++) if (f.ctrls[i]) gates.push(['x', cq[i]]);
        for (i = 0; i < sub.length; i++) gates.push(sub[i]);
        for (i = C - 1; i >= 0; i--) if (f.ctrls[i]) gates.push(['x', cq[i]]);
    }

    for (si = 0; si < stmts.length; si++) {
        st = stmts[si];
        doStatement(st.text, st.line, gates, st);
    }

    if (nq === 0) throw new QasmError(1, 'no qreg declared',
        'start with: OPENQASM 2.0; include "qelib1.inc"; qreg q[2];');

    /* A measurement can be deferred only in the terminal measurement suffix.
     * Classical feedback is not the sole reason to collapse: H; measure; H
     * is a mixture, not H; H followed by a final measurement. Decide before
     * optimization so an exact unitary rewrite cannot erase this boundary. */
    var sawMeasurement = false;
    for (var di = 0; di < gates.length; di++) {
        if (gates[di][0] === 'measure') sawMeasurement = true;
        else if (sawMeasurement) dynamic = true;
    }

    var compressed = opts && opts.mode === 'compressed';
    if (compressed) {
        if (dynamic) throw new QasmError(1,
            'compressed observables require a circuit without intermediate measurement, feedback or reset',
            'choose Statevector for dynamic circuits');
        /* Only terminal readout is meaningful here. Do this before rewriting:
         * a measurement followed by cancelling gates is still intermediate. */
        var seenReadout = false;
        for (var mi = 0; mi < gates.length; mi++) {
            if (gates[mi][0] === 'measure') seenReadout = true;
            else if (seenReadout && gates[mi][0] !== 'gphase') throw new QasmError(1,
                'compressed observables support measurements only at the end',
                'move readout to the end of a unitary circuit');
        }
    }

    /* Phases still use pi/8 units here. Simplify before choosing the ring
     * and container: cancelled odd phases may no longer need Z[zeta_16],
     * and cancelled Hadamards must not inflate the sparse support bound.
     * The rewrite preserves the entire unitary, including global phase.
     * Tests and raw-kernel benchmarks can explicitly opt out. */
    var optimization = null;
    if (OPT && (!opts || opts.optimize !== false)) {
        var simplified = OPT.optimize(gates, nq, 16);
        gates = simplified.gates;
        optimization = simplified.stats;
    }

    if (compressed) {
        var observableGates = [], ignoredGlobalPhases = 0;
        for (var ci = 0; ci < gates.length; ci++) {
            var cg = gates[ci];
            if (cg[0] === 'measure') continue;
            /* Global phase cancels in every observable. In particular an
             * odd global phase alone must not require the larger ring. */
            if (cg[0] === 'gphase') { ignoredGlobalPhases++; continue; }
            if (cg[0] === 'zpow' || cg[0] === 'mcpow') {
                if (cg[2] % 2 !== 0) throw new QasmError(1,
                    'compressed observables currently require phases on the pi/4 lattice',
                    'choose Statevector for relative pi/8 phases');
                cg = cg.slice(); cg[2] /= 2;
            }
            observableGates.push(cg);
        }
        /* This mode never allocates the physical 2^n state. Its own backend
         * validates the gate set and active rank before allocating 2^r. */
        return {
            n: nq, nc: nc, qregs: qregs, cregs: cregs, ring: 8,
            gates: observableGates, measures: measures, warnings: warnings,
            backend: 'compressed', supportBound: null, dynamic: false,
            optimization: optimization, ignoredGlobalPhases: ignoredGlobalPhases
        };
    }

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
            if (ge[0] === 'if') { scanPhases(ge[2]); if (ge[3]) scanPhases(ge[3]); continue; }
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
                if (list[gi][0] === 'if') {
                    dropOddGlobal(list[gi][2]);
                    if (list[gi][3]) dropOddGlobal(list[gi][3]);
                    continue;
                }
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
            if (ge[0] === 'if') { halvePhases(ge[2]); if (ge[3]) halvePhases(ge[3]); continue; }
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
        /* SparseState has no collapse or classical register. A dynamic
         * circuit stays on the dense backend even with very small support. */
        bound = dynamic ? Math.pow(2, nq) : sparsePlan(gates, nq);
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
        dynamic: dynamic, optimization: optimization
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
        if (!q3Detect(src)) r = parse2(src, opts);
        else {
            var tr = q3Translate(src);
            try { r = parse2(tr.text, opts); }
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
