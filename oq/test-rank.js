/* Exact Pauli-observable checks for the rank-compressed OQ backend.
 * Run: node oq/test-rank.js
 * The dense oracle uses OQ.amp and independent polynomial convolution;
 * no OQRANK arithmetic or frame helpers are used to compute expected values.
 */
'use strict';

const assert = require('node:assert/strict');
const OQ = require('./oq.js');
const OQRANK = require('./oqrank.js');
const QASM = require('./qasm.js');

const ZERO = [0n, 0n, 0n, 0n];
const ONE = [1n, 0n, 0n, 0n];
const report = {
    status: 'passed', seed: 20260921, denseCircuits: 0, randomCircuits: 0,
    expectationComparisons: 0, probabilityComparisons: 0, normChecks: 0,
    stepExecutions: 0, analyticChecks: 0, validationChecks: 0,
    parserChecks: 0, largeRegisterQubits: 100, largeRegisterRank: null,
    largeRegisterStoredAmplitudes: null, targetedCases: []
};
let randomState = report.seed >>> 0;
function random(n) {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) % n;
}

function add(a, b) { return a.map((value, i) => value + b[i]); }
function negate(a) { return a.map(value => -value); }
function multiply(a, b) {
    const expanded = Array(7).fill(0n);
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) expanded[i + j] += a[i] * b[j];
    }
    for (let degree = 6; degree >= 4; degree--) expanded[degree - 4] -= expanded[degree];
    return expanded.slice(0, 4);
}
function conjugate(a) { return [a[0], -a[3], -a[2], -a[1]]; }
function rootPower(k) {
    k = ((k % 8) + 8) % 8;
    const a = [0n, 0n, 0n, 0n];
    a[k % 4] = k >= 4 ? -1n : 1n;
    return a;
}
function canonical(numerator, denominatorExp) {
    numerator = numerator.slice();
    while (denominatorExp && numerator.every(value => value % 2n === 0n)) {
        numerator = numerator.map(value => value / 2n);
        denominatorExp--;
    }
    return { numerator, denominatorExp };
}
function parity(mask) {
    let answer = 0;
    while (mask) { answer ^= 1; mask &= mask - 1n; }
    return answer;
}
function denseAmplitude(state, basis) {
    const a = state.amp(basis);
    return [a.c0, a.c1, a.c2, a.c3];
}
function denseExpectation(state, pauli) {
    let numerator = ZERO;
    const phase = rootPower(2 * pauli.phase);
    for (let basis = 0; basis < state.size; basis++) {
        const destination = Number(BigInt(basis) ^ pauli.x);
        let term = multiply(conjugate(denseAmplitude(state, destination)),
                            multiply(phase, denseAmplitude(state, basis)));
        if (parity(BigInt(basis) & pauli.z)) term = negate(term);
        numerator = add(numerator, term);
    }
    return canonical(numerator, 2 * state.denom);
}
function denseProbabilityOne(state, q) {
    let numerator = ZERO;
    for (let basis = 0; basis < state.size; basis++) {
        if (!(basis & (1 << q))) continue;
        const amplitude = denseAmplitude(state, basis);
        numerator = add(numerator, multiply(conjugate(amplitude), amplitude));
    }
    return canonical(numerator, 2 * state.denom);
}
function compareExact(actual, wanted, name) {
    assert.ok(Array.isArray(actual.numerator) && actual.numerator.length === 4, name + ': four ring coefficients');
    assert.ok(actual.numerator.every(value => typeof value === 'bigint'), name + ': BigInt arithmetic');
    assert.ok(Number.isInteger(actual.denominatorExp) && actual.denominatorExp >= 0, name + ': denominator');
    const value = { numerator: actual.numerator, denominatorExp: actual.denominatorExp };
    assert.deepEqual(value, canonical(value.numerator, value.denominatorExp), name + ': canonical powers of two');
    assert.deepEqual(value, wanted, name);
}

