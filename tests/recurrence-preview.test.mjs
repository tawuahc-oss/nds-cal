import test from 'node:test';
import assert from 'node:assert/strict';
import {database,loadWorker,baseEvent,rule} from './helpers.mjs';
const {default:worker}=await loadWorker();
const preview=(env,event=baseEvent,recurrence=rule(),authorized=true)=>worker.fetch(new Request('https://example.test/api/admin/recurrence-preview',{
  method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:'Bearer '+env.token}:{})},
  body:JSON.stringify({event,rule:recurrence})
}),env);

test('preview distinguishes first Monday from fixed day and never writes calendar data',async()=>{
  const env=await database();
  try{
    const response=await preview(env);
    assert.equal(response.status,200);
    const data=await response.json();
    assert.deepEqual(data.starts.slice(0,6),['2026-11-02','2026-12-07','2027-01-04','2027-02-01','2027-03-01','2027-04-05']);
    assert.equal(data.total,13);
    const fixed=await (await preview(env,baseEvent,rule({by_weekday:null}))).json();
    assert.deepEqual(fixed.starts.slice(0,3),['2026-11-02','2026-12-02','2027-01-02']);
    for(const table of ['events','recurrence_rules','event_exceptions','audit_logs'])
      assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
  }finally{env.close();}
});
test('preview requires login, validates anchor and bounds infinite daily rules',async()=>{
  const env=await database();
  try{
    assert.equal((await preview(env,baseEvent,rule(),false)).status,401);
    assert.equal((await preview(env,baseEvent,rule({by_weekday:'2MO'}))).status,400);
    const daily=await (await preview(env,baseEvent,rule({frequency:'daily',by_weekday:null}))).json();
    assert.equal(daily.total,366);
    assert.equal(daily.starts.length,12);
    assert.equal(daily.to,'2027-11-02');
    const counted=await (await preview(env,baseEvent,rule({occurrence_count:2}))).json();
    assert.equal(counted.total,2);
    const fifth=await (await preview(env,{...baseEvent,start_at:'2026-11-30'},rule({by_weekday:'5MO',occurrence_count:3}))).json();
    assert.deepEqual(fifth.starts,['2026-11-30','2027-03-29','2027-05-31']);
  }finally{env.close();}
});
