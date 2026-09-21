/* Exact regression checks for OQ's affine-parity phase optimizer.
 * Run: node oq/test-optimizer.js
 * Standard library only; deterministic and deliberately small.
 */
'use strict';

const assert = require('node:assert/strict');
const OQ = require('./oq.js');
const OQ16 = require('./oq16.js');
const OQS = require('./oqsparse.js');
const OQOPT = require('./oqopt.js');
const QASM = require('./qasm.js');

const report = {
    status: 'passed', seed: 20260921,
    optimizerCases: 0, randomCircuits: 0, fullStateComparisons: 0,
    basisInputsChecked: 0, dynamicTrajectories: 0, sparseComparisons: 0,
    parserCases: 0, lossyFallbackTrajectories: 0, lossyFallbackHashDifferences: 0,
    targetedCases: []
};
let randomState = report.seed >>> 0;
function random(n) {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) % n;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function optimize(gates, n, modulus) {
    const before = clone(gates);
    const result = OQOPT.optimize(gates, n, modulus);
    assert.deepEqual(gates, before, 'optimizer mutated its input gate tree');
    assert.ok(Array.isArray(result.gates), 'optimizer result must have gates');
    assert.ok(result.stats && typeof result.stats === 'object', 'optimizer must return stats');
    report.optimizerCases++;
    return result.gates;
}

function inputGates(n, basis) {
    const gates = [];
    for (let q = 0; q < n; q++) if (basis & (1 << q)) gates.push(['x', q]);
    return gates;
}

function compareState(left, right, context) {
    assert.equal(left.n, right.n, context + ': register');
    assert.equal(left.denom, right.denom, context + ': denominator');
    for (let basis = 0; basis < left.size; basis++) {
        assert.deepEqual(left.amp(basis), right.amp(basis), context + ': amplitude ' + basis);
    }
    assert.equal(left.hash(), right.hash(), context + ': exact hash including global phase');
    if (left.cbits) {
        assert.deepEqual(left.cbits, right.cbits, context + ': classical bits');
        assert.equal(left.measured, right.measured, context + ': measurement count');
        assert.deepEqual(left.normPair(), right.normPair(), context + ': carried norm');
    }
    report.fullStateComparisons++;
}

function checkCircuit(name, gates, n, modulus, optimized) {
    const after = optimized || optimize(gates, n, modulus);
    const engine = modulus === 16 ? OQ16 : OQ;
    for (let basis = 0; basis < (1 << n); basis++) {
        const input = inputGates(n, basis);
        compareState(engine.run(input.concat(gates), n), engine.run(input.concat(after), n),
                     name + ' ring' + modulus + ' input' + basis);
        report.basisInputsChecked++;
    }
    return after;
}

