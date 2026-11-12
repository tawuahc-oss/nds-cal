import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildOfflineWorker} from '../offline-sw.mjs';

test('offline worker caches only public data, isolates date ranges and never handles admin requests',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'nds-sw-'));
  try{
    await writeFile(join(folder,'index.html'),'<html>Public shell</html>');
    const root=pathToFileURL(folder+'/');
    const {source}=await buildOfflineWorker(root,['./index.html'],'calendar',['/api/calendar']);
    const handlers={},entries=new Map();let failing=false,invalid=false;
    const cache={async match(key){return entries.get(typeof key==='string'?key:key.url)?.clone();},async put(key,value){
      assert.equal(key.headers.get('Authorization'),null);assert.equal(key.headers.get('Cookie'),null);entries.set(key.url,value.clone());
    }};
    const context={URL,Request,Response,Headers,AbortController,setTimeout,clearTimeout,Date,
      self:{registration:{scope:'https://cal.example/'},location:{origin:'https://cal.example'},addEventListener(type,handler){handlers[type]=handler;}},
      caches:{open:async()=>cache},fetch:async()=>{if(failing)throw Error('offline');return Response.json(invalid?{error:'broken'}:{events:[{id:'public',notes:'PRIVATE'}]});}};
    vm.createContext(context);vm.runInContext(source,context);
    const request=path=>new Request('https://cal.example'+path,{headers:{Authorization:'Bearer TEST_SECRET'}});
    const run=async req=>{let response;handlers.fetch({request:req,respondWith(value){response=value;}});return response?await response:null;};
    const month='/api/calendar?from=2026-11-01&to=2026-11-30';
    assert.equal((await run(request(month))).status,200);
    assert.equal([...entries.values()].length,1);
    assert.equal(await run(request('/api/admin/calendar')),null);
    failing=true;
    const saved=await (await run(request(month))).json();assert.equal(saved.stale,true);assert.equal(saved.events[0].notes,undefined);assert.ok(saved.backup_saved_at);
    assert.equal((await run(request('/api/calendar?from=2027-01-01&to=2027-01-31'))).status,503);
    assert.equal(await run(new Request('https://cal.example/api/admin/login',{method:'POST',body:'{}'})),null);
    failing=false;invalid=true;
    assert.equal((await (await run(request(month))).json()).stale,true);
    invalid=false;assert.equal((await (await run(request(month))).json()).stale,undefined);
  }finally{
    if(!resolve(folder).startsWith(resolve(tmpdir())+requireSeparator()))throw Error('Unsafe cleanup');
    await rm(folder,{recursive:true,force:true});
  }
});
function requireSeparator(){return resolve(tmpdir()).includes('\\')?'\\':'/';}
