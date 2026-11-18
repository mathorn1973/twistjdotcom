/* Exact comparisons for the supported, bounded OQ gate set. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./qasm.js'), require('./oqcount.js'), require('./oq.js'), require('./oq16.js'));
    } else {
        root.OQCOMPARE = factory(root.QASM, root.OQCOUNT, root.OQ, root.OQ16);
    }
})(typeof self !== 'undefined' ? self : this, function (QASM, Count, OQ, OQ16) {
'use strict';

const MAX_QUBITS = 16;
const MAX_GATES = 500;
const MAX_SOURCE = 65536;
const SMALL_QUBITS = 4;
const SUPPORTED = new Set(['h', 'x', 'cx', 'swap', 'zpow', 'mcpow', 'gphase']);

function parse(source, side, unitary) {
    if (typeof source !== 'string' || source.length > MAX_SOURCE) {
        throw new TypeError(side + ' QASM must be text with at most ' + MAX_SOURCE + ' characters.');
    }
    let program;
    try {
        program = QASM.parse(source, { mode: 'exact-query', optimize: false });
    } catch (error) {
        throw new TypeError(side + ' circuit: ' + error.message);
    }
    if (program.dynamic || (unitary && program.measures.length)) {
        throw new TypeError(side + (unitary
            ? ' circuit must be unitary. Remove measurements, reset and classical feedback.'
            : ' circuit may use terminal measurements only. Reset and classical feedback are unsupported.'));
    }
    const unsupported = program.gates.find(gate => !SUPPORTED.has(gate[0]));
    if (unsupported) throw new TypeError(side + ' circuit has an unsupported gate: ' + unsupported[0] + '.');
    // QASM may retain a wire list after the mask and phase for controlled gates.
    // Count's gate interface consumes the exact mask directly.
    program.gates = program.gates.map(gate => gate[0] === 'mcpow' ? gate.slice(0, 3) : gate);
    return program;
}

function operands(left, right, unitary) {
    const a = parse(left, 'Left', unitary);
    const b = parse(right, 'Right', unitary);
    if (a.n !== b.n) throw new TypeError('Circuits must have the same number of qubits.');
    return [a, b];
}

function resourceReason(a, b) {
    if (a.n > MAX_QUBITS) return 'Comparison is limited to ' + MAX_QUBITS + ' qubits per circuit.';
    if (Math.max(a.gates.length, b.gates.length) > MAX_GATES) {
        return 'Comparison is limited to ' + MAX_GATES + ' lowered gates per circuit.';
    }
    return undefined;
}

function makeBudget(options) {
    const maxNodes = options.maxNodes === undefined ? 250000 : options.maxNodes;
    if (!Number.isInteger(maxNodes) || maxNodes < 0 || maxNodes > 500000) {
        throw new TypeError('maxNodes must be an integer from 0 through 500000.');
    }
    return {
        remaining: maxNodes,
        amplitude(program, output) {
            if (this.remaining === 0) throw new Count.LimitError('Counting node budget exhausted.');
            const query = Count.amplitude(program, output);
            const answer = Count.solve(query, { maxNodes: this.remaining });
            this.remaining -= answer.stats.nodes;
            return answer.value;
        }
    };
}

function equal(a, b) {
    return a.ring === b.ring && a.denominatorExp === b.denominatorExp &&
        a.numerator.every((coefficient, i) => coefficient === b.numerator[i]);
}

function isOne(a) {
    return a.denominatorExp === 0 && a.numerator.every((coefficient, i) => coefficient === (i === 0 ? 1n : 0n));
}

function times(a, b, conjugateB = false) {
    const degree = a.numerator.length;
    const product = Array(degree).fill(0n);
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < degree; j++) {
            const exponent = (2 * degree + i + (conjugateB ? -j : j)) % (2 * degree);
            const term = a.numerator[i] * b.numerator[j];
            product[exponent % degree] += exponent < degree ? term : -term;
        }
    }
    return Count.normalize(product, a.denominatorExp + b.denominatorExp, a.ring);
}

function squareMagnitude(value) {
    return times(value, value, true);
}

function format(value) {
    const terms = [];
    value.numerator.forEach((coefficient, exponent) => {
        if (coefficient === 0n) return;
        const magnitude = coefficient < 0n ? -coefficient : coefficient;
        const root = value.ring === 8 ? 'ζ₈' : 'ζ₁₆';
        const power = exponent === 0 ? '' : root + (exponent === 1 ? '' : '^' + exponent);
        const term = (power && magnitude === 1n ? '' : String(magnitude)) + power;
        const sign = coefficient < 0n ? '−' : '+';
        terms.push((terms.length ? ' ' + sign + ' ' : coefficient < 0n ? sign : '') + term);
    });
    const sum = terms.join('') || '0';
    if (value.denominatorExp === 0) return sum;
    const denominator = value.denominatorExp <= 16 ? String(2 ** value.denominatorExp) : '2^' + value.denominatorExp;
    return (terms.length > 1 ? '(' + sum + ')' : sum) + '/' + denominator;
}

function widen(program, ring) {
    return ring === program.ring ? program.gates : OQ16.widen(program.gates);
}

function inverse(gates) {
    return Array.from(gates).reverse().map(g => {
        if (g[0] === 'gphase') return ['gphase', -g[1]];
        if (g[0] === 'zpow' || g[0] === 'mcpow') return [g[0], g[1], -g[2]];
        return g;
    });
}

function bellComparison(a, b, ring) {
    // E followed by V, U† and E†. The reference register occupies the high bits.
    const e = [];
    for (let q = 0; q < a.n; q++) e.push(['h', a.n + q], ['cx', a.n + q, q]);
    return { n: 2 * a.n, ring, gates: [...e, ...widen(b, ring), ...inverse(widen(a, ring)), ...inverse(e)] };
}

function denseState(program, ring, input) {
    const engine = ring === 8 ? OQ : OQ16;
    const state = new engine.State(program.n);
    for (let q = 0; q < program.n; q++) if (input & (1 << q)) engine.apply(state, ['x', q]);
    for (const gate of widen(program, ring)) engine.apply(state, gate);
    return state;
}

function amplitudes(state, ring) {
    return Array.from({ length: state.size }, (_, index) => {
        const amp = state.amp(index);
        return Count.normalize(ring === 8 ? [amp.c0, amp.c1, amp.c2, amp.c3] : amp, state.denom, ring);
    });
}

function word(value, n) {
    return value.toString(2).padStart(n, '0');
}

function showEntry(entry) {
    return {
        input: entry.input, output: entry.output,
        leftAmplitude: format(entry.left), rightAmplitude: format(entry.right)
    };
}

function smallMatrix(program, ring) {
    return Array.from({ length: 2 ** program.n }, (_, input) =>
        amplitudes(denseState(program, ring, input), ring)
    );
}

function superpose(a, b, conjugatePhase) {
    const ring = a.ring;
    const denominator = Math.max(a.denominatorExp, b.denominatorExp);
    const phase = Array(ring / 2).fill(0n);
    // The bra of (|a> + i|b>)/sqrt(2) uses -i on the second coefficient.
    phase[conjugatePhase ? ring / 4 : 0] = conjugatePhase ? -1n : 1n;
    const phased = times(b, Count.normalize(phase, 0, ring));
    const sum = a.numerator.map((term, i) =>
        (term << BigInt(denominator - a.denominatorExp)) +
        (phased.numerator[i] << BigInt(denominator - phased.denominatorExp))
    );
    const inverseSqrtTwo = Array(ring / 2).fill(0n);
    inverseSqrtTwo[ring / 8] = 1n;
    inverseSqrtTwo[3 * ring / 8] = -1n;
    return times(Count.normalize(sum, denominator, ring), Count.normalize(inverseSqrtTwo, 1, ring));
}

function distinguishingProjection(left, right, n) {
    for (let out = 0; out < left.length; out++) {
        const p = squareMagnitude(left[out]), q = squareMagnitude(right[out]);
        if (!equal(p, q)) {
            return { projection: { kind: 'basis', words: [word(out, n)] }, leftProbability: format(p), rightProbability: format(q) };
        }
    }
    for (let i = 0; i < left.length; i++) {
        for (let j = i + 1; j < left.length; j++) {
            for (const kind of ['plus', 'imaginary']) {
                const p = squareMagnitude(superpose(left[i], left[j], kind === 'imaginary'));
                const q = squareMagnitude(superpose(right[i], right[j], kind === 'imaginary'));
                if (!equal(p, q)) {
                    return { projection: { kind, words: [word(i, n), word(j, n)] }, leftProbability: format(p), rightProbability: format(q) };
                }
            }
        }
    }
    return undefined;
}

function distinguishingExperiment(leftMatrix, rightMatrix, n) {
    for (let i = 0; i < leftMatrix.length; i++) {
        const result = distinguishingProjection(leftMatrix[i], rightMatrix[i], n);
        if (result) return { preparation: { kind: 'basis', words: [word(i, n)] }, ...result };
    }
    // If every basis column agrees projectively, a relative column phase is
    // exposed by an equal superposition of the corresponding basis inputs.
    for (let i = 0; i < leftMatrix.length; i++) {
        for (let j = i + 1; j < leftMatrix.length; j++) {
            const combine = matrix => matrix[i].map((amplitude, k) => superpose(amplitude, matrix[j][k], false));
            const result = distinguishingProjection(combine(leftMatrix), combine(rightMatrix), n);
            if (result) return { preparation: { kind: 'plus', words: [word(i, n), word(j, n)] }, ...result };
        }
    }
    return undefined;
}

function smallWitness(leftMatrix, rightMatrix, n, status) {
    const entries = [];
    for (let input = 0; input < leftMatrix.length; input++) {
        const left = leftMatrix[input];
        const right = rightMatrix[input];
        for (let output = 0; output < left.length; output++) {
            const entry = { input: word(input, n), output: word(output, n), left: left[output], right: right[output] };
            if (status === 'projective' && !equal(entry.left, entry.right)) {
                return { kind: 'amplitude', ...showEntry(entry) };
            }
            const p = squareMagnitude(entry.left), q = squareMagnitude(entry.right);
            if (!equal(p, q)) {
                return { kind: 'probability', ...showEntry(entry), leftProbability: format(p), rightProbability: format(q) };
            }
            if (p.numerator.some(coefficient => coefficient !== 0n)) entries.push(entry);
        }
    }
    const reference = entries[0];
    const inconsistent = entries.find(entry =>
        !equal(times(reference.left, entry.right), times(reference.right, entry.left)));
    if (!inconsistent) throw new Error('Exact matrix check did not reproduce the comparison difference.');
    return { kind: 'amplitude', ...showEntry(inconsistent), reference: showEntry(reference) };
}

function compareUnitary(left, right, options = {}) {
    const [a, b] = operands(left, right, true);
    const ring = Math.max(a.ring, b.ring);
    const budget = makeBudget(options);
    const qubits = a.n;
    const reason = resourceReason(a, b);
    if (reason) return { status: 'undecided', qubits, reason };

    let overlap;
    try {
        overlap = budget.amplitude(bellComparison(a, b, ring), 0n);
    } catch (error) {
        if (!(error instanceof Count.LimitError)) throw error;
        return { status: 'undecided', qubits, reason: error.message };
    }
    const squared = squareMagnitude(overlap);
    const status = isOne(overlap) ? 'strict' : isOne(squared) ? 'projective' : 'different';
    const result = { status, qubits, overlap: format(overlap), overlapSquared: format(squared) };
    if (qubits <= SMALL_QUBITS && status !== 'strict') {
        const leftMatrix = smallMatrix(a, ring);
        const rightMatrix = smallMatrix(b, ring);
        result.witness = smallWitness(leftMatrix, rightMatrix, qubits, status);
        if (status === 'different') {
            const experiment = distinguishingExperiment(leftMatrix, rightMatrix, qubits);
            if (experiment) result.witness.experiment = experiment;
        }
    }
    return result;
}

function sampleOptions(qubits, options) {
    const { shots, seed, bitstring } = options;
    if (shots === undefined && seed === undefined) return undefined;
    if (bitstring !== undefined || qubits > SMALL_QUBITS) {
        throw new TypeError('Sampling is available only for all outcomes of circuits with up to four qubits.');
    }
    if (!Number.isInteger(shots) || shots < 1 || shots > 10000) {
        throw new TypeError('shots must be an integer from 1 through 10000.');
    }
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
        throw new TypeError('seed must be an integer from 0 through 4294967295.');
    }
    return { shots, seed };
}

function sampleCounts(state, { shots, seed }) {
    const counts = Array(state.size).fill(0);
    for (const outcome of state.sample(shots, seed)) counts[outcome]++;
    return counts;
}

function compareState(left, right, options = {}) {
    const [a, b] = operands(left, right, false);
    const qubits = a.n;
    const ring = Math.max(a.ring, b.ring);
    const budget = makeBudget(options);
    const { bitstring } = options;
    if (bitstring !== undefined && (typeof bitstring !== 'string' || bitstring.length !== qubits || !/^[01]+$/.test(bitstring))) {
        throw new TypeError('Enter exactly ' + qubits + ' bits, with the highest-index qubit first.');
    }
    const samples = sampleOptions(qubits, options);
    const reason = resourceReason(a, b);
    if (reason) return { status: 'undecided', qubits, rows: [], reason };
    if (bitstring === undefined && qubits > SMALL_QUBITS) {
        return { status: 'undecided', qubits, rows: [], reason: 'For more than four qubits, enter a basis output bit string.' };
    }

    let leftValues, rightValues, leftCounts, rightCounts;
    try {
        if (budget.remaining === 0) throw new Count.LimitError('Counting node budget exhausted.');
        if (bitstring === undefined) {
            const leftState = denseState(a, ring, 0);
            const rightState = denseState(b, ring, 0);
            leftValues = amplitudes(leftState, ring);
            rightValues = amplitudes(rightState, ring);
            if (samples) {
                leftCounts = sampleCounts(leftState, samples);
                rightCounts = sampleCounts(rightState, samples);
            }
        } else {
            const output = BigInt('0b' + bitstring);
            leftValues = [budget.amplitude({ n: qubits, ring, gates: widen(a, ring) }, output)];
            rightValues = [budget.amplitude({ n: qubits, ring, gates: widen(b, ring) }, output)];
        }
    } catch (error) {
        if (!(error instanceof Count.LimitError)) throw error;
        return { status: 'undecided', qubits, rows: [], reason: error.message };
    }
    let same = true;
    const rows = leftValues.map((amplitude, i) => {
        const p = squareMagnitude(amplitude), q = squareMagnitude(rightValues[i]);
        same = same && equal(p, q);
        return {
            bitstring: bitstring === undefined ? word(i, qubits) : bitstring,
            leftAmplitude: format(amplitude), rightAmplitude: format(rightValues[i]),
            leftProbability: format(p), rightProbability: format(q),
            ...(samples && { leftCount: leftCounts[i], rightCount: rightCounts[i] })
        };
    });
    return { status: same ? 'equal' : 'different', qubits, rows, ...(samples && { samples }) };
}

return { compareUnitary, compareState };
});
