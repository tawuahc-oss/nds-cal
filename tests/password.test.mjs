import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {database,loadWorker} from './helpers.mjs';
const {default:worker}=await loadWorker();
test('password changes are explicit, revoke sessions and do not mutate Secrets; recovery is single-use',async()=>{
  const env=await database(),salt=Buffer.alloc(16,4);
  env.ADMIN_USERNAME='test-admin';
  env.ADMIN_PASSWORD_HASH='100000:'+salt.toString('hex')+':'+pbkdf2Sync('original-test-password',salt,100000,32,'sha256').toString('hex');
  const original=env.ADMIN_PASSWORD_HASH;
  const call=(path,body,token=env.token)=>worker.fetch(new Request('https://api.test'+path,{
    method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),'CF-Connecting-IP':'192.0.2.15'},body:JSON.stringify(body)
  }),env);
  try{
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM admin_credentials').get().n,0);
    assert.equal((await call('/api/admin/change-password',{current_password:'original-test-password',new_password:'12345678'})).status,400);
    assert.equal((await call('/api/admin/change-password',{current_password:'wrong',new_password:'long-new-test-password'})).status,400);
    assert.equal((await call('/api/admin/change-password',{current_password:'original-test-password',new_password:'long-new-test-password'})).status,200);
    assert.equal(env.ADMIN_PASSWORD_HASH,original);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,0);
    const old=await call('/api/admin/login',{username:env.ADMIN_USERNAME,password:'original-test-password'},null);assert.equal(old.status,401);
    const login=await call('/api/admin/login',{username:env.ADMIN_USERNAME,password:'long-new-test-password'},null);
    const token=(await login.json()).token;assert.ok(token);
    const code=(await (await call('/api/admin/recovery-code',{current_password:'long-new-test-password'},token)).json()).recovery_code;
    assert.match(code,/^[a-f0-9]{64}$/);
    assert.notEqual(env.sqlite.prepare('SELECT recovery_hash FROM admin_credentials').get().recovery_hash,code);
    const resets=await Promise.all([
      call('/api/admin/reset-password',{recovery_code:code,new_password:'reset-test-password-one'},null),
      call('/api/admin/reset-password',{recovery_code:code,new_password:'reset-test-password-two'},null)
    ]);
    assert.deepEqual(resets.map(r=>r.status).sort(),[200,401]);
    assert.equal(env.sqlite.prepare('SELECT recovery_hash FROM admin_credentials').get().recovery_hash,null);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM admin_sessions').get().n,0);
    const audit=JSON.stringify(env.sqlite.prepare('SELECT details_json FROM audit_logs').all());
    assert.ok(!audit.includes(code)&&!audit.includes('test-password'));
    const exported=await worker.fetch(new Request('https://api.test/api/admin/export'),env);
    assert.equal(exported.status,401);
  }finally{env.close();}
});
