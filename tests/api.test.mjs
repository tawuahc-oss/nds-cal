import test from 'node:test';
import assert from 'node:assert/strict';
import { database, loadWorker, baseEvent, rule } from './helpers.mjs';
const {default: worker} = await loadWorker();
function call(env,path,method='GET',body,authenticated=true) {
  return worker.fetch(new Request('https://nds-cal.tawuahc.workers.dev'+path,{
    method,headers:{Origin:'http://127.0.0.1:8080',...(authenticated?{Authorization:'Bearer '+env.token}:{}),
      ...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined
  }),env);
}
test('single save atomically creates event, ordinal rule and audit; public API expands it',async()=>{
  const env=await database();
  try {
    const r=await call(env,'/api/admin/calendar-events','POST',{event:baseEvent,rule:rule()});
    assert.equal(r.status,201);
    const saved=await r.json();
    assert.ok(saved.recurrence_rule_id);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM events').get().n,1);
    const list=await call(env,'/api/events?from=2026-11-01&to=2027-04-30','GET',null,false);
    const dates=(await list.json()).events.map(x=>x.start_at);
    assert.deepEqual(dates,['2026-11-02','2026-12-07','2027-01-04','2027-02-01','2027-03-01','2027-04-05']);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,1);
  } finally {env.close();}
});
test('validation and transaction failure leave no partially created event',async()=>{
  const env=await database();
  try{
    assert.equal((await call(env,'/api/admin/calendar-events','POST',{event:baseEvent,rule:rule({by_weekday:'2MO'})})).status,400);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM events').get().n,0);
    env.sqlite.exec("CREATE TRIGGER test_failure BEFORE INSERT ON recurrence_rules BEGIN SELECT RAISE(ABORT,'test transaction failure'); END");
    assert.equal((await call(env,'/api/admin/calendar-events','POST',{event:baseEvent,rule:rule()})).status,500);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM events').get().n,0);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,0);
  }finally{env.close();}
});
test('single occurrence modifications, cancellation, restore, series schedule protection and cascade delete',async()=>{
  const env=await database();
  try{
    const created=await (await call(env,'/api/admin/calendar-events','POST',{event:baseEvent,rule:rule()})).json();
    const path='/api/admin/recurrences/'+created.recurrence_rule_id;
    assert.equal((await call(env,path+'/exceptions','POST',{original_start_at:'2026-12-07',action:'cancelled'})).status,200);
    let events=(await (await call(env,'/api/events?from=2026-12-01&to=2026-12-31','GET',null,false)).json()).events;
    assert.equal(events.length,0);
    assert.equal((await call(env,'/api/admin/calendar-events/'+created.event.id,'PUT',{event:baseEvent,rule:null})).status,409);
    assert.equal((await call(env,'/api/admin/calendar-events/'+created.event.id,'PUT',{event:{...baseEvent,title:'改名'},rule:rule()})).status,200);
    assert.equal((await call(env,path+'/exceptions/2026-12-07','DELETE')).status,200);
    assert.equal((await call(env,path+'/exceptions','POST',{original_start_at:'2026-12-07',action:'modified',override:{start_at:'2027-01-15',location:'禮堂'}})).status,200);
    events=(await (await call(env,'/api/events?from=2027-01-01&to=2027-01-31','GET',null,false)).json()).events;
    assert.ok(events.some(e=>e.start_at==='2027-01-15' && e.location==='禮堂'));
    assert.equal((await call(env,path,'DELETE')).status,200);
    for(const table of ['events','recurrence_rules','event_exceptions'])assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
  }finally{env.close();}
});
test('all admin routes require auth; export excludes sessions and login attempts; original CRUD still works',async()=>{
  const env=await database();
  try{
    for(const path of ['/api/admin/categories','/api/admin/events','/api/admin/recurrences','/api/admin/export','/api/admin/me']){
      assert.equal((await call(env,path,'GET',null,false)).status,401);
    }
    assert.equal((await call(env,'/api/admin/calendar-events','POST',{event:baseEvent,rule:rule()},false)).status,401);
    const category=await (await call(env,'/api/admin/categories','POST',{name:'學生',color:'#4488AA',sort_order:0})).json();
    const created=await (await call(env,'/api/admin/events','POST',{...baseEvent,category_id:category.category.id})).json();
    assert.equal((await call(env,'/api/admin/events/'+created.event.id,'PUT',{...baseEvent,title:'更新'})).status,200);
    assert.equal((await call(env,'/api/admin/events/'+created.event.id,'DELETE')).status,200);
    assert.equal((await call(env,'/api/admin/categories/'+category.category.id,'DELETE')).status,200);
    const exported=await (await call(env,'/api/admin/export')).json();
    assert.equal(exported.format,'nds-cal-export');
    assert.equal(exported.tables.admin_sessions,undefined);
    assert.equal(exported.tables.login_attempts,undefined);
    assert.ok(Array.isArray(exported.tables.audit_logs));
  }finally{env.close();}
});
