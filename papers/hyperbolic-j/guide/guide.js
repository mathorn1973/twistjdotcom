(function (root) {
  'use strict';
  const M = [[1n,0n,-1n,1n],[0n,1n,-1n,0n],[1n,0n,0n,0n],[0n,1n,-1n,1n]];
  const identity = () => Array.from({length:4}, (_,i) => Array.from({length:4}, (_,j) => i === j ? 1n : 0n));
  const product = (a,b) => a.map(row => b[0].map((_,j) => row.reduce((s,x,k) => s + x*b[k][j], 0n)));
  function determinant(matrix) {
    const a = matrix.map(row => row.slice());
    let sign = 1n, previous = 1n;
    for (let k=0;k<3;k++) {
      if (a[k][k] === 0n) {
        const swap = a.findIndex((row,i) => i>k && row[k] !== 0n);
        if (swap<0) return 0n;
        [a[k],a[swap]]=[a[swap],a[k]]; sign=-sign;
      }
      const pivot=a[k][k];
      for (let i=k+1;i<4;i++) for (let j=k+1;j<4;j++) {
        const numerator=a[i][j]*pivot-a[i][k]*a[k][j];
        if (numerator%previous !== 0n) throw new Error('Non-integral determinant elimination.');
        a[i][j]=numerator/previous;
      }
      for (let i=k+1;i<4;i++) a[i][k]=0n;
      previous=pivot;
    }
    return sign*a[3][3];
  }
  function census(limit=8) {
    if (!Number.isInteger(limit) || limit<1 || limit>32) throw new RangeError('Choose an integer limit from 1 to 32.');
    const records=[]; let power=identity();
    for (let n=1;n<=limit;n++) {
      power=product(power,M);
      const delta=power.map((row,i) => row.map((x,j) => x-(i===j?1n:0n)));
      const signed=determinant(delta), fixed=signed<0n?-signed:signed;
      let exact=fixed;
      for (const row of records) if (n%row.n===0) exact-=row.exact;
      if (exact<0n || exact%BigInt(n)!==0n) throw new Error('Invalid exact-period count.');
      records.push({n,fixed,exact,orbits:exact/BigInt(n)});
    }
    return records;
  }
  const step = vector => M.map(row => row.reduce((s,x,j) => s+x*vector[j],0n));
  function liftAt(n) {
    if (!Number.isInteger(n)||n<0||n>6) throw new RangeError('Choose a lift step from 0 to 6.');
    let lift=[-2n,1n,2n,6n];
    for(let i=0;i<n;i++) lift=step(lift);
    return {step:n,lift,residues:lift.map(x=>((x%11n)+11n)%11n),denominator:11n};
  }
  const api={census,determinant,step,liftAt};
  if (typeof module==='object'&&module.exports) module.exports=api;
  root.HyperbolicJGuide=api;
  if (typeof document==='undefined') return;

  const $=id=>document.getElementById(id), rows=census(8);
  let selected=1, liftStep=0;
  const svgNS='http://www.w3.org/2000/svg';
  const element=(name,attrs,text)=>{const e=document.createElementNS(svgNS,name);for(const [key,val] of Object.entries(attrs)) e.setAttribute(key,String(val));if(text!==undefined)e.textContent=text;return e;};
  const integer=x=>x.toString().replace('-','−');
  const tuple=a=>'('+a.map(integer).join(', ')+') / 11';
  function drawCounts() {
    const parent=$('count-bars');parent.replaceChildren();
    const base=225, height=177, maximum=Math.log10(Number(rows[7].fixed)+1);
    parent.append(element('line',{x1:26,y1:base,x2:550,y2:base,stroke:'#dbddd3'}));
    rows.forEach((row,i)=>{
      const x=31+i*65, h=height*Math.log10(Number(row.fixed)+1)/maximum;
      parent.append(element('rect',{x,y:base-h,width:40,height:h,rx:4,fill:row.n===selected?'#a95432':'#d8ded2'}));
      parent.append(element('text',{x:x+20,y:base-h-9,'text-anchor':'middle','font-size':12},String(row.fixed)));
      parent.append(element('text',{x:x+20,y:247,'text-anchor':'middle','font-size':13,'font-weight':row.n===selected?700:400},String(row.n)));
    });
    $('count-chart-desc').textContent='Fixed points for n = 1 through 8: '+rows.map(r=>String(r.fixed)).join(', ')+'. Selected n = '+selected+'. Heights use log base ten of one plus the exact count.';
  }
  function showCount(n) {
    if (!Number.isInteger(n)||n<1||n>8) return;
    selected=n;const row=rows[n-1];
    $('period').value=String(n);$('period-value').value=String(n);
    $('fixed').value=String(row.fixed);$('exact').value=String(row.exact);$('orbits').value=String(row.orbits);
    $('previous').disabled=n===1;$('next').disabled=n===8;$('reset-count').disabled=n===1;
    const earlier=row.fixed-row.exact;
    const earlierText=earlier===1n?'1 point already has a smaller period.':`${earlier} points already have a smaller period.`;
    $('count-message').textContent=n===1?'At n = 1, the single fixed point is the zero class. Its exact period is one.':`${row.fixed} points return after ${n} steps. ${earlierText} The remaining ${row.exact} points form ${row.orbits} distinct ${n}-cycles.`;
    document.querySelectorAll('#count-table tr').forEach(tr=>tr.classList.toggle('selected',Number(tr.dataset.n)===n));
    drawCounts();
  }
  function drawCoordinates(record) {
    const parent=$('coordinate-tracks');parent.replaceChildren();
    record.residues.forEach((value,i)=>{
      const y=37+61*i, start=83, width=386, coordinate=Number(value)/11;
      parent.append(element('text',{x:18,y:y+5,'font-size':15},'x'+String(i+1)));
      parent.append(element('line',{x1:start,y1:y,x2:start+width,y2:y,stroke:'#dbddd3','stroke-width':3}));
      for(let tick=0;tick<=11;tick++) parent.append(element('line',{x1:start+width*tick/11,y1:y-4,x2:start+width*tick/11,y2:y+4,stroke:'#b8c3b5'}));
      parent.append(element('circle',{cx:start+width*coordinate,cy:y,r:8,fill:'#a95432'}));
      parent.append(element('text',{x:548,y:y+5,'text-anchor':'end','font-size':14},`${value}/11`));
      if(i===3){parent.append(element('text',{x:start,y:y+28,'text-anchor':'middle','font-size':11},'0'));parent.append(element('text',{x:start+width,y:y+28,'text-anchor':'middle','font-size':11},'1 ≡ 0'));}
    });
    $('coordinate-desc').textContent=`Step ${record.step}. Four residues modulo one: ${record.residues.map(x=>`${x}/11`).join(', ')}. Each line is a separate coordinate of the four-torus.`;
  }
  function showLift(n) {
    const record=liftAt(n);liftStep=n;
    $('lift-vector').value=tuple(record.lift);$('residue-vector').value=tuple(record.residues);$('lift-step').textContent=`Step ${n} of 6`;
    $('lift-next').disabled=n===6;$('lift-reset').disabled=n===0;
    $('lift-message').textContent=n===0?'This is the starting class. Its first coordinate can be written as −2/11 or 9/11.':n===2?'The class is back. The exact lift has changed by (1, 0, 0, 0): M²x = x + (1, 0, 0, 0).':n%2===0?'The torus class is back again, but the exact lift is different. The cycle has period two.':'The class is at the other point of the two-cycle. One more step returns it to the starting class.';
    drawCoordinates(record);
  }
  $('period').disabled=false;
  $('period').addEventListener('input',event=>showCount(Number(event.target.value)));
  $('previous').addEventListener('click',()=>showCount(selected-1));
  $('next').addEventListener('click',()=>showCount(selected+1));
  $('reset-count').addEventListener('click',()=>showCount(1));
  $('lift-next').addEventListener('click',()=>showLift(liftStep+1));
  $('lift-reset').addEventListener('click',()=>showLift(0));
  showCount(1);showLift(0);
})(typeof globalThis!=='undefined'?globalThis:this);
