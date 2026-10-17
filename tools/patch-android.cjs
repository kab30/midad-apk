// After `npx cap add android`: sign every build with the key in keystore/ (so updates install over the old app)
// and give each build a higher version number.
const fs=require('fs'),path=require('path');
const f=path.join(__dirname,'..','android','app','build.gradle');
let g=fs.readFileSync(f,'utf8');
const run=process.env.RUN||'1';
g=g.replace(/versionCode\s+\d+/, 'versionCode '+(100+Number(run)));
g=g.replace(/versionName\s+"[^"]*"/, 'versionName "1.'+run+'"');
if(!g.includes('midad-signing')){
  g=g.replace(/android\s*\{/, `android {
    // midad-signing: one fixed key for every build
    signingConfigs {
        debug {
            storeFile file("\${rootProject.projectDir}/../keystore/debug.keystore")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }
    }`);
}
fs.writeFileSync(f,g);
console.log('patched', (g.match(/versionCode \d+/)||[])[0], (g.match(/versionName "[^"]*"/)||[])[0]);
