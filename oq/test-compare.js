/* Exact, independent dense matrix oracle and real worker contract regression. */
'use strict';

const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const QASM = require('./qasm.js');
const Compare = require('./oqcompare.js');

const counts = { matrices: 0, witness: 0, experiments: 0, state: 0, limits: 0, worker: 0 };
const qasm = (n, body = '') => 'OPENQASM 3.0; include "stdgates.inc"; qubit[' + n + '] q;\n' + body;
const basis = () => Array(8).fill(0n);
const one = () => [1n, ...basis().slice(1)];
const add = (a, b) => a.map((c, i) => c + b[i]);
const scale = (a, s) => a.map(c => c * s);
const same = (a, b) => a.every((c, i) => c === b[i]);

// Work over a 16-element cyclic convolution, then quotient by ζ₁₆⁸+1.
function convolve(a, b, conjugate) {
    const cyclic = Array(16).fill(0n);
    for (const [i, ai] of a.entries()) {
        for (const [j, bj] of b.entries()) {
            cyclic[(i + (conjugate ? 16 - j : j)) % 16] += ai * bj;
        }
    }
    return cyclic.slice(0, 8).map((c, i) => c - cyclic[i + 8]);
}

function power(exponent) {
    const out = basis();
    const e = (exponent + 16 * 1000) % 16;
    out[e % 8] = e < 8 ? 1n : -1n;
    return out;
}

function matrix(source) {
    const { n, ring, gates } = QASM.parse(source, { optimize: false });
    const size = 1 << n;
    let denominator = 0;
    const columns = [];
    for (let input = 0; input < size; input++) {
        let column = Array.from({ length: size }, (_, index) => index === input ? one() : basis());
        denominator = 0;
        for (const [op, a, b] of gates) {
            const old = column;
            const step = ring === 8 ? 2 : 1;
            switch (op) {
            case 'h': {
                const squareRootTwo = add(power(2), power(-2));
                column = old.map((_, y) => {
                    const lo = old[y & ~(1 << a)], hi = old[y | 1 << a];
                    const sum = add(lo, scale(hi, (y & (1 << a)) ? -1n : 1n));
                    return convolve(sum, squareRootTwo, false);
                });
                denominator++;
                break;
            }
            case 'x': column = old.map((_, y) => old[y ^ 1 << a]); break;
            case 'cx': column = old.map((_, y) => old[y ^ ((y & (1 << a)) ? 1 << b : 0)]); break;
            case 'swap': column = old.map((_, y) => old[(((y >> a) ^ (y >> b)) & 1) ? y ^ (1 << a) ^ (1 << b) : y]); break;
            case 'zpow':
            case 'mcpow':
            case 'gphase': {
                const mask = op === 'zpow' ? 1 << a : op === 'mcpow' ? Number(a) : 0;
                const multiplier = power((op === 'gphase' ? a : b) * step);
                column = old.map((value, y) => (y & mask) === mask ? convolve(value, multiplier, false) : value);
                break;
            }
            default: assert.fail('unexpected oracle gate ' + op);
            }
        }
        columns.push(column);
    }
    return { n, denominator, columns };
}

function parseValue(text) {
    const match = /^(.+?)(?:\/(\d+|2\^\d+))?$/.exec(text.replace(/[() ]/g, '').replace(/−/g, '-'));
    assert.ok(match, text);
    const p = basis();
    for (const token of match[1].match(/[+-]?[^+-]+/g)) {
        const term = /^([+-]?)(\d*)(?:(ζ₈|ζ₁₆)(?:\^(\d+))?)?$/.exec(token);
        assert.ok(term && (term[2] || term[3]), token);
        const exponent = term[3] ? Number(term[4] || 1) * (term[3] === 'ζ₈' ? 2 : 1) : 0;
        p[exponent] += BigInt((term[1] || '+') + (term[2] || '1'));
    }
    const d = match[2] && match[2].startsWith('2^') ? 2n ** BigInt(match[2].slice(2)) : BigInt(match[2] || 1);
    return [p, d];
}

