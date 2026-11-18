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
assert.throws(()=>Q.parse('OPENQASM 3.0; qubit q; for int k in [0:10020] { h q; }',
    {mode:'exact-query',optimize:false}),/10000 QASM3 statements/);checks++;
assert.throws(()=>Q.parse('OPENQASM 2.0; qreg q[4096]; h q; h q; h q;',
    {mode:'exact-query',optimize:false}),/10000 gates/);checks++;
const mode={mode:'exact-query',optimize:false};
function reject(source, message){assert.throws(()=>Q.parse(source,mode),message);checks++;}
reject('OPENQASM 3.0; qubit q; for int i in [0:1000000000] { barrier q; }',/50000 compile-time steps/);
reject('OPENQASM 3.0; qubit q; for int i in [0:999] { for int j in [0:999] { delay[1ns] q; } }',/50000 compile-time steps/);
reject('OPENQASM 3.0; qubit q; for int i in [0:9007199254740992] { h q; }',/safe integers/);
reject('OPENQASM 3.0; qubit[2] q; ctrl(1000000000) @ x q[0], q[1];',/control count exceeds/);
reject('OPENQASM 2.0; qreg q[4096]; pow(4096) @ h q;',/10000 gates/);
reject('OPENQASM 2.0; qreg q[1]; creg c[1000000000]; measure q -> c;',/classical registers exceed/);
check('OPENQASM 3.0; qubit q; reset q; h q;',{},p=>assert.deepEqual(p.gates,[['h',0]]));
reject('OPENQASM 3.0; qubit q; reset q; h q;',/do not support reset/);
const angleGrowth=Array.from({length:25},(_,i)=>i?'const angle a'+i+' = a'+(i-1)+' + a'+(i-1)+';':'const angle a0=pi;').join('\n');
reject('OPENQASM 3.0; qubit q;\n'+angleGrowth+'\np(a24) q;',/2 MiB of generated text/);
for(const gate of ['p','rz','rx','ry','u1']) {
    reject('OPENQASM 2.0; qreg q[1]; '+gate+'(pi/2+1e-20) q[0];',/unlike powers of pi/);
}
reject('OPENQASM 3.0; qubit q; gphase(pi/8+1e-20);',/unlike powers of pi/);
reject('OPENQASM 3.0; qubit[2] q; cp(0.39269908169872414) q[0],q[1];',/multiple of pi\/8/);
reject('OPENQASM 3.0; qubit q; U(pi/2+1e-20,0,0) q;',/unlike powers of pi/);
reject('OPENQASM 3.0; qubit q; if (1+1e-20==1) { x q; }',/dyadic fractions/);
reject('OPENQASM 3.0; qubit q; pow(1+1e-20) @ x q;',/dyadic fractions/);
reject('OPENQASM 3.0; qubit[2] q; ctrl(1+1e-20) @ x q[0],q[1];',/dyadic fractions/);
reject('OPENQASM 3.0; include "custom.inc"; qubit q; h q;',/only the stdgates.inc include/);
reject('OPENQASM 2.0; include "custom.inc"; qreg q[1]; h q[0];',/only the qelib1.inc include/);
check('OPENQASM 2.0; qreg q[1]; p(pi/8+1e-20) q[0];',{},p=>assert.deepEqual(p.gates,[['zpow',0,1]]));
check('OPENQASM 3.0; qubit q; const angle a = 0.125*pi; p(a+(pi-pi)) q;',mode,p=>assert.deepEqual(p.gates,[['zpow',0,1]]));
check('OPENQASM 3.0; qubit q; p(9007199254740993*pi/8) q;',mode,p=>assert.deepEqual(p.gates,[['zpow',0,1]]));
check('OPENQASM 3.0; qubit q; pow(1/2) @ z q;',mode,p=>assert.deepEqual(p.gates,[['zpow',0,2]]));
check('OPENQASM 3.0; qubit q; if (1 + 1/4096 > 1) { h q; } else { x q; }',mode,p=>assert.deepEqual(p.gates,[['h',0]]));
check('OPENQASM 3.0; qubit[2] q; ctrl @ gphase(pi/8) q[1];',mode,p=>{
    assert.equal(p.ring,16);
    assert.deepEqual(p.gates,[['mcpow',2,1,[1]]]);
});
reject('OPENQASM 2.0; qreg q[1]; pow(0) @ unknown q[0];',/unknown gate/);
reject('OPENQASM 3.0; qubit q; pragma vendor_instruction;',/pragmas/);
check('OPENQASM 3.0; include "stdgates.inc"; qubit q; pow(0) @ x q;',mode,p=>assert.deepEqual(p.gates,[]));
console.log('PASS exact-query QASM parser: '+checks+' scoped checks; other modes unchanged');