function targetedChecks() {
    const cases = [
        ['empty', 1, []],
        ['adjacent_H_cancellation', 2, [['h', 0], ['h', 0]]],
        ['phase_sum_wraparound', 1, [['zpow', 0, 17], ['zpow', 0, -1]]],
        ['complemented_phase_global', 1,
            [['x', 0], ['zpow', 0, 1], ['x', 0], ['zpow', 0, 1]]],
        ['complemented_phase_negative', 1,
            [['zpow', 0, -3], ['x', 0], ['zpow', 0, 5], ['gphase', -19], ['x', 0]]],
        ['CX_phase_recurrence', 2,
            [['cx', 0, 1], ['zpow', 1, 3], ['cx', 0, 1],
             ['x', 0], ['cx', 0, 1], ['zpow', 1, 5], ['cx', 0, 1]]],
        ['same_parity_different_wire', 2,
            [['zpow', 0, 3], ['cx', 0, 1], ['swap', 0, 1], ['zpow', 1, 5]]],
        ['SWAP_phase_transport', 3,
            [['h', 0], ['zpow', 0, 1], ['swap', 0, 2], ['x', 2],
             ['zpow', 2, -1], ['cx', 2, 1], ['swap', 1, 0], ['h', 2]]],
        ['nonlinear_mcpow_barrier', 3,
            [['h', 0], ['h', 1], ['zpow', 0, 1], ['cx', 0, 2],
             ['mcpow', 7, 3, [0, 1, 2]], ['zpow', 0, -1],
             ['cx', 2, 1], ['zpow', 1, 5], ['h', 0]]],
        ['Hadamard_separates_parities', 1,
            [['zpow', 0, 1], ['h', 0], ['zpow', 0, -1]]],
        ['global_phase_sums', 2,
            [['gphase', 1], ['h', 0], ['gphase', -17], ['x', 1], ['gphase', 3]]]
    ];
    for (const [name, n, gates] of cases) {
        for (const modulus of [8, 16]) checkCircuit(name, gates, n, modulus);
        report.targetedCases.push(name);
    }
    assert.deepEqual(optimize([['h', 0], ['h', 0]], 1, 16), [], 'adjacent H pair should vanish');
    const combined = optimize([['zpow', 0, 1], ['zpow', 0, 1]], 1, 16);
    assert.ok(combined.length < 2, 'identical parity phases should combine');
    const complemented = optimize([['x', 0], ['zpow', 0, 1], ['x', 0], ['zpow', 0, 1]], 1, 16);
    assert.ok(complemented.some(g => g[0] === 'gphase'), 'complemented parity must retain global phase');
    const defaults = [['zpow', 0, 9], ['zpow', 0, 1]];
    assert.deepEqual(OQOPT.optimize(clone(defaults), 1).gates,
                     OQOPT.optimize(clone(defaults), 1, 16).gates, 'default modulus is 16');
}

function randomCircuit(n) {
    const gates = [];
    const length = 12 + random(29);
    for (let i = 0; i < length; i++) {
        const choice = random(n > 1 ? 9 : 5);
        const q = random(n);
        if (choice === 0) gates.push(['h', q]);
        else if (choice === 1) gates.push(['x', q]);
        else if (choice <= 3) gates.push(['zpow', q, random(65) - 32]);
        else if (choice === 4) gates.push(['gphase', random(65) - 32]);
        else {
            const other = (q + 1 + random(n - 1)) % n;
            if (choice <= 6) gates.push(['cx', q, other]);
            else if (choice === 7) gates.push(['swap', q, other]);
            else gates.push(['mcpow', (1 << q) | (1 << other), random(33) - 16, [q, other]]);
        }
    }
    return gates;
}

function randomChecks() {
    for (const modulus of [8, 16]) {
        for (let n = 1; n <= 4; n++) {
            for (let trial = 0; trial < 24; trial++) {
                checkCircuit('random' + trial, randomCircuit(n), n, modulus);
                report.randomCircuits++;
            }
        }
    }
}

function dynamicChecks() {
    const gates = [
        ['h', 0], ['zpow', 0, 1], ['zpow', 0, 7], ['measure', 0, 0],
        ['if', { bits: [0], value: 1 }, [
            ['h', 1], ['h', 1], ['zpow', 1, 1], ['x', 1], ['zpow', 1, 1],
            ['if', { bits: [0], value: 1 }, [
                ['cx', 1, 2], ['zpow', 2, 3], ['zpow', 2, -3]
            ]], ['measure', 1, 1]
        ]],
        ['if', { bits: [0], value: 0 }, [
            ['h', 1], ['zpow', 1, 3], ['zpow', 1, 5], ['measure', 1, 1],
            ['if', { bits: [1], value: 1 }, [['x', 2], ['zpow', 2, 3], ['zpow', 2, -3]]]
        ]],
        ['h', 2], ['measure', 2, 2]
    ];
    const optimized = optimize(gates, 3, 8);
    const outcomes = new Set();
    for (let seed = 0; seed < 32; seed++) {
        const original = OQ.run(gates, 3, seed);
        compareState(original, OQ.run(optimized, 3, seed), 'nested dynamic seed' + seed);
        outcomes.add(original.cbits[0]);
        report.dynamicTrajectories++;
    }
    assert.equal(outcomes.size, 2, 'seed set must exercise both top-level branches');
    report.targetedCases.push('nested_if_and_measurement_barriers');
}

