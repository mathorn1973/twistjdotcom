(function (root) {
  'use strict';
  // Four exact coefficients in Z[j], j^4+j^3+j^2+j+1=0.
  const zero=()=>[0n,0n,0n,0n], one=()=>[1n,0n,0n,0n];
  const add=(a,b)=>a.map((x,i)=>x+b[i]);
  function multiply(a,b) {
    const c=Array(7).fill(0n);
    for(let i=0;i<4;i++) for(let k=0;k<4;k++) c[i+k]+=a[i]*b[k];
    for(let k=6;k>=4;k--) for(let q=1;q<=4;q++) c[k-q]-=c[k];
    return c.slice(0,4);
  }
  function power(a,n) {
    if(!Number.isInteger(n)||n<0||n>100) throw new RangeError('The exponent must be an integer from 0 to 100.');
    let p=one(); for(let k=0;k<n;k++) p=multiply(p,a); return p;
  }
  const j=[0n,1n,0n,0n], epsilon=[0n,0n,0n,-1n];
  function conjugate(a) {
    return a.reduce((s,x,k)=>add(s,power(j,(5-k)%5).map(v=>v*x)),zero());
  }
  function inner(v,w) {
    return v.reduce((s,x,k)=>add(s,multiply(conjugate(x),w[k])),zero());
  }
  function real(a) {
    if(a[1]!==0n||a[2]!==a[3]) throw new Error('The element is not real.');
    return [a[0],-a[2]]; // phi = -j^2-j^3.
  }
  function integralPair(v) {
    return {R:v.map(x=>v.map(y=>multiply(x,conjugate(y)))),s:inner(v,v)};
  }
  function state(id) {
    if(typeof id!=='string'||!/^(axis[01]|phase[0-9])$/.test(id)) throw new RangeError('Choose one of the twelve listed rays.');
    const phase=id.startsWith('phase')?Number(id.slice(5)):null;
    const vector=phase===null?(id==='axis0'?[one(),zero()]:[zero(),one()]):[one(),power(epsilon,phase)];
    const pair=integralPair(vector), [a,b]=real(pair.s);
    return {id,phase,vector,pair,support:phase===null?1:2,height:a*a+a*b-b*b,label:phase===null?(id==='axis0'?'[1 : 0]':'[0 : 1]'):`[1 : ε${phase}]`};
  }
  function gcd(a,b) {a=a<0n?-a:a;b=b<0n?-b:b;while(b){[a,b]=[b,a%b];}return a;}
  function fraction(a,b,denominator) {
    if(denominator===0n) throw new RangeError('A denominator cannot be zero.');
    if(denominator<0n){a=-a;b=-b;denominator=-denominator;}
    const g=gcd(gcd(a,b),denominator); return {a:a/g,b:b/g,denominator:denominator/g};
  }
  function overlap(idA,idB) {
    const A=state(idA),B=state(idB),h=inner(A.vector,B.vector);
    const numerator=real(multiply(h,conjugate(h)));
    const denominator=real(multiply(A.pair.s,B.pair.s));
    if(denominator[1]!==0n) throw new Error('This twelve-ray guide expects integer denominators.');
    const exact=fraction(...numerator,denominator[0]);
    const first=(Number(exact.a)+Number(exact.b)*(1+Math.sqrt(5))/2)/Number(exact.denominator);
    const second=(Number(exact.a)+Number(exact.b)*(1-Math.sqrt(5))/2)/Number(exact.denominator);
    return {A,B,h,exact,first,second,orthogonal:exact.a===0n&&exact.b===0n,same:exact.a===exact.denominator&&exact.b===0n};
  }
  const api={state,overlap,integralPair,multiply,conjugate,inner,real,power,fraction};
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.TwistProjectiveGuide=api;
})(typeof globalThis==='object'?globalThis:this);