function allPaulis(n) {
    const paulis = [];
    for (let word = 0; word < 4 ** n; word++) {
        let x = 0n, z = 0n, phase = 0;
        for (let q = 0; q < n; q++) {
            const letter = (word >> (2 * q)) & 3;
            if (letter === 1 || letter === 2) x |= 1n << BigInt(q);
            if (letter === 2 || letter === 3) z |= 1n << BigInt(q);
            if (letter === 2) phase++;
        }
        paulis.push({ x, z, phase: phase % 4 });
    }
    return paulis;
}
function samplePaulis(n) {
    const paulis = [{ x: 0n, z: 0n, phase: 0 }];
    for (let q = 0; q < n; q++) {
        const bit = 1n << BigInt(q);
        paulis.push({ x: bit, z: 0n, phase: 0 }, { x: bit, z: bit, phase: 1 }, { x: 0n, z: bit, phase: 0 });
    }
    for (let i = 0; i < 16; i++) {
        const x = BigInt(random(1 << n)), z = BigInt(random(1 << n));
        paulis.push({ x, z, phase: parity(x & z) + 2 * random(2) });
    }
    return paulis;
}

function checkCircuit(name, gates, n, exhaustive) {
    const dense = OQ.run(gates, n);
    const plan = OQRANK.plan(gates, n, { maxRank: 16 });
    assert.ok(plan.rank >= 0 && plan.rank <= n, name + ': binary rank');
    assert.equal(plan.size, 2 ** plan.rank, name + ': active-space size');
    assert.equal(plan.tCount, gates.filter(g => g[0] === 'zpow' && Math.abs(g[2] % 2) === 1).length,
                 name + ': odd phase count');
    const state = OQRANK.create(plan);
    let steps = 0;
    while (state.step()) {
        steps++;
        assert.ok(steps <= plan.tCount, name + ': bounded stepping');
    }
    assert.equal(steps, plan.tCount, name + ': all non-Clifford rotations completed');
    assert.equal(state.done, steps, name + ': progress counter');
    assert.equal(state.step(), false, name + ': completed step is idempotent');
    assert.equal(state.coefficients.length, plan.size, name + ': compressed allocation');
    assert.equal(state.checkNorm().ok, true, name + ': exact norm');
    report.stepExecutions += steps;
    report.normChecks++;
    for (const pauli of exhaustive ? allPaulis(n) : samplePaulis(n)) {
        compareExact(state.expectation(pauli), denseExpectation(dense, pauli), name + ': Pauli');
        report.expectationComparisons++;
    }
    for (let q = 0; q < n; q++) {
        compareExact(state.probabilityOne(q), denseProbabilityOne(dense, q), name + ': marginal ' + q);
        report.probabilityComparisons++;
    }
    report.denseCircuits++;
    return state;
}

function analytic(state, pauli, numerator, denominatorExp, name) {
    compareExact(state.expectation(pauli), { numerator, denominatorExp }, name);
    report.analyticChecks++;
}

