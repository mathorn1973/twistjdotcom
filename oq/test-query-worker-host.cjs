/* Node Worker testing shim. Reproduces classic Worker importScripts semantics;
 * this file is TEST-ONLY, never loaded by the OQ page or production worker. */
'use strict';
const {parentPort}=require('node:worker_threads');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
globalThis.self=globalThis;
globalThis.postMessage=(m)=>parentPort.postMessage(m);
globalThis.importScripts=(...names)=>{
    for(const name of names){
        if(!/^[a-z][a-z0-9]*\.js$/.test(name))throw Error('Unexpected importScripts path');
        vm.runInThisContext(fs.readFileSync(path.join(__dirname,name),'utf8'),{filename:name});
    }
};
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'oqqueryworker.js'),'utf8'),
    {filename:'oqqueryworker.js'});
parentPort.on('message',m=>globalThis.onmessage({data:m}));
