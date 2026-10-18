// After `npx cap add android`: sign every build with keystore/release.p12 (password from the KEYSTORE_PASSWORD secret),
// give each build a higher version, and allow the app to open its own update installer.
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const f=path.join(root,'android','app','build.gradle');
let g=fs.readFileSync(f,'utf8');
const run=process.env.RUN||'1';
const pass=process.env.KEY_PASS;
if(!pass){console.error('::error::KEYSTORE_PASSWORD secret is missing (Settings > Secrets and variables > Actions)');process.exit(1)}
g=g.replace(/versionCode\s+\d+/,'versionCode '+(100+Number(run)));
g=g.replace(/versionName\s+"[^"]*"/,'versionName "1.'+run+'"');
if(!g.includes('midad-signing')){
  g=g.replace(/android\s*\{/,`android {
    // midad-signing: one fixed key for every build
    signingConfigs {
        debug {
            storeFile file("\${rootProject.projectDir}/../keystore/release.p12")
            storeType "pkcs12"
            storePassword System.getenv("KEY_PASS")
            keyAlias "midad"
            keyPassword System.getenv("KEY_PASS")
        }
    }`);
}
// background-runner ships its JS engine as a local library
if(fs.existsSync(path.join(root,'node_modules','@capacitor','background-runner'))&&!g.includes('background-runner/android/src/main/libs'))
  g=g.replace(/dirs\s+'([^']*capacitor-cordova-android-plugins[^']*)'\s*,\s*'libs'/,"dirs '$1', '../../node_modules/@capacitor/background-runner/android/src/main/libs', 'libs'");
fs.writeFileSync(f,g);
const mf=path.join(root,'android','app','src','main','AndroidManifest.xml');
let m=fs.readFileSync(mf,'utf8');
if(!m.includes('REQUEST_INSTALL_PACKAGES'))m=m.replace(/<manifest([^>]*)>/,'<manifest$1>\n    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />');
if(!m.includes('POST_NOTIFICATIONS'))m=m.replace(/<manifest([^>]*)>/,'<manifest$1>\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />');
// share-in (Share > Midad) and the home-screen widget
const appMain=path.join(root,'android','app','src','main');
const javaDir=path.join(appMain,'java','app','midad','reader');
fs.mkdirSync(javaDir,{recursive:true});
for(const f of ['MainActivity.java','WidgetBridge.java','ContinueWidget.java'])fs.copyFileSync(path.join(__dirname,'android','java',f),path.join(javaDir,f));
for(const [d,f] of [['layout','widget_continue.xml'],['xml','widget_continue_info.xml'],['drawable','widget_bg.xml']]){
  fs.mkdirSync(path.join(appMain,'res',d),{recursive:true});fs.copyFileSync(path.join(__dirname,'android','res',d,f),path.join(appMain,'res',d,f));
}
const sf=path.join(appMain,'res','values','strings.xml');
let sx=fs.readFileSync(sf,'utf8');
if(!sx.includes('widget_desc'))sx=sx.replace('</resources>','    <string name="widget_desc">آخر فصل تقرؤه، واضغط لمتابعته</string>\n</resources>');
fs.writeFileSync(sf,sx);
if(!m.includes('android.intent.action.SEND')){
  // first </intent-filter> belongs to MainActivity (MAIN/LAUNCHER)
  m=m.replace('</intent-filter>','</intent-filter>\n            <intent-filter>\n                <action android:name="android.intent.action.SEND" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <data android:mimeType="text/plain" />\n            </intent-filter>');
}
if(!m.includes('.ContinueWidget')){
  m=m.replace('</application>','    <receiver android:name=".ContinueWidget" android:exported="false" android:label="مداد: تابع القراءة">\n            <intent-filter>\n                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />\n            </intent-filter>\n            <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_continue_info" />\n        </receiver>\n    </application>');
}
fs.writeFileSync(mf,m);
console.log('runner libs:',g.includes('background-runner/android'));console.log('patched',(g.match(/versionCode \d+/)||[])[0],(g.match(/versionName "[^"]*"/)||[])[0]);
