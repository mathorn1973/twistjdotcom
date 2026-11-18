'use strict';

const assert = require('node:assert/strict');
const lessons = require('./lessons.js');
const QASM = require('./qasm.js');
const dense = require('./oq.js');
const sparse = require('./oqsparse.js');
const synth = require('./oqsynth.js');

function checkDistribution(source, n, expected, label) {
    for (const optimize of [false, true]) {
        const program = QASM.parse(source, { optimize });
        assert.equal(program.n, n, label);
        assert.equal(program.ring, 8, label);
        assert.equal(program.dynamic, false, label);

        const states = [
            { state: dense.run(program.gates, n), key: Number, name: 'dense' },
            { state: sparse.run(program.gates, n), key: BigInt, name: 'sparse' },
        ];
        for (const { state, key, name } of states) {
            const denominator = 1n << BigInt(2 * state.denom);
            for (let outcome = 0; outcome < 2 ** n; outcome++) {
                const [rational, radical, scale] = expected(outcome);
                const { S, X } = state.bornPair(key(outcome));
                const context = `${label}, ${name}, optimize=${optimize}, outcome=${outcome}`;
                assert.equal(S * scale, rational * denominator, context);
                assert.equal(X * scale, radical * denominator, context);
            }
        }
    }
}

// The two paths have equal magnitudes before H. The final H gives
// P(0)=(1+cos(πk/4))/2 and P(1)=1-P(0) for k eighth-turns.
for (const [turn, expectedZero] of [
    [0, [1n, 0n, 1n]],
    [1, [2n, 1n, 4n]],
    [2, [1n, 0n, 2n]],
    [4, [0n, 0n, 1n]],
]) {
    checkDistribution(lessons.phase(turn, false), 1, () => [1n, 0n, 2n], `phase ${turn}, direct`);
    const [rational, radical, scale] = expectedZero;
    checkDistribution(lessons.phase(turn, true), 1, outcome => outcome
        ? [scale - rational, -radical, scale]
        : expectedZero, `phase ${turn}, Hadamard readout`);
}

// One oracle flip followed by reflection about the mean changes the marked
// amplitude to (3-4/N)/sqrt(N) and every other amplitude to (1-4/N)/sqrt(N).
for (const n of [2, 3]) {
    const count = 1n << BigInt(n);
    const marked = (3n * count - 4n) ** 2n;
    const other = (count - 4n) ** 2n;
    for (let target = 0; target < Number(count); target++) {
        checkDistribution(lessons.grover(n, target, false), n,
            () => [1n, 0n, count], `Grover ${n}, target ${target}, initial`);
        checkDistribution(lessons.grover(n, target, true), n,
            outcome => [outcome === target ? marked : other, 0n, count ** 3n],
            `Grover ${n}, target ${target}, one iteration`);
    }
}

// The off-lattice ansatz in the public Matematyka OQ console requires explicit
// opt-in. Its synthesized circuit and its per-rotation estimates are separate
// from the exact parser contract.
const ansatz = [
    'OPENQASM 3;',
    'include "stdgates.inc";',
    'qubit[2] q;',
    'h q[0];',
    'rx(0.354 * pi) q[0];',
    'ry(0.218 * pi) q[1];',
    'cx q[0], q[1];',
    'rz(0.412 * pi) q[1];',
].join('\n');
const exactRefusal = { name: 'QasmError', message: /no exact representative/ };
assert.throws(() => QASM.parse(ansatz), exactRefusal);
const epsilon = 1e-3;
const approximate = QASM.parse(ansatz, { synth, eps: epsilon });
assert.deepEqual(approximate.synthesis.map(({ gate }) => gate), ['rx', 'ry', 'rz']);
assert.equal(approximate.synthEps, epsilon);
for (const { err } of approximate.synthesis) {
    assert.ok(Number.isFinite(err) && err >= 0 && err <= epsilon);
}
assert.throws(() => QASM.parse(ansatz), exactRefusal);
console.log('PASS phase and Grover lessons against exact Born probabilities, plus explicit synthesis opt-in');
