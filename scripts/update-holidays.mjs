import https from 'node:https';
import {writeFile,mkdir} from 'node:fs/promises';
export function readUrl(url, redirects=0) {
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{agent:false},res=>{
      if(res.statusCode>=300&&res.statusCode<400&&res.headers.location&&redirects<4){
        res.resume();resolve(readUrl(new URL(res.headers.location,url),redirects+1));return;
      }
      if(res.statusCode!==200){res.resume();reject(new Error('Download HTTP '+res.statusCode));return;}
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(Buffer.concat(chunks)));
    });req.setTimeout(30000,()=>req.destroy(new Error('Download timed out')));req.on('error',reject);
  });
}
export function parseHolidays(ics) {
  const text=ics.replace(/\r?\n[ \t]/g,'');
  const events=[];
  for(const block of text.split('BEGIN:VEVENT').slice(1)){
    const date=block.match(/DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
    const summary=block.match(/(?:^|\n)SUMMARY:(.*)/);
    if(!date||!summary)throw Error('Unsupported holiday record');
    events.push({date:date[1]+'-'+date[2]+'-'+date[3],title:summary[1].trim().replace(/\\n/g,' ').replace(/\\([,;\\])/g,'$1')});
  }
  if(events.length<10)throw Error('Official holiday feed unexpectedly empty');
  return events.sort((a,b)=>a.date.localeCompare(b.date));
}
if(import.meta.url===new URL('file:///'+process.argv[1].replaceAll('\\','/')).href){
  const source='https://www.1823.gov.hk/common/ical/gc/tc.ics';
  const events=parseHolidays((await readUrl(source)).toString('utf8'));
  const result={source,retrieved_at:new Date().toISOString(),years:[...new Set(events.map(e=>e.date.slice(0,4)))],events};
  await mkdir(new URL('../assets/data/',import.meta.url),{recursive:true});
  await writeFile(new URL('../assets/data/hk-holidays.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
  console.log('Official HK holidays updated for '+result.years.join(', '));
}