function targetedChecks() {
    const cases = [
        ['empty', 1, []],
        ['TH_positive_Y', 1, [['h', 0], ['zpow', 0, 1]]],
        ['TDGH_negative_Y', 1, [['h', 0], ['zpow', 0, 7]]],
        ['negative_X_axis', 1, [['h', 0], ['x', 0], ['zpow', 0, 1], ['h', 0]]],
        ['Bell_correlation', 2, [['h', 0], ['cx', 0, 1]]],
        ['two_Y_axis', 2, [['zpow', 0, 6], ['zpow', 1, 6], ['h', 0], ['h', 1], ['cx', 0, 1], ['zpow', 1, 1]]],
        ['nonorthogonal_basis', 3, [['h', 0], ['h', 1], ['cx', 0, 1], ['zpow', 1, 1], ['zpow', 0, 1],
                                   ['zpow', 1, 2], ['h', 0], ['cx', 1, 2]]],
        ['CZ_and_SWAP', 3, [['h', 0], ['h', 1], ['mcpow', 3, 4, [0, 1]], ['zpow', 0, 1],
                            ['swap', 0, 2], ['h', 1], ['mcpow', 6, 4, [1, 2]], ['h', 2]]],
        ['global_phase_observables', 2, [['gphase', 3], ['h', 0], ['zpow', 0, 1], ['cx', 0, 1], ['gphase', -6]]],
        ['initial_T_rank_zero', 3, [['zpow', 0, 1], ['zpow', 1, 7], ['x', 2], ['zpow', 2, 3]]],
        ['T_TDG_cancellation', 2, [['h', 0], ['cx', 0, 1], ['zpow', 1, 1], ['zpow', 1, 7]]]
    ];
    for (const [name, n, gates] of cases) {
        const state = checkCircuit(name, gates, n, true);
        report.targetedCases.push(name);
        if (name === 'TH_positive_Y' || name === 'TDGH_negative_Y') {
            analytic(state, { x: 1n, z: 0n, phase: 0 }, [0n, 1n, 0n, -1n], 1, name + ' X');
            analytic(state, { x: 1n, z: 1n, phase: 1 },
                     name === 'TH_positive_Y' ? [0n, 1n, 0n, -1n] : [0n, -1n, 0n, 1n], 1, name + ' Y');
        }
        if (name === 'Bell_correlation') {
            analytic(state, { x: 0n, z: 3n, phase: 0 }, ONE, 0, 'Bell ZZ correlation');
            analytic(state, { x: 3n, z: 3n, phase: 2 }, [-1n, 0n, 0n, 0n], 0, 'Bell YY sign');
            for (let q = 0; q < 2; q++) {
                compareExact(state.probabilityOne(q), { numerator: ONE, denominatorExp: 1 }, 'Bell marginal half');
                report.analyticChecks++;
            }
        }
        if (name === 'initial_T_rank_zero') assert.equal(state.coefficients.length, 1);
        if (name === 'nonorthogonal_basis') assert.equal(state.coefficients.length, 4);
    }
    for (let k = 0; k < 8; k++) {
        checkCircuit('every_zpow_' + k, [['h', 0], ['zpow', 0, k], ['h', 0], ['zpow', 0, k - 8]], 1, true);
    }
    report.targetedCases.push('all_zpow_residues_and_negative_exponents');
    const convenience = OQRANK.run([['h', 0], ['zpow', 0, 1]], 1, { maxRank: 1 });
    analytic(convenience, { x: 1n, z: 1n, phase: 1 }, [0n, 1n, 0n, -1n], 1, 'run convenience');
}

function randomCircuit(n, length) {
    const gates = [];
    for (let i = 0; i < length; i++) {
        const choice = random(n > 1 ? 9 : 6), q = random(n);
        if (choice <= 1) gates.push(['h', q]);
        else if (choice === 2) gates.push(['x', q]);
        else if (choice <= 4) gates.push(['zpow', q, random(33) - 16]);
        else if (choice === 5) gates.push(['gphase', random(33) - 16]);
        else {
            const other = (q + 1 + random(n - 1)) % n;
            if (choice === 6) gates.push(['cx', q, other]);
            else if (choice === 7) gates.push(['swap', q, other]);
            else gates.push(['mcpow', (1 << q) | (1 << other), 4, [q, other]]);
        }
    }
    return gates;
}

function randomChecks() {
    for (let n = 1; n <= 5; n++) {
        for (let trial = 0; trial < 24; trial++) {
            checkCircuit('random_n' + n + '_case' + trial, randomCircuit(n, 10 + random(71)), n, false);
            report.randomCircuits++;
        }
    }
    checkCircuit('long_400_gates', randomCircuit(5, 400), 5, false);
}

