/* Midad standalone runtime: replaces the Claude artifact runtime (window.claude) with
   - db      → IndexedDB on the phone
   - user    → a single local user
   - sample  → Google Gemini with the reader's own API key
   - downloads → Android share sheet (Capacitor) or a normal browser download
   Loaded before the app script. */
(function(){
  const CAP=window.Capacitor&&window.Capacitor.Plugins||{};
  const LSget=k=>{try{return localStorage.getItem(k)||''}catch(e){return ''}};

  /* ---------- db: IndexedDB with the same small API the app uses ---------- */
  const DBN='midad',ST='docs';let dbp=null;
  function idb(){if(dbp)return dbp;dbp=new Promise((res,rej)=>{const r=indexedDB.open(DBN,1);r.onupgradeneeded=()=>{r.result.createObjectStore(ST)};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});return dbp}
  async function tx(mode,fn){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction(ST,mode);const s=t.objectStore(ST);let out;Promise.resolve(fn(s)).then(v=>out=v);t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||{code:'quota_exceeded'})})}
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
  function collection(path){
    const pre=path+'/';const subs=new Set();let timer=null;
    const snap=async()=>{const all=await tx('readonly',async s=>{const keys=await req(s.getAllKeys());const vals=await req(s.getAll());return keys.map((k,i)=>[k,vals[i]])});
      return {docs:all.filter(([k])=>String(k).startsWith(pre)).map(([k,v])=>({id:String(k).slice(pre.length),data:()=>JSON.parse(JSON.stringify(v))}))}};
    const notify=()=>{clearTimeout(timer);timer=setTimeout(async()=>{if(!subs.size)return;let s;try{s=await snap()}catch(e){return}subs.forEach(([ok])=>{try{ok(s)}catch(e){}})},120)};
    const clean=v=>JSON.parse(JSON.stringify(v));
    return {
      get:snap,
      onSnapshot(ok,err){const e=[ok,err];subs.add(e);snap().then(ok).catch(x=>err&&err(x));return ()=>subs.delete(e)},
      doc(id){const key=pre+id;return {
        id,
        async get(){const v=await tx('readonly',s=>req(s.get(key)));return {id,exists:v!==undefined,data:()=>v===undefined?undefined:clean(v)}},
        async set(v){await tx('readwrite',s=>req(s.put(clean(v),key)));notify()},
        async update(p){await tx('readwrite',async s=>{const o=await req(s.get(key));await req(s.put(Object.assign({},o||{},clean(p)),key))});notify()},
        async delete(){await tx('readwrite',s=>req(s.delete(key)));notify()}
      }}
    };
  }
  const dbNs={collection,doc:p=>{const i=p.lastIndexOf('/');return collection(p.slice(0,i)).doc(p.slice(i+1))}};
  try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}

  /* ---------- user ---------- */
  const userNs={id:async()=>'local',me:async()=>({id:'local',name:''}),isOwner:()=>true,canEdit:()=>true,can:()=>true,profiles:async()=>({})};

  /* ---------- sample: Gemini ---------- */
  const TIER={quick:'gemini-2.5-flash-lite',default:'gemini-2.5-flash',complex:'gemini-2.5-pro'};
  function model(tier){const m=LSget('midad.gemModel').trim();return m||TIER[tier]||TIER.default}
  const b64=blob=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=()=>rej(r.error);r.readAsDataURL(blob)});
  async function call(input,opts={},json){
    const key=LSget('midad.gemKey').trim();
    if(!key)throw {code:'gem_key',message:'أضف مفتاح Gemini من شاشة الإضافة ← ترجمة'};
    const turns=typeof input==='string'?[{role:'user',content:input}]:input;
    const contents=turns.map(t=>({role:t.role==='assistant'?'model':'user',parts:[{text:String(t.content)}]}));
    if(opts.images&&opts.images.length){const last=contents[contents.length-1];for(const im of opts.images)last.parts.push({inline_data:{mime_type:im.type||'image/png',data:await b64(im)}})}
    const gen={temperature:json?0.4:0.7,maxOutputTokens:opts.maxTokens||16384};if(json)gen.responseMimeType='application/json';
    const url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model(opts.modelTier))+':streamGenerateContent?alt=sse';
    let resp;
    try{resp=await fetch(url,{method:'POST',signal:opts.signal,headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents,generationConfig:gen})})}
    catch(e){if(e&&e.name==='AbortError')throw {code:'cancelled'};throw {code:'gem_blocked',message:'لا يوجد اتصال بالإنترنت'}}
    if(!resp.ok){let msg='';try{const j=await resp.json();msg=(j.error&&j.error.message)||''}catch(e){}const st=resp.status;
      throw {code:st===429?'rate_limited':((st===400&&/key/i.test(msg))||st===401||st===403)?'gem_key':st===404?'gem_model':'gem_http',message:msg||('HTTP '+st)}}
    const rd=resp.body.getReader(),dec=new TextDecoder();let buf='',out='',fin='',block='';
    try{for(;;){const {value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;
      while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line.startsWith('data:'))continue;let j;try{j=JSON.parse(line.slice(5))}catch(e){continue}
        if(j.promptFeedback&&j.promptFeedback.blockReason)block=j.promptFeedback.blockReason;const c=(j.candidates||[])[0];if(!c)continue;
        const d=((c.content&&c.content.parts)||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');
        if(d){out+=d;opts.onText&&opts.onText({text:out,delta:d})}if(c.finishReason)fin=c.finishReason}}}
    catch(e){if(e&&e.name==='AbortError')throw {code:'cancelled',text:out};throw {code:'gem_net',text:out}}
    if(!out){if(block||fin==='SAFETY'||fin==='PROHIBITED_CONTENT')throw {code:'gem_safety'};throw {code:'gem_empty'}}
    return {text:out,truncated:fin==='MAX_TOKENS'};
  }
  const sample=(input,opts)=>call(input,opts,false);
  sample.json=async(input,opts={})=>{const r=await call(input,Object.assign({},opts,{onText:null}),true);let t=r.text.trim().replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'');
    try{return JSON.parse(t)}catch(e){const m=t.match(/[\[{][\s\S]*[\]}]/);if(m)try{return JSON.parse(m[0])}catch(x){}throw {code:'bad_json',message:'رد غير مفهوم، حاول مرة أخرى'}}};
  sample.limits=async()=>({images:true});

  /* ---------- downloads: share sheet on Android, normal download elsewhere ---------- */
  const downloadsNs={async save({filename,data}){
    const blob=data instanceof Blob?data:new Blob([data]);
    if(CAP.Filesystem&&CAP.Share){
      const b=await b64(blob);const w=await CAP.Filesystem.writeFile({path:filename,data:b,directory:'CACHE'});
      try{await CAP.Share.share({title:filename,url:w.uri,dialogTitle:'احفظ أو أرسل الملف'})}catch(e){throw {code:'declined'}}
      return {status:'saved'};
    }
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},4000);return {status:'saved'};
  }};

  const NS={db:dbNs,user:userNs,sample,downloads:downloadsNs};
  window.claude={use:async n=>NS[n]||null};
  window.MIDAD_STANDALONE=true;

  /* ---------- keep the screen on while reading (WebView has no Wake Lock API) ---------- */
  if(!('wakeLock' in navigator)&&CAP.KeepAwake){
    navigator.wakeLock={request:async()=>{await CAP.KeepAwake.keepAwake();const l=new Set();return {addEventListener:(t,f)=>l.add(f),release:async()=>{await CAP.KeepAwake.allowSleep();l.forEach(f=>{try{f()}catch(e){}})}}}};
  }

  /* ---------- read aloud: native Android voice when the WebView has none ---------- */
  if(!('speechSynthesis' in window)&&CAP.TextToSpeech){
    const TTS=CAP.TextToSpeech;let gen=0;
    window.SpeechSynthesisUtterance=function(text){this.text=text;this.lang='ar-SA';this.rate=1;this.onend=null;this.onerror=null};
    window.speechSynthesis={
      getVoices:()=>[{lang:'ar-SA',name:'العربية',localService:true}],
      addEventListener(){},
      speak(u){const g=++gen;TTS.speak({text:u.text,lang:'ar-SA',rate:u.rate||1,category:'playback'}).then(()=>{if(g===gen&&u.onend)u.onend({})}).catch(e=>{if(g===gen&&u.onerror)u.onerror({error:'synthesis-failed'})})},
      cancel(){gen++;try{TTS.stop()}catch(e){}}
    };
  }
})();
