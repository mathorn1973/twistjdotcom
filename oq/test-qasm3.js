/* OpenQASM 3 control-flow, measurement and operand regression tests.
 * Run: node oq/test-qasm3.js
 * Reference trajectories are explicit gates/manual JS branch decisions,
 * independent of QASM translation and the engine's conditional IR.
 */
'use strict';

const assert = require('node:assert/strict');
const OQ = require('./oq.js');
const QASM = require('./qasm.js');

const report = { status: 'passed', programs: 0, parserVariants: 0,
    exactTrajectoryComparisons: 0, deterministicBasisChecks: 0,
    rejectedInputs: 0, cases: [] };

function source(n, body) {
    return 'OPENQASM 3.0; include "stdgates.inc"; qubit[' + n + '] q;\n' + body;
}
function apply(state, gates) {
    for (const gate of gates) OQ.apply(state, gate);
    return state;
}
function compareState(actual, expected, label) {
    assert.equal(actual.n, expected.n, label + ': register');
    assert.equal(actual.denom, expected.denom, label + ': denominator');
    for (let b = 0; b < actual.size; b++) assert.deepEqual(actual.amp(b), expected.amp(b), label + ': amplitude ' + b);
    assert.equal(actual.hash(), expected.hash(), label + ': exact global-phase-sensitive hash');
    assert.deepEqual(actual.cbits, expected.cbits, label + ': measured classical bits');
    assert.equal(actual.measured, expected.measured, label + ': measurement count');
    assert.deepEqual(actual.normPair(), expected.normPair(), label + ': carried norm');
    report.exactTrajectoryComparisons++;
}
function check(name, n, body, reference, options) {
    options = options || {};
    const seeds = options.seeds === undefined ? 16 : options.seeds;
    const observed = new Set();
    for (const optimize of [false, true]) {
        const program = QASM.parse(source(n, body), { optimize });
        assert.equal(program.qasm3, true, name + ': QASM3 route');
        assert.equal(program.n, n, name + ': register width');
        assert.equal(program.ring, 8, name + ': expected ring');
        if (options.dynamic !== undefined) assert.equal(program.dynamic, options.dynamic, name + ': execution mode');
        for (let seed = 0; seed < seeds; seed++) {
            const expected = typeof reference === 'function' ? reference(seed) : OQ.run(reference, n, seed);
            const actual = OQ.run(program.gates, n, seed);
            compareState(actual, expected, name + ' optimize=' + optimize + ' seed=' + seed);
            if (options.basis !== undefined) {
                for (let b = 0; b < actual.size; b++) {
                    assert.equal(actual.isZero(b), b !== options.basis, name + ': final basis support');
                }
                report.deterministicBasisChecks++;
            }
            if (options.bothOutcomes) observed.add(actual.cbits[options.outcomeBit || 0]);
        }
        report.parserVariants++;
    }
    if (options.bothOutcomes) assert.deepEqual([...observed].sort(), [0, 1], name + ': exercise both outcomes');
    report.programs++;
    report.cases.push(name);
}
function reject(name, n, body, opts) {
    assert.throws(() => QASM.parse(source(n, body), opts), error => {
        assert.equal(error.name, 'QasmError', name + ': actionable parser error');
        assert.ok(typeof error.message === 'string' && error.message.length > 5, name + ': explanation');
        assert.ok(Number.isInteger(error.line) && error.line >= 1, name + ': source line');
        return true;
    }, name);
    report.rejectedInputs++;
}

