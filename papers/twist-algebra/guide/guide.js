(function () {
  'use strict';
  const model=globalThis.TwistProjectiveGuide,$=id=>document.getElementById(id);
  let rayA='phase0',rayB='phase2',active='B';
  const superscripts=['⁰','¹','²','³','⁴','⁵','⁶','⁷','⁸','⁹'];
  const phaseLabel=r=>r===0?'1':r===2?'j':r===5?'−1':`ε${superscripts[r]}`;
  const rayLabel=s=>s.phase===null?(s.id==='axis0'?'[1 : 0]':'[0 : 1]'):`[1 : ${phaseLabel(s.phase)}]`;
  function polynomial(a,bases) {
    const terms=[];
    a.forEach((v,k)=>{if(v===0n)return;const abs=v<0n?-v:v;const term=k===0?String(abs):(abs===1n?'':String(abs))+bases[k];terms.push((v<0n?'−':(terms.length?'+':''))+' '+term);});
    return terms.length?terms.join(' ').trim():'0';
  }
  const field=x=>polynomial(x,['','j','j²','j³']);
  const exact=x=>{const numerator=polynomial([x.a,x.b],['','φ']);return x.denominator===1n?numerator:(x.a!==0n&&x.b!==0n?`(${numerator})` : numerator)+' / '+x.denominator;};
  const approximate=x=>'≈ '+x.toFixed(6);
  function stored(s) {
    if(s.phase===null) return `R = ${s.id==='axis0'?'((1, 0), (0, 0))':'((0, 0), (0, 1))'}, s = 1`;
    const r=s.phase,c=(10-r)%10;
    return `R = ((1, ${phaseLabel(c)}), (${phaseLabel(r)}, 1)), s = 2`;
  }
  function render() {
    const result=model.overlap(rayA,rayB), labelA=rayLabel(result.A),labelB=rayLabel(result.B);
    $('select-a').setAttribute('aria-pressed',String(active==='A'));
    $('select-b').setAttribute('aria-pressed',String(active==='B'));
    document.querySelectorAll('.state-button').forEach(button=>{
      const id=button.dataset.state,isA=id===rayA,isB=id===rayB;
      button.classList.toggle('selected-a',isA);button.classList.toggle('selected-b',isB);
      button.setAttribute('aria-pressed',String(id===(active==='A'?rayA:rayB)));
      button.querySelector('.selection-label').textContent=isA&&isB?'A + B':isA?'A':isB?'B':'';
    });
    $('ray-a').textContent=labelA;$('ray-b').textContent=labelB;
    for(const [key,s] of [['a',result.A],['b',result.B]]) $('height-'+key).textContent=`${s.support} nonzero coordinate${s.support===1?'':'s'} · Δ = ${s.height}`;
    $('exact-overlap').textContent=exact(result.exact);
    const relationship=result.same?'Same ray':result.orthogonal?'Orthogonal rays':'Distinct, nonorthogonal rays';
    $('relationship').textContent=relationship;
    $('first-reading').textContent=approximate(result.first);$('second-reading').textContent=approximate(result.second);
    $('first-bar').style.width=(result.first*100)+'%';$('second-bar').style.width=(result.second*100)+'%';
    $('selection-status').textContent=`Changing ray ${active}. A is ${labelA}; B is ${labelB}. ${relationship}. Exact overlap ${exact(result.exact)}.`;
    $('stored-pair').textContent=stored(result.A);$('inner-readout').textContent='h(A,B) = '+field(result.h);
    const line=$('pair-line');
    line.setAttribute('visibility',result.A.phase===null||result.B.phase===null||result.same?'hidden':'visible');
    for(const [suffix,s] of [['1',result.A],['2',result.B]]) if(s.phase!==null) {
      const theta=Math.PI*s.phase/5;
      line.setAttribute('x'+suffix,String(200+142*Math.cos(theta)));
      line.setAttribute('y'+suffix,String(200-142*Math.sin(theta)));
    }
  }
  $('select-a').addEventListener('click',()=>{active='A';render();});
  $('select-b').addEventListener('click',()=>{active='B';render();});
  document.querySelectorAll('.state-button').forEach(button=>button.addEventListener('click',()=>{if(active==='A')rayA=button.dataset.state;else rayB=button.dataset.state;render();}));
  $('swap-rays').addEventListener('click',()=>{[rayA,rayB]=[rayB,rayA];render();});
  const preset=(a,b)=>{rayA=a;rayB=b;active='B';render();};
  $('adjacent-example').addEventListener('click',()=>preset('phase0','phase1'));
  $('orthogonal-example').addEventListener('click',()=>preset('phase0','phase5'));
  $('reset-example').addEventListener('click',()=>preset('phase0','phase2'));
  render();
})();
