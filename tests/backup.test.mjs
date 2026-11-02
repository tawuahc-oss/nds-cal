import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarBackup,restoreCheck} from '../scripts/backup-format.mjs';
test('backup allowlist excludes auth, recovers quoted Chinese text, and verifies SQL roundtrip',async()=>{
  const snapshot=calendarBackup({
    events:[{id:'event-1',title:"學生's 聚會",start_at:'2026-11-02',all_day:1}],
    categories:[],recurrence_rules:[],event_exceptions:[],
    admin_sessions:[{token_hash:'must-not-export'}],admin_credentials:[{password_hash:'must-not-export'}],audit_logs:[{details_json:'internal'}]
  });
  assert.deepEqual(Object.keys(snapshot.tables),['categories','events','recurrence_rules','event_exceptions']);
  assert.ok(!JSON.stringify(snapshot).includes('must-not-export'));
  const {counts,sql}=await restoreCheck(snapshot);
  assert.equal(counts.events,1);assert.ok(sql.includes("學生''s 聚會"));
});
test('restore rejects invalid foreign keys and unknown data columns',async()=>{
  const valid={categories:[],events:[],recurrence_rules:[],event_exceptions:[]};
  await assert.rejects(()=>restoreCheck(calendarBackup({...valid,events:[{id:'x',title:'bad',start_at:'2026-01-01',all_day:1,category_id:'missing'}]})));
  await assert.rejects(()=>restoreCheck(calendarBackup({...valid,events:[{id:'x',unexpected_column:'bad'}]})));
});