function measurementChecks() {
    check('scalar_measurement_initializer', 2,
        'x q[0]; bit c = measure q[0]; if(c) x q[1];',
        [['x', 0], ['measure', 0, 0], ['x', 1]], { dynamic: true, basis: 3 });
    for (let input = 0; input < 4; input++) {
        const prep = [], text = [];
        for (let q = 0; q < 2; q++) if (input & (1 << q)) { prep.push(['x', q]); text.push('x q[' + q + '];'); }
        check('register_measurement_initializer_' + input, 3,
            text.join(' ') + ' bit[2] c = measure q[0:1]; if(c == 2) x q[2];',
            prep.concat([['measure', 0, 0], ['measure', 1, 1]], input === 2 ? [['x', 2]] : []),
            { dynamic: true, basis: input === 2 ? 6 : input });
    }
    check('condition_is_read_once', 2,
        'x q[0]; bit c = measure q[0]; if(c) { x q[0]; c = measure q[0]; x q[1]; }',
        [['x', 0], ['measure', 0, 0], ['x', 0], ['measure', 0, 0], ['x', 1]],
        { dynamic: true, basis: 2 });
    check('condition_snapshot_does_not_enter_else', 3,
        'x q[0]; bit c = measure q[0]; if(c) { x q[0]; c = measure q[0]; x q[1]; } else { x q[2]; }',
        [['x', 0], ['measure', 0, 0], ['x', 0], ['measure', 0, 0], ['x', 1]],
        { dynamic: true, basis: 2 });
    check('else_snapshot_does_not_stop_after_remeasurement', 3,
        'bit c = measure q[0]; if(c) { x q[2]; } else { x q[0]; c = measure q[0]; x q[1]; }',
        [['measure', 0, 0], ['x', 0], ['measure', 0, 0], ['x', 1]],
        { dynamic: true, basis: 3 });
    check('measurement_before_H_without_feedback_collapses', 1,
        'h q[0]; bit c = measure q[0]; h q[0];',
        [['h', 0], ['measure', 0, 0], ['h', 0]], { dynamic: true, bothOutcomes: true });
    check('measurement_before_cancelled_H_pair_still_collapses', 1,
        'h q[0]; bit c = measure q[0]; h q[0]; h q[0];',
        [['h', 0], ['measure', 0, 0]], { dynamic: true, bothOutcomes: true });
    // Terminal measurement remains deferred for final-state shot sampling.
    for (const optimize of [false, true]) {
        const program = QASM.parse(source(1, 'h q[0]; bit c = measure q[0];'), { optimize });
        assert.equal(program.dynamic, false);
        assert.deepEqual(program.measures, [{ q: 0, c: 0 }]);
        assert.ok(program.gates.every(g => g[0] !== 'measure'));
        compareState(OQ.run(program.gates, 1), OQ.run([['h', 0]], 1), 'terminal initializer deferred');
        report.parserVariants++;
    }
    report.programs++;
    report.cases.push('terminal_initializer_keeps_readout_metadata');
}

function branchChecks() {
    for (const flag of [0, 1]) {
        const prep = flag ? [['x', 0]] : [];
        const text = (flag ? 'x q[0]; ' : '') + 'bit c = measure q[0]; ';
        check('single_statement_else_' + flag, 3,
            text + 'if(c) x q[1]; else x q[2];',
            prep.concat([['measure', 0, 0], ['x', flag ? 1 : 2]]),
            { dynamic: true, basis: flag ? 3 : 4 });
        check('boolean_negation_' + flag, 3,
            text + 'if(!c) { x q[1]; } else { x q[2]; }',
            prep.concat([['measure', 0, 0], ['x', flag ? 2 : 1]]),
            { dynamic: true, basis: flag ? 5 : 2 });
        check('negated_bool_cast_' + flag, 3,
            text + 'if(!bool(c)) x q[1]; else x q[2];',
            prep.concat([['measure', 0, 0], ['x', flag ? 2 : 1]]),
            { dynamic: true, basis: flag ? 5 : 2 });
    }
    for (let input = 0; input < 4; input++) {
        const prep = [], text = [];
        for (let q = 0; q < 2; q++) if (input & (1 << q)) { prep.push(['x', q]); text.push('x q[' + q + '];'); }
        const prefix = text.join(' ') + ' bit[2] c = measure q[0:1]; ';
        check('register_not_equal_' + input, 3, prefix + 'if(c != 2) x q[2];',
            prep.concat([['measure', 0, 0], ['measure', 1, 1]], input !== 2 ? [['x', 2]] : []),
            { dynamic: true, basis: input !== 2 ? input | 4 : input });
        const branch = input === 0 ? [['x', 2]] : input === 1 ? [['x', 3]] : [['x', 2], ['x', 3]];
        check('else_if_chain_' + input, 4,
            prefix + 'if(c == 0) { x q[2]; } else if(c == 1) { x q[3]; } else { x q[2]; x q[3]; }',
            prep.concat([['measure', 0, 0], ['measure', 1, 1]], branch), { dynamic: true });
        const nestedBranch = (input & 1) ? ((input & 2) ? [['x', 2]] : [['x', 3]]) : [['x', 2], ['x', 3]];
        check('nested_runtime_else_' + input, 4,
            prefix + 'if(c[0]) { if(c[1]) { x q[2]; } else { x q[3]; } } else { x q[2]; x q[3]; }',
            prep.concat([['measure', 0, 0], ['measure', 1, 1]], nestedBranch), { dynamic: true });
        const danglingBranch = (input & 1) ? ((input & 2) ? [['x', 2]] : [['x', 3]]) : [];
        check('dangling_else_binds_nearest_if_' + input, 4,
            prefix + 'if(c[0]) if(c[1]) x q[2]; else x q[3];',
            prep.concat([['measure', 0, 0], ['measure', 1, 1]], danglingBranch), { dynamic: true });
    }
    for (const flag of [0, 1]) {
        const prep = flag ? [['x', 0]] : [];
        const text = 'bit[33] c; ' + (flag ? 'x q[0]; ' : '') + 'c[32] = measure q[0]; ';
        check('indexed_classical_bit_32_' + flag, 2, text + 'if(c[32] != 0) x q[1];',
            prep.concat([['measure', 0, 32]], flag ? [['x', 1]] : []),
            { dynamic: true, basis: flag ? 3 : 0 });
        check('wide_classical_register_no_32bit_truncation_' + flag, 2,
            text + 'if(c != 4294967296) x q[1];',
            prep.concat([['measure', 0, 32]], flag ? [] : [['x', 1]]),
            { dynamic: true, basis: flag ? 1 : 2 });
    }
    check('else_phase_scan_and_halving', 2,
        'h q[0]; h q[1]; bit c = measure q[0]; if(c) { t q[1]; } else { s q[1]; gphase(pi/2); }',
        seed => {
            const state = OQ.run([['h', 0], ['h', 1], ['measure', 0, 0]], 2, seed);
            const taken = state.cbits[0];
            return apply(state, taken ? [['zpow', 1, 1]] : [['zpow', 1, 2], ['gphase', 2]]);
        }, { dynamic: true, bothOutcomes: true });
}

