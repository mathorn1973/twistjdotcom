/* Exact worker protocol reproduced in Node worker_threads on two architectures.
 * Browser's native classic Worker behavior is separately tested by Playwright.
 */
'use strict';
const {Worker}=require('node:worker_threads');
const path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const digest=crypto.createHash('sha256');let passed=0, errors=0;
const basic='OPENQASM 2.0; qreg q[1]; h q[0]; t q[0]; h q[0];';
async function query(data){
    const w=new Worker(path.join(__dirname,'test-query-worker-host.cjs'));
    try{return await new Promise((resolve,reject)=>{
        const t=setTimeout(()=>{reject(Error('Node worker deadlocked'));w.terminate();},10000);
        w.on('error',e=>{clearTimeout(t);reject(e);});
        w.on('message',m=>{
            if(m.type==='progress')return;
            clearTimeout(t);resolve(m);
        });
        w.postMessage(Object.assign({schema:'oq-exact-ui-v1',id:1,kind:'probability',method:'auto',source:basic,
          input:'0',output:'0',qubits:'0',outcome:'0',pauli:'Z0'},data));
    });}finally{await w.terminate();}
}
function equal(m,coefficients,den,label){
    assert.equal(m.type,'done',label+': '+(m.message||''));
    assert.equal(m.schema,'oq-exact-ui-v1');
    const v=m.result.value;
    assert.equal(v.numerator.length,coefficients.length,label);
    for(let i=0;i<coefficients.length;i++)
        assert.equal(v.numerator[i]*(1n<<BigInt(den)),
                     BigInt(coefficients[i])*(1n<<BigInt(v.denominatorExp)),label+' c'+i);
    digest.update(label+':'+v.numerator.join(',')+'/'+v.denominatorExp+'\n');passed++;
}
(async()=>{
    for(const method of ['auto','count','affine','active'])
        equal(await query({method}),[2,1,0,-1],2,'HTH P(0) '+method);
    for(const method of ['auto','count','affine'])
        equal(await query({kind:'amplitude',method}),[1,1,0,0],1,'HTH amplitude '+method);
    const bell='OPENQASM 2.0; qreg q[2]; h q[0]; cx q[0],q[1];';
    equal(await query({kind:'probability',source:bell,qubits:'0,1',outcome:'11'}),[1,0,0,0],1,'Bell joint');
    equal(await query({kind:'pauli',source:bell,pauli:'Z0 Z1',method:'active'}),[1,0,0,0],0,'Bell correlation');
    equal(await query({kind:'amplitude',source:'OPENQASM 3.0; qubit[24] q; p(pi/8) q[23];',
      input:'0x800000',output:'0x800000',method:'count'}),[0,1,0,0,0,0,0,0],0,'ring16 large index');
    const large='0b1'+'0'.repeat(4095);
    equal(await query({kind:'amplitude',source:'OPENQASM 3.0; qubit[4096] q; p(pi/8) q[4095];',
      input:large,output:large,method:'count'}),[0,1,0,0,0,0,0,0],0,'ring16 4096 bits');
    equal(await query({kind:'probability',source:'OPENQASM 3.0; qubit[128] q; h q[0]; cx q[0],q[127]; cp(pi/4) q[0],q[127];',
      qubits:'127',outcome:'1',method:'affine'}),[1,0,0,0],1,'high controlled phase');
    for(const [label,data,pattern] of [
      ['intermediate measurement',{source:'OPENQASM 3.0; qubit q; h q; bit c=measure q; h q;'},/intermediate/],
      ['amplitude active',{kind:'amplitude',method:'active'},/Physical amplitudes/],
      ['ring16 Pauli',{kind:'pauli',source:'OPENQASM 3.0; qubit q; p(pi/8) q;',pauli:'Z0'},/ring8/],
      ['bad outcome',{source:bell,qubits:'0,1',outcome:'0'},/exactly 2/],
      ['oversize QASM3',{source:'OPENQASM 3.0; qubit q; for int k in [0:10020] { h q; }'},/10000/]]){
        const m=await query(data);
        assert.equal(m.type,'error');assert.match(m.message,pattern,label);
        digest.update(label+':error\n');errors++;
    }
    console.log('PASS OQ exact worker protocol: '+passed+' exact results; '+errors+' typed errors');
    console.log('DIGEST '+digest.digest('hex'));
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