function experimentProbability(matrix, { preparation, projection }) {
    const [first, second] = preparation.words.map(bits => parseInt(bits, 2));
    let vector = matrix.columns[first];
    let denominator = matrix.denominator;
    const sqrtTwo = add(power(2), power(14));
    if (preparation.kind === 'plus') {
        vector = vector.map((coefficient, i) =>
            convolve(add(coefficient, matrix.columns[second][i]), sqrtTwo));
        denominator++;
    } else assert.equal(preparation.kind, 'basis');
    const [a, b] = projection.words.map(bits => parseInt(bits, 2));
    let amplitude = vector[a];
    if (projection.kind !== 'basis') {
        assert.ok(projection.kind === 'plus' || projection.kind === 'imaginary');
        const other = projection.kind === 'imaginary' ? convolve(vector[b], power(12)) : vector[b];
        amplitude = convolve(add(amplitude, other), sqrtTwo);
        denominator++;
    }
    return [convolve(amplitude, amplitude, true), 2n ** BigInt(2 * denominator)];
}

function checkPair(left, right, known) {
    const a = matrix(left);
    const b = matrix(right);
    const entries = a.columns.flatMap((col, x) => col.map((c, y) =>
        [scale(c, 1n << BigInt(b.denominator)), scale(b.columns[x][y], 1n << BigInt(a.denominator))]));
    const anchor = entries.find(([l]) => !same(l, basis()));
    assert.ok(anchor, 'a unitary has a nonzero entry');
    const strict = entries.every(([l, r]) => same(l, r));
    const projective = entries.every(([l, r]) => same(convolve(l, anchor[1]), convolve(r, anchor[0])));
    const expected = strict ? 'strict' : projective ? 'projective' : 'different';
    if (known) assert.equal(expected, known);
    const result = Compare.compareUnitary(left, right, { maxNodes: 500000 });
    assert.equal(result.status, expected, JSON.stringify(result));
    assert.equal(result.qubits, a.n);

    const trace = a.columns.flatMap((col, x) => col.map((c, y) => convolve(b.columns[x][y], c, true))).reduce(add, basis());
    const divisor = 2n ** BigInt(a.denominator + b.denominator + a.n);
    const [got, gotDivisor] = parseValue(result.overlap);
    assert.ok(same(scale(got, divisor), scale(trace, gotDivisor)), result.overlap);
    const [gotSquared, sqDivisor] = parseValue(result.overlapSquared);
    assert.ok(same(scale(gotSquared, divisor ** 2n), scale(convolve(trace, trace, true), sqDivisor)), result.overlapSquared);
    counts.matrices++;

    if (strict) {
        assert.equal(result.witness, undefined);
        return;
    }
    const witness = result.witness;
    assert.ok(witness);
    function checkEntry(item) {
        const x = parseInt(item.input, 2), y = parseInt(item.output, 2);
        for (const [side, key] of [[a, 'leftAmplitude'], [b, 'rightAmplitude']]) {
            const [shown, showDen] = parseValue(item[key]);
            assert.ok(same(scale(shown, 2n ** BigInt(side.denominator)), scale(side.columns[x][y], showDen)));
        }
        return entries[x * (1 << a.n) + y];
    }
    const [l, r] = checkEntry(witness);
    if (witness.kind === 'probability') {
        assert.ok(!same(convolve(l, l, true), convolve(r, r, true)));
        for (const [shown, value] of [[witness.leftProbability, l], [witness.rightProbability, r]]) {
            const [z, d] = parseValue(shown);
            assert.ok(same(scale(z, 2n ** BigInt(2 * (a.denominator + b.denominator))),
                           scale(convolve(value, value, true), d)));
        }
    } else if (witness.reference) {
        const [al, ar] = checkEntry(witness.reference);
        assert.ok(!same(convolve(l, ar), convolve(r, al)), 'no global phase aligns both entries');
    } else {
        assert.equal(expected, 'projective');
        assert.ok(!same(l, r));
    }
    if (expected === 'different') {
        const experiment = witness.experiment;
        assert.ok(experiment, 'small physically different circuits must offer an experiment');
        for (const [m, key] of [[a, 'leftProbability'], [b, 'rightProbability']]) {
            const [calculated, calDen] = experimentProbability(m, experiment);
            const [shown, shownDen] = parseValue(experiment[key]);
            assert.ok(same(scale(calculated, shownDen), scale(shown, calDen)), experiment[key]);
        }
        const [leftValue, leftDen] = parseValue(experiment.leftProbability);
        const [rightValue, rightDen] = parseValue(experiment.rightProbability);
        assert.ok(!same(scale(leftValue, rightDen), scale(rightValue, leftDen)), 'the proposed experiment distinguishes');
        counts.experiments++;
    } else assert.equal(witness.experiment, undefined);
    counts.witness++;
    return witness.experiment;
}

