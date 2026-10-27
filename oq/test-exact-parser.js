/* Exact-query parser isolation. Independent of the Worker UI. */
'use strict';
const assert=require('node:assert/strict');
const Q=require('./qasm.js');
let checks=0;
function check(s,opt,verify){const p=Q.parse(s,opt);verify(p);checks++;}
const bell='OPENQASM 2.0; qreg q[2]; h q[0]; cx q[0],q[1];';
check(bell,{mode:'exact-query',optimize:false},p=>{
    assert.equal(p.backend,'exact-query');assert.equal(p.ring,8);assert.equal(p.gates.length,2);
});
check(bell,{optimize:false},p=>{assert.equal(p.backend,'dense');assert.equal(p.ring,8);});
const high='OPENQASM 3.0; qubit[128] q; h q[0]; cp(pi/4) q[0],q[127];';
check(high,{mode:'exact-query',optimize:false},p=>{
    assert.equal(p.n,128);assert.equal(p.backend,'exact-query');assert.equal(p.ring,8);
    assert.equal(p.gates[1][0],'mcpow');assert.equal(p.gates[1][1],null);
    assert.deepEqual(p.gates[1][3],[0,127]);
});
const ring16='OPENQASM 3.0; qubit[32] q; p(pi/8) q[31];';
check(ring16,{mode:'exact-query',optimize:false},p=>{
    assert.equal(p.ring,16);assert.equal(p.n,32);assert.equal(p.backend,'exact-query');
    assert.deepEqual(p.gates,[['zpow',31,1]]);
});
assert.throws(()=>Q.parse(ring16,{optimize:false}),/caps at 22|sparse backend/);checks++;
const global='OPENQASM 3.0; qubit q; gphase(pi/8);';
check(global,{mode:'exact-query',optimize:false},p=>{
    assert.equal(p.ring,16);assert.deepEqual(p.gates,[['gphase',1]]);
});
const measurement='OPENQASM 3.0; qubit q; bit c; h q; c=measure q;';
check(measurement,{mode:'exact-query',optimize:false},p=>{
    assert.equal(p.dynamic,false);assert.equal(p.measures.length,1);
    assert.deepEqual(p.gates,[['h',0]]);
});
assert.throws(()=>Q.parse('OPENQASM 3.0; qubit q; h q; bit c=measure q; x q;',{mode:'exact-query'}),/intermediate measurement|reset/);checks++;
assert.throws(()=>Q.parse('OPENQASM 3.0; qubit[4097] q; h q[0];',{mode:'exact-query'}),/4096/);checks++;
console.log('PASS exact-query QASM parser: '+checks+' scoped checks; other modes unchanged');