function sparseChecks() {
    const n = 100;
    const gates = [
        ['h', 0], ['h', 31], ['h', 63], ['zpow', 99, 1], ['x', 99],
        ['zpow', 99, 1], ['cx', 99, 31], ['zpow', 31, 3],
        ['swap', 31, 63], ['zpow', 63, -3], ['cx', 0, 99],
        ['zpow', 99, 5], ['swap', 99, 0], ['zpow', 0, 3],
        ['mcpow', null, 4, [0, 31, 63, 99]], ['h', 63], ['h', 63]
    ];
    const optimized = optimize(gates, n, 8);
    for (let sample = 0; sample < 16; sample++) {
        const prep = [];
        for (let i = 0; i < 4; i++) if (sample & (1 << i)) prep.push(['x', [0, 31, 63, 99][i]]);
        const a = OQS.run(prep.concat(gates), n, 64, true);
        const b = OQS.run(prep.concat(optimized), n, 64, true);
        assert.equal(a.denom, b.denom, '100-qubit sparse denominator');
        assert.deepEqual(a.map, b.map, '100-qubit exact sparse amplitudes');
        assert.equal(a.sparseHash(), b.sparseHash(), '100-qubit sparse hash');
        report.sparseComparisons++;
    }
    report.targetedCases.push('100_qubits_masks_above_32_bits');
}

function parserChecks() {
    const prefix = 'OPENQASM 2.0; include "qelib1.inc"; qreg q[3];\n';
    const sources = [
        ['paired_pi8_demotes_ring', prefix + 'h q[0]; p(pi/8) q[0]; p(pi/8) q[0]; cx q[0],q[1];'],
        ['cancel_pi8_across_SWAP', prefix + 'h q[0]; p(pi/8) q[0]; swap q[0],q[2]; p(-pi/8) q[2];'],
        ['complement_retains_odd_global', prefix + 'x q[0]; p(pi/8) q[0]; x q[0]; p(pi/8) q[0];'],
        ['controlled_phase_barrier', prefix + 'h q[0]; p(pi/4) q[0]; cp(pi/8) q[0],q[1]; p(-pi/4) q[0];'],
        ['QASM3_translation', 'OPENQASM 3.0; include "stdgates.inc"; qubit[2] q; h q[0]; p(pi/8) q[0]; p(pi/8) q[0]; cx q[0],q[1];']
    ];
    for (const [name, source] of sources) {
        const plain = QASM.parse(source, { optimize: false });
        const optimized = QASM.parse(source);
        assert.equal(plain.n, optimized.n, name + ': qubit count');
        assert.deepEqual(plain.measures, optimized.measures, name + ': readout metadata');
        const before = plain.ring === 8 ? OQ16.widen(plain.gates) : plain.gates;
        const after = optimized.ring === 8 ? OQ16.widen(optimized.gates) : optimized.gates;
        for (let basis = 0; basis < (1 << plain.n); basis++) {
            const prep = inputGates(plain.n, basis);
            compareState(OQ16.run(prep.concat(before), plain.n), OQ16.run(prep.concat(after), plain.n), name + ' input' + basis);
            report.basisInputsChecked++;
        }
        if (name === 'paired_pi8_demotes_ring' || name === 'cancel_pi8_across_SWAP' || name === 'QASM3_translation') {
            assert.equal(plain.ring, 16, name + ': unoptimized ring');
            assert.equal(optimized.ring, 8, name + ': optimized ring');
            assert.ok(optimized.gates.length < plain.gates.length, name + ': real gate reduction');
        }
        if (name === 'complement_retains_odd_global') assert.equal(optimized.ring, 16, 'exact odd global phase needs ring16');
        report.parserCases++;
        report.targetedCases.push(name);
    }
    const dynamicSource = prefix + 'creg c[1]; h q[0]; measure q[0] -> c[0]; ' +
        'if(c==1) t q[1]; if(c==1) tdg q[1]; if(c==0) x q[2];';
    const a = QASM.parse(dynamicSource, { optimize: false });
    const b = QASM.parse(dynamicSource);
    assert.ok(a.dynamic && b.dynamic, 'parser must retain dynamic mode');
    assert.equal(a.ring, 8); assert.equal(b.ring, 8);
    for (let seed = 0; seed < 16; seed++) {
        compareState(OQ.run(a.gates, a.n, seed), OQ.run(b.gates, b.n, seed), 'parsed dynamic seed' + seed);
        report.dynamicTrajectories++;
    }
    report.parserCases++;
}

