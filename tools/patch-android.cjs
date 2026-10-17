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
fs.writeFileSync(f,g);
const mf=path.join(root,'android','app','src','main','AndroidManifest.xml');
let m=fs.readFileSync(mf,'utf8');
if(!m.includes('REQUEST_INSTALL_PACKAGES'))m=m.replace(/<manifest([^>]*)>/,'<manifest$1>\n    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />');
fs.writeFileSync(mf,m);
console.log('patched',(g.match(/versionCode \d+/)||[])[0],(g.match(/versionName "[^"]*"/)||[])[0]);
