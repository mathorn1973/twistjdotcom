/* Optional exact-query UI for OQ. All exact computation stays in a Worker.
 * (c) Marek Spanel 2026. All rights reserved.
 * NON-CANONICAL engineering, general acceleration H.
 */
(function(root,factory){
    if(typeof module==='object' && module.exports) module.exports=factory();
    else root.OQQUERYUI=factory();
})(typeof window!=='undefined'?window:this,function(){
'use strict';
const SCHEMA='oq-exact-ui-v1',DEADLINE_MS=30000;
function escapeText(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function shownInteger(x){
    const s=x.toString();
    if(s.length<=110)return {text:s,truncated:false};
    return {text:s.slice(0,48)+'…'+s.slice(-24)+' ['+s.length+' characters]',truncated:true};
}
function formatExact(value){
    if(!value || ![8,16].includes(value.ring)||!Array.isArray(value.numerator)||
        value.numerator.length!==value.ring/2 ||
        !value.numerator.every(v=>typeof v==='bigint') ||
        !Number.isSafeInteger(value.denominatorExp)||value.denominatorExp<0)
        throw new Error('Worker returned an invalid exact ring value');
    const symbols=['','ζ','ζ²','ζ³','ζ⁴','ζ⁵','ζ⁶','ζ⁷'];
    const parts=[],coeffs=[];let truncated=false;
    for(let i=0;i<value.numerator.length;i++){
        const v=value.numerator[i],x=shownInteger(v<0n?-v:v);
        if(v!==0n){
            const sign=v<0n?'−':'+',mag=x.text==='1'&&i>0?'':x.text;
            parts.push((parts.length?(sign==='−'?' − ':' + '):(sign==='−'?'−':''))+mag+symbols[i]);
        }
        const full=shownInteger(v);coeffs.push('c'+i+' = '+full.text);
        truncated=truncated||x.truncated||full.truncated;
    }
    return {
        result:(parts.length?'('+parts.join('')+')':'0')+(value.denominatorExp?'/2^'+value.denominatorExp:''),
        coefficients:coeffs.join(' · '),truncated
    };
}
function metric(v){
    if(typeof v==='bigint')return shownInteger(v).text;
    if(typeof v==='number'&&Number.isFinite(v))return String(v);
    if(typeof v==='string'&&v.length<90)return v;
    return null;
}
function summary(stats){
    const labels=[['backend','method'],['physicalQubits','physical qubits'],['activeRank','active rank r'],
      ['hadamards','Hadamards'],['activeHadamards','active H'],['linearFreeBits','free bits d'],
      ['phaseRank','phase rank χ'],['assignments','planned phase evaluations'],
      ['evaluatedAssignments','phase evaluations'],['nodes','DPLL nodes'],
      ['projectorBits','readout bits'],['projectorTerms','projector terms'],
      ['maxCNFVariables','CNF variables'],['maxCNFClauses','CNF clauses'],
      ['linearWork','symbolic work units'],['queries','readout queries']];
    if(!stats || typeof stats!=='object')return '';
    const out=[];
    for(const [key,label] of labels)if(Object.prototype.hasOwnProperty.call(stats,key)){
        const v=metric(stats[key]);if(v!==null)out.push(label+': '+v);
    }
    return out.join(' · ');
}
function renderResult(result){
    if(!result||typeof result!=='object'||!['amplitude','probability','pauli'].includes(result.kind))
        throw new Error('Worker did not return a complete scalar result');
    const f=formatExact(result.value),label=escapeText(result.label);
    const lines=['<span class="h">exact query</span>  <span class="q">'+label+'</span>',
      '<span class="h">result</span>       <span class="b">'+escapeText(f.result)+'</span>',
      '<span class="d">ring: Z[ζ'+(result.ring===16?'₁₆':'₈')+'] · denominator: 2^'+result.value.denominatorExp+'</span>',
      '<span class="d">'+escapeText(f.coefficients)+'</span>',
      '',
      '<span class="h">circuit</span>      '+result.qubits+' qubits · '+result.gates+' gates · input |'+escapeText(result.input)+'⟩',
      '<span class="h">selected</span>     '+escapeText(result.method)+' · '+escapeText(summary(result.stats))];
    if(result.terminalMeasurements)lines.push('<span class="d">Terminal measurements are metadata; result is before readout.</span>');
    if(f.truncated)lines.push('<span class="err">Large integer coefficients shortened for display. The Worker computed exact BigInt values; the shortened text is NOT a complete coefficient.</span>');
    lines.push('','<span class="d">Exact algebraic value, not a floating-point estimate. No full statevector, shot sampling or state fingerprint is produced by this query.</span>',
      '<span class="d">Experimental method; no general performance speedup is established (H).</span>');
    return lines.join('\n');
}
function create(opts){
    if(!opts||typeof opts.el!=='function'||typeof opts.setBusy!=='function'||typeof opts.isBusy!=='function')
        throw new TypeError('OQQUERYUI requires the existing UI controls');
    const el=opts.el;
    let current=null,serial=0;
    const controls=['queryKind','queryMethod','queryInput','queryOutput','queryQubits','queryOutcome','queryPauli'];
    function sync(){
        const kind=el('queryKind').value,method=el('queryMethod');
        for(const node of el('queryControls').querySelectorAll('[data-query-kind]'))
            node.hidden=node.getAttribute('data-query-kind')!==kind;
        const active=method.querySelector('option[value="active"]');
        active.disabled=kind==='amplitude';
        if(active.disabled&&method.value==='active')method.value='auto';
        for(const id of controls)el(id).disabled=opts.isBusy();
    }
    function chip(){return 'Exact scalar query · isolated Worker · bounded time and memory · speedup H (unproved)';}
    function stop(){
        if(!current)return false;
        current.finish({type:'stopped'});
        return true;
    }
    function request(){return {
        schema:SCHEMA,id:++serial,source:el('src').value,kind:el('queryKind').value,
        method:el('queryMethod').value,input:el('queryInput').value,
        output:el('queryOutput').value,qubits:el('queryQubits').value,
        outcome:el('queryOutcome').value,pauli:el('queryPauli').value
    };}
    async function run(){
        if(opts.isBusy())return;
        const out=el('out'),m=request();
        if(m.source.length>262144){out.textContent='QASM text exceeds the 262144-character exact-query limit.';return;}
        if(typeof Worker==='undefined'){
            out.textContent='This browser does not support Web Workers. The exact-query mode cannot run here.';return;
        }
        opts.setBusy(true);sync();out.innerHTML='';
        el('prog').classList.add('on');el('progBar').style.width='4%';
        el('progText').textContent='starting isolated exact-query Worker · Stop ends it immediately';
        let event;
        try{
            event=await new Promise(function(resolve){
                let worker,timeout,closed=false;
                function finish(value){
                    if(closed)return;
                    closed=true;
                    if(timeout!==undefined)clearTimeout(timeout);
                    if(worker)worker.terminate();
                    if(current&&current.finish===finish)current=null;
                    resolve(value);
                }
                current={finish};
                try{
                    worker=new Worker('oqqueryworker.js?v=1');
                    worker.onmessage=function(ev){
                        if(closed || !ev.data || ev.data.schema!==SCHEMA||ev.data.id!==m.id)return;
                        if(ev.data.type==='progress'){
                            const stage=ev.data.stage==='reading QASM'?'reading QASM':'computing exact result';
                            el('progBar').style.width=stage==='reading QASM'?'15%':'35%';
                            el('progText').textContent=stage+' · Stop can terminate this Worker';
                            return;
                        }
                        if(ev.data.type==='done'||ev.data.type==='error')finish(ev.data);
                        else finish({type:'error',message:'Unexpected Worker response'});
                    };
                    worker.onerror=function(e){if(e&&e.preventDefault)e.preventDefault();finish({type:'error',message:'Worker failed to start or load its modules. Serve the OQ directory over HTTP.'});};
                    worker.onmessageerror=function(){finish({type:'error',message:'Worker returned unreadable data'});};
                    timeout=setTimeout(function(){finish({type:'timeout'});},DEADLINE_MS);
                    worker.postMessage(m);
                }catch(e){finish({type:'error',message:'Cannot create the exact-query Worker: '+(e&&e.message?e.message:String(e))});}
            });
            if(event.type==='done'){
                out.innerHTML=renderResult(event.result);
                el('progBar').style.width='100%';
            }else if(event.type==='stopped')out.textContent='Stopped. The Worker was terminated. No partial result is used.';
            else if(event.type==='timeout')out.textContent='Exact query exceeded the 30-second Worker limit. Stopped without a result. Try a smaller circuit or another method.';
            else out.textContent=(event.line?'line '+event.line+': ':'')+(event.message||'Exact Worker error')+'\n\nNo partial result was used.';
        }catch(e){
            out.textContent='Invalid exact Worker result: '+(e&&e.message?e.message:String(e));
        }finally{
            if(current){current.finish({type:'stopped'});current=null;}
            el('prog').classList.remove('on');el('progText').textContent='';
            opts.setBusy(false);sync();
        }
    }
    el('queryKind').addEventListener('change',sync);
    el('queryMethod').addEventListener('change',sync);
    sync();
    return Object.freeze({run,stop,sync,chip,isRunning:()=>current!==null});
}
return Object.freeze({version:'0.1.0-experimental',create,formatExact,renderResult});
});