function lossyGlobalPhaseFallbackCheck() {
    const source = 'OPENQASM 2.0; include "qelib1.inc"; qreg q[2]; creg c[1]; ' +
        'h q[0]; rz(pi/4) q[0]; rz(pi/4) q[0]; measure q[0] -> c[0]; if(c==1) x q[1];';
    const plain = QASM.parse(source, { optimize: false });
    const optimized = QASM.parse(source);
    assert.ok(plain.dynamic && optimized.dynamic);
    assert.equal(plain.ring, 8); assert.equal(optimized.ring, 8);
    assert.ok(plain.warnings.some(w => /DROPPED/.test(w)), 'legacy path must report dropped odd global phases');
    assert.ok(!optimized.warnings.some(w => /DROPPED/.test(w)), 'combined global phase is exactly representable');

    // Rz(theta)=exp(-i theta/2) diag(1,exp(i theta)). The two Rz(pi/4)
    // therefore give zpow(2) and zeta8**(-1)=zeta8**7 globally, before measure.
    // The legacy fallback drops each odd zeta16 global factor separately.
    // Its hash consequently differs even though every measurement agrees.
    const exact = [['h', 0], ['zpow', 0, 2], ['gphase', 7], ['measure', 0, 0],
                   ['if', { bits: [0], value: 1 }, [['x', 1]]]];
    const outcomes = new Set();
    for (let seed = 0; seed < 16; seed++) {
        const a = OQ.run(plain.gates, 2, seed);
        const b = OQ.run(optimized.gates, 2, seed);
        compareState(b, OQ.run(exact, 2, seed), 'exact combined Rz global phase seed' + seed);
        assert.deepEqual(a.cbits, b.cbits, 'lossy fallback classical outcomes');
        assert.equal(a.measured, b.measured, 'lossy fallback measurement count');
        assert.equal(a.denom, b.denom, 'lossy fallback denominator');
        assert.deepEqual(a.normPair(), b.normPair(), 'lossy fallback carried norm');
        for (let basis = 0; basis < a.size; basis++) {
            // With the same denominator and carried norm, equal exact Born
            // pairs prove equal normalized probabilities without floats.
            assert.deepEqual(a.bornPair(basis), b.bornPair(basis), 'lossy fallback exact probability ' + basis);
        }
        assert.notEqual(a.hash(), b.hash(), 'documented lossy fallback must change the global-phase-sensitive hash');
        outcomes.add(a.cbits[0]);
        report.dynamicTrajectories++;
        report.lossyFallbackTrajectories++;
        report.lossyFallbackHashDifferences++;
    }
    assert.equal(outcomes.size, 2, 'lossy fallback seeds must exercise both measurement outcomes');
    report.parserCases++;
    report.targetedCases.push('legacy_lossy_global_phase_fallback');
}

targetedChecks();
randomChecks();
dynamicChecks();
sparseChecks();
parserChecks();
lossyGlobalPhaseFallbackCheck();
console.log(JSON.stringify(report, null, 2));
