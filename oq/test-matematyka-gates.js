/* Independent exact parser integration tests for Fractal Matematyka OQ.
 * Frozen before acceptance; tests full matrices including global phase.
 */
'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Q=require('./qasm.js'), O8=require('./oq.js'), O16=require('./oq16.js');
let gates=0, basisComparisons=0, amplitudeComparisons=0, controlCases=0, syntaxCases=0;
const digest=crypto.createHash('sha256');
function source(n,cmd){return `OPENQASM 3.0; include "stdgates.inc"; qubit[${n}] q; ${cmd}`;}
function parse(n,cmd,optimize){return Q.parse(source(n,cmd),{optimize});}
function state(n,program,input){
 const O=program.ring===16?O16:O8, s=new O.State(n);
 for(let j=0;j<n;j++)if((input>>j)&1)O.apply(s,['x',j]);
 for(const g of program.gates)O.apply(s,g);
 return s;
}
function amps(s){return Array.from({length:s.size},(_,y)=>{const a=s.amp(y);return (Array.isArray(a)?a:[a.c0,a.c1,a.c2,a.c3]).map(BigInt);});}
function checkBasis(s,expected,label,den=0){
 for(let y=0;y<s.size;y++){
  const a=amps(s)[y],v=expected[y]||Array(a.length).fill(0n);
  for(let k=0;k<a.length;k++){
   assert.equal(a[k]*(1n<<BigInt(den)),v[k]*(1n<<BigInt(s.denom)),`${label} at ${y} coefficient ${k}`);
   amplitudeComparisons++;
  }
 }
 basisComparisons++;
 digest.update(`${label}\0${s.hash()}\n`);
}
function one(y,coef){const d={};d[y]=coef||[1n,0n,0n,0n];return d;}
function checkAll(n,cmd,oracle){
 for(const opt of [false,true]){
  const p=parse(n,cmd,opt);gates++;
  for(let input=0;input<2**n;input++){
   const s=state(n,p,input);oracle(s,input,`n${n}:${cmd}:opt${opt}:in${input}`,p);
  }
 }
}
// Independently specified iSWAP and DCX actions on |00>, |01>, |10>, |11>.
checkAll(2,'iswap q[0],q[1];',(s,input,label,p)=>{
 assert.equal(p.ring,8);
 const mapping=[0,2,1,3][input];
 checkBasis(s,one(mapping,(input===1||input===2)?[0n,0n,1n,0n]:undefined),label);
});
checkAll(2,'dcx q[0],q[1];',(s,input,label,p)=>{
 assert.equal(p.ring,8);checkBasis(s,one([0,2,3,1][input]),label);
});
// The SX matrix is 1/2 [[1+i, 1-i],[1-i,1+i]].
for(const [op,dir]of [['csx',1],['csxdg',-1]]){
 checkAll(2,`${op} q[0],q[1];`,(s,input,label)=>{
  if(!(input&1))return checkBasis(s,one(input),label);
  const stay=[1n,0n,BigInt(dir),0n],flip=[1n,0n,BigInt(-dir),0n];
  checkBasis(s,{[input]:stay,[input^2]:flip},label,1);
 });
}
checkAll(2,'csx q[0],q[1]; csx q[0],q[1];',(s,input,label)=>{
 checkBasis(s,one((input&1)?input^2:input),label);
});
checkAll(2,'csx q[0],q[1]; csxdg q[0],q[1];',(s,input,label)=>checkBasis(s,one(input),label));
// Multi-controlled X, checked on ALL basis states and not against the parser's own expansion.
for(const n of [4,5]){
 const name=n===4?'c3x':'c4x';const args=Array.from({length:n},(_,q)=>`q[${q}]`).join(',');
 checkAll(n,`${name} ${args};`,(s,input,label)=>{
  const controls=(1<<(n-1))-1, target=1<<(n-1),y=(input&controls)===controls?input^target:input;
  checkBasis(s,one(y),label);controlCases++;
 });
}
// Separately compose the declared ECR definition from angle rotations, including their phases.
for(const opt of [false,true]){
 const actual=parse(2,'ecr q[0],q[1];',opt);
 const reference=parse(2,'rzx(pi/4) q[0],q[1]; x q[0]; rzx(-pi/4) q[0],q[1];',opt);
 for(let input=0;input<4;input++){
  const s=state(2,actual,input),t=state(2,reference,input);
  assert.equal(actual.ring,8);assert.equal(reference.ring,16);
  const ref8=amps(t).map((v)=>{for(const j of [1,3,5,7])assert.equal(v[j],0n,'ECR lies in ring8 subfield');return [v[0],v[2],v[4],v[6]];});
  checkBasis(s,Object.fromEntries(ref8.map((v,i)=>[i,v])),`ECR:${opt}:${input}`,t.denom);
 }
}
// RZX(pi/4) is H(target) CX Rz(pi/4)(target) CX H(target).
for(const opt of [false,true]){
 const actual=parse(2,'rzx(pi/4) q[0],q[1];',opt);
 const ref=parse(2,'h q[1]; cx q[0],q[1]; rz(pi/4) q[1]; cx q[0],q[1]; h q[1];',opt);
 for(let input=0;input<4;input++)checkBasis(state(2,actual,input),
  Object.fromEntries(amps(state(2,ref,input)).map((v,i)=>[i,v])),`RZX:${opt}:${input}`,state(2,ref,input).denom);
}
// U(theta,phi-pi/2,-phi+pi/2) is the explicit R(theta,phi) definition.
for(const opt of [false,true]){
 const actual=parse(1,'r(pi/2,pi/4) q[0];',opt);
 const ref=parse(1,'U(pi/2, (pi/4)-pi/2, -(pi/4)+pi/2) q[0];',opt);
 for(let input=0;input<2;input++){
  const s=state(1,actual,input),t=state(1,ref,input);
  checkBasis(s,Object.fromEntries(amps(t).map((v,i)=>[i,v])),`R:${opt}:${input}`,t.denom);
 }
}
// Set-valued loops, box and delay/pragma have exactly the intended gate-layer meaning.
for(const opt of [false,true]){
 const actual=parse(3,'for int k in {0,2} { h q[k]; }',opt);
 const ref=parse(3,'h q[0]; h q[2];',opt);
 for(let input=0;input<8;input++){
  const s=state(3,actual,input),t=state(3,ref,input);
  checkBasis(s,Object.fromEntries(amps(t).map((v,i)=>[i,v])),`FOR_SET:${opt}:${input}`,t.denom);
 }
 syntaxCases++;
 const annotated=parse(1,'delay[10ns] q[0]; box { h q[0]; } pragma backend_hint;',opt);
 const plain=parse(1,'h q[0];',opt);
 for(let input=0;input<2;input++){
  const s=state(1,annotated,input),t=state(1,plain,input);
  checkBasis(s,Object.fromEntries(amps(t).map((v,i)=>[i,v])),`TIMING_BOX:${opt}:${input}`,t.denom);
 }
 syntaxCases++;
}
console.log(`MATEMATYKA_QASM PASS gates=${gates} basis=${basisComparisons} coefficients=${amplitudeComparisons} controls=${controlCases} syntax=${syntaxCases}`);
console.log(`DIGEST ${digest.digest('hex')}`);
