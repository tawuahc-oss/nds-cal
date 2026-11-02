import test from 'node:test';
import assert from 'node:assert/strict';
import {database,loadWorker} from './helpers.mjs';
const {default:worker}=await loadWorker();
test('admin pagination has a stable order and does not lose records beyond the first page',async()=>{
  const env=await database();
  try{
    const insert=env.sqlite.prepare('INSERT INTO events(id,title,start_at,all_day) VALUES(?,?,?,1)');
    for(let i=0;i<505;i++)insert.run(String(i).padStart(4,'0'),'event '+i,'2026-11-02');
    const fetch=offset=>worker.fetch(new Request('https://api.test/api/admin/events?limit=200&offset='+offset,{headers:{Authorization:'Bearer '+env.token}}),env);
    const a=await (await fetch(0)).json(),b=await (await fetch(200)).json(),c=await (await fetch(400)).json();
    assert.equal(a.events.length,200);assert.equal(b.events.length,200);assert.equal(c.events.length,105);
    assert.equal(a.has_more,true);assert.equal(c.has_more,false);
    assert.equal(new Set([...a.events,...b.events,...c.events].map(e=>e.id)).size,505);
    assert.equal((await fetch(-1)).status,400);
  }finally{env.close();}
});
