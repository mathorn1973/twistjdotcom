const TwistJ=(()=>{
const PHI=(1+Math.sqrt(5))/2,PHI_I=1/PHI,PHI_2=PHI*PHI,PHI_I2=1/PHI_2,F_SCH=7.83;
const FIBS=[3,5,8,13,21];
const TEMPO_MULS=[PHI_I2,PHI_I,1,PHI,PHI_2];
const TEMPO_NAMES=['largo','adagio','andante','allegro','presto'];
const TEMPO_LABELS=['φ⁻²','φ⁻¹','1','φ','φ²'];
const ROOT_HARMONICS=[24,27,30,36,40];
const ROOT_NAMES=['I','II','III','V','VI'];
const SCALE_RATIOS=[[1,1],[9,8],[5,4],[4,3],[3,2],[5,3],[15,8],[2,1]];
const RIFF_NAMES=[
  'jab','snap','kick','stab','pop','hit','crack','dart',
  'whip','burst','slam','rush','punch','spike','bang','zip',
  'flick','hook','rip','tap','dive','sting','chop','zap',
  'thump','click','buzz','ping','slash','drop','clip','bolt',
  'grind','lash','poke','blitz','smash','jolt','strike','cut'
];
const RIFFS=[
  [[0,.25],[4,.25]],[[- 1,.125],[0,.25],[7,.125]],[[0,.5],[4,.25],[7,.25]],
  [[7,.125],[4,.125],[0,.25]],[[-1,.25],[0,.125],[0,.125]],
  [[0,.125],[4,.125],[7,.125],[4,.125]],[[7,.25],[-1,.125],[0,.125]],
  [[0,.125],[2,.125],[4,.125],[7,.125]],[[4,.25],[-1,.125],[0,.125]],
  [[0,.125],[7,.125],[-1,.125],[4,.125]],[[0,.5],[7,.125],[0,.125]],
  [[2,.125],[4,.125],[7,.125]],[[0,.25],[0,.125],[4,.125]],
  [[-1,.125],[7,.25],[4,.125]],[[4,.125],[4,.125],[7,.25]],
  [[7,.125],[4,.125]],[[0,.125],[-1,.125],[7,.25]],
  [[4,.125],[0,.125],[7,.25]],[[7,.25],[4,.125],[0,.125]],
  [[0,.5],[-1,.125],[0,.125]],[[7,.125],[5,.125],[4,.125]],
  [[0,.25],[-1,.125],[4,.125]],[[4,.125],[7,.125],[4,.125],[0,.125]],
  [[-1,.125],[0,.125],[4,.25]],[[0,.125],[0,.125],[0,.125],[-1,.125]],
  [[4,.125],[-1,.125],[0,.125]],[[0,.125],[4,.125],[0,.125]],
  [[7,.25],[5,.25]],[[0,.125],[7,.375]],[[7,.375],[0,.125]],
  [[-1,.125],[4,.125],[7,.125],[4,.125]],[[0,.125],[4,.25],[7,.125]],
  [[0,.25],[2,.125],[4,.125]],[[7,.125],[0,.25],[4,.125]],
  [[-1,.125],[0,.375]],[[4,.125],[7,.125],[0,.125],[4,.125]],
  [[0,.375],[7,.125]],[[4,.25],[0,.25]],
  [[0,.125],[4,.125],[7,.125],[0,.125],[4,.125]],
  [[7,.125],[4,.125],[2,.125],[0,.125],[7,.125],[0,.125]]
];
const BASS_RIFFS=[
  [[0,.25],[-1,.25]],[[0,.25],[0,.125],[4,.125]],[[0,.375],[4,.125]],
  [[-1,.125],[0,.25],[-1,.125]],[[4,.125],[0,.375]],
  [[0,.125],[0,.125],[-1,.25]],[[0,.25],[4,.25]],
  [[0,.125],[-1,.125],[4,.25]],[[0,.5]],
  [[-1,.125],[0,.125],[0,.25]],[[4,.25],[0,.125],[4,.125]],
  [[0,.125],[4,.125],[0,.125],[-1,.125]],
  [[0,.125],[0,.125],[4,.125],[0,.125]],
  [[-1,.125],[0,.125],[-1,.125],[4,.125]],
  [[0,.25],[0,.125],[-1,.125]],[[4,.125],[0,.125],[4,.125],[0,.125]]
];
function riffNoteDeg(r,p){return r[p][0];}
function riffNoteDur(r,p){return r[p][1];}
function riffEndDeg(r){for(let i=r.length-1;i>=0;i--)if(r[i][0]>=0)return r[i][0];return 0;}
function riffStartDeg(r){for(let i=0;i<r.length;i++)if(r[i][0]>=0)return r[i][0];return 0;}
function selectRiff(n,prevEnd){const base=gPhase(n,RIFFS.length);const gap=Math.abs(riffStartDeg(RIFFS[base])-prevEnd);if(gap<=3)return base;const off=tm(n*3+1)===1?7:13;const alt=(base+off)%RIFFS.length;return Math.abs(riffStartDeg(RIFFS[alt])-prevEnd)<gap?alt:base;}
function selectBassRiff(n){return gPhase(n*7,BASS_RIFFS.length);}
const VOICE_DEFS=[{name:'lead',wave:'triangle',vol:0.50,regOff:0},{name:'counter',wave:'sine',vol:0.30,regOff:0},{name:'bass',wave:'triangle',vol:0.45,regOff:-1},{name:'pad',wave:'sine',vol:0.18,regOff:0},{name:'pulse',wave:'square',vol:0.12,regOff:1}];
function tm(n){n=n>>>0;n^=n>>16;n^=n>>8;n^=n>>4;n^=n>>2;n^=n>>1;return n&1;}
function gPhase(n,mod){mod=mod||5;return Math.floor((((n*PHI)%1+1)%1)*mod);}
function fibAt(n){let a=0,b=1;for(let i=0;i<((n%24)+24)%24;i++){const t=a+b;a=b;b=t;}return a;}
function scaleHarmonic(rootH,deg,octShift){const d=((deg%8)+8)%8;const oct=Math.floor(deg/8)+(octShift||0);const[num,den]=SCALE_RATIOS[d];return Math.round(rootH*num/den*Math.pow(2,oct));}
function rootHarmonicsAtReg(reg){const mul=Math.pow(2,reg);return ROOT_HARMONICS.map(h=>Math.round(h*mul));}
function sectionTempoIdx(s){const b=gPhase(s*3+7,5);const j=tm(s*5+1)===1?2:0;return(b+j)%5;}
function computeSection(secNum){const t1=tm(secNum),t2=tm(secNum*3+1),t3=tm(secNum*7+2);const count=[1,2,3,5][t1+t2+t3];const start=gPhase(secNum*11+3,5);const step=tm(secNum*5)===0?1:2;const set=[];let idx=start;for(let i=0;i<count;i++){set.push(idx%5);idx+=step;}return{count:[...new Set(set)].length,activeSet:[...new Set(set)],sectionLen:FIBS[gPhase(secNum*13,4)]};}
function articulate(step,noteIdx){const t1=tm(step+noteIdx*3);const t2=tm(step*5+noteIdx*7);if(t1===1&&t2===1)return'accent';if(noteIdx===0)return'accent';return'normal';}
function shouldSilence(themeNum,silWeight){if(silWeight<=0)return false;return(tm(themeNum*3+7)+tm(themeNum*11+2))/2>=(1-silWeight);}
class Engine{
constructor(opts){opts=opts||{};this.baseTempo=opts.tempo||84;this.reverb=opts.reverb!=null?opts.reverb:0.77;this.breath=opts.breath!=null?opts.breath:0.65;this.silW=opts.silence!=null?opts.silence:0.50;this.regW=opts.register||2;this.wander=opts.wander||false;this.vTM=opts.vTM||[1,1,1,1,1];this.playing=false;this.step=0;this._listeners={};this._ax=null;this._master=null;this._dryB=null;this._revS=null;this._revC=null;this._comp=null;this._schedId=null;this._masterNextT=0;this._initState();}
start(n){this._initAudio();this._jumpToN(n||0);this.playing=true;if(this._ax.state==='suspended')this._ax.resume();const now=this._ax.currentTime;this._masterNextT=now;this._voices.forEach(v=>{if(v.nextT<now)v.nextT=now;});this._sched();}
pause(){this.playing=false;if(this._schedId)clearTimeout(this._schedId);}
resume(){if(!this._ax)return this.start(this.step);this.playing=true;if(this._ax.state==='suspended')this._ax.resume();const now=this._ax.currentTime;this._masterNextT=now;this._voices.forEach(v=>{if(v.nextT<now)v.nextT=now;});this._sched();}
stop(){this.playing=false;if(this._schedId)clearTimeout(this._schedId);this.step=0;this._initState();}
setTempo(bpm){this.baseTempo=Math.max(0.5,Math.min(400,bpm));}
setWander(on){this.wander=!!on;}
setVoiceVol(i,vol){if(this._voices&&this._voices[i])this._voices[i].vol=Math.max(0,Math.min(1,vol));}
forceAllVoices(on){this._forceAll=!!on;if(on&&this._voices)this._voices.forEach(v=>{v.structActive=true;});}
muteVoice(i){if(this._voices&&this._voices[i])this._voices[i].muted=true;}
unmuteVoice(i){if(this._voices&&this._voices[i])this._voices[i].muted=false;}
set(opts){if(opts.reverb!=null){this.reverb=opts.reverb;this._updateReverb();}if(opts.breath!=null)this.breath=opts.breath;if(opts.silence!=null)this.silW=opts.silence;if(opts.register!=null)this.regW=opts.register;if(opts.tempo!=null)this.setTempo(opts.tempo);if(opts.wander!=null)this.setWander(opts.wander);if(opts.vTM)this.vTM=opts.vTM;}
on(event,fn){if(!this._listeners[event])this._listeners[event]=[];this._listeners[event].push(fn);}
off(event,fn){if(!this._listeners[event])return;this._listeners[event]=this._listeners[event].filter(f=>f!==fn);}
get state(){return{n:this.step,playing:this.playing,section:this._S.sectionNum,theme:this._S.themeNum,tempo:this._effectiveTempo(),tempoName:TEMPO_NAMES[this._S.tempoMulIdx],tempoLabel:TEMPO_LABELS[this._S.tempoMulIdx],tempoMul:this._S.tempoMul,rootIdx:this._S.rootIdx,rootName:ROOT_NAMES[this._S.rootIdx],rootReg:this._S.rootReg,rootHarmonic:rootHarmonicsAtReg(this._S.rootReg)[this._S.rootIdx],leadRiff:RIFF_NAMES[this._S.leadRiffIdx],leadRiffIdx:this._S.leadRiffIdx,voiceCount:this._S.activeCount,activeVoices:this._S.activeSet,silence:this._S.inSilence,wander:this.wander,voices:this._voices.map(v=>({name:v.name,active:v.active,muted:v.muted,harmonic:v.curH,freq:v.curH?v.curH*F_SCH:0}))};}
_emit(event,data){(this._listeners[event]||[]).forEach(fn=>{try{fn(data);}catch(e){}});}
_initState(){this._S={sectionNum:0,sectionLen:5,themesInSection:0,themeNum:0,activeCount:3,activeSet:[0,1,2],inSilence:false,silBeatsLeft:0,silPhraseNum:0,tempoMulIdx:2,tempoMul:1,prevTempoMul:1,tempoTransition:1,tempoTransLen:0,leadRiffIdx:0,leadRiffPos:0,leadEndDeg:0,leadPhraseNum:0,counterRiffIdx:10,counterRiffPos:0,counterEndDeg:4,counterPhraseNum:0,bassRiffIdx:0,bassRiffPos:0,bassPhraseNum:0,rootIdx:0,rootReg:1,breathBeats:0};this._voices=VOICE_DEFS.map((d,i)=>({...d,i,step:0,nextT:0,muted:false,structActive:true,curH:0,active:false}));}
_jumpToN(n){n=Math.max(0,Math.floor(n));this.step=n;const S=this._S;this._voices.forEach((v,i)=>{v.step=n+i*5;});S.sectionNum=Math.floor(n/200);S.themeNum=Math.floor(n/40);S.leadPhraseNum=Math.floor(n/3);S.counterPhraseNum=Math.floor(n/3)+5;S.bassPhraseNum=Math.floor(n/3)+3;S.leadRiffIdx=selectRiff(S.leadPhraseNum,0);S.counterRiffIdx=selectRiff(S.counterPhraseNum*3+11,4);S.bassRiffIdx=selectBassRiff(S.bassPhraseNum);S.leadRiffPos=0;S.counterRiffPos=0;S.bassRiffPos=0;S.rootIdx=gPhase(S.themeNum,5);S.rootReg=Math.max(0,Math.min(3,1+fibAt(S.themeNum)%this.regW-Math.floor(this.regW/2)));const sec=computeSection(S.sectionNum);S.sectionLen=sec.sectionLen;S.activeCount=sec.count;S.activeSet=sec.activeSet;S.themesInSection=S.themeNum%S.sectionLen;const tIdx=sectionTempoIdx(S.sectionNum);S.tempoMulIdx=tIdx;S.tempoMul=TEMPO_MULS[tIdx];S.prevTempoMul=S.tempoMul;S.tempoTransition=1;this._voices.forEach((v,j)=>{v.structActive=this._forceAll||sec.activeSet.includes(j);});S.inSilence=false;S.breathBeats=0;}
_effectiveTempo(){const S=this._S;let mul;if(S.tempoTransition>=1)mul=S.tempoMul;else{const t=S.tempoTransition;const e=t*t*(3-2*t);mul=S.prevTempoMul+(S.tempoMul-S.prevTempoMul)*e;}return this.baseTempo*mul;}
_updateReverb(){if(this._dryB)this._dryB.gain.value=1-this.reverb;if(this._revS)this._revS.gain.value=this.reverb;}
_initAudio(){if(this._ax)return;const ax=new(window.AudioContext||window.webkitAudioContext)();this._ax=ax;this._comp=ax.createDynamicsCompressor();this._comp.threshold.value=-10;this._comp.knee.value=12;this._comp.ratio.value=4;this._comp.connect(ax.destination);this._master=ax.createGain();this._master.gain.value=0.70;this._dryB=ax.createGain();this._dryB.gain.value=1-this.reverb;this._dryB.connect(this._comp);this._revS=ax.createGain();this._revS.gain.value=this.reverb;this._revS.connect(this._comp);const sr=ax.sampleRate,len=sr*5;const buf=ax.createBuffer(2,len,sr);for(let c=0;c<2;c++){const d=buf.getChannelData(c);for(let i=0;i<len;i++){const t=i/sr;d[i]=((Math.random()*2-1)*.25+(tm(i>>>4)*2-1)*.008)*Math.exp(-t*PHI*.55)+Math.sin(2*Math.PI*F_SCH*2*t)*Math.exp(-t*5)*.015;}}this._revC=ax.createConvolver();this._revC.buffer=buf;this._master.connect(this._dryB);this._master.connect(this._revC);this._revC.connect(this._revS);}
_synth(freq,dur,vel,when,wave,vi){if(!this._ax||freq<18)return;const ax=this._ax,master=this._master;const S=this._S;const tScale=Math.min(2.5,Math.max(0.25,1/S.tempoMul));const osc=ax.createOscillator();osc.type=wave;osc.frequency.setValueAtTime(freq,when);let atk,sus,rel;switch(vi){case 0:atk=.008*tScale;sus=dur*.35;rel=dur*.25*tScale;break;case 1:atk=.02*tScale;sus=dur*.4;rel=dur*.3*tScale;break;case 2:atk=.005;sus=dur*.5;rel=dur*.25;break;case 3:atk=.08*tScale;sus=dur*.9;rel=dur*.6*tScale;break;case 4:atk=.002;sus=dur*.06;rel=dur*.05;break;}const tot=atk+sus+rel;const env=ax.createGain();env.gain.setValueAtTime(0,when);env.gain.linearRampToValueAtTime(vel*.30,when+atk);if(vi===4){env.gain.exponentialRampToValueAtTime(.001,when+Math.max(tot,.03));}else{env.gain.linearRampToValueAtTime(vel*.18,when+atk+sus);env.gain.exponentialRampToValueAtTime(.0003,when+Math.max(tot,.04));}if(vi<2||vi===3){const vib=ax.createOscillator(),vG=ax.createGain();vib.frequency.value=F_SCH*PHI_I*(1+vi*.3);vG.gain.value=freq*.002*tScale;vib.connect(vG);vG.connect(osc.frequency);vib.start(when);vib.stop(when+tot+.1);}if(vi===2&&freq>60){const sub=ax.createOscillator();sub.type='sine';sub.frequency.setValueAtTime(freq/2,when);const sE=ax.createGain();sE.gain.setValueAtTime(0,when);sE.gain.linearRampToValueAtTime(vel*.10,when+.01);sE.gain.exponentialRampToValueAtTime(.0003,when+tot);sub.connect(sE);sE.connect(master);sub.start(when);sub.stop(when+tot+.1);}osc.connect(env);env.connect(master);osc.start(when);osc.stop(when+tot+.1);}
_advanceVoice(v,when){const S=this._S;const beatDur=(60/this._effectiveTempo())*(this.vTM[v.i]||1);if(S.inSilence){v.active=false;v.step++;return beatDur*.5;}if(!v.structActive){v.active=false;v.step++;return beatDur*PHI*.5;}if(S.breathBeats>0&&v.i===0){S.breathBeats--;v.active=false;v.step++;return beatDur*.5;}const roots=rootHarmonicsAtReg(S.rootReg+v.regOff);const rootH=roots[S.rootIdx];let harm=0,isRest=false,dur=beatDur*.5;switch(v.i){case 0:{const riff=RIFFS[S.leadRiffIdx];const note=riff[S.leadRiffPos];const deg=note[0];const durMul=note[1];dur=beatDur*durMul;const art=articulate(v.step,S.leadRiffPos);if(deg<0)isRest=true;else{harm=scaleHarmonic(rootH,deg,0);this._synth(harm*F_SCH,dur,v.vol*(art==='accent'?1:.65),when,v.wave,0);}S.leadRiffPos++;if(S.leadRiffPos>=riff.length){S.leadEndDeg=riffEndDeg(riff);S.leadRiffPos=0;S.leadPhraseNum++;S.leadRiffIdx=selectRiff(S.leadPhraseNum,S.leadEndDeg);this._emit('riff',this.state);}break;}case 1:{const riff=RIFFS[S.counterRiffIdx];const note=riff[S.counterRiffPos];const deg=note[0];const durMul=note[1];dur=beatDur*durMul;const art=articulate(v.step+7,S.counterRiffPos);if(deg<0)isRest=true;else{const inv=tm(S.counterPhraseNum)===1?(7-deg):deg;harm=scaleHarmonic(rootH,inv,tm(S.counterPhraseNum*3)===1?1:0);this._synth(harm*F_SCH,dur,v.vol*(art==='accent'?1:.55),when,v.wave,1);}S.counterRiffPos++;if(S.counterRiffPos>=riff.length){S.counterEndDeg=riffEndDeg(riff);S.counterRiffPos=0;S.counterPhraseNum++;S.counterRiffIdx=selectRiff(S.counterPhraseNum*3+11,S.counterEndDeg);}break;}case 2:{const bRiff=BASS_RIFFS[S.bassRiffIdx%BASS_RIFFS.length];const note=bRiff[S.bassRiffPos];const deg=note[0];const durMul=note[1];dur=beatDur*durMul;if(deg<0)isRest=true;else{harm=scaleHarmonic(rootH,deg,-1);if(harm<12)harm*=2;this._synth(harm*F_SCH,dur*1.1,v.vol*(S.bassRiffPos===0?1:.7),when,v.wave,2);}S.bassRiffPos++;if(S.bassRiffPos>=bRiff.length){S.bassRiffPos=0;S.bassPhraseNum++;S.bassRiffIdx=selectBassRiff(S.bassPhraseNum);}break;}case 3:{const padDeg=[0,2,4,7][v.step%4];dur=beatDur*2;if(tm(v.step*2)!==1&&v.step>0)isRest=true;else{harm=scaleHarmonic(rootH,padDeg,0);this._synth(harm*F_SCH,dur,v.vol*.7,when,v.wave,3);}break;}case 4:{dur=beatDur*0.25;if(!(tm(v.step)===1&&tm(v.step*3+1)===1))isRest=true;else{harm=scaleHarmonic(rootH,tm(v.step*7)===0?0:4,1);this._synth(harm*F_SCH,dur*.6,v.vol*.9,when,'square',4);}break;}}v.curH=harm||0;v.active=!isRest&&!v.muted;v.step++;if(v.i===0&&S.leadPhraseNum>0&&S.leadPhraseNum%FIBS[gPhase(S.sectionNum,4)]===0){this._advanceTheme();}return dur;}
_advanceTheme(){const S=this._S;S.themeNum++;if(shouldSilence(S.themeNum,this.silW)){S.inSilence=true;S.silBeatsLeft=FIBS[gPhase(S.silPhraseNum*7,4)];S.silPhraseNum++;}const restB=Math.round((tm(S.themeNum*5+3)+1)*this.breath*2);if(restB>0)S.breathBeats=restB;S.rootIdx=gPhase(S.themeNum,5);S.rootReg=Math.max(0,Math.min(3,1+fibAt(S.themeNum)%this.regW-Math.floor(this.regW/2)));S.themesInSection++;if(S.themesInSection>=S.sectionLen){S.themesInSection=0;S.sectionNum++;const sec=computeSection(S.sectionNum);S.sectionLen=sec.sectionLen;S.activeCount=sec.count;S.activeSet=sec.activeSet;this._voices.forEach((v,j)=>{v.structActive=this._forceAll||sec.activeSet.includes(j);});const newTIdx=sectionTempoIdx(S.sectionNum);S.prevTempoMul=S.tempoMul;S.tempoMulIdx=newTIdx;S.tempoMul=TEMPO_MULS[newTIdx];S.tempoTransition=0;S.tempoTransLen=4;if(this.wander){const jump=104729*gPhase(S.sectionNum*7+3,5)+7919*tm(S.sectionNum*11);const newN=this.step+jump;this._voices.forEach(v=>{v.step=newN+v.i*5;});this.step=newN;S.leadPhraseNum=gPhase(newN,100);S.counterPhraseNum=gPhase(newN+7,100);S.bassPhraseNum=gPhase(newN+13,50);S.leadRiffIdx=selectRiff(S.leadPhraseNum,0);S.counterRiffIdx=selectRiff(S.counterPhraseNum*3+11,4);S.bassRiffIdx=selectBassRiff(S.bassPhraseNum);S.leadRiffPos=0;S.counterRiffPos=0;S.bassRiffPos=0;}this._emit('section',this.state);}if(S.tempoTransition<1&&S.tempoTransLen>0){S.tempoTransition=Math.min(1,S.tempoTransition+1/S.tempoTransLen);}this._emit('beat',this.state);}
_advanceSilence(){const S=this._S;if(!S.inSilence)return;S.silBeatsLeft--;if(S.silBeatsLeft<=0)S.inSilence=false;}
_sched(){if(!this.playing||!this._ax)return;const now=this._ax.currentTime;const S=this._S;const AHEAD=0.22;while(S.inSilence&&this._masterNextT<now+AHEAD){if(this._masterNextT<now)this._masterNextT=now;this._advanceSilence();this._masterNextT+=60/this._effectiveTempo();}for(const v of this._voices){while(v.nextT<now+AHEAD){if(v.nextT<now)v.nextT=now;const d=this._advanceVoice(v,v.nextT);v.nextT+=d;}}let mx=0;for(const v of this._voices)if(v.step>mx)mx=v.step;if(mx!==this.step){this.step=mx;this._emit('beat',this.state);}this._schedId=setTimeout(()=>this._sched(),28);}
}
function TwistJC(opts){return new Engine(opts);}
TwistJC.tm=tm;TwistJC.gPhase=gPhase;TwistJC.F_SCHUMANN=F_SCH;TwistJC.PHI=PHI;TwistJC.TEMPO_MULS=TEMPO_MULS;
return TwistJC;
})();
