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
  const notifiers=new Set();const notifyAll=()=>notifiers.forEach(f=>f());
  function collection(path){
    const pre=path+'/';const subs=new Set();let timer=null;
    const snap=async()=>{const all=await tx('readonly',async s=>{const keys=await req(s.getAllKeys());const vals=await req(s.getAll());return keys.map((k,i)=>[k,vals[i]])});
      return {docs:all.filter(([k])=>String(k).startsWith(pre)).map(([k,v])=>({id:String(k).slice(pre.length),data:()=>JSON.parse(JSON.stringify(v))}))}};
    const notify=()=>{clearTimeout(timer);timer=setTimeout(async()=>{if(!subs.size)return;let s;try{s=await snap()}catch(e){return}subs.forEach(([ok])=>{try{ok(s)}catch(e){}})},120)};
    const clean=v=>JSON.parse(JSON.stringify(v));
    notifiers.add(notify);
    return {
      get:snap,
      onSnapshot(ok,err){const e=[ok,err];subs.add(e);snap().then(ok).catch(x=>err&&err(x));return ()=>subs.delete(e)},
      doc(id){const key=pre+id;return {
        id,
        async get(){const v=await tx('readonly',s=>req(s.get(key)));return {id,exists:v!==undefined,data:()=>v===undefined?undefined:clean(v)}},
        async set(v){await tx('readwrite',s=>req(s.put(clean(v),key)));notify();cloud.queue(pre,id)},
        async update(p){await tx('readwrite',async s=>{const o=await req(s.get(key));await req(s.put(Object.assign({},o||{},clean(p)),key))});notify();cloud.queue(pre,id)},
        async delete(){await tx('readwrite',s=>req(s.delete(key)));notify();cloud.queue(pre,id)}
      }}
    };
  }
  /* ---------- cloud: the same Supabase table the web version syncs with ---------- */
  const SBC={url:window.MIDAD_SB_URL||'https://ieqepwxarioowtuooqqu.supabase.co',key:'sb_publishable_DdxCgpvbBNJRuUn3xwuohQ_U-ctREm3'};
  const PRE='data/users/local/';
  const cloud=(()=>{
    const LSG=(k,d)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},LSS=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
    function deq(a,b){if(a===b)return true;if(typeof a!=='object'||typeof b!=='object'||!a||!b)return false;if(Array.isArray(a)!==Array.isArray(b))return false;
      const ka=Object.keys(a),kb=Object.keys(b);if(ka.length!==kb.length)return false;return ka.every(k=>deq(a[k],b[k]))}
    let ses=LSG('midad.sbSession',null);const q=new Set(LSG('midad.sbQueue',[]));const pushed={};
    let st={busy:false,pulling:false,err:'',lastAt:0};const listeners=new Set();
    const emit=()=>listeners.forEach(f=>{try{f()}catch(e){}});
    const saveQ=()=>LSS('midad.sbQueue',[...q]);
    async function auth(path,body){
      const r=await fetch(SBC.url+'/auth/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json',apikey:SBC.key},body:JSON.stringify(body)});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw {code:'auth',message:j.error_description||j.msg||j.message||('HTTP '+r.status)};
      return j;
    }
    function keep(j,email){ses={access:j.access_token,refresh:j.refresh_token,exp:Date.now()+(j.expires_in||3600)*1000,uid:j.user&&j.user.id||(ses&&ses.uid),email:email||(ses&&ses.email)};LSS('midad.sbSession',ses)}
    async function token(){
      if(!ses)throw {code:'signed_out'};
      if(Date.now()>ses.exp-60000){try{keep(await auth('token?grant_type=refresh_token',{refresh_token:ses.refresh}))}catch(e){throw {code:'signed_out',message:'انتهت الجلسة، سجّل الدخول من جديد'}}}
      return ses.access;
    }
    async function rest(path,opt={}){
      const t=await token();
      const r=await fetch(SBC.url+'/rest/v1/'+path,Object.assign({},opt,{headers:Object.assign({apikey:SBC.key,Authorization:'Bearer '+t,'Content-Type':'application/json'},opt.headers||{})}));
      if(!r.ok){const j=await r.json().catch(()=>({}));throw {code:'rest',message:j.message||('HTTP '+r.status)}}
      return r.status===204?null:r.json().catch(()=>null);
    }
    const local=id=>tx('readonly',s=>req(s.get(PRE+id)));
    let timer=null;
    function queue(pre,id){if(pre!==PRE||!ses||applying.has(id))return;q.add(id);saveQ();clearTimeout(timer);timer=setTimeout(flush,2500);emit()}
    const applying=new Set();
    async function flush(){
      if(st.busy||!q.size||!ses)return;st.busy=true;emit();
      try{
        while(q.size){
          const ids=[];const rows=[];let size=0;
          for(const id of q){const v=await local(id);const row={user_id:ses.uid,id,data:v===undefined?null:v,deleted:v===undefined};const n=JSON.stringify(row).length;if(rows.length&&size+n>800000)break;rows.push(row);ids.push(id);size+=n}
          await rest('docs?on_conflict=user_id,id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows)});
          rows.forEach(r=>{q.delete(r.id);pushed[r.id]=r.deleted?'del':r.data});saveQ();
        }
        st.err='';st.lastAt=Date.now();
      }catch(e){st.err=msg(e);clearTimeout(timer);timer=setTimeout(flush,30000)}
      st.busy=false;emit();
    }
    function msg(e){return e&&e.code==='signed_out'?(e.message||'سجّل الدخول'):e&&e.name==='TypeError'?'لا يوجد اتصال بالإنترنت':'تعذّرت المزامنة'+(e&&e.message?': '+String(e.message).slice(0,90):'')}
    async function pull(){
      if(st.pulling||!ses)return 0;st.pulling=true;emit();let got=0;
      try{
        for(let page=0;page<60;page++){
          const last=LSG('midad.sbLast:'+ses.uid,'');
          const rows=await rest('docs?select=id,data,deleted,updated_at&order=updated_at.asc&limit=40'+(last?'&updated_at=gt.'+encodeURIComponent(last):''));
          if(!rows||!rows.length)break;
          await tx('readwrite',s=>{for(const r of rows){const pv=pushed[r.id];const mine=pv!==undefined&&(r.deleted?pv==='del':deq(pv,r.data));if(mine)delete pushed[r.id];if(q.has(r.id)||mine)continue;
            if(r.deleted||r.data==null)s.delete(PRE+r.id);else s.put(r.data,PRE+r.id);got++}});
          LSS('midad.sbLast:'+ses.uid,rows[rows.length-1].updated_at);
          if(rows.length<40)break;
        }
        st.err='';st.lastAt=Date.now();if(got)notifyAll();
      }catch(e){st.err=msg(e)}
      st.pulling=false;emit();return got;
    }
    async function link(email,password){
      keep(await auth('token?grant_type=password',{email,password}),email);
      // first link: send what the cloud doesn't have yet, then bring in what it has
      const have=new Set(((await rest('docs?select=id'))||[]).map(r=>r.id));
      const keys=await tx('readonly',s=>req(s.getAllKeys()));
      keys.map(String).filter(k=>k.startsWith(PRE)).map(k=>k.slice(PRE.length)).forEach(id=>{if(!have.has(id))q.add(id)});saveQ();
      emit();await flush();const got=await pull();return {sent:0,got};
    }
    /* notifications: a background check (runner.js) asks Supabase every ~15 min for chapters translated since you left the app */
    const BR=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.BackgroundRunner;const LABEL='app.midad.reader.check';
    const brSend=details=>BR?BR.dispatchEvent({label:LABEL,event:'configure',details}).catch(()=>{}):Promise.resolve();
    async function notify(on){
      if(!BR)throw {message:'الإشعارات غير متاحة في هذه النسخة'};
      if(on){
        if(!ses)throw {message:'اربط المكتبة أولاً'};
        try{const p=await BR.requestPermissions({apis:['notifications']});if(p&&p.notifications==='denied')throw {message:'اسمح لمداد بالإشعارات من إعدادات الهاتف'}}catch(e){if(e&&e.message)throw e}
        let k=LSG('midad.nkey:'+ses.uid,'');
        if(!k){const a=new Uint8Array(24);crypto.getRandomValues(a);k=[...a].map(x=>x.toString(16).padStart(2,'0')).join('');
          await rest('notify_keys',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({key:k,user_id:ses.uid})});LSS('midad.nkey:'+ses.uid,k)}
        await brSend({on:true,url:SBC.url,key:SBC.key,nkey:k,since:new Date().toISOString()});
      }else await brSend({on:false});
      LSS('midad.notify',!!on);emit();
    }
    // only chapters that arrive after you leave the app are announced
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&LSG('midad.notify',false))brSend({since:new Date().toISOString()})});
    function unlink(){ses=null;LSS('midad.sbSession',null);q.clear();saveQ();st.err='';brSend({on:false});LSS('midad.notify',false);emit()}
    setInterval(()=>{if(ses&&!document.hidden)pull()},60000);
    document.addEventListener('visibilitychange',()=>{if(ses&&!document.hidden){flush();setTimeout(pull,800)}});
    if(ses)setTimeout(()=>{flush();pull()},4000);
    return {queue,flush,pull,link,unlink,notify,canNotify:()=>!!BR,notifyOn:()=>!!LSG('midad.notify',false),onChange:f=>listeners.add(f),
      state:()=>({linked:!!ses,email:ses&&ses.email,pending:q.size,busy:st.busy,pulling:st.pulling,err:st.err,lastAt:st.lastAt})};
  })();
  window.midadCloud=cloud;

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
      speak(u){const g=++gen;TTS.speak({text:u.text,lang:'ar-SA',rate:u.rate||1,pitch:u.pitch||1,category:'playback'}).then(()=>{if(g===gen&&u.onend)u.onend({})}).catch(e=>{if(g===gen&&u.onerror)u.onerror({error:'synthesis-failed'})})},
      cancel(){gen++;try{TTS.stop()}catch(e){}}
    };
  }
})();