function largeRegisterCheck() {
    const n = 100, gates = [];
    for (let q = 0; q < n; q++) gates.push(['h', q]);
    for (const q of [0, 31, 63, 99]) gates.push(['zpow', q, 1]);
    const plan = OQRANK.plan(gates, n, { maxRank: 4 });
    assert.equal(plan.rank, 4);
    assert.equal(plan.size, 16);
    const state = OQRANK.create(plan);
    while (state.step()) report.stepExecutions++;
    assert.equal(state.coefficients.length, 16, '100-qubit simulation stores only the active 16 amplitudes');
    assert.equal(state.checkNorm().ok, true);
    report.normChecks++;
    for (const q of [0, 31, 63, 99]) {
        const bit = 1n << BigInt(q);
        analytic(state, { x: bit, z: 0n, phase: 0 }, [0n, 1n, 0n, -1n], 1, 'wide active X' + q);
        analytic(state, { x: bit, z: bit, phase: 1 }, [0n, 1n, 0n, -1n], 1, 'wide active Y' + q);
    }
    analytic(state, { x: 1n << 80n, z: 0n, phase: 0 }, ONE, 0, 'wide untouched X');
    analytic(state, { x: 0n, z: 1n << 80n, phase: 0 }, ZERO, 0, 'wide untouched Z');
    for (const q of [0, 31, 63, 80, 99]) {
        compareExact(state.probabilityOne(q), { numerator: ONE, denominatorExp: 1 }, 'wide marginal ' + q);
        report.analyticChecks++;
    }
    assert.throws(() => OQRANK.plan(gates, n, { maxRank: 3 }), /rank|limit|cap/i);
    report.validationChecks++;
    report.largeRegisterRank = plan.rank;
    report.largeRegisterStoredAmplitudes = state.coefficients.length;
    report.targetedCases.push('100_H_gates_four_independent_T_axes');
}

function validationChecks() {
    assert.deepEqual(OQRANK.parseObservable('X0 Y1 Z7', 8), { x: 3n, z: 130n, phase: 1 });
    assert.deepEqual(OQRANK.parseObservable('- X0 Y1 Z7', 8), { x: 3n, z: 130n, phase: 3 });
    assert.deepEqual(OQRANK.parseObservable('I', 100), { x: 0n, z: 0n, phase: 0 });
    assert.deepEqual(OQRANK.parseObservable('-I', 100), { x: 0n, z: 0n, phase: 2 });
    assert.deepEqual(OQRANK.parseObservable('X99', 100), { x: 1n << 99n, z: 0n, phase: 0 });
    report.validationChecks += 5;
    for (const text of ['Q0', 'X8', 'X-1', 'X0 junk', 'Y1.5']) {
        assert.throws(() => OQRANK.parseObservable(text, 8), undefined, 'malformed observable ' + text);
        report.validationChecks++;
    }
    for (const gate of [['mcpow', 3, 2, [0, 1]], ['mcpow', 7, 4, [0, 1, 2]], ['measure', 0, 0],
                        ['if', { bits: [0], value: 1 }, [['x', 1]]], ['unknown', 0]]) {
        assert.throws(() => OQRANK.plan([gate], 3), undefined, 'unsupported gate ' + gate[0]);
        report.validationChecks++;
    }
    const state = OQRANK.run([], 2);
    assert.throws(() => state.expectation({ x: 1n, z: 1n, phase: 0 }), undefined, 'non-Hermitian observable');
    assert.throws(() => state.expectation({ x: 4n, z: 0n, phase: 0 }), undefined, 'observable outside register');
    assert.throws(() => state.probabilityOne(2), undefined, 'marginal outside register');
    report.validationChecks += 3;
    const incomplete = OQRANK.create(OQRANK.plan([['h', 0], ['zpow', 0, 1]], 1));
    assert.equal(incomplete.checkNorm().ok, true, 'intermediate compressed coefficients retain unit norm');
    assert.throws(() => incomplete.expectation({ x: 1n, z: 0n, phase: 0 }), undefined,
                  'readout must not silently expose an incomplete circuit');
    assert.throws(() => incomplete.probabilityOne(0), undefined, 'marginal requires completed execution');
    report.normChecks++;
    report.validationChecks += 2;
    const halfRoot = { numerator: [0n, 1n, 0n, -1n], denominatorExp: 1 };
    assert.equal(typeof OQRANK.toString(halfRoot), 'string');
    assert.ok(Math.abs(OQRANK.toNumber(halfRoot) - Math.SQRT1_2) < 1e-14);
    report.validationChecks += 2;
}

