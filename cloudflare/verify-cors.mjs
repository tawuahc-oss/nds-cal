import assert from 'node:assert/strict';
import https from 'node:https';
function readApi(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {method: options.method || 'GET', headers: options.headers, agent: false}, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({status: res.statusCode, headers: {get: name => res.headers[name.toLowerCase()] ?? null}, json: async () => JSON.parse(body)}));
    });
    req.setTimeout(20000, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}
const base = 'https://nds-cal.tawuahc.workers.dev';
const allowed = ['https://tawuahc-oss.github.io', 'http://127.0.0.1:8080', 'http://localhost:8080'];
for (const origin of allowed) {
  const preflight = await readApi(base + '/api/admin/login', {method: 'OPTIONS', headers: {Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization'}, signal: AbortSignal.timeout(20000)});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Authorization/i);
  const health = await readApi(base + '/api/health', {headers: {Origin: origin}, signal: AbortSignal.timeout(20000)});
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('Access-Control-Allow-Origin'), origin);
  const healthData=await health.json();
  assert.equal(healthData.database,'connected');
  assert.ok(healthData.api_version>=6);
  const me = await readApi(base + '/api/admin/me', {headers: {Origin: origin}, signal: AbortSignal.timeout(20000)});
  assert.equal(me.status, 401);
  assert.equal(me.headers.get('Access-Control-Allow-Origin'), origin);
  console.log(origin + ': preflight 204, health 200, unauthenticated admin 401');
}
for (const origin of ['https://example.com', 'http://localhost:8081', 'null']) {
  const r = await readApi(base + '/api/health', {headers: {Origin: origin}, signal: AbortSignal.timeout(20000)});
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
  console.log(origin + ': rejected 403');
}
console.log('Live CORS checks passed.');
