// Isolated UI test server. No Cloudflare bindings, real credentials or network writes.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pbkdf2Sync } from 'node:crypto';
import { database, baseEvent, rule } from '../tests/helpers.mjs';
import worker from '../worker.js';
const env=await database();
env.ADMIN_USERNAME='preview-admin';
const salt=Buffer.alloc(16,7);
env.ADMIN_PASSWORD_HASH='100000:'+salt.toString('hex')+':'+pbkdf2Sync('preview-only',salt,100000,32,'sha256').toString('hex');
env.sqlite.prepare('INSERT INTO events(id,title,start_at,all_day) VALUES(?,?,?,1)')
  .run('22222222-2222-4222-8222-222222222222',baseEvent.title,baseEvent.start_at);
env.sqlite.prepare('INSERT INTO recurrence_rules(id,event_id,frequency,interval_value,by_weekday) VALUES(?,?,?,?,?)')
  .run('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',rule().frequency,1,'1MO');
const root=new URL('../',import.meta.url);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1:8081');
    if(url.pathname.startsWith('/api/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=Buffer.concat(chunks);
      const request=new Request('https://preview.invalid'+url.pathname+url.search,{method:req.method,
        headers:{...req.headers,origin:'http://127.0.0.1:8080'},
        body:['GET','HEAD'].includes(req.method)?undefined:body});
      const response=await worker.fetch(request,env);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
    }
    const path=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(path!=='index.html'&&!/^assets\/[\w./-]+\.(?:js|css|json|ttf)$/.test(path)){res.writeHead(404);res.end();return;}
    if(path.split('/').includes('..')){res.writeHead(404);res.end();return;}
    const content=await readFile(new URL(path,root));
    res.writeHead(200,{'Content-Type':types['.'+path.split('.').pop()]||'text/plain','Cache-Control':'no-store'});res.end(content);
  }catch(error){res.writeHead(500);res.end('Preview error');console.error(error.message);}
});
server.listen(8081,'127.0.0.1',()=>console.log('Isolated preview: http://127.0.0.1:8081/?preview=1'));