const special = [
    ['h q[0]; z q[0]; h q[0];','x q[0];','strict'],
    ['t q[0];','tdg q[0];','different'],
    ['s q[0];','t q[0]; t q[0];','strict'],
    ['','z q[0];','different'],
    ['','gphase(pi/8);','projective'],
    ['gphase(pi/8);','gphase(-pi/8);','projective'],
    ['t q[0];','p(pi/8) q[0]; p(pi/8) q[0];','strict'],
    ['t q[0];','p(pi/8) q[0];','different'],
    ['','x q[0];','different'],
    ['h q[0];','h q[0]; z q[0];','different'],
];
for (const [left, right, status] of special) checkPair(qasm(1, left), qasm(1, right), status);
const iz = Compare.compareUnitary(qasm(1),qasm(1,'z q[0];')).witness.experiment;
assert.deepEqual(iz,{preparation:{kind:'plus',words:['0','1']},projection:{kind:'plus',words:['0','1']},leftProbability:'1',rightProbability:'0'});
const tPair = Compare.compareUnitary(qasm(1,'t q[0];'),qasm(1,'tdg q[0];')).witness.experiment;
assert.deepEqual(tPair.preparation,{kind:'plus',words:['0','1']});
assert.deepEqual(tPair.projection,{kind:'imaginary',words:['0','1']});
assert.deepEqual([tPair.leftProbability,tPair.rightProbability],['(2 + ζ₈ − ζ₈^3)/4','(2 − ζ₈ + ζ₈^3)/4']);
checkPair('OPENQASM 2.0; include "qelib1.inc"; qreg q[1]; h q[0]; z q[0]; h q[0];', qasm(1, 'x q[0];'), 'strict');
checkPair(qasm(2, 'crz(pi/4) q[0],q[1];'), qasm(2, 'p(-pi/8) q[0]; cp(pi/4) q[0],q[1];'), 'strict');

let seed = 0xa624b95e;
function next(n) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 8) % n;
}
function circuit(n) {
    let s = '';
    const single = ['h','x','t','tdg','s','z'];
    for (let i = 0; i < 5; i++) {
        const q = next(n);
        const op = next(single.length + (n > 1 ? 3 : 1));
        const other = (q + 1 + next(Math.max(1, n - 1))) % n;
        if (op < single.length) s += single[op] + ' q[' + q + '];\n';
        else if (op === 6) s += 'p(pi/8) q[' + q + '];\n';
        else s += (op === 7 ? 'cx' : 'swap') + ' q[' + q + '], q[' + other + '];\n';
    }
    return s;
}
for (let n = 1; n <= 4; n++) {
    for (let i = 0; i < 8; i++) {
        const base = circuit(n);
        const after = i % 4;
        const suffix = after === 0 ? 'h q[0]; h q[0];'
            : after === 1 ? 'gphase(pi/8);'
            : after === 2 ? 'z q[0];'
            : undefined;
        checkPair(qasm(n, base), qasm(n, suffix === undefined ? circuit(n) : base + suffix),
                  after === 0 ? 'strict' : after === 1 ? 'projective' : after === 2 ? 'different' : undefined);
    }
}

