import test from 'node:test';
import assert from 'node:assert/strict';
import calendar from '../worker.js';
import {database,baseEvent} from './helpers.mjs';
function backups(){
  const rows=new Map(),jobs=[];
  return {rows,ctx:{waitUntil(job){jobs.push(job);}},async flush(){await Promise.all(jobs.splice(0));},
    kv:{async get(key){return rows.has(key)?JSON.parse(rows.get(key)):null;},async put(key,value){rows.set(key,value);}}};
}
test('calendar outages serve sanitized backups; admin writes fail until live editing recovers',async()=>{
  const env=await database(),backup=backups();env.PUBLIC_BACKUPS=backup.kv;
  const request=(path,method='GET',body)=>new Request('https://cal.example'+path,{method,headers:{Authorization:'Bearer '+env.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const year=new Date().getUTCFullYear(),start=year+'-11-02';
  const created=await calendar.fetch(request('/api/admin/calendar-events','POST',{event:{...baseEvent,start_at:start,notes:'PRIVATE_TEST_NOTE'},rule:null}),env,backup.ctx);
  assert.equal(created.status,201);const id=(await created.json()).event.id;await backup.flush();
  assert.ok(backup.rows.size>=3);
  assert.equal([...backup.rows.values()].some(value=>value.includes('PRIVATE_TEST_NOTE')),false);
  const realDB=env.DB;env.DB={prepare(){throw Error('simulated database outage');}};
  const path='/api/calendar?from='+year+'-11-01&to='+year+'-11-30';
  const failed=await calendar.fetch(request(path),env,backup.ctx),data=await failed.json();
  assert.equal(failed.status,200);assert.equal(data.stale,true);assert.ok(data.backup_saved_at);
  assert.equal(data.events.find(row=>row.id===id).notes,undefined);
  assert.equal((await calendar.fetch(request('/api/admin/calendar-events/'+id,'PUT',{event:{...baseEvent,start_at:start,title:'Should not save'},rule:null}),env,backup.ctx)).status,500);
  env.DB=realDB;
  const updated=await calendar.fetch(request('/api/admin/calendar-events/'+id,'PUT',{event:{...baseEvent,start_at:start,title:'Editing works again'},rule:null}),env);
  assert.equal(updated.status,200);
  const live=await (await calendar.fetch(request(path),env)).json();
  assert.equal(live.stale,undefined);assert.equal(live.events.find(row=>row.id===id).title,'Editing works again');
  env.close();
});
