/* Real-browser exact-query UI and isolated Worker acceptance.
 * Use: OQ_PLAYWRIGHT_MODULE=/path/to/playwright-core node oq/test-query-browser.cjs
 * Local HTTP only. No deployment or changes to website sources.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),crypto=require('node:crypto');
const pw=require(process.env.OQ_PLAYWRIGHT_MODULE||'playwright-core');
const root=path.resolve(__dirname,'..');
const MIME={'.js':'text/javascript; charset=utf-8','.html':'text/html; charset=utf-8',
    '.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
const server=http.createServer((req,res)=>{
    let pathname;
    try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch(e){res.writeHead(400);res.end();return;}
    if(pathname.endsWith('/'))pathname+='index.html';
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
        res.writeHead(404);res.end();return;
    }
    res.writeHead(200,{'content-type':MIME[path.extname(file)]||'application/octet-stream',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    fs.createReadStream(file).pipe(res);
});
const counters={nativeResults:0,uiRuns:0,exactComparisons:0,bigIndex:0,rejected:0,
    stopped:0,timeout:0,workerFailure:0,noAuto:0,oldModes:0,staleReply:0,nativeStop:0,mobile:0};
const digest=crypto.createHash('sha256');
function logData(v){digest.update(JSON.stringify(v)+'\n');}
async function workerQuery(page,msg){
    const ret=await page.evaluate(async opts=>{
        const worker=new Worker('oqqueryworker.js?v=1');
        return await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>{worker.terminate();reject(Error('Worker test timeout'));},15000);
            worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(Error('Worker fatal startup error '+e.message));};
            worker.onmessage=e=>{
                if(e.data.type==='progress')return;
                clearTimeout(timer);worker.terminate();
                const r=e.data;
                if(r.type==='done'){
                    r.result.value.numerator=r.result.value.numerator.map(v=>v.toString());
                    r.result.input=r.result.input.toString();
                    r.result.stats={backend:r.result.stats.backend||null,
                        phaseRank:r.result.stats.phaseRank??null,
                        activeRank:r.result.stats.activeRank??null};
                }
                resolve(r);
            };
            worker.postMessage(Object.assign({schema:'oq-exact-ui-v1',id:1,kind:'probability',method:'auto',input:'0',
                output:'0',qubits:'0',outcome:'0',pauli:'Z0'},opts));
        });
    },msg);
    return ret;
}
function sameResult(got,want,refden,label){
    assert.equal(got.type,'done',label+': '+(got.message||''));
    for(let i=0;i<want.length;i++){
        const v=BigInt(got.result.value.numerator[i]);
        assert.equal(v*(1n<<BigInt(refden)),BigInt(want[i])*(1n<<BigInt(got.result.value.denominatorExp)),label+' coefficient '+i);
        counters.exactComparisons++;
    }
    logData([label,got.result.value.numerator,got.result.value.denominatorExp]);counters.nativeResults++;
}
async function denseRef(page,src,input,output){
    return await page.evaluate(({src,input,output})=>{
        const p=QASM.parse(src,{optimize:false}),E=p.ring===16?OQ16:OQ;
        const s=new E.State(p.n);
        for(let j=0;j<p.n;j++)if((BigInt(input)>>BigInt(j))&1n)E.apply(s,['x',j]);
        for(const g of p.gates)E.apply(s,g);
        const a=s.amp(Number(output));
        const coeffs=Array.isArray(a)?a:[a.c0,a.c1,a.c2,a.c3];
        return {numerator:coeffs.map(x=>x.toString()),denom:s.denom,ring:p.ring};
    },{src,input,output});
}
async function drive(page,{src,kind='probability',method='auto',input='0',qubits='0',outcome='0',output='0',pauli='Z0'}){
    await page.locator('#src').fill(src);
    await page.locator('#runMode').selectOption('exact-query');
    await page.locator('#queryKind').selectOption(kind);
    await page.locator('#queryMethod').selectOption(method);
    await page.locator('#queryInput').fill(input);
    if(kind==='probability'){
        await page.locator('#queryQubits').fill(qubits);
        await page.locator('#queryOutcome').fill(outcome);
    }else if(kind==='amplitude')await page.locator('#queryOutput').fill(output);
    else await page.locator('#queryPauli').fill(pauli);
    await page.locator('#runBtn').click();
    await page.waitForFunction(()=>!document.querySelector('#runBtn').disabled,{timeout:15000});
    const result=await page.locator('#out').innerText();
    counters.uiRuns++;
    return result;
}
(async()=>{
    let browser;
    try{
        await new Promise(r=>server.listen(0,'127.0.0.1',r));
        const origin='http://127.0.0.1:'+server.address().port;
        browser=await pw.chromium.launch({headless:true,args:['--no-sandbox'],timeout:25000});
        const context=await browser.newContext({viewport:{width:1160,height:900}});
        await context.route(/^https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//,r=>r.abort());
        const page=await context.newPage();const errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(origin+'/oq/',{waitUntil:'domcontentloaded'});
        assert.equal(await page.locator('#runMode').inputValue(),'statevector');
        assert.equal(await page.locator('#queryControls').isVisible(),false);
        await page.locator('#src').fill('OPENQASM 2.0; qreg q[1]; h q[0]; t q[0]; h q[0];');
        await page.locator('#runMode').selectOption('statevector');
        await page.locator('#runBtn').click();
        await page.waitForFunction(()=>!document.querySelector('#runBtn').disabled,{timeout:15000});
        assert.match(await page.locator('#out').innerText(),/fingerprint/i);counters.oldModes++;
        await page.locator('#runMode').selectOption('compressed');
        await page.locator('#rankQubits').fill('0');
        await page.locator('#rankPaulis').fill('Z0');
        await page.locator('#runBtn').click();
        await page.waitForFunction(()=>!document.querySelector('#runBtn').disabled,{timeout:15000});
        assert.match(await page.locator('#out').innerText(),/compressed observables/i);counters.oldModes++;
        const hth='OPENQASM 2.0; qreg q[1]; h q[0]; t q[0]; h q[0];';
        const hthRef=await denseRef(page,hth,'0','0');
        for(const method of ['auto','count','affine','active']){
            const txt=await drive(page,{src:hth,method});
            assert.match(txt,/exact query/i);assert.match(txt,/c0 = 2/);assert.match(txt,/c1 = 1/);
            assert.match(txt,/c3 = -1/);assert.match(txt,/2\^2/);
        }
        for(const method of ['auto','count','affine']){
            const txt=await drive(page,{src:hth,kind:'amplitude',method,output:'0'});
            assert.match(txt,/c0 = 1/);assert.match(txt,/c1 = 1/);assert.match(txt,/2\^1/);
            const got=await workerQuery(page,{source:hth,kind:'amplitude',method,output:'0'});
            sameResult(got,hthRef.numerator,hthRef.denom,'HTH amplitude '+method);
        }
        const bell='OPENQASM 2.0; qreg q[2]; h q[0]; cx q[0],q[1];';
        for(const bits of ['00','11','01']){
            const got=await workerQuery(page,{source:bell,kind:'probability',qubits:'0,1',outcome:bits});
            sameResult(got,bits==='01'?['0','0','0','0']:['1','0','0','0'],bits==='01'?0:1,'Bell joint '+bits);
        }
        const bellUI=await drive(page,{src:bell,kind:'pauli',pauli:'Z0 Z1',method:'active'});
        assert.match(bellUI,/c0 = 1/);
        const pauliResult=await workerQuery(page,{source:bell,kind:'pauli',pauli:'Z0 Z1'});
        sameResult(pauliResult,['1','0','0','0'],0,'Bell physical Pauli');
        const ring16='OPENQASM 3.0; qubit q; h q; p(pi/8) q; h q;';
        const ref16=await denseRef(page,ring16,'0','0');
        const r16=await workerQuery(page,{source:ring16,kind:'amplitude',method:'count',output:'0'});
        assert.equal(r16.result.ring,16);sameResult(r16,ref16.numerator,ref16.denom,'ring16 amplitude');
        const ref16non=await denseRef(page,ring16,'1','0');
        sameResult(await workerQuery(page,{source:ring16,kind:'amplitude',method:'affine',input:'1',output:'0'}),
            ref16non.numerator,ref16non.denom,'ring16 nonzero input');
        const high='OPENQASM 3.0; qubit[128] q; h q[0]; cx q[0],q[127]; cp(pi/4) q[0],q[127];';
        const highR=await workerQuery(page,{source:high,method:'affine',kind:'probability',qubits:'127',outcome:'1'});
        sameResult(highR,['1','0','0','0'],1,'high qubit 127');counters.bigIndex++;
        const high16='OPENQASM 3.0; qubit[24] q; p(pi/8) q[23];';
        const high16R=await workerQuery(page,{source:high16,kind:'amplitude',method:'count',input:'0x800000',output:'0x800000'});
        sameResult(high16R,['0','1','0','0','0','0','0','0'],0,'24 qubit ring16 selected amp');counters.bigIndex++;
        const endWord='0b1'+'0'.repeat(4095);
        const high4096=await workerQuery(page,{source:'OPENQASM 3.0; qubit[4096] q; p(pi/8) q[4095];',
            kind:'amplitude',method:'count',input:endWord,output:endWord});
        sameResult(high4096,['0','1','0','0','0','0','0','0'],0,'4096 qubit exact single amplitude');counters.bigIndex++;
        const rejects=[
            {source:ring16,kind:'pauli',pauli:'Z0',message:/ring8/i},
            {source:ring16,kind:'amplitude',method:'active',message:/Physical amplitudes/i},
            {source:'OPENQASM 3.0; qubit q; h q; bit c = measure q; h q;',message:/intermediate measurement/i},
            {source:bell,qubits:'0,1',outcome:'0',message:/exactly 2 binary digits/i},
            {source:bell,qubits:'0,0',outcome:'00',message:/once/i},
            {source:bell,input:'-1',message:/nonnegative/i},
            {source:bell,method:'garbage',message:/Unknown exact method/i},
            {source:'OPENQASM 3.0; qubit q; for int k in [0:10020] { h q; }',message:/10000 QASM3 statements/i}
        ];
        for(const x of rejects){const r=await workerQuery(page,x);assert.equal(r.type,'error',JSON.stringify(r));assert.match(r.message,x.message);counters.rejected++;}
        // Stop without work continuing: a deliberately nonresponsive Worker object.
        await page.evaluate(()=>{
            window.__nativeWorker=window.Worker;
            window.__fakeWorkers=[];
            window.Worker=class{
                constructor(){this.terminated=false;window.__fakeWorkers.push(this);}
                postMessage(m){this.request=m;}
                terminate(){this.terminated=true;}
            };
        });
        await page.locator('#runMode').selectOption('exact-query');
        await page.locator('#src').fill(hth);
        await page.locator('#queryKind').selectOption('probability');
        await page.locator('#queryMethod').selectOption('auto');
        await page.locator('#runBtn').click();
        await page.locator('#stopBtn').click();
        await page.waitForFunction(()=>!document.querySelector('#runBtn').disabled);
        assert.match(await page.locator('#out').innerText(),/Stopped.*No partial/i);
        assert.equal(await page.evaluate(()=>window.__fakeWorkers[0].terminated),true);
        counters.stopped++;
        await page.evaluate(()=>{
            const f=window.__fakeWorkers[0];f.onmessage({data:{schema:'oq-exact-ui-v1',id:f.request.id,type:'done',result:{}}});
        });
        assert.match(await page.locator('#out').innerText(),/Stopped.*No partial/i);
        counters.staleReply++;
        // Shorten only the synthetic 30s timer in this test. Production stays at 30s.
        await page.evaluate(()=>{
            window.__oldTimeout=window.setTimeout;
            window.setTimeout=function(fn,ms,...args){return window.__oldTimeout(fn,ms===30000?30:ms,...args);};
        });
        await page.locator('#runBtn').click();
        await page.waitForFunction(()=>!document.querySelector('#runBtn').disabled);
        assert.match(await page.locator('#out').innerText(),/30-second Worker limit/i);
        assert.equal(await page.evaluate(()=>window.__fakeWorkers[1].terminated),true);
        counters.timeout++;
        await page.evaluate(()=>{
            window.setTimeout=window.__oldTimeout;
            window.Worker=class{constructor(){throw Error('startup fixture');}};
        });
        await page.locator('#runBtn').click();
        await page.waitForFunction(()=>!document.querySelector('#runBtn').disabled);
        assert.match(await page.locator('#out').innerText(),/startup fixture/);
        counters.workerFailure++;
        await page.evaluate(()=>{window.Worker=window.__nativeWorker;});
        await page.locator('#runBtn').click();
        await page.waitForFunction(()=>!document.querySelector('#runBtn').disabled,{timeout:15000});
        assert.match(await page.locator('#out').innerText(),/exact query/i);
        // Terminate a REAL Worker during an intentionally expensive path-count run.
        const hard='OPENQASM 2.0; qreg q[1]; '+('h q[0]; t q[0]; ').repeat(160);
        await page.locator('#src').fill(hard);
        await page.locator('#queryKind').selectOption('probability');
        await page.locator('#queryMethod').selectOption('count');
        await page.locator('#runBtn').click();
        await page.locator('#stopBtn').click();
        await page.waitForFunction(()=>!document.querySelector('#runBtn').disabled);
        assert.match(await page.locator('#out').innerText(),/Stopped.*No partial/i);
        counters.nativeStop++;
        await page.locator('#src').fill(hth);
        await page.locator('#queryMethod').selectOption('affine');
        await page.locator('#runBtn').click();
        await page.waitForFunction(()=>!document.querySelector('#runBtn').disabled,{timeout:15000});
        assert.match(await page.locator('#out').innerText(),/c0 = 2/);
        // Exact query persisted in storage must NOT spawn an expensive worker at boot.
        const context2=await browser.newContext();
        await context2.addInitScript(()=>{
            localStorage.setItem('oq-mode','exact-query');
            window.__workersConstructed=0;
            const original=window.Worker;
            window.Worker=class extends original{constructor(...args){super(...args);window.__workersConstructed++;}};
        });
        await context2.route(/^https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//,r=>r.abort());
        const page2=await context2.newPage();await page2.goto(origin+'/oq/');
        await page2.waitForTimeout(300);
        assert.equal(await page2.locator('#runMode').inputValue(),'exact-query');
        assert.equal(await page2.evaluate(()=>window.__workersConstructed),0);
        assert.match(await page2.locator('#out').innerText(),/press Run/i);
        counters.noAuto++;
        const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
        await mobileContext.route(/^https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)\//,r=>r.abort());
        const mobile=await mobileContext.newPage();
        mobile.on('pageerror',e=>errors.push('mobile: '+e.message));
        await mobile.goto(origin+'/oq/',{waitUntil:'domcontentloaded'});
        await mobile.locator('#src').fill(hth);
        await mobile.locator('#runMode').selectOption('exact-query');
        await mobile.locator('#queryKind').selectOption('probability');
        await mobile.locator('#runBtn').click();
        await mobile.waitForFunction(()=>!document.querySelector('#runBtn').disabled);
        assert.match(await mobile.locator('#out').innerText(),/c0 = 2/);
        assert.equal(await mobile.locator('#queryControls').isVisible(),true);
        assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true,'mobile viewport horizontal overflow');
        counters.mobile++;
        await mobileContext.close();
        assert.deepEqual(errors,[],`page errors: ${errors.join(' | ')}`);
        logData(counters);
        console.log('OQ_EXACT_UI_BROWSER PASS '+JSON.stringify(counters));
        console.log('DIGEST '+digest.digest('hex'));
        await context2.close();await context.close();
    } finally {
        if(browser)await browser.close();
        await new Promise(resolve=>server.close(resolve));
    }
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1;});