const a = qasm(1, 'bit c; h q[0]; c = measure q[0];');
const b = qasm(1, 'h q[0]; z q[0];');
let state = Compare.compareState(a, b);
assert.equal(state.status, 'equal');
assert.deepEqual(state.rows.map(r => [r.bitstring, r.leftProbability, r.rightProbability]), [['0','1/2','1/2'],['1','1/2','1/2']]);
assert.notEqual(state.rows[1].leftAmplitude, state.rows[1].rightAmplitude);
state = Compare.compareState(qasm(1, 'h q[0]; h q[0];'), qasm(1, 'h q[0]; z q[0]; h q[0];'), { bitstring:'0' });
assert.equal(state.status, 'different');
assert.deepEqual(state.rows.map(r => [r.leftProbability,r.rightProbability]), [['1','0']]);
assert.equal(Compare.compareState(qasm(5),qasm(5),{bitstring:'00000'}).status,'equal');
assert.equal(Compare.compareState(qasm(4),qasm(4)).rows.length,16);
assert.equal(Compare.compareState(qasm(5),qasm(5)).status,'undecided');
assert.throws(() => Compare.compareState(qasm(2),qasm(2),{bitstring:'2'}), /bits/);
assert.throws(() => Compare.compareState(qasm(1),qasm(1,'reset q[0];')), /reset/i);
assert.throws(() => Compare.compareUnitary(a,b), /unitary/);
assert.throws(() => Compare.compareUnitary(qasm(1),qasm(2)), /same number/);
assert.throws(() => Compare.compareUnitary(qasm(1,'rz(0.1) q[0];'),qasm(1)), /Left circuit/);
assert.ok(!Object.hasOwn(state.rows[0],'leftCount'));
let sampled = Compare.compareState(qasm(1),qasm(1,'x q[0];'), { shots:128,seed:7 });
assert.deepEqual(sampled.samples,{shots:128,seed:7});
assert.deepEqual(sampled.rows.map(row=>[row.leftCount,row.rightCount]),[[128,0],[0,128]]);
sampled = Compare.compareState(a,b,{shots:1024,seed:123});
assert.deepEqual(Compare.compareState(a,b,{shots:1024,seed:123}),sampled);
assert.equal(sampled.rows.reduce((sum,row)=>sum+row.leftCount,0),1024);
assert.equal(sampled.rows.reduce((sum,row)=>sum+row.rightCount,0),1024);
assert.ok(sampled.rows.every(row=>row.leftProbability==='1/2'&&row.rightProbability==='1/2'));
assert.throws(() => Compare.compareState(a,b,{shots:7}), /seed/);
assert.throws(() => Compare.compareState(a,b,{shots:10001,seed:7}), /shots/);
assert.throws(() => Compare.compareState(a,b,{shots:7,seed:-1}), /seed/);
assert.throws(() => Compare.compareState(a,b,{shots:7,seed:0,bitstring:'0'}), /all outcomes/);
assert.throws(() => Compare.compareState(qasm(5),qasm(5),{shots:7,seed:0}), /up to four/);
counts.state += 22;
for (const maxNodes of [0,1]) {
    const limited = Compare.compareUnitary(qasm(1,'h q[0];'),qasm(1),{maxNodes});
    assert.equal(limited.status,'undecided');
    assert.ok(limited.reason && !limited.overlap && !limited.witness);
    assert.equal(Compare.compareState(qasm(1),qasm(1),{bitstring:'0',maxNodes}).status,'undecided');
    counts.limits += 2;
}
assert.equal(Compare.compareUnitary(qasm(17),qasm(17)).status,'undecided');
assert.equal(Compare.compareUnitary(qasm(1,'h q[0];\n'.repeat(501)),qasm(1)).status,'undecided');
assert.throws(() => Compare.compareUnitary(qasm(1),qasm(1),{maxNodes:500001}), /maxNodes/);
counts.limits += 3;

async function testWorker() {
    const worker = new Worker(path.join(__dirname, 'oqcompare-worker.js'));
    async function send(request) {
        try {
            return await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('worker timeout')), 5000);
                worker.once('message', reply => { clearTimeout(timer); resolve(reply); });
                worker.once('error', error => { clearTimeout(timer); reject(error); });
                worker.postMessage(request);
            });
        } finally {
            worker.removeAllListeners('error');
        }
    }
    try {
        let reply = await send({id:4,mode:'unitary',left:qasm(1),right:qasm(1,'gphase(pi/8);')});
        assert.equal(reply.id,4);
        assert.equal(reply.ok,true);
        assert.equal(reply.result.status,'projective');
        assert.equal(reply.result.overlap,'ζ₁₆');
        reply = await send({id:8,mode:'state',left:a,right:b,shots:20,seed:11});
        assert.equal(reply.id,8);
        assert.equal(reply.ok,true);
        assert.equal(reply.result.status,'equal');
        assert.deepEqual(reply.result.samples,{shots:20,seed:11});
        reply = await send({id:9,mode:'other'});
        assert.deepEqual(reply,{id:9,ok:false,error:'Unknown comparison mode.'});
        counts.worker += 3;
    } finally {
        await worker.terminate();
    }
}

testWorker().then(() => console.log('Exact compare regression passed:',JSON.stringify(counts)))
    .catch(error => { console.error(error); process.exitCode = 1; });