function compileTimeChecks() {
    check('literal_true_false', 3,
        'if(true) { x q[0]; } else { x q[2]; } if(false) x q[2]; else x q[1];',
        [['x', 0], ['x', 1]], { dynamic: false, basis: 3, seeds: 1 });
    check('compiletime_bool_and_comparisons', 4,
        'const bool enabled = true; const bool disabled = false; const int k = 2; ' +
        'if(enabled) x q[0]; if(!disabled) x q[1]; if(k == 2) x q[2]; ' +
        'if(k != 2) x q[0]; else if(k >= 2) x q[3];',
        [['x', 0], ['x', 1], ['x', 2], ['x', 3]], { dynamic: false, basis: 15, seeds: 1 });
    check('compiletime_selected_branch_only', 2,
        'const int k = 3; if(k < 2) { x q[0]; } else if(k <= 3) { x q[1]; } else { x q[0]; }',
        [['x', 1]], { dynamic: false, basis: 2, seeds: 1 });
}

function operandChecks() {
    const slices = [
        ['all_explicit', 'q[0:3]', [0, 1, 2, 3]],
        ['prefix', 'q[0:2]', [0, 1, 2]],
        ['suffix', 'q[1:3]', [1, 2, 3]],
        ['reverse', 'q[3:-1:0]', [3, 2, 1, 0]],
        ['step', 'q[1:2:3]', [1, 3]],
        ['negative_range_elements', 'q[-2:1]', [2, 3, 0, 1]]
    ];
    for (const [name, expression, indices] of slices) {
        check('slice_' + name, 4, 'x ' + expression + ';', indices.map(q => ['x', q]),
            { dynamic: false, seeds: 1, basis: indices.reduce((mask, q) => mask | (1 << q), 0) });
    }
    check('concatenated_alias', 5, 'let a = (q[0:1]) ++ (q[3:4]); x a;',
        [['x', 0], ['x', 1], ['x', 3], ['x', 4]], { dynamic: false, basis: 27, seeds: 1 });
    check('concatenated_alias_gate_broadcast', 4,
        'let controls = q[0] ++ q[1]; let targets = q[2] ++ q[3]; x q[0:1]; cx controls, targets;',
        [['x', 0], ['x', 1], ['cx', 0, 2], ['cx', 1, 3]], { dynamic: false, basis: 15, seeds: 1 });
    check('reverse_slice_measurement_order', 4,
        'x q[0]; let reverse = q[3:-1:0]; bit[4] c = measure reverse; if(c == 8) x q[1];',
        [['x', 0], ['measure', 3, 0], ['measure', 2, 1], ['measure', 1, 2], ['measure', 0, 3], ['x', 1]],
        { dynamic: true, basis: 3 });
    check('concatenated_alias_measurement_order', 4,
        'x q[0]; let first = q[{3,1}]; let selected = first ++ q[0]; bit[3] c = measure selected; if(c == 4) x q[2];',
        [['x', 0], ['measure', 3, 0], ['measure', 1, 1], ['measure', 0, 2], ['x', 2]],
        { dynamic: true, basis: 5 });
}

