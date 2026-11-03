import test from 'node:test';
import assert from 'node:assert/strict';
import {database,loadWorker} from './helpers.mjs';
const {default:worker}=await loadWorker();
test('archive preview protects active series and the web API cannot perform cleanup',async()=>{
  const env=await database();
  const call=(path,body)=>worker.fetch(new Request('https://api.test'+path,{method:body?'POST':'GET',
    headers:{Authorization:'Bearer '+env.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env);
  try{
    const insert=env.sqlite.prepare('INSERT INTO events(id,title,start_at,end_at,all_day) VALUES(?,?,?,?,1)');
    insert.run('past','old plain','2023-01-01',null);
    insert.run('future','future','2030-01-01',null);
    insert.run('cross','cross cutoff','2024-12-31','2025-01-02');
    for(const id of ['ongoing','ended','excepted'])insert.run(id,id,'2023-01-02',null);
    const recurrence=env.sqlite.prepare('INSERT INTO recurrence_rules(id,event_id,frequency,interval_value,until_date) VALUES(?,?,?,1,?)');
    recurrence.run('r-ongoing','ongoing','weekly',null);
    recurrence.run('r-ended','ended','weekly','2023-12-31');
    recurrence.run('r-excepted','excepted','weekly','2023-12-31');
    env.sqlite.prepare("INSERT INTO event_exceptions(id,recurrence_rule_id,original_start_at,action,override_json) VALUES('x','r-excepted','2023-01-02','modified',?)")
      .run(JSON.stringify({start_at:'2030-01-01'}));
    const before='2025-01-01',preview=await (await call('/api/admin/archive-preview?before='+before)).json();
    assert.deepEqual(preview.candidates.map(e=>e.id).sort(),['ended','past']);
    assert.equal((await call('/api/admin/archive-cleanup',{before})).status,404);
    const result=await call('/api/admin/archive-cleanup',{before,backup_confirmed:true,confirm:'DELETE BEFORE '+before});
    assert.equal(result.status,404);
    assert.deepEqual(env.sqlite.prepare('SELECT id FROM events ORDER BY id').all().map(e=>e.id),['cross','ended','excepted','future','ongoing','past']);
    assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM event_exceptions").get().n,1);
    assert.equal(env.sqlite.prepare("SELECT COUNT(*) n FROM admin_sessions").get().n,1);
  }finally{env.close();}
});
