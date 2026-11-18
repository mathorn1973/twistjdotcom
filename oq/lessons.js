(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.OQLessons = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function phase(turn, hadamardReadout) {
        var gates = { 0: '', 1: 't q[0];', 2: 's q[0];', 4: 'z q[0];' };
        var lines = [
            'OPENQASM 2.0;', 'include "qelib1.inc";', 'qreg q[1];', 'creg c[1];',
            '', '// Prepare an equal superposition.', 'h q[0];'
        ];
        if (gates[turn]) lines.push('// Change the relative phase of |1>.', gates[turn]);
        if (hadamardReadout) lines.push('// Read in the X basis using H, then measure.', 'h q[0];');
        lines.push('measure q -> c;');
        return lines.join('\n') + '\n';
    }

    function grover(qubits, target, iterate) {
        var register = Array.from({ length: qubits }, function (_, bit) { return 'q[' + bit + ']'; });
        var zeros = register.filter(function (_, bit) { return (target & (1 << bit)) === 0; });
        var label = target.toString(2).padStart(qubits, '0');
        var tag = (qubits === 2 ? 'cz ' : 'ccz ') + register.join(',') + ';';
        var lines = [
            'OPENQASM 2.0;', 'include "qelib1.inc";', 'qreg q[' + qubits + '];', 'creg c[' + qubits + '];',
            '', '// Target |' + label + '>; displayed bit order is q[' + (qubits - 1) + '] to q[0].',
            'h q;'
        ];

        if (iterate) {
            lines.push('', '// One oracle application: flip the target amplitude.');
            zeros.forEach(function (wire) { lines.push('x ' + wire + ';'); });
            lines.push(tag);
            zeros.forEach(function (wire) { lines.push('x ' + wire + ';'); });
            lines.push('', '// Reflect about the mean, up to a global sign.',
                'h q;', 'x q;', tag, 'x q;', 'h q;');
        }

        lines.push('', 'measure q -> c;');
        return lines.join('\n') + '\n';
    }

    function bell(negative) {
        var lines = ['OPENQASM 3;', 'include "stdgates.inc";', 'qubit[2] q;', 'h q[0];', 'cx q[0], q[1];'];
        if (negative) lines.push('z q[0];');
        return lines.join('\n') + '\n';
    }

    return { phase: phase, grover: grover, bell: bell };
});