function existingStructureRegressionChecks() {
    check('custom_parameterized_gate_inside_loop', 4,
        'gate pair(theta) a,b { h a; p(theta) a; cx a,b; } ' +
        'for uint i in [0:1] { pair(pi/4) q[2*i],q[2*i+1]; }',
        [['h', 0], ['zpow', 0, 1], ['cx', 0, 1], ['h', 2], ['zpow', 2, 1], ['cx', 2, 3]],
        { dynamic: false, seeds: 1 });
    check('compiletime_if_else_inside_loop', 3,
        'for int i in [0:2] { if(i == 1) { x q[i]; } else { h q[i]; h q[i]; } }',
        [['x', 1]], { dynamic: false, basis: 2, seeds: 1 });
    check('nested_loops_with_compiletime_if_else', 4,
        'h q; for int i in [0:1] { for int j in [0:1] { ' +
        'if(i == j) { x q[2*i+j]; } else { z q[2*i+j]; } } }',
        [['h', 0], ['h', 1], ['h', 2], ['h', 3], ['x', 0], ['zpow', 1, 4], ['zpow', 2, 4], ['x', 3]],
        { dynamic: false, seeds: 1 });
    check('runtime_if_else_inside_unrolled_loop', 3,
        'h q; bit c = measure q[0]; for uint i in [1:2] { if(c) { x q[i]; } else { z q[i]; } }',
        seed => {
            const state = OQ.run([['h', 0], ['h', 1], ['h', 2], ['measure', 0, 0]], 3, seed);
            const branch = state.cbits[0];
            return apply(state, branch ? [['x', 1], ['x', 2]] : [['zpow', 1, 4], ['zpow', 2, 4]]);
        }, { dynamic: true, bothOutcomes: true });
    check('custom_gate_broadcast_over_concatenated_alias', 4,
        'gate local_phase(theta) a { h a; p(theta) a; } ' +
        'let selected = q[{3,1}] ++ q[0]; local_phase(pi/4) selected;',
        [['h', 3], ['zpow', 3, 1], ['h', 1], ['zpow', 1, 1], ['h', 0], ['zpow', 0, 1]],
        { dynamic: false, seeds: 1 });
}

