import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {database,loadWorker} from './helpers.mjs';
const {default:worker}=await loadWorker();
test('concurrent failed login requests cannot bypass the five-attempt limiter',async()=>{
  const env=await database(),salt=Buffer.alloc(16,1);
  env.ADMIN_USERNAME='test-only-admin';
  env.ADMIN_PASSWORD_HASH='100000:'+salt.toString('hex')+':'+pbkdf2Sync('test-only-password',salt,100000,32,'sha256').toString('hex');
  const login=password=>worker.fetch(new Request('https://api.test/api/admin/login',{method:'POST',
    headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},
    body:JSON.stringify({username:env.ADMIN_USERNAME,password})}),env);
  try{
    const results=await Promise.all(Array.from({length:12},()=>login('wrong')));
    assert.equal(results.filter(r=>r.status===401).length,5);
    assert.equal(results.filter(r=>r.status===429).length,7);
    env.sqlite.exec('DELETE FROM login_attempts');
    const success=await login('test-only-password');assert.equal(success.status,200);
    const {token}=await success.json();assert.match(token,/^[0-9a-f]{64}$/);
    const request=(path,method='GET')=>worker.fetch(new Request('https://api.test'+path,{method,headers:{Authorization:'Bearer '+token}}),env);
    assert.equal((await request('/api/admin/me')).status,200);
    assert.equal((await request('/api/admin/logout','POST')).status,200);
    assert.equal((await request('/api/admin/me')).status,401);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) n FROM login_attempts').get().n,0);
  }finally{env.close();}
});
