// Background check (Android runs this about every 15 minutes, even when Midad is closed):
// asks Supabase for chapters translated since you last left the app and shows one notification.
function cfg(){try{return JSON.parse((CapacitorKV.get('cfg')||{}).value||'{}')}catch(e){return {}}}
addEventListener('configure',(resolve,reject,args)=>{
  try{const c=Object.assign(cfg(),args||{});CapacitorKV.set('cfg',JSON.stringify(c));resolve()}catch(e){reject(e)}
});
addEventListener('checkNew',async(resolve,reject)=>{
  try{
    const c=cfg();
    if(!c.on||!c.nkey||!c.url){resolve();return}
    const since=c.since||new Date().toISOString();
    const r=await fetch(c.url+'/rest/v1/rpc/midad_new_chapters',{method:'POST',headers:{apikey:c.key,'Content-Type':'application/json'},body:JSON.stringify({p_key:c.nkey,p_since:since})});
    if(!r.ok){resolve();return}
    const rows=await r.json();
    if(rows&&rows.length){
      const by={};rows.forEach(x=>{(by[x.novel||'']=by[x.novel||'']||[]).push(x)});
      const names=Object.keys(by);
      let title,body;
      if(rows.length===1){title='تُرجم فصل جديد';body=(rows[0].title||('الفصل '+rows[0].num))+(rows[0].novel?' · '+rows[0].novel:'')}
      else{title='تُرجم '+rows.length+' فصول جديدة';body=names.map(n=>{const l=by[n];const nums=l.map(x=>x.num).filter(v=>v!=null);return (n||'رواية')+(nums.length?' ('+Math.min(...nums)+(nums.length>1?'–'+Math.max(...nums):'')+')':'')}).join('، ')}
      CapacitorNotifications.schedule([{id:Math.floor(Date.now()/1000)%2000000000,title,body,scheduleAt:new Date(Date.now()+1000),autoCancel:true}]);
      c.since=new Date(Math.max(...rows.map(x=>+x.created||0))).toISOString();
      CapacitorKV.set('cfg',JSON.stringify(c));
    }
    resolve();
  }catch(e){reject(e)}
});
