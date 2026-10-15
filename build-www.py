#!/usr/bin/env python3
"""Builds www/index.html (phone app) from the web version midad.html. Re-run after every change to midad.html."""
import sys,re,os
src=sys.argv[1] if len(sys.argv)>1 else os.path.join(os.path.dirname(__file__),'..','midad.html')
out=os.path.join(os.path.dirname(os.path.abspath(__file__)),'www','index.html')
s=open(src,encoding='utf8').read()
def rep(a,b,n=1):
    global s
    c=s.count(a)
    if c!=n: raise SystemExit(f'pattern found {c}x (expected {n}): {a[:70]}')
    s=s.replace(a,b)

# visible wording: the AI here is Gemini, data lives on the phone
s=s.replace('Claude','Gemini')
rep("const t=on?'محفوظ في حسابك':'على هذا الجهاز'","const t='محفوظ في الهاتف'")
# translation engine: always the built-in route (Gemini with tier → model); key + model always visible
rep('''        <h4>محرك الترجمة</h4>
        <div class="seg" id="trEng"><button type="button" data-e="claude">Gemini</button><button type="button" data-e="gemini">Gemini</button></div>''','''        <h4>الذكاء الاصطناعي</h4>
        <div id="trEng" hidden></div>''')
rep("$('#gemModel').value=gemModel()===GEM_DEF?'':gemModel();","$('#gemModel').value=(()=>{try{return localStorage.getItem('midad.gemModel')||''}catch(e){return ''}})();")
rep('<div class="opt"><h4>محرك الترجمة</h4><div class="seg" id="rwEng"><button type="button" data-e="claude">Gemini</button><button type="button" data-e="gemini">Gemini</button></div></div>','')
rep("$('#gemBox').hidden=en!=='gemini';$('#trTier').closest('.opt').style.opacity=en==='gemini'?'.45':'';","$('#gemBox').hidden=false;")
rep("  $('#rwTier').closest('.opt').style.opacity=en==='gemini'?'.45':'';","")
s=s.replace('<input id="gemModel" dir="ltr" list="gemModels" placeholder="gemini-2.5-flash-lite">','<input id="gemModel" dir="ltr" list="gemModels" placeholder="تلقائي حسب الجودة">')
rep("const GEM_DEF='gemini-2.5-flash-lite';","const GEM_DEF='';")
rep("function gemModel(){let m='';try{m=(localStorage.getItem('midad.gemModel')||'').trim()}catch(e){}return m||GEM_DEF}","function gemModel(){let m='';try{m=(localStorage.getItem('midad.gemModel')||'').trim()}catch(e){}return m||({quick:'gemini-2.5-flash-lite',default:'gemini-2.5-flash',complex:'gemini-2.5-pro'}[prefs.trTier]||'gemini-2.5-flash')}")
rep("function gemReady(){return prefs.trEngine==='gemini'&&!!gemKey()}","function gemReady(){return false}")
rep("""  $('#trEngHint').textContent=en==='gemini'?""","""  $('#trEngHint').textContent='المفتاح محفوظ في هذا الهاتف فقط. الجودة: سريعة = gemini-2.5-flash-lite، متوازنة = gemini-2.5-flash، دقيقة = gemini-2.5-pro، إلا إذا كتبت نموذجاً بنفسك. كل ميزات الذكاء في التطبيق تستخدم هذا المفتاح.';if(0)$('#trEngHint').textContent=en==='gemini'?""")
rep("if(prefs.trEngine==='gemini'&&!gemKey()){trErr=","if(!gemKey()){trErr=")
rep("اخترت Gemini لكن لم تضف المفتاح بعد. أضفه من شاشة الترجمة.","أضف مفتاح Gemini أولاً من شاشة الإضافة ← ترجمة.")
# Drive backup needs Claude connectors: hide it, backups go through the share sheet instead
rep('    <div class="gdrive">','    <div class="gdrive" hidden>')
rep("setTimeout(maybeDailyDrive,1500);","")
rep("حفظ الملفات غير متاح في هذا العرض، افتح التطبيق من Gemini","تعذّر حفظ الملف")
# Android back button: close the top-most thing instead of leaving the app
rep("/* ---------- parsing ---------- */","""/* ---------- Android back button ---------- */
window.__midadBack=()=>{
  if(!$('#entPop').hidden){hideEnt();return true}
  if(openSheet){hideSheet();return true}
  const lb=$('#lbox');if(lb&&!lb.hidden){lb.hidden=true;return true}
  if(current){closeReader();return true}
  const dv=$('#discView');if(dv&&dv.classList.contains('show')){const b=dv.querySelector('[data-back],.back,#dsBack');if(b){b.click();return true}}
  if(curNovel){closeNovel();return true}
  return false;
};
/* ---------- parsing ---------- */""")
# head: runtime shim + phone meta
rep("<title>مداد</title>","""<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b1020">
<title>مداد</title>
<script src="native.js"></script>""")
s=s+"""
<script>
(function(){const C=window.Capacitor;if(!C||!C.Plugins||!C.Plugins.App)return;
C.Plugins.App.addListener('backButton',()=>{if(!(window.__midadBack&&window.__midadBack()))C.Plugins.App.exitApp()});})();
</script>
</body></html>"""
open(out,'w',encoding='utf8').write(s)
print('wrote',out,len(s))