function lexicalScopeAndOperandChecks() {
    check('compiletime_bool_shadow_does_not_escape', 1,
        'const bool b = false; if(true) { const bool b = true; } if(b) x q[0];',
        [], { dynamic: false, basis: 0, seeds: 1 });
    check('compiletime_alias_shadow_does_not_escape', 2,
        'let a = q[0]; if(true) { let a = q[1]; x a; } x a;',
        [['x', 1], ['x', 0]], { dynamic: false, basis: 3, seeds: 1 });
    check('nested_else_alias_scopes', 4,
        'let a = q[0]; if(false) { let a = q[3]; } else { let a = q[1]; ' +
        'if(true) { let a = q[2]; x a; } x a; } x a;',
        [['x', 2], ['x', 1], ['x', 0]], { dynamic: false, basis: 7, seeds: 1 });
    check('compiletime_angle_shadow_does_not_escape', 2,
        'const angle theta = pi/4; if(true) { const angle theta = pi/2; h q[0]; p(theta) q[0]; } ' +
        'h q[1]; p(theta) q[1];',
        [['h', 0], ['zpow', 0, 2], ['h', 1], ['zpow', 1, 1]], { dynamic: false, seeds: 1 });
    check('branch_alias_scope_survives_inner_loop', 3,
        'let a = q[0]; if(true) { for int i in [1:2] { let a = q[i]; x a; } } x a;',
        [['x', 1], ['x', 2], ['x', 0]], { dynamic: false, basis: 7, seeds: 1 });
    check('branch_bool_scope_inside_loop', 4,
        'const bool b = false; if(true) { for int i in [0:1] { ' +
        'if(i == 0) { const bool b = true; if(b) x q[0]; } if(b) x q[2]; } } if(b) x q[3];',
        [['x', 0]], { dynamic: false, basis: 1, seeds: 1 });
    // Aliases may overlap across different broadcast instances. It is only
    // repeated physical operands within one gate invocation that are invalid.
    check('custom_gate_cross_instance_overlap_is_valid', 3,
        'gate local a,b { x a; z b; } let a = q[0:1]; let b = q[1:2]; h q[1]; local a,b;',
        [['h', 1], ['x', 0], ['zpow', 1, 4], ['x', 1], ['zpow', 2, 4]],
        { dynamic: false, seeds: 1 });
    for (const [name, body] of [
        ['branch_local_bool_unavailable_after_scope', 'if(true) { const bool inner = true; } if(inner) x q[0];'],
        ['branch_local_alias_unavailable_after_scope', 'if(true) { let inner = q[0]; } x inner;'],
        ['compiletime_branch_quantum_declaration', 'if(true) { qubit ancillary; }'],
        ['compiletime_branch_bit_declaration', 'if(true) { bit localbit; }'],
        ['compiletime_else_bit_declaration', 'if(false) { x q[0]; } else { bit localbit; }'],
        ['runtime_branch_const_declaration', 'bit c; if(c) { const bool inner = true; }'],
        ['runtime_branch_alias_declaration', 'bit c; if(c) { let inner = q[0]; }'],
        ['custom_gate_same_physical_arguments', 'gate local a,b { x a; z b; } local q[0],q[0];'],
        ['custom_gate_alias_overlap_within_instance',
            'gate local a,b { x a; z b; } let a = q[0:1]; let b = q[{2,1}]; local a,b;'],
        ['modified_custom_gate_same_physical_arguments', 'gate local a,b { x a; z b; } inv @ local q[0],q[0];'],
        ['controlled_custom_gate_overlap_with_control', 'gate local a,b { x a; z b; } ctrl @ local q[0],q[1],q[0];']
    ]) reject(name, 3, body);
}

function refusalChecks() {
    for (const [name, body] of [
        ['constant_bit_initializer', 'bit c = 1;'],
        ['expression_bit_initializer', 'bit[2] c = 1 + 1;'],
        ['bool_bit_initializer', 'bit c = true;'],
        ['measurement_initializer_width', 'bit[2] c = measure q[0];'],
        ['negated_multibit_condition', 'bit[2] c; if(!c) x q[0];'],
        ['unsupported_runtime_expression', 'bit c; if(c + 1) x q[0];'],
        ['unsupported_runtime_and', 'bit c; bit d; if(c && d) x q[0];'],
        ['orphan_else', 'else { x q[0]; }'],
        ['missing_else_body', 'bit c; if(c) x q[0]; else'],
        ['else_odd_relative_phase', 'bit c; if(c) { x q[0]; } else { p(pi/8) q[1]; }'],
        ['slice_zero_step', 'x q[0:0:3];'],
        ['slice_too_many_parts', 'x q[0:1:2:3];'],
        ['slice_empty_range', 'x q[2:1];'],
        ['slice_empty_set', 'x q[{}];'],
        ['fractional_index', 'x q[0.5];'],
        ['nonfinite_index', 'x q[1/0];'],
        ['unsafe_index', 'x q[9007199254740992];'],
        ['open_slice_both', 'x q[:];'],
        ['open_slice_start', 'x q[:2];'],
        ['open_slice_end', 'x q[1:];'],
        ['open_slice_reverse', 'x q[: -1 :];'],
        ['concat_missing_operand', 'let a = q[0] ++;'],
        ['concat_unknown_register', 'let a = q[0] ++ missing;'],
        ['concat_repeated_qubit', 'let a = q[0:1] ++ q[1:2];'],
        ['concat_only_in_alias_grammar', 'x q[0] ++ q[1];']
    ]) reject(name, 4, body);
    reject('compressed_feedback_else', 2,
        'h q[0]; bit c = measure q[0]; if(c) x q[1]; else z q[1];', { mode: 'compressed' });
    reject('compressed_mid_measure_without_feedback', 1,
        'h q[0]; bit c = measure q[0]; h q[0];', { mode: 'compressed' });
}

measurementChecks();
branchChecks();
compileTimeChecks();
operandChecks();
existingStructureRegressionChecks();
lexicalScopeAndOperandChecks();
refusalChecks();
console.log(JSON.stringify(report, null, 2));