function parserChecks() {
    const wide = 'OPENQASM 2.0; include "qelib1.inc"; qreg q[100]; h q; t q[0]; t q[31]; t q[63]; t q[99];';
    assert.throws(() => QASM.parse(wide), undefined, 'statevector mode must retain its dense/sparse limit');
    const program = QASM.parse(wide, { mode: 'compressed' });
    assert.equal(program.backend, 'compressed');
    assert.equal(program.ring, 8);
    assert.equal(program.n, 100);
    const plan = OQRANK.plan(program.gates, program.n, { maxRank: 4 });
    assert.equal(plan.rank, 4);
    assert.equal(plan.size, 16);
    const prefix = 'OPENQASM 2.0; include "qelib1.inc"; qreg q[2]; ';
    assert.throws(() => QASM.parse(prefix + 'h q[0]; p(pi/8) q[0];', { mode: 'compressed' }), undefined,
                  'compressed mode only supports ring8');
    assert.throws(() => QASM.parse(prefix + 'creg c[1]; h q[0]; measure q[0] -> c[0]; if(c==1) x q[1];',
                                  { mode: 'compressed' }), undefined, 'compressed mode rejects dynamic circuits');
    assert.throws(() => QASM.parse(prefix + 'h q[0]; reset q[0];', { mode: 'compressed' }), undefined,
                  'compressed mode rejects reset');
    assert.throws(() => QASM.parse(prefix + 'creg c[1]; h q[0]; measure q[0] -> c[0]; h q[1]; h q[1];',
                                  { mode: 'compressed' }), undefined, 'intermediate measurement is rejected before cancellation');
    const rzSource = prefix + 'h q[0]; rz(pi/4) q[0];';
    assert.equal(QASM.parse(rzSource).ring, 16, 'statevector retains the odd global phase');
    const rzCompressed = QASM.parse(rzSource, { mode: 'compressed' });
    assert.equal(rzCompressed.ring, 8, 'observables ignore the global phase');
    assert.ok(rzCompressed.ignoredGlobalPhases >= 1, 'ignored global phase is reported');
    const rzState = OQRANK.run(rzCompressed.gates, 2);
    analytic(rzState, { x: 1n, z: 1n, phase: 1 }, [0n, 1n, 0n, -1n], 1, 'Rz observable ignores global phase');
    const terminalReadout = QASM.parse(prefix + 'creg c[2]; h q[0]; cx q[0],q[1]; measure q -> c;', { mode: 'compressed' });
    assert.equal(terminalReadout.backend, 'compressed');
    assert.equal(terminalReadout.dynamic, false);
    assert.equal(terminalReadout.measures.length, 2);
    const bell = OQRANK.run(terminalReadout.gates, 2);
    analytic(bell, { x: 0n, z: 3n, phase: 0 }, ONE, 0, 'parsed Bell ZZ');
    report.parserChecks += 8;
}

assert.deepEqual(multiply([0n, 1n, 0n, -1n], [0n, 1n, 0n, -1n]), [2n, 0n, 0n, 0n]);
for (let i = 0; i < 8; i++) {
    assert.deepEqual(conjugate(rootPower(i)), rootPower(-i));
    for (let j = 0; j < 8; j++) assert.deepEqual(multiply(rootPower(i), rootPower(j)), rootPower(i + j));
}
targetedChecks();
randomChecks();
largeRegisterCheck();
validationChecks();
parserChecks();
console.log(JSON.stringify(report, null, 2));
