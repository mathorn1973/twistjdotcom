'use strict';

const assert = require('node:assert/strict');
const link = require('./circuit-link.js');
const lessons = require('./lessons.js');
const QASM = require('./qasm.js');

const source = '  // Phase π/8 + |ψ⟩ & measurement #1\r\n' + lessons.grover(3, 5, true) + '\n';
const fragment = '#qasm=' + encodeURIComponent(source);
assert.equal(link.read(fragment), source);
assert.equal(link.read('#qasm=%2B+%252B'), '++%2B', 'decode once, keeping literal plus signs');

for (const base of [
    'https://twistj.com/oq/?keep=1#measurement',
    'http://127.0.0.1:8080/oq/index.html#grover',
    'file:///sample/oq/index.html#grover-search',
]) {
    const shared = link.build(base, source);
    const address = new URL(shared);
    const previous = new URL(base);
    assert.equal(address.origin, previous.origin);
    assert.equal(address.pathname, previous.pathname);
    assert.equal(address.search, previous.search);
    assert.equal(address.hash, fragment);
    const program = QASM.parse(link.read(address.hash));
    assert.equal(program.n, 3);
    assert.equal(program.ring, 8);
}

for (const hash of [null, '#measurement', '#QASM=h%20q;', '#qasm=', '#qasm=%20%0A', '#qasm=%', '#qasm=%ED%A0%80']) {
    assert.equal(link.read(hash), null, String(hash));
}
assert.equal(link.build('https://twistj.com/oq/', '\uD800'), null);
assert.equal(link.build('https://twistj.com/oq/', '  '), null);
assert.equal(link.build('data:text/plain,example', source), null);
assert.equal(link.build('not a URL', source), null);
console.log('PASS direct game-compatible QASM link roundtrip, malformed input, and local/offline URLs');
