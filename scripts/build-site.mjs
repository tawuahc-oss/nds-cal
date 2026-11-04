import {createHash} from 'node:crypto';
import {mkdir,rm,copyFile,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),dist=resolve(root,'dist');
if(dirname(dist)!==resolve(root))throw Error('Unsafe output path');
// dist is generated only; never package source, backups, tests or credentials.
await rm(dist,{recursive:true,force:true});
await mkdir(dist,{recursive:true});
let html = await readFile(new URL('../index.html',import.meta.url),'utf8');
for (const name of ['calendar.css','app.js']) {
  const content = await readFile(new URL('../assets/'+name,import.meta.url));
  const revision = createHash('sha256').update(content).digest('hex').slice(0,12);
  const reference = new RegExp('(\\./assets/'+name.replace('.', '\\.')+')(?:\\?[^\"]*)?', 'g');
  html = html.replace(reference, '$1?v='+revision);
}
await writeFile(resolve(dist,'index.html'),html);
await copyFile(new URL('../manifest.webmanifest',import.meta.url),resolve(dist,'manifest.webmanifest'));
const files=['icons/calendar-180.png','icons/calendar-192.png','icons/calendar-512.png','calendar.css','app.js','lunar-info.js','recurrence-form.js','pdf.js',
  'vendor/lunar.js','vendor/lunar.LICENSE','fonts/NotoSansTC.ttf','fonts/OFL.txt','data/hk-holidays.json'];
for(const name of files){const target=resolve(dist,'assets',name);await mkdir(dirname(target),{recursive:true});await copyFile(new URL('../assets/'+name,import.meta.url),target);}
console.log('Public site packaged: index.html and '+files.length+' allowed assets. Test pages and all backups excluded.');

await writeFile(resolve(dist,'_headers'),"/\n  Cache-Control: no-store\n/index.html\n  Cache-Control: no-store\n");
