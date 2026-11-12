import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function buildOfflineWorker(root,paths,project,publicPaths){
  const content=await Promise.all(paths.map(path=>readFile(new URL(path,root))));
  const hash=createHash('sha256');for(const bytes of content)hash.update(bytes);
  const version=hash.digest('hex').slice(0,16);
  const source=`const SHELL=${JSON.stringify('nds-shell-'+project+'-')};
const STATIC=SHELL+${JSON.stringify(version)},DATA=${JSON.stringify('nds-public-'+project)};
const ASSETS=${JSON.stringify(paths)},PUBLIC=${JSON.stringify(publicPaths)};
const absolute=path=>new URL(path,self.registration.scope).href;
self.addEventListener('install',event=>event.waitUntil(caches.open(STATIC).then(cache=>cache.addAll(ASSETS.map(absolute))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(SHELL)&&key!==STATIC).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
async function online(request){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{return await fetch(request,{signal:controller.signal});}finally{clearTimeout(timer);}}
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.includes('/api/admin/'))return;
  if(PUBLIC.includes(url.pathname)){
    event.respondWith((async()=>{
      const cache=await caches.open(DATA),key=new Request(url.href);
      try{
        const response=await online(request);
        if(!response.ok&&response.status>=500)throw Error('Unavailable');
        if(response.ok&&!response.headers.has('Set-Cookie')){
          const body=await response.clone().json();
          const valid=url.pathname==='/api/categories'?Array.isArray(body.categories):url.pathname==='/api/public'?Array.isArray(body.weekly_events)&&Array.isArray(body.monthly_announcements):Array.isArray(body.events);
          if(!valid)throw Error('Invalid public data');
          if(!body.stale){
            ${project==='calendar'?"if(body.events)body.events=body.events.map(({notes,...event})=>event);":''}
            await cache.put(key,new Response(JSON.stringify({saved_at:new Date().toISOString(),body}),{headers:{'Content-Type':'application/json'}}));
          }
        }
        return response;
      }catch{
        const saved=await cache.match(key);
        if(!saved)return Response.json({error:'沒有這個日期範圍的離線資料，請連線後再試。'},{status:503});
        const data=await saved.json();
        return Response.json({...data.body,stale:true,backup_saved_at:data.saved_at},{headers:{'Cache-Control':'no-store','X-Data-Backup':'1'}});
      }
    })());return;
  }
  if(request.mode==='navigate'){
    event.respondWith((async()=>{try{const response=await online(request);if(!response.ok&&response.status>=500)throw Error('Unavailable');return response;}catch{return (await caches.match(absolute('./index.html'),{cacheName:STATIC}))||Response.error();}})());return;
  }
  const allowed=ASSETS.some(path=>new URL(path,self.registration.scope).pathname===url.pathname);
  if(allowed)event.respondWith(caches.open(STATIC).then(async cache=>{
    const saved=await cache.match(url.href)||await cache.match(url.href,{ignoreSearch:true});
    if(saved)return saved;
    const response=await online(request);if(response.ok)await cache.put(new Request(url.href),response.clone());return response;
  }));
});
`;
  await writeFile(new URL('sw.js',root),source);
  return {version,source};
}