/* ---------- in-app updates: a new build on GitHub shows a bar; one tap downloads it and opens Android's installer ---------- */
(function(){
  const CAP=window.Capacitor&&window.Capacitor.Plugins||{};
  if(!CAP.Filesystem||!window.MIDAD_BUILD)return;
  const API='https://api.github.com/repos/kab30/midad-apk/releases/latest';
  let shown=false,busy=false,lastCheck=0;
  function bar(){
    let b=document.getElementById('updBar');if(b)return b;
    b=document.createElement('div');b.id='updBar';b.dir='rtl';
    b.style.cssText='position:fixed;inset-inline:12px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:9999;display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:16px;background:#0f1a2e;color:#e7eefc;border:1px solid #2a3550;box-shadow:0 18px 40px -16px rgba(0,0,0,.7);font:600 14px "Readex Pro",system-ui,sans-serif';
    b.innerHTML='<span style="flex:1"></span><button type="button" data-a="go" style="height:38px;padding:0 16px;border-radius:12px;border:0;background:#4fdcff;color:#04111c;font:inherit">حدّث</button><button type="button" data-a="x" style="height:38px;width:38px;border-radius:12px;border:1px solid #2a3550;background:transparent;color:#9fb0cc;font:inherit">✕</button>';
    document.body.appendChild(b);return b;
  }
  const say=t=>{bar().querySelector('span').textContent=t};
  async function check(force){
    if(busy||(!force&&Date.now()-lastCheck<6*3600e3))return;lastCheck=Date.now();
    try{
      const r=await fetch(API,{headers:{Accept:'application/vnd.github+json'}});if(!r.ok)return;
      const j=await r.json();const n=+(String(j.tag_name||'').match(/\d+/)||[0])[0];
      const a=(j.assets||[]).find(x=>/\.apk$/i.test(x.name));
      if(!a||!(n>window.MIDAD_BUILD)||shown)return;
      shown=true;const b=bar();say(`تحديث جديد لمداد (الإصدار ${n})`);
      b.querySelector('[data-a=x]').onclick=()=>{b.remove();shown=false};
      b.querySelector('[data-a=go]').onclick=()=>install(a.browser_download_url,j.html_url);
    }catch(e){}
  }
  async function install(url,page){
    if(busy)return;busy=true;const b=bar();b.querySelector('[data-a=go]').disabled=true;say('جارِ تنزيل التحديث…');
    try{
      let h=null;
      try{h=await CAP.Filesystem.addListener('progress',p=>{if(p&&p.contentLength)say(`جارِ تنزيل التحديث… ${Math.round(p.bytes/p.contentLength*100)}%`)})}catch(e){}
      const res=await CAP.Filesystem.downloadFile({url,path:'midad-update.apk',directory:'CACHE',progress:true});
      try{h&&h.remove()}catch(e){}
      const path=res.path||(await CAP.Filesystem.getUri({path:'midad-update.apk',directory:'CACHE'})).uri;
      say('افتح «تحديث» في نافذة Android');
      if(CAP.FileOpener&&CAP.FileOpener.open)await CAP.FileOpener.open({filePath:path,contentType:'application/vnd.android.package-archive',openWithDefault:true});
      else if(CAP.FileOpener&&CAP.FileOpener.openFile)await CAP.FileOpener.openFile({path,mimeType:'application/vnd.android.package-archive'});
      else throw new Error('no opener');
    }catch(e){
      say('تعذّر التثبيت من داخل التطبيق، سيُفتح رابط التنزيل');
      try{if(CAP.Browser)await CAP.Browser.open({url:page||url})}catch(x){}
    }
    busy=false;const g=b.querySelector('[data-a=go]');if(g)g.disabled=false;
  }
  window.midadCheckUpdate=()=>check(true);
  setTimeout(()=>check(false),8000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check(false)});
})();
