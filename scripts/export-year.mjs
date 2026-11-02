import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import lunar from 'lunar-javascript';
import worker from '../worker.js';
import {calendarPdf,detailsPdf} from '../assets/pdf-source.js';
import {restoreCheck} from './backup-format.mjs';
if(!process.argv[2]||!/^\d{4}$/.test(process.argv[3]||''))throw Error('Usage: node scripts/export-year.mjs backup.json YEAR [output-directory]');
const backup=JSON.parse(await readFile(process.argv[2],'utf8')),year=process.argv[3],from=year+'-01-01',to=year+'-12-31';
const {sql}=await restoreCheck(backup),db=new DatabaseSync(':memory:');db.exec(sql);
try{
  const env={DB:{prepare:sql=>{let params=[];const query={bind(...v){params=v;return query;},async all(){return {results:db.prepare(sql).all(...params)};},async first(){return db.prepare(sql).get(...params)||null;}};return query;}}};
  const response=await worker.fetch(new Request('https://local-export.invalid/api/events?from='+from+'&to='+to),env);
  if(!response.ok)throw Error('Calendar expansion failed: '+response.status);
  const {events}=await response.json(),fontBytes=await readFile(new URL('../assets/fonts/NotoSansTC.ttf',import.meta.url));
  const holidays=JSON.parse(await readFile(new URL('../assets/data/hk-holidays.json',import.meta.url),'utf8')).events;
  const output=resolve(process.argv[4]||'output/pdf');await mkdir(output,{recursive:true});
  await writeFile(resolve(output,'nds-cal-'+year+'-calendar.pdf'),await calendarPdf({from,to,events,fontBytes,Solar:lunar.Solar,holidays}));
  await writeFile(resolve(output,'nds-cal-'+year+'-details.pdf'),await detailsPdf({from,to,events,backup,fontBytes}));
  console.log('Annual reports exported for '+year+'; occurrences: '+events.length);
}finally{db.close();}
