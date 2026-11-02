import test from 'node:test';
import assert from 'node:assert/strict';
import {database,loadWorker} from './helpers.mjs';
const {default:worker}=await loadWorker();
test('large bodies, malformed JSON and unapproved origins are rejected before writes',async()=>{
  const env=await database();
  try{
    const request=(body,origin='http://127.0.0.1:8080')=>worker.fetch(new Request('https://api.test/api/admin/calendar-events',{
      method:'POST',headers:{Origin:origin,Authorization:'Bearer '+env.token,'Content-Type':'application/json'},body
    }),env);
    assert.equal((await request('x'.repeat(20000))).status,413);
    assert.equal((await request('{broken')).status,400);
    assert.equal((await request('{}','https://example.com')).status,403);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM events').get().n,0);
  }finally{env.close();}
});
