/* Dedicated worker: no synchronous counting on the page thread. */
'use strict';

function handler(api, send) {
    return function (request) {
        const { id, mode, left, right, bitstring, maxNodes, shots, seed } = request || {};
        try {
            if (mode !== 'unitary' && mode !== 'state') throw new TypeError('Unknown comparison mode.');
            const compare = mode === 'unitary' ? api.compareUnitary : api.compareState;
            send({ id, ok: true, result: compare(left, right, { bitstring, maxNodes, shots, seed }) });
        } catch (error) {
            send({ id, ok: false, error: error.message });
        }
    };
}

if (typeof importScripts === 'function') {
    importScripts('oq.js', 'oq16.js', 'oqopt.js', 'qasm.js?v=qasm3-exact-1', 'oqcount.js', 'oqcompare.js');
    const compare = handler(self.OQCOMPARE, reply => self.postMessage(reply));
    self.onmessage = event => compare(event.data);
} else {
    const { parentPort } = require('node:worker_threads');
    parentPort.on('message', handler(require('./oqcompare.js'), reply => parentPort.postMessage(reply)));
}
