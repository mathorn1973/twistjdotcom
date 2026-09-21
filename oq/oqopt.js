/*
 * oqopt.js -- exact affine-phase reductions for Ordinary Quantum.
 *
 * Between Hadamards and other barriers, X/CX/SWAP make every wire an affine
 * form f(x) = a.x XOR b over F_2. A phase on that wire contributes
 *
 *     k f(x) = k b + (-1)^b k (a.x)              modulo the phase order.
 *
 * Equal linear forms therefore share a phase coefficient, even when CNOTs
 * separate their occurrences. Keep the first occurrence as the anchor and
 * add the constant correction as an exact global phase. This preserves the
 * whole unitary, including the global phase used by OQ's fingerprints.
 *
 * Affine gates retain their order. H, controlled phases (AND, not XOR),
 * measurements, conditional blocks and unknown operations are barriers.
 * No measurement probabilities or floating-point amplitudes are involved.
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.OQOPT = api;
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

function mod(k, order) { return ((k % order) + order) % order; }
function isPhase(g) { return g[0] === 'zpow' || g[0] === 'mcpow' || g[0] === 'gphase'; }

function validate(gates, n, order) {
    if (!Array.isArray(gates)) throw new Error('optimizer gates must be an array');
    if (!Number.isSafeInteger(n) || n < 1) throw new Error('optimizer needs a positive qubit count');
    if (order !== 8 && order !== 16) throw new Error('optimizer phase order must be 8 or 16');
    function qubit(q) {
        if (!Number.isSafeInteger(q) || q < 0 || q >= n)
            throw new Error('optimizer qubit outside the register');
    }
    for (var i = 0; i < gates.length; i++) {
        var g = gates[i], op;
        if (!Array.isArray(g) || typeof g[0] !== 'string')
            throw new Error('invalid optimizer gate');
        op = g[0];
        if (isPhase(g) && !Number.isSafeInteger(g[op === 'gphase' ? 1 : 2]))
            throw new Error('optimizer phase exponent must be a safe integer');
        if (op === 'x' || op === 'h' || op === 'zpow') qubit(g[1]);
        if (op === 'cx' || op === 'swap') {
            qubit(g[1]); qubit(g[2]);
            if (g[1] === g[2]) throw new Error('optimizer two-qubit gate needs distinct qubits');
        }
    }
}

/* Reuse an unchanged instruction, and never mutate the caller's gate list. */
function phaseWith(g, k, order) {
    var at = g[0] === 'gphase' ? 1 : 2;
    if (mod(g[at], order) === k) return g;
    var out = g.slice();
    out[at] = k;
    return out;
}

/* Only adjacent, exact identities. In particular, no up-to-global-phase
 * Clifford identities and no movement through classical control. */
function clean(gates, order) {
    var out = [], i, g, p, k, op;
    for (i = 0; i < gates.length; i++) {
        g = gates[i]; op = g[0];
        if ((op === 'zpow' || op === 'gphase') &&
            mod(g[op === 'gphase' ? 1 : 2], order) === 0) continue;
        p = out[out.length - 1];
        if (p && p[0] === op) {
            if (((op === 'x' || op === 'h') && p[1] === g[1]) ||
                (op === 'cx' && p[1] === g[1] && p[2] === g[2]) ||
                (op === 'swap' && ((p[1] === g[1] && p[2] === g[2]) ||
                                  (p[1] === g[2] && p[2] === g[1])))) {
                out.pop();
                continue;
            }
            if ((op === 'zpow' && p[1] === g[1]) || op === 'gphase') {
                var at = op === 'gphase' ? 1 : 2;
                /* Reduce separately: two individually safe raw exponents
                 * need not have a safely representable sum. */
                k = mod(mod(p[at], order) + mod(g[at], order), order);
                out.pop();
                if (k) out.push(phaseWith(p, k, order));
                continue;
            }
        }
        out.push(g);
    }
    return out;
}

function affinePass(gates, order) {
    var out = [], block = [], wires = new Map(), groups = new Map();
    var constant = 0, globals = 0, globalAnchor = -1;

    function wire(q) {
        var f = wires.get(q);
        if (!f) { f = { mask: 1n << BigInt(q), offset: 0 }; wires.set(q, f); }
        return f;
    }

    function flush() {
        if (!block.length) return;
        var replacements = new Map(), correction = mod(constant + globals, order);
        groups.forEach(function (group) {
            var k = mod(group.offset ? -group.sum : group.sum, order);
            replacements.set(group.anchor, k);
            correction = mod(correction - (group.offset ? k : 0), order);
        });
        for (var j = 0; j < block.length; j++) {
            var g = block[j];
            if (g[0] === 'zpow') {
                var replacement = replacements.get(j);
                if (replacement) out.push(phaseWith(g, replacement, order));
            } else if (g[0] === 'gphase') {
                if (j === globalAnchor && correction) out.push(phaseWith(g, correction, order));
            } else out.push(g);
        }
        if (globalAnchor < 0 && correction) out.push(['gphase', correction]);
        block = []; wires = new Map(); groups = new Map();
        constant = 0; globals = 0; globalAnchor = -1;
    }

    for (var i = 0; i < gates.length; i++) {
        var g = gates[i], op = g[0], a, b, k, group;
        if (op === 'x') {
            a = wire(g[1]);
            wires.set(g[1], { mask: a.mask, offset: a.offset ^ 1 });
        } else if (op === 'cx') {
            a = wire(g[1]); b = wire(g[2]);
            wires.set(g[2], { mask: a.mask ^ b.mask, offset: a.offset ^ b.offset });
        } else if (op === 'swap') {
            a = wire(g[1]); b = wire(g[2]);
            wires.set(g[1], b); wires.set(g[2], a);
        } else if (op === 'zpow') {
            a = wire(g[1]); k = mod(g[2], order);
            group = groups.get(a.mask);
            if (!group) {
                group = { anchor: block.length, offset: a.offset, sum: 0 };
                groups.set(a.mask, group);
            }
            group.sum = mod(group.sum + (a.offset ? -k : k), order);
            if (a.offset) constant = mod(constant + k, order);
        } else if (op === 'gphase') {
            if (globalAnchor < 0) globalAnchor = block.length;
            globals = mod(globals + mod(g[1], order), order);
        } else {
            flush();
            out.push(g);
            continue;
        }
        block.push(g);
    }
    flush();
    return out;
}

function countPhases(gates) {
    var count = 0;
    for (var i = 0; i < gates.length; i++) if (isPhase(gates[i])) count++;
    return count;
}

function optimize(gates, n, modulus) {
    var order = modulus === undefined ? 16 : modulus;
    validate(gates, n, order);
    var optimized = clean(gates, order), before = optimized.length;
    /* Cancellations can remove a barrier and join two affine blocks. Allow
     * one more pass after a reduction, keeping preprocessing bounded even on
     * adversarial nested circuits. No circuit is expanded by these rules. */
    optimized = clean(affinePass(optimized, order), order);
    if (optimized.length < before)
        optimized = clean(affinePass(optimized, order), order);
    return {
        gates: optimized,
        stats: {
            inputGates: gates.length,
            outputGates: optimized.length,
            phasesBefore: countPhases(gates),
            phasesAfter: countPhases(optimized),
            removedGates: gates.length - optimized.length
        }
    };
}

return { optimize: optimize };
}));
