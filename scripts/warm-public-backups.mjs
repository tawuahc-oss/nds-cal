// Fetch public endpoints only. The Workers persist sanitized backup snapshots in the background.
const year=Number(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric'}).format(new Date()));
const requests=[
  ...[-1,0,1].map(offset=>['calendar '+(year+offset),'https://nds-cal.tawuahc.workers.dev/api/calendar?from='+(year+offset)+'-01-01&to='+(year+offset)+'-12-31']),
  ['weekly','https://nds-weekly.tawuahc.workers.dev/api/public']
];
for(const [name,url]of requests){
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  if(!response.ok||data.stale)throw Error(name+': live data unavailable ('+response.status+')');
  if(data.events?.some(event=>'notes' in event))throw Error('Private calendar notes in public response');
  console.log(JSON.stringify({name,status:response.status,events:data.events?.length??data.weekly_events?.length,notices:data.monthly_announcements?.length}));
}
