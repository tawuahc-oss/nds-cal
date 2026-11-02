import {mkdir,rm,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),dist=resolve(root,'dist');
if(dirname(dist)!==resolve(root))throw Error('Unsafe output path');
// dist is generated only; never package source, backups, tests or credentials.
await rm(dist,{recursive:true,force:true});
await mkdir(dist,{recursive:true});
await copyFile(new URL('../index.html',import.meta.url),resolve(dist,'index.html'));
const files=['calendar.css','app.js','lunar-info.js','recurrence-form.js','pdf.js',
  'vendor/lunar.js','vendor/lunar.LICENSE','fonts/NotoSansTC.ttf','fonts/OFL.txt','data/hk-holidays.json'];
for(const name of files){const target=resolve(dist,'assets',name);await mkdir(dirname(target),{recursive:true});await copyFile(new URL('../assets/'+name,import.meta.url),target);}
console.log('Public site packaged: index.html and '+files.length+' allowed assets. Test pages and all backups excluded.');
